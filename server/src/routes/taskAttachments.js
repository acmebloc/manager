import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import { canModifyTask } from '../lib/taskPermissions.js'
import {
  deleteAttachmentFile,
  MAX_ATTACHMENTS_PER_TASK,
  TASK_UPLOAD_DIR,
  taskUpload,
} from '../lib/uploads.js'

// Mounted at /api/projects/:projectId/tasks/:taskId/attachments
const router = Router({ mergeParams: true })

const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true, email: true, picture: true } },
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
    where: { taskId: task.id },
    orderBy: { createdAt: 'asc' },
    select: attachmentSelect,
  })
  res.json(attachments.map(decryptAttachment))
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (!canModifyTask(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // Cheap early rejection in the common case — checked again right before
  // the DB write below, since two uploads to the same task can otherwise
  // both pass this check before either one commits its row.
  const count = await prisma.taskAttachment.count({ where: { taskId: task.id } })
  if (count >= MAX_ATTACHMENTS_PER_TASK) {
    return res.status(400).json({ error: `일감당 첨부파일은 최대 ${MAX_ATTACHMENTS_PER_TASK}개입니다` })
  }

  taskUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'file is required' })

    const recount = await prisma.taskAttachment.count({ where: { taskId: task.id } })
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
    where: { id: req.params.id, taskId: task.id },
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
  if (!canModifyTask(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: req.params.id, taskId: task.id },
  })
  if (!attachment) return res.status(404).json({ error: 'Not found' })

  await prisma.taskAttachment.delete({ where: { id: attachment.id } })
  await deleteAttachmentFile(attachment.storageKey)
  res.status(204).end()
})

export default router
