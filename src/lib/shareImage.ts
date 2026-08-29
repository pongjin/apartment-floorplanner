export async function shareOrDownloadPng(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: 'image/png' })
  const canShareFile = typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))

  if (canShareFile) {
    try {
      await navigator.share({ files: [file], title })
      return
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 이미지를 만들지 못했어요.')), 'image/png')
  })
}
