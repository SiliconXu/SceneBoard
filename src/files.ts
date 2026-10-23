export function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('图片尺寸无效。'))
    image.onerror = () => reject(new Error('无法读取图片，请检查文件是否完整。'))
    image.src = src
  })
}

export async function readImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。')
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败。'))
    reader.readAsDataURL(file)
  })
  const image = await decodeImage(src)
  return { name: file.name, src, width: image.naturalWidth, height: image.naturalHeight }
}

export async function download(blob: Blob, filename: string): Promise<boolean> {
  if (window.sceneBoardDesktop) return window.sceneBoardDesktop.save(filename, new Uint8Array(await blob.arrayBuffer()))
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

export const downloadJson = (data: unknown, filename: string) => download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
