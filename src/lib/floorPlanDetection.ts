import { nanoid } from 'nanoid'
import type { FloorPlanImage, Opening, ScaleCalibration, Wall } from '../types/project'

type Axis = 'horizontal' | 'vertical'

type PixelOpening = {
  offsetPx: number
  widthPx: number
  kind?: 'swing' | 'window'
}

type PixelLine = {
  axis: Axis
  coordinate: number
  start: number
  end: number
  thickness: number
  openings: PixelOpening[]
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

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

function luminanceMask(data: Uint8ClampedArray, width: number, height: number, threshold: number) {
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4
    const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
    mask[index] = data[offset + 3] > 80 && luminance < threshold ? 1 : 0
  }
  return mask
}

function hasPixelNear(mask: Uint8Array, width: number, height: number, x: number, y: number, radius = 2) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const px = Math.round(x + offsetX)
      const py = Math.round(y + offsetY)
      if (px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px]) return true
    }
  }
  return false
}

function hasQuarterArc(mask: Uint8Array, width: number, height: number, line: PixelLine, candidate: PixelOpening) {
  const gapStart = line.start + candidate.offsetPx
  const gapEnd = gapStart + candidate.widthPx
  const radius = candidate.widthPx
  if (radius < 8) return false
  const angles = [15, 25, 35, 45, 55, 65, 75]

  for (const hingeAtEnd of [false, true]) {
    for (const perpendicularSign of [-1, 1]) {
      let hits = 0
      for (const degree of angles) {
        const angle = degree * Math.PI / 180
        const along = Math.cos(angle) * radius * (hingeAtEnd ? -1 : 1)
        const perpendicular = Math.sin(angle) * radius * perpendicularSign
        const hinge = hingeAtEnd ? gapEnd : gapStart
        const x = line.axis === 'horizontal' ? hinge + along : line.coordinate + perpendicular
        const y = line.axis === 'horizontal' ? line.coordinate + perpendicular : hinge + along
        if (hasPixelNear(mask, width, height, x, y, Math.max(2, Math.round(radius * .04)))) hits += 1
      }
      if (hits >= 6) return true
    }
  }
  return false
}

function classifyOpenings(lines: PixelLine[], dark: Uint8Array, width: number, height: number, calibration: ScaleCalibration) {
  for (const line of lines) {
    for (const candidate of line.openings) {
      const widthMm = candidate.widthPx * calibration.mmPerPixel
      if (widthMm <= 1600 && hasQuarterArc(dark, width, height, line, candidate)) candidate.kind = 'swing'
      else candidate.kind = widthMm <= 1150 ? 'swing' : 'window'
    }
  }
}

type Run = { coordinate: number; start: number; end: number }

function scanRuns(mask: Uint8Array, width: number, height: number, axis: Axis): Run[] {
  const majorLength = axis === 'horizontal' ? height : width
  const minorLength = axis === 'horizontal' ? width : height
  const minRun = Math.max(18, Math.round(minorLength * 0.032))
  const runs: Run[] = []

  for (let major = 0; major < majorLength; major += 1) {
    let start = -1
    let lastDark = -1
    for (let minor = 0; minor <= minorLength; minor += 1) {
      const dark = minor < minorLength && (axis === 'horizontal'
        ? mask[major * width + minor]
        : mask[minor * width + major])
      if (dark) {
        if (start < 0) start = minor
        lastDark = minor
      }
      const gap = start >= 0 ? minor - lastDark : 0
      if (start >= 0 && (!dark && (gap > 2 || minor === minorLength))) {
        const end = lastDark
        if (end - start + 1 >= minRun) runs.push({ coordinate: major, start, end })
        start = -1
        lastDark = -1
      }
    }
  }
  return runs
}

function overlapRatio(a: Run, b: Run) {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
  return overlap / Math.max(1, Math.min(a.end - a.start, b.end - b.start))
}

function clusterRuns(runs: Run[], axis: Axis): PixelLine[] {
  const clusters: Run[][] = []
  for (const run of runs) {
    const cluster = clusters.find((items) => {
      const previous = items[items.length - 1]
      return run.coordinate - previous.coordinate <= 2 && overlapRatio(run, previous) > 0.62
    })
    if (cluster) cluster.push(run)
    else clusters.push([run])
  }

  return clusters
    .filter((items) => {
      const coordinates = new Set(items.map((item) => item.coordinate))
      return coordinates.size >= 3
    })
    .map((items) => {
      const starts = items.map((item) => item.start).sort((a, b) => a - b)
      const ends = items.map((item) => item.end).sort((a, b) => a - b)
      const coordinates = items.map((item) => item.coordinate).sort((a, b) => a - b)
      return {
        axis,
        coordinate: coordinates[Math.floor(coordinates.length / 2)],
        start: starts[Math.floor(starts.length / 2)],
        end: ends[Math.floor(ends.length / 2)],
        thickness: coordinates[coordinates.length - 1] - coordinates[0] + 1,
        openings: [],
      }
    })
}

function mergeCollinear(lines: PixelLine[], calibration: ScaleCalibration): PixelLine[] {
  const coordinateTolerance = Math.max(2, Math.min(5, Math.round(100 / calibration.mmPerPixel)))
  const minOpeningPx = 550 / calibration.mmPerPixel
  const maxOpeningPx = 2100 / calibration.mmPerPixel
  const groups: PixelLine[][] = []

  for (const line of [...lines].sort((a, b) => a.coordinate - b.coordinate || a.start - b.start)) {
    const group = groups.find((items) => items[0].axis === line.axis && Math.abs(items[0].coordinate - line.coordinate) <= coordinateTolerance)
    if (group) group.push(line)
    else groups.push([line])
  }

  const merged: PixelLine[] = []
  for (const group of groups) {
    const sorted = group.sort((a, b) => a.start - b.start)
    let current = { ...sorted[0], openings: [...sorted[0].openings] }
    for (const next of sorted.slice(1)) {
      const gap = next.start - current.end
      if (gap <= 4) {
        current.end = Math.max(current.end, next.end)
        current.thickness = Math.max(current.thickness, next.thickness)
      } else if (gap >= minOpeningPx && gap <= maxOpeningPx) {
        current.openings.push({ offsetPx: current.end - current.start, widthPx: gap })
        current.end = next.end
        current.thickness = Math.max(current.thickness, next.thickness)
      } else {
        merged.push(current)
        current = { ...next, openings: [...next.openings] }
      }
    }
    merged.push(current)
  }
  return merged
}

function removeDuplicates(lines: PixelLine[], calibration: ScaleCalibration) {
  const minimumLength = 600 / calibration.mmPerPixel
  const sorted = lines
    .filter((line) => line.end - line.start >= minimumLength)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))
  const kept: PixelLine[] = []

  for (const line of sorted) {
    const duplicate = kept.some((other) =>
      line.axis === other.axis
      && Math.abs(line.coordinate - other.coordinate) <= Math.max(2, Math.min(line.thickness, other.thickness) / 2)
      && Math.abs(line.start - other.start) < 8
      && Math.abs(line.end - other.end) < 8)
    if (!duplicate) kept.push(line)
  }
  return kept.slice(0, 80)
}

export async function detectFloorPlan(imageData: FloorPlanImage, calibration: ScaleCalibration): Promise<DetectionResult> {
  const image = await loadImage(imageData.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = imageData.widthPx
  canvas.height = imageData.heightPx
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('이미지 분석을 시작할 수 없어요.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const mask = luminanceMask(pixels.data, canvas.width, canvas.height, 92)
  const raw = [
    ...clusterRuns(scanRuns(mask, canvas.width, canvas.height, 'horizontal'), 'horizontal'),
    ...clusterRuns(scanRuns(mask, canvas.width, canvas.height, 'vertical'), 'vertical'),
  ]
  const lines = removeDuplicates(mergeCollinear(raw, calibration), calibration)
  classifyOpenings(lines, mask, canvas.width, canvas.height, calibration)
  const walls: Wall[] = []
  const openings: Opening[] = []

  for (const line of lines) {
    const wallId = nanoid()
    const startPx = line.axis === 'horizontal'
      ? { x: line.start, y: line.coordinate }
      : { x: line.coordinate, y: line.start }
    const endPx = line.axis === 'horizontal'
      ? { x: line.end, y: line.coordinate }
      : { x: line.coordinate, y: line.end }
    walls.push({
      id: wallId,
      start: { x: startPx.x * calibration.mmPerPixel, y: startPx.y * calibration.mmPerPixel },
      end: { x: endPx.x * calibration.mmPerPixel, y: endPx.y * calibration.mmPerPixel },
      thicknessMm: Math.max(100, Math.min(300, line.thickness * calibration.mmPerPixel)),
      heightMm: 2400,
    })
    for (const candidate of line.openings) {
      const widthMm = candidate.widthPx * calibration.mmPerPixel
      openings.push({
        id: nanoid(),
        wallId,
        detected: true,
        type: candidate.kind === 'window' ? 'window' : 'door',
        doorKind: candidate.kind === 'swing' ? 'swing' : undefined,
        offsetMm: candidate.offsetPx * calibration.mmPerPixel,
        widthMm,
        heightMm: candidate.kind === 'window' ? 1200 : 2100,
        sillHeightMm: candidate.kind === 'window' ? 900 : 0,
      })
    }
  }

  return {
    walls,
    openings,
    summary: {
      wallCount: walls.length,
      doorCount: openings.filter((opening) => opening.type === 'door').length,
      windowCount: openings.filter((opening) => opening.type === 'window').length,
    },
  }
}
