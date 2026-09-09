import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import { canEditTaskFields } from '../lib/taskPermissions.js'
import {
  deleteAttachmentFile,
  MAX_ATTACHMENTS_PER_TASK,
  TASK_UPLOAD_DIR,
  taskUpload,
} from '../lib/uploads.js'

// Mounted at /api/projects/:projectId/tasks/:taskId/attachments
//
// 이 라우터는 일감의 일반 첨부파일만 다룬다 — 검수 이력의 산출물 파일은 같은
// TaskAttachment 테이블에 있지만 reviewId가 채워져 있고, 권한 규칙("올린 사람만
// 삭제")도 달라서 taskReviews.js가 따로 담당한다. 그래서 이 파일의 모든 조회에
// reviewId: null이 붙는다 — 빠지면 산출물이 첨부파일 목록에 섞여 보이고, 이쪽
// 규칙으로 지워질 수도 있다.
const router = Router({ mergeParams: true })

const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true, email: true, picture: true, deactivatedAt: true } },
}

// 완료 잠금(docs/task-review-spec.md 8장)과 역할 부족을 구분해서 알려준다 —
// "권한이 없다"만 뜨면 완료된 일감이라 잠긴 것인지 애초에 내 일감이 아닌 것인지
// 알 수가 없다.
function attachmentDenyMessage(task) {
  if (task.status === 'done') return '완료된 일감은 첨부파일을 변경할 수 없습니다'
  return 'Forbidden'
}

function decryptAttachment(attachment) {
  return { ...attachment, uploadedBy: attachment.uploadedBy ? decryptUser(attachment.uploadedBy) : null }
}

async function loadTask(req, res) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
  })
  if (!task) {
    res.status(404).json({ error: 'Not found' })
    return null
  }
  return task
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const attachments = await prisma.taskAttachment.findMany({
    where: { taskId: task.id, reviewId: null },
    orderBy: { createdAt: 'asc' },
    select: attachmentSelect,
  })
  res.json(attachments.map(decryptAttachment))
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (!canEditTaskFields(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: attachmentDenyMessage(task) })
  }

  // Cheap early rejection in the common case — checked again right before
  // the DB write below, since two uploads to the same task can otherwise
  // both pass this check before either one commits its row.
  const count = await prisma.taskAttachment.count({ where: { taskId: task.id, reviewId: null } })
  if (count >= MAX_ATTACHMENTS_PER_TASK) {
    return res.status(400).json({ error: `일감당 첨부파일은 최대 ${MAX_ATTACHMENTS_PER_TASK}개입니다` })
  }

  taskUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'file is required' })

    const recount = await prisma.taskAttachment.count({ where: { taskId: task.id, reviewId: null } })
    if (recount >= MAX_ATTACHMENTS_PER_TASK) {
      await deleteAttachmentFile(req.file.filename)
      return res.status(400).json({ error: `일감당 첨부파일은 최대 ${MAX_ATTACHMENTS_PER_TASK}개입니다` })
    }

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: task.id,
        // multer/busboy decode multipart filenames as latin1 by default (the
        // spec never mandated UTF-8), so a non-ASCII name arrives mangled
        // unless re-decoded from the bytes it actually was.
        fileName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
        mimeType: req.file.mimetype,
        size: req.file.size,
        storageKey: req.file.filename,
        uploadedById: req.user.id,
      },
      select: attachmentSelect,
    })
    res.status(201).json(decryptAttachment(attachment))
  })
})

router.get('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: req.params.id, taskId: task.id, reviewId: null },
  })
  if (!attachment) return res.status(404).json({ error: 'Not found' })

  const filePath = path.join(TASK_UPLOAD_DIR, attachment.storageKey)
  res.set('Content-Type', attachment.mimeType)
  res.set('X-Content-Type-Options', 'nosniff')
  res.set(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
  )

  const stream = fs.createReadStream(filePath)
  stream.on('error', () => res.status(404).end())
  stream.pipe(res)
})

router.delete('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (!canEditTaskFields(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: attachmentDenyMessage(task) })
  }

  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: req.params.id, taskId: task.id, reviewId: null },
  })
  if (!attachment) return res.status(404).json({ error: 'Not found' })

  // DB 행을 먼저 지우고 디스크 파일을 치운다 — 파일 삭제가 실패해도 요청은
  // 성공으로 끝난다(deleteAttachmentFile이 던지지 않는 이유는 uploads.js 주석
  // 참고). 순서를 뒤집으면 파일은 없는데 목록에는 남아있는 상태가 될 수 있다.
  await prisma.taskAttachment.delete({ where: { id: attachment.id } })
  await deleteAttachmentFile(attachment.storageKey)
  res.status(204).end()
})

export default router
