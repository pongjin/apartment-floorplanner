import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Konva from 'konva'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { Copy, Hand, Move, RotateCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { distance, formatMm, mmToPx, pxToMm } from '../lib/geometry'
import { useProjectStore } from '../store/projectStore'
import { furnitureColors } from '../lib/furniturePresets'
import type { FurnitureItem, PointMm, PointPx, Wall } from '../types/project'

type Props = {
  calibrationPoints: PointPx[]
  setCalibrationPoints: (points: PointPx[]) => void
}

function useHtmlImage(src?: string) {
  const [image, setImage] = useState<HTMLImageElement>()
  useEffect(() => {
    if (!src) return setImage(undefined)
    const next = new Image()
    next.onload = () => setImage(next)
    next.src = src
  }, [src])
  return image
}

const WALL_SNAP_MAX_GAP_MM = 30
const WALL_SNAP_MAX_PENETRATION_MM = 80
const DRAW_SNAP_DISTANCE_PX = 18
const DRAW_ANGLE_SNAP_RAD = Math.PI / 24

function angularDistance(a: number, b: number) {
  const difference = Math.abs(a - b) % Math.PI
  return Math.min(difference, Math.PI - difference)
}

function snapDraftPoint(candidate: PointPx, start: PointPx | undefined, walls: Wall[], calibrationMmPerPixel: number, scale: number): PointPx {
  const threshold = DRAW_SNAP_DISTANCE_PX / scale
  let snapped = candidate
  let nearest = threshold
  let snappedToStructure = false
  for (const wall of walls) {
    const a = { x: wall.start.x / calibrationMmPerPixel, y: wall.start.y / calibrationMmPerPixel }
    const b = { x: wall.end.x / calibrationMmPerPixel, y: wall.end.y / calibrationMmPerPixel }
    for (const endpoint of [a, b]) {
      const gap = distance(candidate, endpoint)
      if (gap < nearest) { nearest = gap; snapped = endpoint; snappedToStructure = true }
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) continue
    const ratio = Math.max(0, Math.min(1, ((candidate.x - a.x) * dx + (candidate.y - a.y) * dy) / lengthSquared))
    const projected = { x: a.x + dx * ratio, y: a.y + dy * ratio }
    const gap = distance(candidate, projected)
    if (gap < nearest) { nearest = gap; snapped = projected; snappedToStructure = true }
  }
  if (!start || snappedToStructure) return snapped
  const dx = snapped.x - start.x
  const dy = snapped.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return snapped
  const angle = Math.atan2(dy, dx)
  const wallAngles = walls.map((wall) => Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x))
  const target = [0, Math.PI / 2, ...wallAngles].reduce<{ angle: number; gap: number } | undefined>((best, candidateAngle) => {
    const gap = angularDistance(angle, candidateAngle)
    return !best || gap < best.gap ? { angle: candidateAngle, gap } : best
  }, undefined)
  if (!target || target.gap > DRAW_ANGLE_SNAP_RAD) return snapped
  const direction = Math.cos(angle - target.angle) >= 0 ? 1 : -1
  return { x: start.x + Math.cos(target.angle) * length * direction, y: start.y + Math.sin(target.angle) * length * direction }
}

function snapFurnitureToWalls(item: FurnitureItem, candidate: PointMm, walls: Wall[]): PointMm {
  const angle = item.rotationDeg * Math.PI / 180
  const widthAxis = { x: Math.cos(angle), y: Math.sin(angle) }
  const depthAxis = { x: -Math.sin(angle), y: Math.cos(angle) }
  const halfWidth = item.widthMm / 2
  const halfDepth = item.depthMm / 2
  const matches: { correction: number; normalX: number; normalY: number; strength: number }[] = []

  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x
    const dy = wall.end.y - wall.start.y
    const length = Math.hypot(dx, dy)
    if (length < 1) continue
    const tangent = { x: dx / length, y: dy / length }
    const normal = { x: -tangent.y, y: tangent.x }
    const relative = { x: candidate.x - wall.start.x, y: candidate.y - wall.start.y }
    const along = relative.x * tangent.x + relative.y * tangent.y
    const signedDistance = relative.x * normal.x + relative.y * normal.y
    const side = signedDistance >= 0 ? 1 : -1
    const distanceToCenterLine = Math.abs(signedDistance)
    const extentAlongWall = Math.abs(widthAxis.x * tangent.x + widthAxis.y * tangent.y) * halfWidth
      + Math.abs(depthAxis.x * tangent.x + depthAxis.y * tangent.y) * halfDepth
    if (along + extentAlongWall <= 0 || along - extentAlongWall >= length) continue
    const extentNormal = Math.abs(widthAxis.x * normal.x + widthAxis.y * normal.y) * halfWidth
      + Math.abs(depthAxis.x * normal.x + depthAxis.y * normal.y) * halfDepth
    const targetDistance = extentNormal + wall.thicknessMm / 2
    const gap = distanceToCenterLine - targetDistance
    if (gap < -WALL_SNAP_MAX_PENETRATION_MM || gap > WALL_SNAP_MAX_GAP_MM) continue
    matches.push({ correction: -gap * side, normalX: normal.x, normalY: normal.y, strength: Math.abs(gap) })
  }

  if (!matches.length) return candidate
  matches.sort((a, b) => a.strength - b.strength)
  const first = matches[0]
  const second = matches.find((match) => Math.abs(first.normalX * match.normalX + first.normalY * match.normalY) < .92)
  if (!second) return {
    x: candidate.x + first.normalX * first.correction,
    y: candidate.y + first.normalY * first.correction,
  }

  const determinant = first.normalX * second.normalY - first.normalY * second.normalX
  if (Math.abs(determinant) < .08) return candidate
  const deltaX = (first.correction * second.normalY - first.normalY * second.correction) / determinant
  const deltaY = (first.normalX * second.correction - first.correction * second.normalX) / determinant
  return { x: candidate.x + deltaX, y: candidate.y + deltaY }
}

export function FloorPlanStage({ calibrationPoints, setCalibrationPoints }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const gestureRef = useRef<{ center: PointPx; distance: number } | undefined>(undefined)
  const [size, setSize] = useState({ width: 390, height: 520 })
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const [wallStart, setWallStart] = useState<PointPx>()
  const [wallEnd, setWallEnd] = useState<PointPx>()
  const [selectedWallId, setSelectedWallId] = useState<string>()
  const [selectedOpeningId, setSelectedOpeningId] = useState<string>()
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string>()
  const [panMode, setPanMode] = useState(false)
  const [showFurnitureProperties, setShowFurnitureProperties] = useState(false)
  const [furnitureDragging, setFurnitureDragging] = useState(false)
  const [interactionMode, setInteractionMode] = useState<'edit' | 'create'>('create')
  const project = useProjectStore((s) => s.project)
  const addWall = useProjectStore((s) => s.addWall)
  const updateWall = useProjectStore((s) => s.updateWall)
  const deleteWall = useProjectStore((s) => s.deleteWall)
  const addOpening = useProjectStore((s) => s.addOpening)
  const addStandaloneOpening = useProjectStore((s) => s.addStandaloneOpening)
  const deleteOpening = useProjectStore((s) => s.deleteOpening)
  const updateFurniture = useProjectStore((s) => s.updateFurniture)
  const deleteFurniture = useProjectStore((s) => s.deleteFurniture)
  const duplicateFurniture = useProjectStore((s) => s.duplicateFurniture)
  const image = useHtmlImage(project.floorPlanImage?.dataUrl)
  const step = project.viewState.activeStep
  const selectedOpening = project.openings.find((item) => item.id === selectedOpeningId)
  const selectedFurniture = project.furniture.find((item) => item.id === selectedFurnitureId)

  useEffect(() => setShowFurnitureProperties(false), [selectedFurnitureId])

  useEffect(() => {
    if (step !== 'furniture' || !selectedFurniture || panMode) return
    const moveSelected = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select')) return
      event.preventDefault()
      const amount = event.shiftKey ? 1 : 10
      const delta = {
        x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
        y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0,
      }
      const candidate = { x: selectedFurniture.position.x + delta.x, y: selectedFurniture.position.y + delta.y }
      updateFurniture(selectedFurniture.id, { position: snapFurnitureToWalls(selectedFurniture, candidate, project.walls) })
    }
    window.addEventListener('keydown', moveSelected)
    return () => window.removeEventListener('keydown', moveSelected)
  }, [panMode, project.walls, selectedFurniture, step, updateFurniture])

  const fit = useMemo(() => {
    if (!project.floorPlanImage) return { x: 0, y: 0, scale: 1 }
    const pad = 24
    const scale = Math.min((size.width - pad * 2) / project.floorPlanImage.widthPx, (size.height - pad * 2) / project.floorPlanImage.heightPx)
    return {
      scale,
      x: (size.width - project.floorPlanImage.widthPx * scale) / 2,
      y: (size.height - project.floorPlanImage.heightPx * scale) / 2,
    }
  }, [project.floorPlanImage, size])

  useEffect(() => setView(fit), [fit])
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const pointerInImage = (): PointPx | undefined => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer || !project.floorPlanImage) return
    const point = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale }
    if (point.x < 0 || point.y < 0 || point.x > project.floorPlanImage.widthPx || point.y > project.floorPlanImage.heightPx) return
    return point
  }

  const handleStageTap = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (panMode) return
    if (event.target !== event.target.getStage() && event.target.name() !== 'floor-image') return
    const point = pointerInImage()
    if (!point) return
    setSelectedWallId(undefined)
    setSelectedOpeningId(undefined)
    setSelectedFurnitureId(undefined)
    if (step === 'scale') {
      setCalibrationPoints(calibrationPoints.length >= 2 ? [point] : [...calibrationPoints, point])
    }
    if (step === 'walls' && interactionMode === 'create' && project.calibration) {
      const snapped = snapDraftPoint(point, wallStart, project.walls, project.calibration.mmPerPixel, view.scale)
      if (!wallStart) setWallStart(snapped)
      else if (!wallEnd && distance(wallStart, snapped) > 3) setWallEnd(snapped)
    }
  }

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    if (!panMode) return
    event.evt.preventDefault()
    if (!event.evt.ctrlKey) {
      setView((current) => ({ ...current, x: current.x - event.evt.deltaX, y: current.y - event.evt.deltaY }))
      return
    }
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const oldScale = view.scale
    const scale = Math.max(fit.scale * 0.7, Math.min(oldScale * (event.evt.deltaY > 0 ? 0.9 : 1.1), fit.scale * 6))
    const imagePoint = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale }
    setView({ scale, x: pointer.x - imagePoint.x * scale, y: pointer.y - imagePoint.y * scale })
  }

  const handleWallTap = (event: KonvaEventObject<MouseEvent | TouchEvent>, wallId: string) => {
    event.cancelBubble = true
    if (panMode) return
    const point = pointerInImage()
    if (interactionMode === 'create' && step === 'walls' && point && project.calibration) {
      const snapped = snapDraftPoint(point, wallStart, project.walls, project.calibration.mmPerPixel, view.scale)
      if (!wallStart) setWallStart(snapped)
      else if (!wallEnd && distance(wallStart, snapped) > 3) setWallEnd(snapped)
      setSelectedWallId(undefined)
      return
    }
    if (interactionMode !== 'edit') return
    setSelectedWallId(wallId)
    setSelectedOpeningId(undefined)
  }

  const handleTouchMove = (event: KonvaEventObject<TouchEvent>) => {
    if (!panMode) return
    const [a, b] = Array.from(event.evt.touches)
    if (!a || !b) return
    event.evt.preventDefault()
    const rect = stageRef.current?.container().getBoundingClientRect()
    if (!rect) return
    const center = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top }
    const touchDistance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    const previous = gestureRef.current
    if (previous) {
      const imagePoint = { x: (previous.center.x - view.x) / view.scale, y: (previous.center.y - view.y) / view.scale }
      const scale = Math.max(fit.scale * 0.7, Math.min(view.scale * (touchDistance / previous.distance), fit.scale * 6))
      setView({ x: center.x - imagePoint.x * scale, y: center.y - imagePoint.y * scale, scale })
    }
    gestureRef.current = { center, distance: touchDistance }
  }

  const commitDraft = (kind: 'wall' | 'door' | 'window' | 'sliding' | 'balcony') => {
    if (!wallStart || !wallEnd || !project.calibration) return
    const start = pxToMm(wallStart, project.calibration)
    const end = pxToMm(wallEnd, project.calibration)
    if (kind === 'wall') addWall(start, end)
    else addStandaloneOpening(start, end, kind)
    setWallStart(undefined)
    setWallEnd(undefined)
  }

  const startFurnitureDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selectedFurniture || !project.calibration) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setFurnitureDragging(true)
    const start = { x: event.clientX, y: event.clientY }
    const original = selectedFurniture.position
    const item = selectedFurniture
    const move = (pointerEvent: PointerEvent) => {
      const factor = project.calibration!.mmPerPixel / view.scale
      const candidate = { x: original.x + (pointerEvent.clientX - start.x) * factor, y: original.y + (pointerEvent.clientY - start.y) * factor }
      updateFurniture(item.id, { position: snapFurnitureToWalls(item, candidate, project.walls) })
    }
    const end = () => {
      setFurnitureDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onClick={handleStageTap}
        onTap={handleStageTap}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => { gestureRef.current = undefined }}
      >
        <Layer>
          <Rect x={0} y={0} width={size.width} height={size.height} fill="#e9e7df" />
          <Group
            x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}
            draggable={panMode}
            onDragMove={(event) => {
              if (event.target !== event.currentTarget) return
              setView((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))
            }}
            onDragEnd={(event) => {
              if (event.target !== event.currentTarget) return
              setView((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))
            }}
          >
            {image && project.floorPlanImage && (
              <KonvaImage
                name="floor-image"
                image={image}
                width={project.floorPlanImage.widthPx}
                height={project.floorPlanImage.heightPx}
                opacity={step === 'walls' ? 0.72 : 1}
              />
            )}
            {step === 'walls' && project.calibration && (() => {
              const inverseScale = 1 / view.scale
              const oneMeterPx = 1000 / project.calibration.mmPerPixel
              const panelWidth = Math.max(oneMeterPx + 16 * inverseScale, 132 * inverseScale)
              return <Group x={14 * inverseScale} y={14 * inverseScale} listening={false}>
                <Rect width={panelWidth} height={40 * inverseScale} fill="#fffdf8" opacity={.92} cornerRadius={8 * inverseScale} shadowColor="#17352e" shadowOpacity={.12} shadowBlur={8 * inverseScale} />
                <Line points={[8 * inverseScale, 15 * inverseScale, 8 * inverseScale + oneMeterPx, 15 * inverseScale]} stroke="#19a56b" strokeWidth={2 * inverseScale} />
                <Line points={[8 * inverseScale, 10 * inverseScale, 8 * inverseScale, 20 * inverseScale, 8 * inverseScale + oneMeterPx, 20 * inverseScale, 8 * inverseScale + oneMeterPx, 10 * inverseScale]} stroke="#19a56b" strokeWidth={2 * inverseScale} />
                <Text x={8 * inverseScale} y={24 * inverseScale} width={panelWidth - 16 * inverseScale} text={`1 m 기준 · ${project.calibration.mmPerPixel.toFixed(2)} mm/px`} fontSize={9 * inverseScale} fill="#315d50" />
              </Group>
            })()}
            {step === 'scale' && project.calibration && (
              <>
                <Line points={[project.calibration.imagePointA.x, project.calibration.imagePointA.y, project.calibration.imagePointB.x, project.calibration.imagePointB.y]} stroke="#e85d3f" strokeWidth={3 / view.scale} dash={[8 / view.scale, 6 / view.scale]} />
              </>
            )}
            {step === 'scale' && calibrationPoints.length > 0 && (
              <>
                {calibrationPoints.length === 2 && <Line points={calibrationPoints.flatMap((p) => [p.x, p.y])} stroke="#e85d3f" strokeWidth={3 / view.scale} />}
                {calibrationPoints.map((point, index) => <Circle key={index} x={point.x} y={point.y} radius={7 / view.scale} fill="#fff" stroke="#e85d3f" strokeWidth={3 / view.scale} />)}
              </>
            )}
            {project.calibration && project.walls.map((wall) => {
              const start = mmToPx(wall.start, project.calibration!)
              const end = mmToPx(wall.end, project.calibration!)
              const selected = wall.id === selectedWallId
              const length = distance(wall.start, wall.end)
              return (
                <Group key={wall.id} listening={step === 'walls'}>
                  <Line
                    points={[start.x, start.y, end.x, end.y]}
                    stroke={selected ? '#e85d3f' : '#19a56b'}
                    strokeWidth={Math.max(3 / view.scale, 2)}
                    dash={[9 / view.scale, 6 / view.scale]}
                    lineCap="square"
                    hitStrokeWidth={20 / view.scale}
                    onClick={(e) => handleWallTap(e, wall.id)}
                    onTap={(e) => handleWallTap(e, wall.id)}
                  />
                  {(project.walls.length <= 10 || selected) && <Text x={(start.x + end.x) / 2 - 28 / view.scale} y={(start.y + end.y) / 2 - 20 / view.scale} width={56 / view.scale} align="center" text={formatMm(length)} fontSize={11 / view.scale} fill="#17352e" padding={3 / view.scale} />}
                  {selected && step === 'walls' && interactionMode === 'edit' && !panMode && (
                    <>
                      <Circle
                        x={start.x} y={start.y} radius={8 / view.scale}
                        fill="#fff" stroke="#e85d3f" strokeWidth={3 / view.scale}
                        draggable
                        onClick={(event) => { event.cancelBubble = true }}
                        onTap={(event) => { event.cancelBubble = true }}
                        onDragEnd={(event) => updateWall(wall.id, { start: pxToMm({ x: event.target.x(), y: event.target.y() }, project.calibration!) })}
                      />
                      <Circle
                        x={end.x} y={end.y} radius={8 / view.scale}
                        fill="#fff" stroke="#e85d3f" strokeWidth={3 / view.scale}
                        draggable
                        onClick={(event) => { event.cancelBubble = true }}
                        onTap={(event) => { event.cancelBubble = true }}
                        onDragEnd={(event) => updateWall(wall.id, { end: pxToMm({ x: event.target.x(), y: event.target.y() }, project.calibration!) })}
                      />
                    </>
                  )}
                </Group>
              )
            })}
            {project.calibration && project.openings.map((opening) => {
              const wall = project.walls.find((item) => item.id === opening.wallId)
              if (!wall && (!opening.start || !opening.end)) return null
              let openingStart: PointPx
              let openingEnd: PointPx
              let wallStroke = 5 / view.scale
              if (wall) {
                const wallLength = distance(wall.start, wall.end)
                if (wallLength === 0) return null
                const ux = (wall.end.x - wall.start.x) / wallLength
                const uy = (wall.end.y - wall.start.y) / wallLength
                const offset = Math.min(opening.offsetMm, Math.max(0, wallLength - opening.widthMm))
                const width = Math.min(opening.widthMm, wallLength - offset)
                openingStart = mmToPx({ x: wall.start.x + ux * offset, y: wall.start.y + uy * offset }, project.calibration!)
                openingEnd = mmToPx({ x: wall.start.x + ux * (offset + width), y: wall.start.y + uy * (offset + width) }, project.calibration!)
                wallStroke = Math.max(5 / view.scale, wall.thicknessMm / project.calibration!.mmPerPixel)
              } else {
                openingStart = mmToPx(opening.start!, project.calibration!)
                openingEnd = mmToPx(opening.end!, project.calibration!)
              }
              const selected = opening.id === selectedOpeningId
              const detected = opening.detected !== false
              const detectedColor = opening.type === 'window' ? '#2585ad' : '#df4f36'
              const openingLabel = opening.detectedClass ?? (opening.type === 'window' ? '창' : opening.doorKind === 'sliding' ? '슬라이딩 도어' : opening.doorKind === 'balcony' ? '베란다 창' : '문')
              const confidenceLabel = opening.confidence == null ? '' : ` ${Math.round(opening.confidence * 100)}%`
              const dx = openingEnd.x - openingStart.x
              const dy = openingEnd.y - openingStart.y
              const pixelLength = Math.hypot(dx, dy) || 1
              const perpendicular = { x: -dy / pixelLength * 4 / view.scale, y: dx / pixelLength * 4 / view.scale }
              const selectOpening = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
                event.cancelBubble = true
                if (!panMode) { setSelectedOpeningId(opening.id); setSelectedWallId(undefined) }
              }
              if (!wall && opening.doorKind === 'sliding') return <Group key={opening.id} listening={interactionMode === 'edit'} onClick={selectOpening} onTap={selectOpening}>
                <Line points={[openingStart.x, openingStart.y, openingEnd.x, openingEnd.y]} stroke="#58aebe" strokeWidth={13 / view.scale} opacity={.35} lineCap="square" hitStrokeWidth={20 / view.scale} />
                <Line points={[openingStart.x + perpendicular.x, openingStart.y + perpendicular.y, openingEnd.x + perpendicular.x, openingEnd.y + perpendicular.y]} stroke={selected ? '#e85d3f' : '#2c7f8e'} strokeWidth={2 / view.scale} opacity={.9} />
                <Line points={[openingStart.x - perpendicular.x, openingStart.y - perpendicular.y, openingEnd.x - perpendicular.x, openingEnd.y - perpendicular.y]} stroke={selected ? '#e85d3f' : '#2c7f8e'} strokeWidth={2 / view.scale} opacity={.9} />
                <Text x={(openingStart.x + openingEnd.x) / 2 - 42 / view.scale} y={(openingStart.y + openingEnd.y) / 2 + 8 / view.scale} width={84 / view.scale} align="center" text="슬라이딩 도어" fontSize={10 / view.scale} fontStyle="bold" fill="#246f7d" />
              </Group>
              if (!wall && opening.doorKind === 'balcony') return <Group key={opening.id} listening={interactionMode === 'edit'} onClick={selectOpening} onTap={selectOpening}>
                <Line points={[openingStart.x, openingStart.y, openingEnd.x, openingEnd.y]} stroke="#dff5fb" strokeWidth={13 / view.scale} opacity={.22} lineCap="square" hitStrokeWidth={20 / view.scale} />
                <Line points={[openingStart.x + perpendicular.x, openingStart.y + perpendicular.y, openingEnd.x + perpendicular.x, openingEnd.y + perpendicular.y]} stroke={selected ? '#e85d3f' : '#64b8d0'} strokeWidth={2 / view.scale} dash={[6 / view.scale, 3 / view.scale]} />
                <Line points={[openingStart.x - perpendicular.x, openingStart.y - perpendicular.y, openingEnd.x - perpendicular.x, openingEnd.y - perpendicular.y]} stroke={selected ? '#e85d3f' : '#64b8d0'} strokeWidth={2 / view.scale} dash={[6 / view.scale, 3 / view.scale]} />
                <Text x={(openingStart.x + openingEnd.x) / 2 - 36 / view.scale} y={(openingStart.y + openingEnd.y) / 2 + 8 / view.scale} width={72 / view.scale} align="center" text="베란다 창" fontSize={10 / view.scale} fontStyle="bold" fill="#368aa4" />
              </Group>
              return <Group key={opening.id} listening={interactionMode === 'edit'}>
                <Line points={[openingStart.x, openingStart.y, openingEnd.x, openingEnd.y]} stroke="#fffdf8" strokeWidth={Math.max(5 / view.scale, wallStroke * .45)} lineCap="butt" />
                <Line
                  points={[openingStart.x, openingStart.y, openingEnd.x, openingEnd.y]}
                  stroke={detected ? detectedColor : selected ? '#e85d3f' : opening.type === 'door' ? '#e08736' : '#3a8eaa'}
                  strokeWidth={Math.max(3 / view.scale, wallStroke * .35)}
                  dash={detected || opening.type === 'window' ? [5 / view.scale, 3 / view.scale] : undefined}
                  hitStrokeWidth={18 / view.scale}
                  onClick={selectOpening}
                  onTap={selectOpening}
                />
                <Text
                  x={(openingStart.x + openingEnd.x) / 2 - 38 / view.scale}
                  y={(openingStart.y + openingEnd.y) / 2 + 5 / view.scale}
                  width={76 / view.scale} align="center"
                  text={`${openingLabel}${confidenceLabel}${detected ? ' 후보' : ''}`}
                  fontSize={10 / view.scale} fontStyle="bold"
                  fill={detected ? detectedColor : opening.type === 'door' ? '#b86425' : '#28748c'}
                />
              </Group>
            })}
            {step === 'furniture' && project.calibration && project.furniture.map((item) => {
              const center = mmToPx(item.position, project.calibration!)
              const width = Math.max(12 / view.scale, item.widthMm / project.calibration!.mmPerPixel)
              const height = Math.max(12 / view.scale, item.depthMm / project.calibration!.mmPerPixel)
              const selected = item.id === selectedFurnitureId
              return <Group
                key={item.id}
                x={center.x} y={center.y}
                rotation={item.rotationDeg}
                draggable={!panMode && !item.locked}
                dragBoundFunc={(absolutePosition) => {
                  const node = stageRef.current?.findOne(`#furniture-${item.id}`)
                  const parent = node?.getParent()
                  if (!parent || !project.floorPlanImage) return absolutePosition
                  const local = parent.getAbsoluteTransform().copy().invert().point(absolutePosition)
                  const clampedPx = {
                    x: Math.max(0, Math.min(project.floorPlanImage.widthPx, local.x)),
                    y: Math.max(0, Math.min(project.floorPlanImage.heightPx, local.y)),
                  }
                  const candidateMm = pxToMm(clampedPx, project.calibration!)
                  const snappedPx = mmToPx(snapFurnitureToWalls(item, candidateMm, project.walls), project.calibration!)
                  return parent.getAbsoluteTransform().point(snappedPx)
                }}
                id={`furniture-${item.id}`}
                onClick={(event) => { event.cancelBubble = true; setSelectedFurnitureId(item.id); setSelectedWallId(undefined); setSelectedOpeningId(undefined) }}
                onTap={(event) => { event.cancelBubble = true; setSelectedFurnitureId(item.id); setSelectedWallId(undefined); setSelectedOpeningId(undefined) }}
                onDragStart={(event) => { event.cancelBubble = true; setSelectedFurnitureId(item.id) }}
                onDragEnd={(event) => {
                  const candidate = pxToMm({ x: event.target.x(), y: event.target.y() }, project.calibration!)
                  updateFurniture(item.id, { position: snapFurnitureToWalls(item, candidate, project.walls) })
                }}
              >
                <Rect
                  x={-width / 2} y={-height / 2} width={width} height={height}
                  fill={item.color} opacity={selected ? .9 : .74}
                  stroke={selected ? '#e85d3f' : '#17352e'} strokeWidth={(selected ? 3 : 1.5) / view.scale}
                  dash={item.source === 'user' ? [5 / view.scale, 3 / view.scale] : undefined}
                  cornerRadius={Math.min(10 / view.scale, width * .08, height * .08)}
                  shadowColor="#17352e" shadowOpacity={selected ? .24 : .1} shadowBlur={selected ? 9 / view.scale : 3 / view.scale}
                />
                {item.type === 'bed' && <Line points={[-width * .42, -height * .25, width * .42, -height * .25]} stroke="#fff" opacity={.8} strokeWidth={2 / view.scale} />}
                {item.type === 'sofa' && <Line points={[-width * .4, height * .2, width * .4, height * .2]} stroke="#fff" opacity={.65} strokeWidth={2 / view.scale} />}
                <Text
                  x={-width / 2} y={-7 / view.scale} width={width} height={14 / view.scale}
                  text={item.name} align="center" verticalAlign="middle" ellipsis
                  fontSize={Math.min(11 / view.scale, height * .24)} fontStyle="bold" fill="#17352e"
                />
              </Group>
            })}
            {step === 'walls' && interactionMode === 'create' && wallStart && (
              <>
                {wallEnd && <Line points={[wallStart.x, wallStart.y, wallEnd.x, wallEnd.y]} stroke="#19a56b" strokeWidth={3 / view.scale} dash={[8 / view.scale, 5 / view.scale]} />}
                <Circle x={wallStart.x} y={wallStart.y} radius={6 / view.scale} fill="#f3b33e" stroke="#17352e" strokeWidth={2 / view.scale} />
                {wallEnd && <Circle x={wallEnd.x} y={wallEnd.y} radius={6 / view.scale} fill="#f3b33e" stroke="#17352e" strokeWidth={2 / view.scale} />}
              </>
            )}
          </Group>
        </Layer>
      </Stage>
      {step === 'walls' && <div className="structure-mode-switch" role="group" aria-label="구조 작업 모드">
        <button className={interactionMode === 'edit' ? 'active' : ''} onClick={() => {
          setInteractionMode('edit'); setWallStart(undefined); setWallEnd(undefined); setPanMode(false)
        }}>기존 구조 수정</button>
        <button className={interactionMode === 'create' ? 'active' : ''} onClick={() => {
          setInteractionMode('create'); setSelectedWallId(undefined); setSelectedOpeningId(undefined); setPanMode(false)
        }}>신규 구조 생성</button>
      </div>}
      <div className="canvas-controls">
        <button onClick={() => setView(fit)} aria-label="화면 맞춤">맞춤</button>
        <button disabled={!panMode} title={!panMode ? '도면 이동을 먼저 눌러주세요' : undefined} onClick={() => setView((v) => ({ ...v, scale: Math.min(v.scale * 1.25, fit.scale * 6) }))} aria-label="확대">＋</button>
        <button disabled={!panMode} title={!panMode ? '도면 이동을 먼저 눌러주세요' : undefined} onClick={() => setView((v) => ({ ...v, scale: Math.max(v.scale / 1.25, fit.scale * 0.7) }))} aria-label="축소">−</button>
      </div>
      {!(step === 'walls' && wallStart) && <button className={`pan-toggle ${panMode ? 'active' : ''}`} onClick={() => setPanMode((active) => !active)} aria-pressed={panMode} aria-label="도면 이동 모드">
        <Hand size={19} /><span>{panMode ? '이동 중' : '도면 이동'}</span>
      </button>}
      {step === 'walls' && interactionMode === 'create' && wallStart && (
        <div className="draft-actions">
          {wallEnd && project.calibration && <>
            <button className="create-wall-button" onClick={() => commitDraft('wall')}>벽 생성</button>
            <button className="create-door-button" onClick={() => commitDraft('door')}>문</button>
            <button className="create-window-button" onClick={() => commitDraft('window')}>창문</button>
            <button className="create-sliding-button" onClick={() => commitDraft('sliding')}>슬라이딩 도어</button>
            <button className="create-balcony-button" onClick={() => commitDraft('balcony')}>베란다 창</button>
          </>}
          <button className="cancel-wall-button" onClick={() => { setWallStart(undefined); setWallEnd(undefined) }}>선택 취소</button>
        </div>
      )}
      {selectedWallId && (
        <div className="selection-popover">
          <span><b>벽 편집</b><small>끝점을 끌어 조정</small></span>
          <div>
            <button className="opening-button door" onClick={() => addOpening(selectedWallId, 'door')}>＋ 문</button>
            <button className="opening-button window" onClick={() => addOpening(selectedWallId, 'window')}>＋ 창</button>
            <button onClick={() => { deleteWall(selectedWallId); setSelectedWallId(undefined) }}>삭제</button>
          </div>
        </div>
      )}
      {selectedOpeningId && (
        <div className="selection-popover">
          <span><b>{selectedOpening?.detectedClass ?? (selectedOpening?.type === 'window' ? '창문' : selectedOpening?.doorKind === 'sliding' ? '슬라이딩 도어' : selectedOpening?.doorKind === 'balcony' ? '베란다 창' : '문')} {selectedOpening?.confidence == null ? '' : `${Math.round(selectedOpening.confidence * 100)}% `}{selectedOpening?.detected !== false ? '후보' : ''}</b><small>{selectedOpening?.detected !== false ? 'AI 자동 인식 결과' : '직접 추가한 요소'}</small></span>
          <button onClick={() => { deleteOpening(selectedOpeningId); setSelectedOpeningId(undefined) }}>제거</button>
        </div>
      )}
      {step === 'furniture' && selectedFurnitureId && selectedFurniture && (
        <div className="selection-popover furniture-selection">
          <div className="furniture-inspector-copy"><b>{selectedFurniture.name}</b><small>방향키 10mm · Shift 1mm</small></div>
          <div className="furniture-direct-actions" aria-label="선택 가구 직접 조작">
            <button className={`neutral planar-handle ${furnitureDragging ? 'active' : ''}`} onPointerDown={startFurnitureDrag}><Move size={18} /><span>평면 이동</span></button>
            <button className="neutral" onClick={() => {
              const rotated = { ...selectedFurniture, rotationDeg: (selectedFurniture.rotationDeg + 90) % 360 }
              updateFurniture(selectedFurnitureId, { rotationDeg: rotated.rotationDeg, position: snapFurnitureToWalls(rotated, selectedFurniture.position, project.walls) })
            }}><RotateCw size={18} /><span>90° 회전</span></button>
            <button onClick={() => { deleteFurniture(selectedFurnitureId); setSelectedFurnitureId(undefined) }}><Trash2 size={18} /><span>제거</span></button>
            <button className={`neutral ${showFurnitureProperties ? 'active' : ''}`} aria-expanded={showFurnitureProperties} onClick={() => setShowFurnitureProperties((open) => !open)}><SlidersHorizontal size={18} /><span>속성</span></button>
          </div>
          {showFurnitureProperties && <div className="furniture-properties">
          <div className="furniture-size-fields">
            {([['widthMm', '가로'], ['depthMm', '세로'], ['heightMm', '높이']] as const).map(([key, label]) => <label key={key}>
              <span>{label}</span>
              <div><input type="number" min="1" step="10" value={selectedFurniture[key]} onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value) || value <= 0) return
                const resized = { ...selectedFurniture, [key]: value }
                updateFurniture(selectedFurnitureId, { [key]: value, position: snapFurnitureToWalls(resized, selectedFurniture.position, project.walls) })
              }} /><i>mm</i></div>
            </label>)}
          </div>
          <div className="selected-color-row" aria-label="가구 색상 프리셋">
            {furnitureColors.map((color) => <button key={color.value} className={selectedFurniture.color.toUpperCase() === color.value ? 'active' : ''} onClick={() => updateFurniture(selectedFurnitureId, { color: color.value })} title={color.name} aria-label={color.name}><i style={{ background: color.value }} /></button>)}
            <details className="rgb-details compact"><summary>RGB</summary><input type="color" value={selectedFurniture.color} onChange={(event) => updateFurniture(selectedFurnitureId, { color: event.target.value })} /></details>
          </div>
          <div className="furniture-inspector-actions">
            <button className="neutral" onClick={() => duplicateFurniture(selectedFurnitureId)}><Copy size={14} /> 복제</button>
          </div>
          </div>}
        </div>
      )}
    </div>
  )
}
