// 시작할 때 환경변수를 확인한다 — fieldCrypto.js가 FIELD_ENCRYPTION_KEY 하나에
// 대해 하던 걸(`key.length !== 32`면 throw) 나머지 인증 관련 값에도 적용한 것.
//
// 지금까지는 값이 비어 있거나 .env.example의 자리표시자 그대로여도 서버가 멀쩡히
// 떴고, 해당 기능을 실제로 쓰는 경로에서만 조용히 틀렸다. OIDC_CLIENT_SECRET이
// 'change-me'로 남아 있으면 Manager는 정상인데 게시판 로그인만 안 되는 식이라,
// 배포 직후에는 알아채기 어렵고 나중에 엉뚱한 데를 뒤지게 된다. 뜨지 않는 편이
// 낫다 — pm2 로그에 이유가 그대로 남는다.

// .env.example에 들어 있는 값들. 이게 그대로 남아 있으면 채운 적이 없는 것이다.
const PLACEHOLDERS = new Set(['change-me', 'changeme', 'your-secret', 'todo'])

function isUnset(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') return true
  return PLACEHOLDERS.has(value.trim().toLowerCase())
}

// 게시판 연동에 필요한 값들 — 이 넷은 전부 있거나 전부 없어야 한다.
const OIDC_KEYS = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']

export function assertEnv() {
  const problems = []

  // 이 넷이 없으면 로그인 자체가 불가능하다 — 서버가 떠 있어도 할 수 있는 게 없다.
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'FRONTEND_ORIGIN']) {
    if (isUnset(name)) problems.push(`${name} — 비어 있거나 자리표시자 그대로입니다`)
  }

  // OIDC는 통째로 선택 사항이다. 게시판을 쓰지 않는 환경(로컬 개발)에서는 넷 다
  // 없어도 정상이고, bookstack.js가 그러듯 조용히 건너뛰면 된다. 다만 **일부만**
  // 채워진 상태는 반드시 실수다 — 그 조합으로는 로그인이 되지 않는데 서버는
  // 정상으로 보이기 때문에, 이건 막고 시작한다.
  const configured = OIDC_KEYS.filter((name) => !isUnset(name))
  if (configured.length > 0 && configured.length < OIDC_KEYS.length) {
    const absent = OIDC_KEYS.filter((name) => isUnset(name))
    problems.push(
      `OIDC 설정이 일부만 채워져 있습니다 (server/DEPLOY.md 6단계) — 누락: ${absent.join(', ')}`,
    )
  }

  if (problems.length > 0) {
    throw new Error(`환경변수 설정을 확인해주세요:\n  - ${problems.join('\n  - ')}`)
  }

  // 여기부터는 뜨는 건 막지 않고 경고만 — 틀렸을 수도 있지만 의도한 구성일 수도 있다.

  // auth.js는 FRONTEND_ORIGIN이 https일 때만 세션 쿠키에 Secure를 붙인다. 로컬
  // 개발에서는 http가 정상이지만, 게시판 연동까지 켜둔 채 http라면 프로덕션을
  // 그렇게 띄운 것이므로 쿠키가 평문으로 오간다.
  if (configured.length === OIDC_KEYS.length && !process.env.FRONTEND_ORIGIN.startsWith('https://')) {
    console.warn(
      '[env] FRONTEND_ORIGIN이 https가 아닙니다 — manager_session 쿠키가 Secure 없이 발급됩니다',
    )
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.warn('[env] JWT_SECRET이 32자 미만입니다 — openssl rand -hex 32 로 생성하는 것을 권장합니다')
  }
}
