const MAX_AVATAR_SIZE = 256

// Downscales a user-picked image file to a JPEG data URL so it stays cheap to
// keep inline — as the encrypted local profile store (avatar, maxSize
// defaults to MAX_AVATAR_SIZE) or, at a larger maxSize, as a markdown image
// embedded directly in task/comment text (see MarkdownEditor.jsx).
export function resizeImageFile(file, maxSize = MAX_AVATAR_SIZE) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const width = Math.round(img.width * scale)
        const height = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
