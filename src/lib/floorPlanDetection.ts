import { nanoid } from 'nanoid'
import * as ort from 'onnxruntime-web/wasm'
import { detectFloorPlan as detectFloorPlanHeuristic } from '../legacy/floorPlanDetectionHeuristic'
import type { FloorPlanImage, Opening, ScaleCalibration, Wall } from '../types/project'

export { detectFloorPlan as detectFloorPlanLegacy } from '../legacy/floorPlanDetectionHeuristic'

type Axis = 'horizontal' | 'vertical'

type DetectionComponent = {
  classId: number
  confidence: number
  x: number
  y: number
  width: number
  height: number
  area: number
}

type WallSegment = {
  wall: Wall
  axis: Axis
  coordinate: number
  start: number
  end: number
}

export type DetectionResult = {
  walls: Wall[]
  openings: Opening[]
  summary: {
    wallCount: number
    doorCount: number
    windowCount: number
  }
}

const MODEL_URL = '/models/hybrid-floorplan-lraspp-v1.onnx'
const MODEL_WIDTH = 640
const MODEL_HEIGHT = 480
const MODEL_CLASSES = 9
const CONFIDENCE_THRESHOLD = .5
const MINIMUM_COMPONENT_AREA = 30

const classMetadata: Record<number, { name: string; group: 'door' | 'window'; doorKind?: 'swing' | 'sliding' }> = {
  3: { name: '여닫이문', group: 'door', doorKind: 'swing' },
  4: { name: '미닫이문', group: 'door', doorKind: 'sliding' },
  5: { name: '기타문', group: 'door' },
  6: { name: '여닫이창', group: 'window' },
  7: { name: '미닫이창', group: 'window' },
  8: { name: '기타창', group: 'window' },
}

let sessionPromise: Promise<ort.InferenceSession> | undefined

function getSession() {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = '/ort/'
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  }
  return sessionPromise
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

function prepareTensor(image: HTMLImageElement) {
  const scale = Math.min(MODEL_WIDTH / image.naturalWidth, MODEL_HEIGHT / image.naturalHeight)
  const resizedWidth = Math.round(image.naturalWidth * scale)
  const resizedHeight = Math.round(image.naturalHeight * scale)
  const padX = Math.floor((MODEL_WIDTH - resizedWidth) / 2)
  const padY = Math.floor((MODEL_HEIGHT - resizedHeight) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_WIDTH
  canvas.height = MODEL_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('AI 입력 이미지를 준비할 수 없어요.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, MODEL_WIDTH, MODEL_HEIGHT)
  context.drawImage(image, padX, padY, resizedWidth, resizedHeight)
  const pixels = context.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT).data
  const planeSize = MODEL_WIDTH * MODEL_HEIGHT
  const tensor = new Float32Array(planeSize * 3)
  const mean = [.485, .456, .406]
  const deviation = [.229, .224, .225]
  for (let index = 0; index < planeSize; index += 1) {
    const source = index * 4
    for (let channel = 0; channel < 3; channel += 1) {
      tensor[channel * planeSize + index] = (pixels[source + channel] / 255 - mean[channel]) / deviation[channel]
    }
  }
  return {
    tensor: new ort.Tensor('float32', tensor, [1, 3, MODEL_HEIGHT, MODEL_WIDTH]),
    geometry: { scale, padX, padY, resizedWidth, resizedHeight },
  }
}

function decodeSegmentation(logits: ort.Tensor): DetectionComponent[] {
  const values = logits.data as Float32Array
  const planeSize = MODEL_WIDTH * MODEL_HEIGHT
  if (values.length !== MODEL_CLASSES * planeSize) throw new Error('AI 모델 출력 크기가 예상과 달라요.')
  const classes = new Uint8Array(planeSize)
  const confidence = new Float32Array(planeSize)
  for (let index = 0; index < planeSize; index += 1) {
    let bestClass = 0
    let maximum = -Infinity
    for (let classId = 0; classId < MODEL_CLASSES; classId += 1) {
      const value = values[classId * planeSize + index]
      if (value > maximum) {
        maximum = value
        bestClass = classId
      }
    }
    let denominator = 0
    for (let classId = 0; classId < MODEL_CLASSES; classId += 1) {
      denominator += Math.exp(values[classId * planeSize + index] - maximum)
    }
    classes[index] = bestClass
    confidence[index] = 1 / denominator
  }

  const visited = new Uint8Array(planeSize)
  const stack = new Int32Array(planeSize)
  const components: DetectionComponent[] = []
  for (let seed = 0; seed < planeSize; seed += 1) {
    const classId = classes[seed]
    if (visited[seed] || classId < 3 || classId > 8) continue
    let stackSize = 1
    stack[0] = seed
    visited[seed] = 1
    let area = 0
    let confidenceSum = 0
    let left = MODEL_WIDTH
    let top = MODEL_HEIGHT
    let right = 0
    let bottom = 0
    while (stackSize) {
      const index = stack[--stackSize]
      const x = index % MODEL_WIDTH
      const y = Math.floor(index / MODEL_WIDTH)
      area += 1
      confidenceSum += confidence[index]
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nextY = y + offsetY
        if (nextY < 0 || nextY >= MODEL_HEIGHT) continue
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue
          const nextX = x + offsetX
          if (nextX < 0 || nextX >= MODEL_WIDTH) continue
          const next = nextY * MODEL_WIDTH + nextX
          if (!visited[next] && classes[next] === classId) {
            visited[next] = 1
            stack[stackSize++] = next
          }
        }
      }
    }
    const averageConfidence = confidenceSum / Math.max(1, area)
    if (area >= MINIMUM_COMPONENT_AREA && averageConfidence >= CONFIDENCE_THRESHOLD) {
      components.push({ classId, confidence: averageConfidence, x: left, y: top, width: right - left + 1, height: bottom - top + 1, area })
    }
  }
  return components
}

function restoreComponent(component: DetectionComponent, geometry: ReturnType<typeof prepareTensor>['geometry'], image: FloorPlanImage) {
  const left = Math.max(0, (component.x - geometry.padX) / geometry.scale)
  const top = Math.max(0, (component.y - geometry.padY) / geometry.scale)
  const right = Math.min(image.widthPx, (component.x + component.width - geometry.padX) / geometry.scale)
  const bottom = Math.min(image.heightPx, (component.y + component.height - geometry.padY) / geometry.scale)
  if (right <= left || bottom <= top) return undefined
  return { ...component, x: left, y: top, width: right - left, height: bottom - top }
}

function wallSegments(walls: Wall[]): WallSegment[] {
  return walls.flatMap((wall) => {
    const horizontal = Math.abs(wall.end.x - wall.start.x) >= Math.abs(wall.end.y - wall.start.y)
    return [{
      wall,
      axis: horizontal ? 'horizontal' as const : 'vertical' as const,
      coordinate: horizontal ? (wall.start.y + wall.end.y) / 2 : (wall.start.x + wall.end.x) / 2,
      start: horizontal ? Math.min(wall.start.x, wall.end.x) : Math.min(wall.start.y, wall.end.y),
      end: horizontal ? Math.max(wall.start.x, wall.end.x) : Math.max(wall.start.y, wall.end.y),
    }]
  })
}

function distanceToSegment(x: number, y: number, line: WallSegment) {
  if (line.axis === 'horizontal') {
    const along = Math.min(Math.max(x, line.start), line.end)
    return Math.hypot(x - along, y - line.coordinate)
  }
  const along = Math.min(Math.max(y, line.start), line.end)
  return Math.hypot(x - line.coordinate, y - along)
}

function perpendicularDistance(x: number, y: number, line: WallSegment) {
  return line.axis === 'horizontal' ? Math.abs(y - line.coordinate) : Math.abs(x - line.coordinate)
}

function nearestWall(component: DetectionComponent, lines: WallSegment[], calibration: ScaleCalibration, group: 'door' | 'window') {
  const centerX = (component.x + component.width / 2) * calibration.mmPerPixel
  const centerY = (component.y + component.height / 2) * calibration.mmPerPixel
  if (group === 'window') {
    const expectedAxis: Axis = component.width >= component.height ? 'horizontal' : 'vertical'
    const sameAxis = lines.filter((line) => line.axis === expectedAxis)
    const candidates = sameAxis.length ? sameAxis : lines
    const line = candidates.reduce((best, candidate) => perpendicularDistance(centerX, centerY, candidate) < perpendicularDistance(centerX, centerY, best) ? candidate : best)
    return { line, distance: perpendicularDistance(centerX, centerY, line), centerX, centerY }
  }
  const line = lines.reduce((best, candidate) => distanceToSegment(centerX, centerY, candidate) < distanceToSegment(centerX, centerY, best) ? candidate : best)
  return { line, distance: distanceToSegment(centerX, centerY, line), centerX, centerY }
}

function wallCorners(lines: WallSegment[]) {
  const corners: { x: number; y: number }[] = []
  const horizontal = lines.filter((line) => line.axis === 'horizontal')
  const vertical = lines.filter((line) => line.axis === 'vertical')
  for (const first of horizontal) {
    for (const second of vertical) {
      if (first.start <= second.coordinate && second.coordinate <= first.end && second.start <= first.coordinate && first.coordinate <= second.end) {
        corners.push({ x: second.coordinate, y: first.coordinate })
      }
    }
  }
  return corners
}

function overlapsExisting(candidate: Opening, openings: Opening[]) {
  return openings.some((opening) => opening.wallId === candidate.wallId
    && Math.max(opening.offsetMm, candidate.offsetMm) < Math.min(opening.offsetMm + opening.widthMm, candidate.offsetMm + candidate.widthMm))
}

function attachOpenings(components: DetectionComponent[], walls: Wall[], image: FloorPlanImage, calibration: ScaleCalibration) {
  const lines = wallSegments(walls)
  if (!lines.length) return []
  const bounds = {
    left: Math.min(...walls.flatMap((wall) => [wall.start.x, wall.end.x])),
    top: Math.min(...walls.flatMap((wall) => [wall.start.y, wall.end.y])),
    right: Math.max(...walls.flatMap((wall) => [wall.start.x, wall.end.x])),
    bottom: Math.max(...walls.flatMap((wall) => [wall.start.y, wall.end.y])),
  }
  const corners = wallCorners(lines)
  const minimumImageDimension = Math.min(image.widthPx, image.heightPx)
  const snapDistance = Math.max(10, minimumImageDimension * .045) * calibration.mmPerPixel
  const boundsMargin = Math.max(5, minimumImageDimension * .025) * calibration.mmPerPixel
  const minimumWindowLength = Math.max(12, (bounds.right - bounds.left) / calibration.mmPerPixel * .045) * calibration.mmPerPixel
  const cornerMargin = Math.max(10 * calibration.mmPerPixel, minimumWindowLength * .4)
  const accepted: Opening[] = []

  for (const component of [...components].sort((a, b) => b.confidence - a.confidence)) {
    const metadata = classMetadata[component.classId]
    if (!metadata) continue
    const nearest = nearestWall(component, lines, calibration, metadata.group)
    const insideBounds = nearest.centerX >= bounds.left - boundsMargin && nearest.centerX <= bounds.right + boundsMargin
      && nearest.centerY >= bounds.top - boundsMargin && nearest.centerY <= bounds.bottom + boundsMargin
    const lengthMm = Math.max(component.width, component.height) * calibration.mmPerPixel
    if (!insideBounds && component.confidence < .75) continue
    if (metadata.group === 'window' && lengthMm < minimumWindowLength && component.confidence < .75) continue
    if (nearest.distance > snapDistance && component.confidence < .75) continue
    if (metadata.group === 'window' && component.confidence < .85
      && corners.some((corner) => Math.hypot(nearest.centerX - corner.x, nearest.centerY - corner.y) < cornerMargin)) continue

    const wallLength = nearest.line.end - nearest.line.start
    const alongCenter = nearest.line.axis === 'horizontal' ? nearest.centerX : nearest.centerY
    const widthMm = Math.min(wallLength, Math.max(300, lengthMm))
    const offsetMm = Math.max(0, Math.min(wallLength - widthMm, alongCenter - nearest.line.start - widthMm / 2))
    const opening: Opening = {
      id: nanoid(),
      wallId: nearest.line.wall.id,
      detected: true,
      detectedClass: metadata.name,
      confidence: component.confidence,
      type: metadata.group === 'window' ? 'window' : 'door',
      doorKind: metadata.doorKind,
      offsetMm,
      widthMm,
      heightMm: metadata.group === 'window' ? 1200 : 2100,
      sillHeightMm: metadata.group === 'window' ? 900 : 0,
    }
    if (!overlapsExisting(opening, accepted)) accepted.push(opening)
  }
  return accepted
}

export async function detectFloorPlan(imageData: FloorPlanImage, calibration: ScaleCalibration): Promise<DetectionResult> {
  const heuristic = await detectFloorPlanHeuristic(imageData, calibration)
  if (!heuristic.walls.length) return { ...heuristic, openings: [] }
  const image = await loadImage(imageData.dataUrl)
  const prepared = prepareTensor(image)
  const session = await getSession()
  const outputs = await session.run({ image: prepared.tensor })
  const logits = outputs.logits
  if (!logits) throw new Error('AI 모델 출력이 없습니다.')
  const restored = decodeSegmentation(logits)
    .map((component) => restoreComponent(component, prepared.geometry, imageData))
    .filter((component): component is DetectionComponent => Boolean(component))
  const openings = attachOpenings(restored, heuristic.walls, imageData, calibration)
  return {
    walls: heuristic.walls,
    openings,
    summary: {
      wallCount: heuristic.walls.length,
      doorCount: openings.filter((opening) => opening.type === 'door').length,
      windowCount: openings.filter((opening) => opening.type === 'window').length,
    },
  }
}
