import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import { assignReviewRounds } from '../lib/taskReview.js'
import { deleteAttachmentFile, TASK_UPLOAD_DIR, taskUpload } from '../lib/uploads.js'

// Mounted at /api/projects/:projectId/tasks/:taskId/reviews — 검수 이력 조회와
// 산출물 파일 첨부만 담당한다. **이력 자체를 만드는 건 여기가 아니다**: 이력은
// 상태 전이와 한 트랜잭션으로 묶여야 하므로 tasks.js의 PATCH /:id가 만든다
// (docs/task-review-spec.md 4장). 그래서 이 라우터에는 POST /가 없다.
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }
// 응답에 실제로 나가는 것만 — mimeType은 다운로드 라우트가 원본 행을 다시
// 읽어서 쓰고(스트리밍 헤더), createdAt은 이력 자체의 시각으로 충분하다.
const outputSelect = { id: true, fileName: true, size: true, uploadedById: true }

async function loadTask(req, res) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
    select: { id: true, status: true },
  })
  if (!task) {
    res.status(404).json({ error: 'Not found' })
    return null
  }
  return task
}

async function loadReview(req, res, taskId) {
  const review = await prisma.taskReview.findFirst({
    where: { id: req.params.reviewId, taskId },
  })
  if (!review) {
    res.status(404).json({ error: 'Not found' })
    return null
  }
  return review
}

// 산출물 파일 교체·삭제는 이력 텍스트에 흔적을 남길 수 없으므로(이력은 불변)
// 활동 로그에 남긴다. field를 채워두는 이유는 taskActivity.js가 field가 있는
// 행만 from/toValue를 그대로 통과시키기 때문이다.
async function logOutputChange(taskId, actorId, action, fileName) {
  try {
    await prisma.taskActivity.create({
      data: {
        taskId,
        actorId,
        action,
        field: 'reviewFile',
        fromValue: action === 'review_file_removed' ? fileName : null,
        toValue: action === 'review_file_added' ? fileName : null,
      },
    })
  } catch (err) {
    console.error('[taskActivity] review output logging failed', { taskId, error: err.message })
  }
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const reviews = await prisma.taskReview.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: userSelect },
      attachments: { select: outputSelect },
    },
  })

  const locked = task.status === 'done'
  res.json(
    assignReviewRounds(reviews).map((review) => {
      // 산출물은 이력당 1개지만 스키마상으로는 1:N이라 배열로 온다 — 클라이언트가
      // 다루기 쉽게 첫 번째 하나만 내려준다.
      const [output] = review.attachments
      return {
        id: review.id,
        kind: review.kind,
        body: review.body,
        links: review.links,
        outputReplaced: review.outputReplaced,
        round: review.round,
        createdAt: review.createdAt,
        author: review.author ? decryptUser(review.author) : null,
        // canDelete/canUpload는 "올린 사람만 지울 수 있다"(사용자 확인)와 완료
        // 잠금을 합친 결과다 — 라우트 쪽 검증과 같은 조건이어야 버튼을 눌렀을 때
        // 403이 나는 일이 없다.
        output: output
          ? {
              id: output.id,
              fileName: output.fileName,
              size: output.size,
              canDelete: output.uploadedById === req.user.id && !locked,
            }
          : null,
        canUpload: review.kind === 'request' && !output && review.authorId === req.user.id && !locked,
      }
    }),
  )
})

router.post('/:reviewId/attachment', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (task.status === 'done') {
    return res.status(409).json({ error: '완료된 일감의 산출물은 변경할 수 없습니다' })
  }

  const review = await loadReview(req, res, task.id)
  if (!review) return
  if (review.kind !== 'request') {
    return res.status(400).json({ error: '산출물은 검수요청 이력에만 첨부할 수 있습니다' })
  }
  // 이력을 남긴 사람(=산출물을 낸 담당자)만 그 이력의 파일을 올리고 지울 수
  // 있다 — 담당자가 교체되거나 프로젝트에서 빠지면 그 파일은 아무도 못 지우게
  // 되는데, 그 트레이드오프는 확인된 사항이다(spec 3장).
  if (review.authorId !== req.user.id) {
    return res.status(403).json({ error: '검수 이력을 등록한 사람만 산출물을 첨부할 수 있습니다' })
  }

  // 이력당 1개. 아래 업로드 후에 한 번 더 확인한다 — 두 요청이 동시에 이
  // 검사를 통과할 수 있다(taskAttachments.js와 같은 이유).
  const count = await prisma.taskAttachment.count({ where: { reviewId: review.id } })
  if (count > 0) return res.status(400).json({ error: '산출물 파일은 이력당 1개만 첨부할 수 있습니다' })

  taskUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'file is required' })

    const recount = await prisma.taskAttachment.count({ where: { reviewId: review.id } })
    if (recount > 0) {
      // 방금 디스크에 쓴 파일을 되돌리는 정리 작업(deleteAttachmentFile은 실패해도
      // 던지지 않는다 — uploads.js 주석 참고).
      await deleteAttachmentFile(req.file.filename)
      return res.status(400).json({ error: '산출물 파일은 이력당 1개만 첨부할 수 있습니다' })
    }

    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: task.id,
        reviewId: review.id,
        fileName,
        mimeType: req.file.mimetype,
        size: req.file.size,
        storageKey: req.file.filename,
        uploadedById: req.user.id,
      },
      select: outputSelect,
    })
    await logOutputChange(task.id, req.user.id, 'review_file_added', fileName)
    res.status(201).json({
      id: attachment.id,
      fileName: attachment.fileName,
      size: attachment.size,
      canDelete: true,
    })
  })
})

router.get('/:reviewId/attachment/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: req.params.id, taskId: task.id, reviewId: req.params.reviewId },
  })
  if (!attachment) return res.status(404).json({ error: 'Not found' })

  const filePath = path.join(TASK_UPLOAD_DIR, attachment.storageKey)
  res.set('Content-Type', attachment.mimeType)
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)

  const stream = fs.createReadStream(filePath)
  stream.on('error', () => res.status(404).end())
  stream.pipe(res)
})

router.delete('/:reviewId/attachment/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (task.status === 'done') {
    return res.status(409).json({ error: '완료된 일감의 산출물은 변경할 수 없습니다' })
  }

  const review = await loadReview(req, res, task.id)
  if (!review) return

  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: req.params.id, taskId: task.id, reviewId: review.id },
  })
  if (!attachment) return res.status(404).json({ error: 'Not found' })
  if (attachment.uploadedById !== req.user.id) {
    return res.status(403).json({ error: '산출물 파일은 등록한 사람만 삭제할 수 있습니다' })
  }

  // 한 번 켜지면 다시 꺼지지 않는다 — 지웠다 다시 올리는 횟수는 세지 않고,
  // "최초 등록물과 다르다"는 사실만 화면에 표시한다(사용자 확인).
  await prisma.$transaction([
    prisma.taskAttachment.delete({ where: { id: attachment.id } }),
    prisma.taskReview.update({ where: { id: review.id }, data: { outputReplaced: true } }),
  ])
  // DB 행이 사라진 뒤의 디스크 정리 — 실패해도 요청을 실패로 돌리지 않는다
  // (deleteAttachmentFile이 던지지 않는 이유는 uploads.js 주석 참고).
  await deleteAttachmentFile(attachment.storageKey)
  await logOutputChange(task.id, req.user.id, 'review_file_removed', attachment.fileName)
  res.status(204).end()
})

export default router
