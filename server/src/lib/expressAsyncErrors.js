// Express 4는 async 핸들러를 await하지 않는다. 그래서 async 핸들러가 던지면
// 그 거부(rejection)를 아무도 받지 않고 **응답이 아예 나가지 않는다** — 500도
// 아니고, 클라이언트가 스스로 포기할 때까지(Node 기본 requestTimeout 5분)
// 소켓이 열린 채 매달린다. 이 파일은 그 한 줄을 메운다.
//
// DB 장애 때만 나는 문제가 아니다. 실측으로 확인한 재현 경로:
//   PATCH /api/projects/:pid/tasks/:id  body {"assigneeId":{"a":1}}
// 문자열 자리에 객체가 오면 Prisma가 검증 오류를 던지고, 그 호출부가 try 밖이라
// 요청이 매달린다. 스칼라 자리에 객체/배열을 넣는 20가지를 시험해 12가지가
// 매달렸다. 인증은 필요하므로 익명 공격 벡터는 아니지만, 구멍은 구멍이다.
//
// **왜 라우트마다 try/catch를 달지 않았나**: 그러면 42개 핸들러를 고쳐야 하고,
// 앞으로 추가되는 라우트마다 같은 것을 기억해야 한다. 잊으면 조용히 되돌아간다.
// 여기서 한 번 감싸면 미들웨어까지 전부, 앞으로 생기는 것까지 자동으로 덮인다.
//
// **Express 5로 올릴 때 이 파일을 지워라.** Express 5는 핸들러를 직접 await
// 하므로 이 패치가 필요 없다.

// Express 내부 모듈을 건드리는 유일한 지점이다. **정적 import를 쓰지 않는
// 이유**: server/DEPLOY.md의 배포가 `npm ci`가 아니라 `npm install`이고
// package.json이 "express": "^4.21.0" 범위라, 서버에서 lockfile과 다른 4.x가
// 깔릴 수 있다(이 저장소에서 실제로 겪은 드리프트 문제다). 정적 import가
// 실패하면 **API 프로세스가 아예 부팅되지 않아 전면 장애**가 된다.
// 매달리는 요청을 막으려다 서버를 못 뜨게 만드는 건 남는 장사가 아니므로,
// 실패하면 크게 로그만 남기고 기존 동작(패치 이전 상태)으로 물러난다.
const LAYER_MODULE = 'express/lib/router/layer.js'

export async function installAsyncErrorHandling() {
  let Layer
  try {
    Layer = (await import(LAYER_MODULE)).default
  } catch (err) {
    console.error(
      `[expressAsyncErrors] ${LAYER_MODULE}를 불러오지 못해 패치를 건너뜀 —` +
        ' async 핸들러가 던지면 응답 없이 요청이 매달릴 수 있다.',
      err.message,
    )
    return false
  }

  const original = Layer.prototype?.handle_request
  if (typeof original !== 'function') {
    console.error(
      '[expressAsyncErrors] Layer.prototype.handle_request가 없어 패치를 건너뜀 —' +
        ' Express 내부 구조가 바뀐 것 같다(5.x라면 이 파일을 지워도 된다).',
    )
    return false
  }

  // 원본(express/lib/router/layer.js)과 같은 동작에 거부 처리만 한 줄 더한 것이다.
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle

    // 인수 4개는 에러 핸들러라 이 경로가 아니라 handle_error로 간다.
    if (fn.length > 3) return next()

    try {
      const result = fn(req, res, next)
      // 원본에 없는 부분. 핸들러가 이미 응답을 보낸 뒤에 거부했더라도
      // index.js의 에러 핸들러가 res.headersSent를 보고 알아서 넘긴다.
      if (result && typeof result.catch === 'function') result.catch(next)
    } catch (err) {
      next(err)
    }
  }

  return true
}
