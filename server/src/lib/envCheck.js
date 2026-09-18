// 시작할 때 환경변수를 확인한다 — fieldCrypto.js가 FIELD_ENCRYPTION_KEY 하나에
// 대해 하던 걸(`key.length !== 32`면 throw) 나머지 인증 관련 값에도 적용한 것.
//
// 지금까지는 값이 비어 있거나 .env.example의 자리표시자 그대로여도 서버가 멀쩡히
// 떴고, 해당 기능을 실제로 쓰는 경로에서만 조용히 틀렸다. OIDC_CLIENT_SECRET이
// 'change-me'로 남아 있으면 Manager는 정상인데 게시판 로그인만 안 되는 식이라,
// 배포 직후에는 알아채기 어렵고 나중에 엉뚱한 데를 뒤지게 된다. 뜨지 않는 편이
// 낫다 — pm2 로그에 이유가 그대로 남는다.
//
// **순서 주의.** index.js는 라우터들을 먼저 import한 뒤에 assertEnv()를 부른다.
// ESM import는 호이스팅되므로 그 모듈들의 최상위 코드는 이 검사보다 **먼저**
// 실행된다 — 예를 들어 mailer.js의 transporter는 여기 오기 전에 이미 확정돼
// 있다. 그래서 이 파일은 "잘못된 값을 고쳐서 쓰게 하는" 용도가 아니라 "이번
// 부팅이 틀렸다고 알려주는" 용도다. 값을 바꾸면 서버를 다시 띄워야 한다.

// .env.example에 들어 있는 값들. 이게 그대로 남아 있으면 채운 적이 없는 것이다.
const PLACEHOLDERS = new Set(['change-me', 'changeme', 'your-secret', 'todo'])

function isUnset(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') return true
  return PLACEHOLDERS.has(value.trim().toLowerCase())
}

// 게시판 연동에 필요한 값들 — 이 넷은 전부 있거나 전부 없어야 한다.
const OIDC_KEYS = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']

// 게시판 공간(Shelf) 자동 연동용 API 토큰 — bookstack.js의 bookstackConfigured()가
// 보는 것과 같은 셋이다. OIDC와 같은 이유로 전부이거나 전무여야 한다.
const BOOKSTACK_KEYS = ['BOOKSTACK_API_URL', 'BOOKSTACK_API_TOKEN_ID', 'BOOKSTACK_API_TOKEN_SECRET']

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

  // 메일은 SMTP_HOST 하나로 켜고 끈다(mailer.js). 켠 상태에서 MAIL_FROM이 없으면
  // From 없는 메일을 보내려다 릴레이가 거절하는데, 발송은 fire-and-forget이라
  // 화면엔 아무 표시도 안 난다 — 조용히 아무도 메일을 못 받는 상태가 된다.
  if (!isUnset('SMTP_HOST') && isUnset('MAIL_FROM')) {
    problems.push('SMTP_HOST는 설정했는데 MAIL_FROM이 비어 있습니다 (server/DEPLOY.md 12단계)')
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

  // SMTP_HOST가 없으면 mailer.js가 실제 발송 대신 콘솔에 [mail:dev]만 찍는다.
  // 로컬 개발에서는 그게 정상이라 막지 않지만, 배포 서버에서 .env를 덮어쓰다
  // 이 값을 빠뜨리면 멘션·마감 리마인더가 전부 사라지면서도 에러가 하나도 안
  // 난다. 그래서 경고는 남긴다.
  if (isUnset('SMTP_HOST')) {
    console.warn('[env] SMTP_HOST가 없습니다 — 이메일 알림을 실제로 보내지 않고 콘솔에만 기록합니다')
  }

  // 게시판 API 토큰 셋 중 일부만 채워진 상태. bookstack.js는 셋이 다 있을 때만
  // 동작하고 아니면 다섯 진입점이 전부 조용히 기본값을 돌려주므로, 프로젝트를
  // 만들어도 책장이 안 생기는데 에러는 안 보이는 상태가 된다. OIDC와 달리 서버를
  // 못 뜨게 할 이유까지는 없어서 경고로 둔다.
  const bookstackConfigured = BOOKSTACK_KEYS.filter((name) => !isUnset(name))
  if (bookstackConfigured.length > 0 && bookstackConfigured.length < BOOKSTACK_KEYS.length) {
    const absent = BOOKSTACK_KEYS.filter((name) => isUnset(name))
    console.warn(
      `[env] 게시판 API 설정이 일부만 채워져 있습니다 — 프로젝트별 책장 자동 연동이 동작하지 않습니다. 누락: ${absent.join(', ')}`,
    )
  }
}
