import { nanoid } from 'nanoid'
import type { FloorPlanImage } from '../types/project'

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const imageSize = (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
  image.onerror = reject
  image.src = src
})

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

export type FloorPlanQuality = {
  accepted: boolean
  issues: string[]
  metrics: {
    width: number
    height: number
    megapixels: number
    colorRatio: number
    contrast: number
    edgeRatio: number
  }
}

export async function inspectFloorPlanQuality(dataUrl: string, width: number, height: number): Promise<FloorPlanQuality> {
  const issues: string[] = []
  const megapixels = width * height / 1_000_000
  const shorterSide = Math.min(width, height)
  const longerSide = Math.max(width, height)
  if (shorterSide < 700 || longerSide < 1100 || megapixels < .9) {
    issues.push(`해상도가 ${width}×${height}px로 너무 낮아요. 짧은 변 700px 이상, 약 100만 화소 이상의 원본을 선택해 주세요.`)
  }

  const image = await loadImage(dataUrl)
  const scale = Math.min(1, 640 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('이미지 품질을 확인할 수 없어요.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const luminance = new Float32Array(canvas.width * canvas.height)
  let colorful = 0
  let visible = 0
  let sum = 0
  let sumSquared = 0

  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4
    if (pixels[offset + 3] < 80) continue
    const value = pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114
    luminance[index] = value
    visible += 1
    sum += value
    sumSquared += value * value
    const chroma = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) - Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    if (chroma > 18 && value < 245) colorful += 1
  }

  let sharpEdges = 0
  let edgeSamples = 0
  for (let y = 1; y < canvas.height - 1; y += 2) {
    for (let x = 1; x < canvas.width - 1; x += 2) {
      const index = y * canvas.width + x
      const gradient = Math.max(
        Math.abs(luminance[index + 1] - luminance[index - 1]),
        Math.abs(luminance[index + canvas.width] - luminance[index - canvas.width]),
      )
      if (gradient > 28) sharpEdges += 1
      edgeSamples += 1
    }
  }

  const colorRatio = colorful / Math.max(1, visible)
  const mean = sum / Math.max(1, visible)
  const contrast = Math.sqrt(Math.max(0, sumSquared / Math.max(1, visible) - mean * mean))
  const edgeRatio = sharpEdges / Math.max(1, edgeSamples)
  if (colorRatio < .012) issues.push('색상 정보가 거의 없는 흑백 도면이에요. 벽·문·창 영역이 색으로 구분된 도면을 선택해 주세요.')
  if (contrast < 24 || edgeRatio < .012) issues.push('선이 흐리거나 대비가 낮아 구조를 구분하기 어려워요. 흔들림 없는 원본 이미지나 선명한 캡처를 선택해 주세요.')

  return {
    accepted: issues.length === 0,
    issues,
    metrics: { width, height, megapixels, colorRatio, contrast, edgeRatio },
  }
}

export async function fileToFloorPlan(file: File): Promise<FloorPlanImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('PNG 또는 JPG 이미지만 사용할 수 있어요.')
  const dataUrl = await readFile(file)
  const { width, height } = await imageSize(dataUrl)
  return { id: nanoid(), name: file.name, dataUrl, widthPx: width, heightPx: height }
}

export async function urlToFloorPlan(url: string, name: string): Promise<FloorPlanImage> {
  const response = await fetch(url)
  const blob = await response.blob()
  return fileToFloorPlan(new File([blob], name, { type: blob.type || 'image/png' }))
}
