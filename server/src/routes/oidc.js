import crypto from 'node:crypto'
import express, { Router } from 'express'
import * as jose from 'jose'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { OIDC_KEY_ID, getPublicJwk, getPublicKeyObject, getSigningKey } from '../lib/oidcKeys.js'
import { verifyAppToken } from '../lib/appToken.js'

// A minimal OIDC provider so external tools (BookStack today, possibly other
// services later) can log in as "whoever is already signed into Manager"
// without their own separate login screen. Manager stays the one place
// users authenticate with Google; everything else just trusts this.
const router = Router()

const AUTH_CODE_TTL_MS = 60_000
const ID_TOKEN_TTL_SEC = 300
const ACCESS_TOKEN_TTL_SEC = 3600

function issuerUrl() {
  return process.env.OIDC_ISSUER
}

// Points at our own /api/avatar/:userId instead of the raw stored value, so
// consumers (BookStack) always see whatever picture is currently set here,
// not a snapshot taken at login time.
function avatarUrl(userId) {
  return `${process.env.FRONTEND_ORIGIN}/api/avatar/${userId}`
}

router.get('/.well-known/openid-configuration', (req, res) => {
  const issuer = issuerUrl()
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    claims_supported: ['sub', 'email', 'name', 'picture'],
    code_challenge_methods_supported: ['S256', 'plain'],
  })
})

router.get('/.well-known/jwks.json', async (req, res) => {
  const jwk = await getPublicJwk()
  res.json({ keys: [jwk] })
})

// Step 1: browser lands here (full page navigation, so only cookies travel —
// no Bearer header). If `manager_session` proves they're already logged in,
// we skip straight to issuing a code; otherwise we bounce to our own login
// page and back.
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method } = req.query

  if (response_type !== 'code') {
    return res.status(400).send('unsupported response_type')
  }
  if (client_id !== process.env.OIDC_CLIENT_ID || redirect_uri !== process.env.OIDC_REDIRECT_URI) {
    return res.status(400).send('unknown client_id or redirect_uri')
  }

  let userId = null
  const sessionToken = req.cookies?.manager_session
  if (sessionToken) {
    try {
      userId = verifyAppToken(sessionToken).sub
    } catch {
      userId = null
    }
  }

  // The cookie's signature only proves it was minted here, not that the
  // account still exists. Withdrawal clears the cookie in the browser that
  // asked for it (me.js) — every other browser keeps a signed cookie that
  // stays valid for the rest of its 7 days, and without this lookup we'd
  // keep handing out fresh board logins for an account that's gone.
  // requireAuth does the same check for the SPA's API calls; this is the
  // other door into the same building.
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deactivatedAt: true },
    })
    if (!user || user.deactivatedAt) userId = null
  }

  // Falling through to the login redirect (rather than erroring) is
  // deliberate: a withdrawn user who signs in with Google again is
  // reactivated by auth.js, and this request then completes on its own.
  if (!userId) {
    const resumeUrl = `/oidc/authorize?${new URLSearchParams(req.query).toString()}`
    const loginUrl = `${process.env.FRONTEND_ORIGIN}/?continue=${encodeURIComponent(resumeUrl)}`
    return res.redirect(loginUrl)
  }

  const code = crypto.randomBytes(32).toString('base64url')
  await prisma.oidcAuthCode.create({
    data: {
      code,
      userId,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  })

  const redirectUrl = new URL(redirect_uri)
  redirectUrl.searchParams.set('code', code)
  if (state) redirectUrl.searchParams.set('state', state)
  res.redirect(redirectUrl.toString())
})

function readClientCredentials(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Basic ')) {
    const [clientId, clientSecret] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')
    return { clientId, clientSecret }
  }
  return { clientId: req.body.client_id, clientSecret: req.body.client_secret }
}

// Step 2: BookStack's own server calls this directly (not through the
// user's browser) to exchange the code for tokens.
router.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
  const { clientId, clientSecret } = readClientCredentials(req)
  if (clientId !== process.env.OIDC_CLIENT_ID || clientSecret !== process.env.OIDC_CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' })
  }

  const { grant_type, code, redirect_uri, code_verifier } = req.body
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' })
  }

  const authCode = code
    ? await prisma.oidcAuthCode.findUnique({ where: { code }, include: { user: true } })
    : null
  if (!authCode || authCode.expiresAt < new Date() || authCode.redirectUri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant' })
  }

  // Withdrawal can land in the 60 seconds between /authorize issuing this
  // code and BookStack redeeming it. Without this the id_token would be
  // signed for a withdrawn account, carrying a null email claim (me.js
  // blanks the field), and BookStack would create a session from it.
  if (authCode.user.deactivatedAt) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'account withdrawn' })
  }

  // deleteMany (never throws if the row is already gone), not delete — a
  // client retry after a perceived timeout can send the same code twice in
  // quick succession, and both requests can pass the findUnique check above
  // before either delete commits. Whichever request's delete actually
  // removes the row (count === 1) wins the exchange; the loser gets a clean
  // invalid_grant instead of crashing on delete's "record not found".
  const { count } = await prisma.oidcAuthCode.deleteMany({ where: { code } })
  if (count === 0) {
    return res.status(400).json({ error: 'invalid_grant' })
  }

  if (authCode.codeChallenge) {
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'missing code_verifier' })
    }
    const expected =
      authCode.codeChallengeMethod === 'plain'
        ? code_verifier
        : crypto.createHash('sha256').update(code_verifier).digest('base64url')
    if (expected !== authCode.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
    }
  }

  const user = decryptUser(authCode.user)
  const now = Math.floor(Date.now() / 1000)
  const signingKey = await getSigningKey()
  const issuer = issuerUrl()

  const idToken = await new jose.SignJWT({ email: user.email, name: user.name, picture: avatarUrl(user.id) })
    .setProtectedHeader({ alg: 'RS256', kid: OIDC_KEY_ID })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + ID_TOKEN_TTL_SEC)
    .sign(signingKey)

  const accessToken = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: OIDC_KEY_ID })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SEC)
    .sign(signingKey)

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    id_token: idToken,
  })
})

router.get('/userinfo', async (req, res) => {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ error: 'invalid_token' })

  try {
    const { payload } = await jose.jwtVerify(token, getPublicKeyObject(), { issuer: issuerUrl() })
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    // Access tokens live an hour; withdrawal inside that hour must stop
    // BookStack from refreshing the profile off a blanked-out record.
    if (!user || user.deactivatedAt) return res.status(401).json({ error: 'invalid_token' })
    const decrypted = decryptUser(user)
    res.json({ sub: decrypted.id, email: decrypted.email, name: decrypted.name, picture: avatarUrl(decrypted.id) })
  } catch {
    res.status(401).json({ error: 'invalid_token' })
  }
})

export default router
