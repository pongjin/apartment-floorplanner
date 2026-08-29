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
