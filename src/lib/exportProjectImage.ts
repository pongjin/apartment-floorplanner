import type { Project } from '../types/project'
import { canvasToPngBlob, shareOrDownloadPng } from './shareImage'

export async function exportProject2D(project: Project) {
  const imageData = project.floorPlanImage
  const calibration = project.calibration
  if (!imageData || !calibration) return
  const image = new Image()
  image.src = imageData.dataUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = imageData.widthPx
  canvas.height = imageData.heightPx
  const context = canvas.getContext('2d')
  if (!context) return
  const px = (mm: number) => mm / calibration.mmPerPixel
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  context.lineCap = 'round'
  project.walls.forEach((wall) => {
    context.beginPath()
    context.setLineDash([12, 8])
    context.lineWidth = Math.max(3, px(wall.thicknessMm) * .45)
    context.strokeStyle = '#3e7c64'
    context.moveTo(px(wall.start.x), px(wall.start.y))
    context.lineTo(px(wall.end.x), px(wall.end.y))
    context.stroke()
  })
  project.openings.forEach((opening) => {
    if (!opening.start || !opening.end) return
    context.beginPath()
    context.setLineDash([10, 7])
    context.lineWidth = 4
    context.strokeStyle = opening.type === 'window' ? '#2985d0' : '#df5145'
    context.moveTo(px(opening.start.x), px(opening.start.y))
    context.lineTo(px(opening.end.x), px(opening.end.y))
    context.stroke()
  })
  context.setLineDash([])
  project.furniture.forEach((item) => {
    const x = px(item.position.x)
    const y = px(item.position.y)
    const width = px(item.widthMm)
    const depth = px(item.depthMm)
    context.save()
    context.translate(x, y)
    context.rotate(item.rotationDeg * Math.PI / 180)
    context.fillStyle = `${item.color}DD`
    context.strokeStyle = '#263a34'
    context.lineWidth = 2
    context.fillRect(-width / 2, -depth / 2, width, depth)
    context.strokeRect(-width / 2, -depth / 2, width, depth)
    context.fillStyle = '#17221e'
    context.font = `${Math.max(10, Math.min(18, width / 7))}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(item.name, 0, 0, width * .9)
    context.restore()
  })
  await shareOrDownloadPng(await canvasToPngBlob(canvas), '집그림-2D.png', '집그림 2D 도면')
}
