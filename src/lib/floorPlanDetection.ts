import { nanoid } from 'nanoid'
import type { FloorPlanImage, Opening, ScaleCalibration, Wall } from '../types/project'

type Axis = 'horizontal' | 'vertical'

type PixelOpening = {
  offsetPx: number
  widthPx: number
  kind?: 'swing' | 'sliding' | 'window'
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

type PixelBounds = { left: number; top: number; right: number; bottom: number }

function findBands(values: number[], minimumInk: number, maximumGap: number) {
  const bands: { start: number; end: number; ink: number }[] = []
  let start = -1
  let lastActive = -1
  let ink = 0
  values.forEach((value, index) => {
    if (value >= minimumInk) {
      if (start < 0) start = index
      lastActive = index
      ink += value
    }
    if (start >= 0 && index - lastActive > maximumGap) {
      bands.push({ start, end: lastActive, ink })
      start = -1
      lastActive = -1
      ink = 0
    }
  })
  if (start >= 0) bands.push({ start, end: lastActive, ink })
  return bands
}

function findDrawingBounds(mask: Uint8Array, width: number, height: number): PixelBounds {
  const rowInk = Array.from({ length: height }, (_, y) => {
    let count = 0
    for (let x = 0; x < width; x += 1) count += mask[y * width + x]
    return count
  })
  const rowBands = findBands(rowInk, Math.max(2, Math.round(width * .008)), Math.max(2, Math.round(height * .025)))
  const rowBand = rowBands.sort((a, b) => b.ink - a.ink)[0]
  if (!rowBand) return { left: 0, top: 0, right: width - 1, bottom: height - 1 }

  const columnInk = Array.from({ length: width }, (_, x) => {
    let count = 0
    for (let y = rowBand.start; y <= rowBand.end; y += 1) count += mask[y * width + x]
    return count
  })
  const columnBands = findBands(columnInk, Math.max(2, Math.round((rowBand.end - rowBand.start + 1) * .008)), Math.max(2, Math.round(width * .025)))
  const columnBand = columnBands.sort((a, b) => b.ink - a.ink)[0]
  if (!columnBand) return { left: 0, top: rowBand.start, right: width - 1, bottom: rowBand.end }
  const padding = Math.max(2, Math.round(Math.min(width, height) * .015))
  return {
    left: Math.max(0, columnBand.start - padding),
    top: Math.max(0, rowBand.start - padding),
    right: Math.min(width - 1, columnBand.end + padding),
    bottom: Math.min(height - 1, rowBand.end + padding),
  }
}

function restrictToBounds(mask: Uint8Array, width: number, height: number, bounds: PixelBounds) {
  const restricted = new Uint8Array(mask.length)
  for (let y = bounds.top; y <= bounds.bottom && y < height; y += 1) {
    const start = y * width + bounds.left
    restricted.set(mask.subarray(start, y * width + Math.min(width, bounds.right + 1)), start)
  }
  return restricted
}

function edgeMask(data: Uint8ClampedArray, width: number, height: number, bounds: PixelBounds) {
  const luminance = new Float32Array(width * height)
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4
    luminance[index] = data[offset] * .299 + data[offset + 1] * .587 + data[offset + 2] * .114
  }
  const mask = new Uint8Array(width * height)
  for (let y = Math.max(1, bounds.top); y < Math.min(height - 1, bounds.bottom + 1); y += 1) {
    for (let x = Math.max(1, bounds.left); x < Math.min(width - 1, bounds.right + 1); x += 1) {
      const index = y * width + x
      const gradientX = Math.abs(luminance[index + 1] - luminance[index - 1])
      const gradientY = Math.abs(luminance[index + width] - luminance[index - width])
      if (luminance[index] < 145 || Math.max(gradientX, gradientY) > 28) mask[index] = 1
    }
  }
  return mask
}

function isLineDrawing(data: Uint8ClampedArray) {
  let colorful = 0
  let dark = 0
  let visible = 0
  for (let offset = 0; offset < data.length; offset += 16) {
    if (data[offset + 3] < 80) continue
    visible += 1
    const maximum = Math.max(data[offset], data[offset + 1], data[offset + 2])
    const minimum = Math.min(data[offset], data[offset + 1], data[offset + 2])
    if (maximum - minimum > 22 && maximum < 245) colorful += 1
    const luminance = data[offset] * .299 + data[offset + 1] * .587 + data[offset + 2] * .114
    if (luminance < 125) dark += 1
  }
  return colorful / Math.max(1, visible) < .025 && dark / Math.max(1, visible) < .05
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
  if (candidate.widthPx < 4) return false
  const angles = [15, 25, 35, 45, 55, 65, 75, 85]

  for (const hingeAtEnd of [false, true]) {
    for (const perpendicularSign of [-1, 1]) {
      for (const radiusRatio of [.7, .85, 1, 1.15]) {
        const radius = candidate.widthPx * radiusRatio
        let hits = 0
        for (const degree of angles) {
          const angle = degree * Math.PI / 180
          const along = Math.cos(angle) * radius * (hingeAtEnd ? -1 : 1)
          const perpendicular = Math.sin(angle) * radius * perpendicularSign
          const hinge = hingeAtEnd ? gapEnd : gapStart
          const x = line.axis === 'horizontal' ? hinge + along : line.coordinate + perpendicular
          const y = line.axis === 'horizontal' ? line.coordinate + perpendicular : hinge + along
          if (hasPixelNear(mask, width, height, x, y, Math.max(1, Math.round(radius * .055)))) hits += 1
        }
        let leafHits = 0
        for (const fraction of [.25, .4, .55, .7, .85]) {
          const perpendicular = radius * fraction * perpendicularSign
          const hinge = hingeAtEnd ? gapEnd : gapStart
          const x = line.axis === 'horizontal' ? hinge : line.coordinate + perpendicular
          const y = line.axis === 'horizontal' ? line.coordinate + perpendicular : hinge
          if (hasPixelNear(mask, width, height, x, y, Math.max(1, Math.round(radius * .045)))) leafHits += 1
        }
        // Tiny floor-plan thumbnails often preserve the swing arc but blur the
        // radial door leaf into a single pixel. Keep the leaf as corroborating
        // evidence without requiring a long, perfectly perpendicular stroke.
        if (hits >= 6 && leafHits >= 1) return true
      }
    }
  }
  return false
}

function countParallelStrokes(mask: Uint8Array, width: number, height: number, line: PixelLine, candidate: PixelOpening) {
  const start = Math.round(line.start + candidate.offsetPx + 1)
  const end = Math.round(start + candidate.widthPx - 2)
  const radius = Math.max(3, Math.round(line.thickness * 3))
  const active: number[] = []
  for (let offset = -radius; offset <= radius; offset += 1) {
    let hits = 0
    for (let along = start; along <= end; along += 1) {
      const x = line.axis === 'horizontal' ? along : line.coordinate + offset
      const y = line.axis === 'horizontal' ? line.coordinate + offset : along
      if (x >= 0 && y >= 0 && x < width && y < height) hits += mask[Math.round(y) * width + Math.round(x)]
    }
    if (hits / Math.max(1, end - start + 1) >= .42) active.push(offset)
  }
  let strokes = 0
  active.forEach((offset, index) => { if (index === 0 || offset - active[index - 1] > 1) strokes += 1 })
  return strokes
}

function classifyOpenings(lines: PixelLine[], symbols: Uint8Array, width: number, height: number, bounds: PixelBounds, detectionMmPerPixel: number) {
  const exteriorTolerance = Math.max(6, Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) * .09)
  const horizontalCoordinates = lines.filter((line) => line.axis === 'horizontal').map((line) => line.coordinate)
  const verticalCoordinates = lines.filter((line) => line.axis === 'vertical').map((line) => line.coordinate)
  const horizontalExtent = { minimum: Math.min(...horizontalCoordinates), maximum: Math.max(...horizontalCoordinates) }
  const verticalExtent = { minimum: Math.min(...verticalCoordinates), maximum: Math.max(...verticalCoordinates) }
  for (const line of lines) {
    for (const candidate of line.openings) {
      const widthMm = candidate.widthPx * detectionMmPerPixel
      const hasArc = widthMm <= 1900 && hasQuarterArc(symbols, width, height, line, candidate)
      const parallelStrokes = countParallelStrokes(symbols, width, height, line, candidate)
      const extent = line.axis === 'horizontal' ? horizontalExtent : verticalExtent
      const nearExterior = Math.min(Math.abs(line.coordinate - extent.minimum), Math.abs(line.coordinate - extent.maximum)) <= exteriorTolerance
      // Repeated strokes on the envelope are a strong window signature. In
      // the interior, a verified swing arc takes precedence; otherwise the
      // same parallel-stroke pattern represents a sliding opening.
      if (parallelStrokes >= 2 && nearExterior) candidate.kind = 'window'
      else if (hasArc && !nearExterior) candidate.kind = 'swing'
      else if (parallelStrokes >= 2 && widthMm >= 1050) candidate.kind = 'sliding'
      else candidate.kind = 'window'
    }
  }
}

type Run = { coordinate: number; start: number; end: number }

function scanRuns(mask: Uint8Array, width: number, height: number, axis: Axis): Run[] {
  const majorLength = axis === 'horizontal' ? height : width
  const minorLength = axis === 'horizontal' ? width : height
  const minRun = Math.max(10, Math.round(minorLength * 0.04))
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

function clusterRuns(runs: Run[], axis: Axis, requiredThickness: number): PixelLine[] {
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
      return coordinates.size >= requiredThickness
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

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 1
}

function filterStructuralLines(lines: PixelLine[], minimumDimension: number) {
  const minimumThinLength = Math.max(14, minimumDimension * .24)
  return lines.filter((line) => {
    const length = line.end - line.start
    if (line.thickness >= 2 && length >= Math.max(8, minimumDimension * .055)) return true
    if (length >= minimumThinLength) return true
    return lines.some((other) => other !== line
      && other.axis === line.axis
      && Math.abs(other.coordinate - line.coordinate) >= 2
      && Math.abs(other.coordinate - line.coordinate) <= Math.max(8, minimumDimension * .05)
      && overlapRatio(line, other) > .68
      && other.end - other.start >= minimumDimension * .18)
  })
}

function estimateDetectionScale(lines: PixelLine[]) {
  const typicalThickness = Math.max(1, median(lines.map((line) => line.thickness).filter((value) => value <= 32)))
  return Math.max(.5, Math.min(200, 160 / typicalThickness))
}

function mergeCollinear(lines: PixelLine[], detectionMmPerPixel: number): PixelLine[] {
  const typicalThickness = Math.max(1, median(lines.map((line) => line.thickness)))
  const coordinateTolerance = Math.max(2, Math.min(7, Math.round(typicalThickness * .7)))
  const minOpeningPx = Math.max(4, 480 / detectionMmPerPixel)
  const maxOpeningPx = Math.max(minOpeningPx + 2, 2400 / detectionMmPerPixel)
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

function removeDuplicates(lines: PixelLine[], detectionMmPerPixel: number) {
  const minimumLength = Math.max(5, 500 / detectionMmPerPixel)
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
  // Recognition runs on a normalized analysis canvas. This preserves thin
  // one-pixel walls and door arcs in thumbnails without changing the uploaded
  // image or the user's calibration coordinate system.
  const analysisScale = Math.max(1, Math.min(3, 320 / Math.min(imageData.widthPx, imageData.heightPx)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(imageData.widthPx * analysisScale)
  canvas.height = Math.round(imageData.heightPx * analysisScale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('이미지 분석을 시작할 수 없어요.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const lineDrawing = isLineDrawing(pixels.data)
  const initialMask = luminanceMask(pixels.data, canvas.width, canvas.height, lineDrawing ? 205 : 125)
  const bounds = findDrawingBounds(initialMask, canvas.width, canvas.height)
  const mask = restrictToBounds(initialMask, canvas.width, canvas.height, bounds)
  const symbols = edgeMask(pixels.data, canvas.width, canvas.height, bounds)
  const raw = filterStructuralLines([
    ...clusterRuns(scanRuns(mask, canvas.width, canvas.height, 'horizontal'), 'horizontal', 1),
    ...clusterRuns(scanRuns(mask, canvas.width, canvas.height, 'vertical'), 'vertical', 1),
  ], Math.min(bounds.right - bounds.left + 1, bounds.bottom - bounds.top + 1))
  const detectionMmPerPixel = estimateDetectionScale(raw)
  const lines = removeDuplicates(mergeCollinear(raw, detectionMmPerPixel), detectionMmPerPixel)
  classifyOpenings(lines, symbols, canvas.width, canvas.height, bounds, detectionMmPerPixel)
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
      start: { x: startPx.x / analysisScale * calibration.mmPerPixel, y: startPx.y / analysisScale * calibration.mmPerPixel },
      end: { x: endPx.x / analysisScale * calibration.mmPerPixel, y: endPx.y / analysisScale * calibration.mmPerPixel },
      thicknessMm: Math.max(100, Math.min(300, line.thickness / analysisScale * calibration.mmPerPixel)),
      heightMm: 2400,
    })
    for (const candidate of line.openings) {
      const widthMm = candidate.widthPx / analysisScale * calibration.mmPerPixel
      openings.push({
        id: nanoid(),
        wallId,
        detected: true,
        type: candidate.kind === 'window' ? 'window' : 'door',
        doorKind: candidate.kind === 'swing' ? 'swing' : candidate.kind === 'sliding' ? 'sliding' : undefined,
        offsetMm: candidate.offsetPx / analysisScale * calibration.mmPerPixel,
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
