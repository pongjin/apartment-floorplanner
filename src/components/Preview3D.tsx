import { useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Grid, Html, OrbitControls } from '@react-three/drei'
import { Box, Hand, Move, MoveVertical, RotateCcw, RotateCw, Share2, SlidersHorizontal, Trash2 } from 'lucide-react'
import { MOUSE, TOUCH } from 'three'
import { useProjectStore } from '../store/projectStore'
import { furnitureColors } from '../lib/furniturePresets'
import { exportProject2D } from '../lib/exportProjectImage'
import { canvasToPngBlob, shareOrDownloadPng } from '../lib/shareImage'
import type { FurnitureItem, Opening, Wall } from '../types/project'

const meter = (mm: number) => mm / 1000

type Center = { x: number; z: number }

function CaptureBridge({ captureRef }: { captureRef: MutableRefObject<(() => Promise<void>) | null> }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    captureRef.current = async () => {
      gl.render(scene, camera)
      await shareOrDownloadPng(await canvasToPngBlob(gl.domElement), '집그림-3D-현재시점.png', '집그림 3D 현재 시점')
    }
    return () => { captureRef.current = null }
  }, [camera, captureRef, gl, scene])
  return null
}

function resolveOpenings(openings: Opening[], walls: Wall[]) {
  return openings.map((opening) => {
    if (opening.wallId && walls.some((wall) => wall.id === opening.wallId)) return opening
    if (!opening.start || !opening.end) return opening
    const openingDx = opening.end.x - opening.start.x
    const openingDy = opening.end.y - opening.start.y
    const openingLength = Math.hypot(openingDx, openingDy)
    if (openingLength < 1) return opening
    let best: { wall: Wall; offset: number; width: number; score: number } | undefined
    for (const wall of walls) {
      const dx = wall.end.x - wall.start.x
      const dy = wall.end.y - wall.start.y
      const length = Math.hypot(dx, dy)
      if (length < 1) continue
      const ux = dx / length
      const uy = dy / length
      const alignment = Math.abs((openingDx / openingLength) * ux + (openingDy / openingLength) * uy)
      if (alignment < .9) continue
      const project = (point: { x: number; y: number }) => (point.x - wall.start.x) * ux + (point.y - wall.start.y) * uy
      const perpendicular = (point: { x: number; y: number }) => Math.abs((point.x - wall.start.x) * -uy + (point.y - wall.start.y) * ux)
      const a = project(opening.start)
      const b = project(opening.end)
      const offset = Math.max(0, Math.min(a, b))
      const end = Math.min(length, Math.max(a, b))
      const distance = Math.max(perpendicular(opening.start), perpendicular(opening.end))
      if (end <= offset || distance > Math.max(180, wall.thicknessMm)) continue
      const score = distance + (1 - alignment) * 500
      if (!best || score < best.score) best = { wall, offset, width: end - offset, score }
    }
    return best ? { ...opening, wallId: best.wall.id, offsetMm: best.offset, widthMm: best.width } : opening
  })
}

function WallPiece({ wall, from, to, bottom, height, center }: { wall: Wall; from: number; to: number; bottom: number; height: number; center: Center }) {
  if (to <= from || height <= 0) return null
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthMm = Math.hypot(dx, dy)
  const ux = dx / lengthMm
  const uy = dy / lengthMm
  const middle = (from + to) / 2
  return <mesh
    castShadow receiveShadow
    position={[meter(wall.start.x + ux * middle) - center.x, meter(bottom + height / 2), meter(wall.start.y + uy * middle) - center.z]}
    rotation={[0, -Math.atan2(dy, dx), 0]}
  >
    <boxGeometry args={[meter(to - from), meter(height), meter(wall.thicknessMm)]} />
    <meshStandardMaterial color="#e8e2d6" roughness={.82} />
  </mesh>
}

function Wall3D({ wall, openings, center }: { wall: Wall; openings: Opening[]; center: Center }) {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  const attached = openings
    .filter((opening) => opening.wallId === wall.id)
    .sort((a, b) => a.offsetMm - b.offsetMm)
  if (!attached.length) return <WallPiece wall={wall} from={0} to={length} bottom={0} height={wall.heightMm} center={center} />

  const pieces: ReactNode[] = []
  let cursor = 0
  attached.forEach((opening, index) => {
    const start = Math.max(cursor, Math.min(length, opening.offsetMm))
    const end = Math.max(start, Math.min(length, opening.offsetMm + opening.widthMm))
    if (start > cursor) pieces.push(<WallPiece key={`full-${index}`} wall={wall} from={cursor} to={start} bottom={0} height={wall.heightMm} center={center} />)
    const sill = opening.type === 'window' ? (opening.sillHeightMm ?? 900) : 0
    const openingHeight = opening.heightMm ?? (opening.type === 'door' ? 2100 : 1200)
    if (sill > 0) pieces.push(<WallPiece key={`low-${index}`} wall={wall} from={start} to={end} bottom={0} height={sill} center={center} />)
    const top = sill + openingHeight
    if (top < wall.heightMm) pieces.push(<WallPiece key={`high-${index}`} wall={wall} from={start} to={end} bottom={top} height={wall.heightMm - top} center={center} />)
    cursor = end
  })
  if (cursor < length) pieces.push(<WallPiece key="tail" wall={wall} from={cursor} to={length} bottom={0} height={wall.heightMm} center={center} />)
  return <>{pieces}</>
}

function OpeningFrame({ width, height, sill = 0, frameColor = '#51615d' }: { width: number; height: number; sill?: number; frameColor?: string }) {
  const bar = .055
  return <>
    <BoxMesh size={[bar, height, .07]} position={[-width / 2, sill + height / 2, 0]} color={frameColor} />
    <BoxMesh size={[bar, height, .07]} position={[width / 2, sill + height / 2, 0]} color={frameColor} />
    <BoxMesh size={[width, bar, .07]} position={[0, sill + height, 0]} color={frameColor} />
    {sill > 0 && <BoxMesh size={[width, bar, .07]} position={[0, sill, 0]} color={frameColor} />}
  </>
}

function GlassPanel({ width, height, position, color = '#9dcbd4' }: { width: number; height: number; position: [number, number, number]; color?: string }) {
  return <mesh castShadow position={position}><boxGeometry args={[width, height, .025]} /><meshPhysicalMaterial color={color} transparent opacity={.34} roughness={.12} metalness={.05} transmission={.18} /></mesh>
}

function Opening3D({ opening, walls, center }: { opening: Opening; walls: Wall[]; center: Center }) {
  const wall = walls.find((candidate) => candidate.id === opening.wallId)
  let start = opening.start
  let end = opening.end
  if (wall) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    const ux = (wall.end.x - wall.start.x) / length
    const uy = (wall.end.y - wall.start.y) / length
    const offset = Math.min(opening.offsetMm, Math.max(0, length - opening.widthMm))
    start = { x: wall.start.x + ux * offset, y: wall.start.y + uy * offset }
    end = { x: wall.start.x + ux * (offset + Math.min(opening.widthMm, length - offset)), y: wall.start.y + uy * (offset + Math.min(opening.widthMm, length - offset)) }
  }
  if (!start || !end) return null
  const dx = end.x - start.x
  const dy = end.y - start.y
  const width = meter(Math.hypot(dx, dy))
  const rotation = -Math.atan2(dy, dx)
  const origin: [number, number, number] = [meter((start.x + end.x) / 2) - center.x, 0, meter((start.y + end.y) / 2) - center.z]
  const height = meter(opening.heightMm ?? (opening.type === 'door' ? 2100 : 1200))
  const sill = meter(opening.type === 'window' ? (opening.sillHeightMm ?? 900) : 0)

  if (opening.type === 'window' && !opening.doorKind) return <group position={origin} rotation={[0, rotation, 0]}>
    <GlassPanel width={width * .96} height={height * .92} position={[0, sill + height / 2, 0]} />
    <OpeningFrame width={width} height={height} sill={sill} />
    <BoxMesh size={[.04, height, .08]} position={[0, sill + height / 2, 0]} color="#667975" />
  </group>

  if (opening.doorKind === 'sliding') return <group position={origin} rotation={[0, rotation, 0]}>
    <OpeningFrame width={width} height={height} frameColor="#3d4140" />
    <GlassPanel width={width * .54} height={height * .94} position={[-width * .22, height * .48, -.035]} color="#aabdbc" />
    <GlassPanel width={width * .54} height={height * .94} position={[width * .22, height * .48, .035]} color="#aabdbc" />
    <BoxMesh size={[width, .035, .12]} position={[0, .018, 0]} color="#3d4140" />
  </group>

  if (opening.doorKind === 'balcony') return <group position={origin} rotation={[0, rotation, 0]}>
    <OpeningFrame width={width} height={height} frameColor="#eeeae1" />
    <GlassPanel width={width * .47} height={height * .94} position={[-width * .245, height * .48, 0]} color="#c7dce2" />
    <GlassPanel width={width * .47} height={height * .94} position={[width * .245, height * .48, 0]} color="#c7dce2" />
    <BoxMesh size={[.055, height, .09]} position={[0, height / 2, 0]} color="#eeeae1" />
  </group>

  const openAngle = -.48
  return <group position={origin} rotation={[0, rotation, 0]}>
    <OpeningFrame width={width} height={height} frameColor="#765d45" />
    <group position={[-width / 2, 0, 0]} rotation={[0, openAngle, 0]}>
      <BoxMesh size={[width * .96, height * .96, .045]} position={[width * .48, height * .48, 0]} color="#c9a878" />
      <mesh position={[width * .82, height * .48, -.045]}><sphereGeometry args={[.035, 12, 10]} /><meshStandardMaterial color="#4c4438" metalness={.6} roughness={.3} /></mesh>
    </group>
  </group>
}

function BoxMesh({ size, position, color, roughness = .72 }: { size: [number, number, number]; position: [number, number, number]; color: string; roughness?: number }) {
  return <mesh castShadow receiveShadow position={position}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={roughness} /></mesh>
}

function Furniture3D({ item, center, selected, onSelect }: { item: FurnitureItem; center: Center; selected: boolean; onSelect: () => void }) {
  const w = meter(item.widthMm)
  const d = meter(item.depthMm)
  const h = Math.max(.02, meter(item.heightMm))
  const color = item.color
  const dark = '#34443f'
  const legs = (topY: number, legHeight: number) => <>
    {[[-w * .42, -d * .4], [w * .42, -d * .4], [-w * .42, d * .4], [w * .42, d * .4]].map(([x, z], index) =>
      <BoxMesh key={index} size={[Math.min(.07, w * .09), legHeight, Math.min(.07, d * .09)]} position={[x, topY - legHeight / 2, z]} color={dark} />)}
  </>

  let model: ReactNode
  if (item.type === 'bed') model = <>
    <BoxMesh size={[w, Math.min(.22, h * .32), d]} position={[0, Math.min(.22, h * .32) / 2, 0]} color={dark} />
    <BoxMesh size={[w * .96, Math.min(.3, h * .4), d * .92]} position={[0, Math.min(.22, h * .32) + Math.min(.3, h * .4) / 2, .03]} color={color} />
    <BoxMesh size={[w, Math.max(.18, h * .45), Math.min(.12, d * .08)]} position={[0, Math.max(.18, h * .45) / 2, -d * .46]} color={color} />
  </>
  else if (item.type === 'mattress') model = <BoxMesh size={[w, h, d]} position={[0, h / 2, 0]} color={color} />
  else if (item.type === 'sofa' && item.shape === 'l-shape') model = <>
    <BoxMesh size={[w, h * .42, d * .42]} position={[0, h * .28, -d * .27]} color={color} />
    <BoxMesh size={[w * .36, h * .42, d]} position={[-w * .32, h * .28, 0]} color={color} />
    <BoxMesh size={[w, h * .55, d * .12]} position={[0, h * .61, -d * .47]} color={color} />
    <BoxMesh size={[w * .1, h * .55, d]} position={[-w * .46, h * .4, 0]} color={color} />
  </>
  else if (item.type === 'sofa') model = <>
    <BoxMesh size={[w, h * .42, d * .78]} position={[0, h * .28, d * .06]} color={color} />
    <BoxMesh size={[w, h * .58, d * .18]} position={[0, h * .62, -d * .38]} color={color} />
    <BoxMesh size={[w * .08, h * .55, d * .75]} position={[-w * .46, h * .38, d * .05]} color={color} />
    <BoxMesh size={[w * .08, h * .55, d * .75]} position={[w * .46, h * .38, d * .05]} color={color} />
  </>
  else if (['table', 'desk', 'vanity'].includes(item.type) && (item.shape === 'round' || item.shape === 'oval')) {
    const top = Math.min(.09, h * .12)
    model = <>
      <mesh castShadow receiveShadow position={[0, h - top / 2, 0]} scale={[item.shape === 'oval' ? w / d : 1, 1, 1]}><cylinderGeometry args={[d / 2, d / 2, top, 32]} /><meshStandardMaterial color={color} roughness={.72} /></mesh>
      <mesh castShadow position={[0, (h - top) / 2, 0]}><cylinderGeometry args={[Math.min(w, d) * .09, Math.min(w, d) * .16, h - top, 20]} /><meshStandardMaterial color={dark} roughness={.7} /></mesh>
    </>
  }
  else if (['table', 'desk', 'vanity'].includes(item.type)) {
    const top = Math.min(.09, h * .12)
    model = <><BoxMesh size={[w, top, d]} position={[0, h - top / 2, 0]} color={color} />{legs(h - top, h - top)}</>
  }
  else if (item.type === 'chair') model = <>
    <BoxMesh size={[w * .9, Math.min(.09, h * .12), d * .78]} position={[0, h * .48, d * .06]} color={color} />
    <BoxMesh size={[w * .88, h * .48, Math.min(.09, d * .13)]} position={[0, h * .74, -d * .38]} color={color} />
    {legs(h * .48, h * .48)}
  </>
  else if (item.type === 'plant') model = <>
    <mesh castShadow position={[0, h * .18, 0]}><cylinderGeometry args={[Math.min(w, d) * .28, Math.min(w, d) * .2, h * .36, 20]} /><meshStandardMaterial color="#9a7457" roughness={.9} /></mesh>
    <mesh castShadow position={[0, h * .62, 0]}><sphereGeometry args={[Math.min(w, d) * .46, 18, 14]} /><meshStandardMaterial color={color} roughness={.9} /></mesh>
  </>
  else if (item.type === 'lighting') model = <>
    <mesh castShadow position={[0, h * .35, 0]}><cylinderGeometry args={[.025, .035, h * .7, 12]} /><meshStandardMaterial color={dark} metalness={.35} /></mesh>
    <mesh castShadow position={[0, h * .78, 0]}><coneGeometry args={[Math.min(w, d) * .42, h * .28, 20, 1, true]} /><meshStandardMaterial color={color} side={2} /></mesh>
  </>
  else if (item.shape === 'rug-round') model = <mesh receiveShadow position={[0, h / 2, 0]} scale={[w / d, 1, 1]}><cylinderGeometry args={[d / 2, d / 2, h, 40]} /><meshStandardMaterial color={color} roughness={.98} /></mesh>
  else if (item.type === 'decor' && h < .08) model = <BoxMesh size={[w, h, d]} position={[0, h / 2, 0]} color={color} roughness={.95} />
  else if (item.type === 'mirror') model = <>
    <BoxMesh size={[w, h, Math.max(.025, d)]} position={[0, h / 2, 0]} color={dark} />
    <BoxMesh size={[w * .9, h * .92, Math.max(.01, d * 1.05)]} position={[0, h * .52, 0]} color="#b9d1d2" roughness={.18} />
  </>
  else if (item.type === 'kitchen') {
    const top = Math.min(.07, h * .1)
    model = <>
      {item.shape !== 'cooktop' && <BoxMesh size={[w, Math.max(.1, h - top), d * .94]} position={[0, (h - top) / 2, .01]} color={color} />}
      <BoxMesh size={[w, top, d]} position={[0, h - top / 2, 0]} color="#6d6d69" roughness={.38} />
      {(item.shape === 'sink' || item.shape === 'kitchen-combo') && <>
        <mesh position={[-w * .23, h + .008, 0]}><boxGeometry args={[w * .34, .025, d * .58]} /><meshStandardMaterial color="#aeb7b6" metalness={.65} roughness={.25} /></mesh>
        <mesh position={[-w * .23, h + .16, -d * .13]}><torusGeometry args={[.12, .018, 8, 18, Math.PI]} /><meshStandardMaterial color="#858f8e" metalness={.7} /></mesh>
      </>}
      {(item.shape === 'range' || item.shape === 'cooktop' || item.shape === 'kitchen-combo') && <group position={[item.shape === 'kitchen-combo' ? w * .27 : 0, h + .02, 0]}>
        <BoxMesh size={[Math.min(.56, w * .42), .035, d * .72]} position={[0, 0, 0]} color="#252726" roughness={.25} />
        {[[-.14,-.12],[.14,-.12],[-.14,.12],[.14,.12]].map(([x,z], index) => <mesh key={index} position={[x,.025,z]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[.065,.012,8,18]} /><meshStandardMaterial color="#69706e" metalness={.7} /></mesh>)}
      </group>}
    </>
  }
  else if (item.type === 'computer' && (item.shape === 'monitor' || item.shape === 'dual-monitor')) {
    const count = item.shape === 'dual-monitor' ? 2 : 1
    model = <>{Array.from({ length: count }, (_, index) => {
      const eachWidth = count === 2 ? w * .48 : w
      const x = count === 2 ? (index === 0 ? -w * .25 : w * .25) : 0
      return <group key={index} position={[x, 0, 0]}><BoxMesh size={[eachWidth, h * .7, Math.max(.035, d * .12)]} position={[0, h * .62, 0]} color="#222321" roughness={.25} /><BoxMesh size={[.045, h * .3, .045]} position={[0, h * .2, 0]} color="#4B4C49" /><BoxMesh size={[eachWidth * .35, .035, d * .65]} position={[0, .018, 0]} color="#4B4C49" /></group>
    })}</>
  }
  else if (item.type === 'computer' && item.shape === 'desktop') model = <>
    <BoxMesh size={[w, h, d]} position={[0, h / 2, 0]} color={color} roughness={.3} />
    <mesh position={[0, h * .65, d * .505]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[w * .28, w * .28, .018, 24]} /><meshStandardMaterial color="#56615d" metalness={.5} /></mesh>
  </>
  else if (item.shape === 'open-shelf') model = <>
    <BoxMesh size={[w, .06, d]} position={[0, .03, 0]} color={color} />
    <BoxMesh size={[.06, h, d]} position={[-w / 2 + .03, h / 2, 0]} color={color} />
    <BoxMesh size={[.06, h, d]} position={[w / 2 - .03, h / 2, 0]} color={color} />
    {[.25,.5,.75,1].map((ratio) => ratio * h < h - .03 && <BoxMesh key={ratio} size={[w, .05, d]} position={[0, ratio * h, 0]} color={color} />)}
  </>
  else if (item.shape === 'drawer') model = <>
    <BoxMesh size={[w, h, d]} position={[0, h / 2, 0]} color={color} />
    {[.22,.45,.68].map((ratio) => <BoxMesh key={ratio} size={[w * .9, .025, .025]} position={[0, h * ratio, d / 2 + .014]} color="#6e746f" />)}
  </>
  else model = <BoxMesh size={[w, h, d]} position={[0, h / 2, 0]} color={color} roughness={item.type === 'appliance' ? .32 : .72} />

  return <group
    position={[meter(item.position.x) - center.x, meter(item.elevationMm ?? 0), meter(item.position.y) - center.z]}
    rotation={[0, -item.rotationDeg * Math.PI / 180, 0]}
    onClick={(event) => { event.stopPropagation(); onSelect() }}
  >
    {model}
    {selected && <mesh position={[0, h / 2, 0]}><boxGeometry args={[w + .08, h + .08, d + .08]} /><meshBasicMaterial color="#e85d3f" wireframe transparent opacity={.9} /></mesh>}
  </group>
}

export function Preview3D({ exportMode = false }: { exportMode?: boolean }) {
  const project = useProjectStore((state) => state.project)
  const setActiveStep = useProjectStore((state) => state.setActiveStep)
  const updateFurniture = useProjectStore((state) => state.updateFurniture)
  const deleteFurniture = useProjectStore((state) => state.deleteFurniture)
  const setCamera3D = useProjectStore((state) => state.setCamera3D)
  const [resetKey, setResetKey] = useState(0)
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string>()
  const [showFurnitureProperties, setShowFurnitureProperties] = useState(false)
  const [axisDragging, setAxisDragging] = useState(false)
  const [cameraMode, setCameraMode] = useState<'orbit' | 'pan'>(() =>
    window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 620 ? 'pan' : 'orbit')
  const captureRef = useRef<(() => Promise<void>) | null>(null)
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const resolvedOpenings = useMemo(() => resolveOpenings(project.openings, project.walls), [project.openings, project.walls])
  const selectedFurniture = project.furniture.find((item) => item.id === selectedFurnitureId)
  useEffect(() => setShowFurnitureProperties(false), [selectedFurnitureId])
  const startPlanarDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selectedFurniture) return
    event.preventDefault()
    event.stopPropagation()
    setAxisDragging(true)
    const furnitureId = selectedFurniture.id
    const original = selectedFurniture.position
    const startPointer = { x: event.clientX, y: event.clientY }
    const controls = controlsRef.current
    controls?.object.updateMatrixWorld()
    const matrix = controls?.object.matrixWorld.elements
    const rightLength = Math.hypot(matrix?.[0] ?? 1, matrix?.[2] ?? 0) || 1
    const upLength = Math.hypot(matrix?.[4] ?? 0, matrix?.[6] ?? 1) || 1
    const right = { x: (matrix?.[0] ?? 1) / rightLength, y: (matrix?.[2] ?? 0) / rightLength }
    const down = { x: -(matrix?.[4] ?? 0) / upLength, y: -(matrix?.[6] ?? 1) / upLength }
    const cameraDistance = controls ? controls.object.position.distanceTo(controls.target) : 6
    const millimetersPerPixel = Math.max(2, cameraDistance * 1.7)
    const move = (pointerEvent: PointerEvent) => {
      const dx = pointerEvent.clientX - startPointer.x
      const dy = pointerEvent.clientY - startPointer.y
      updateFurniture(furnitureId, { position: {
        x: Math.round(original.x + (right.x * dx + down.x * dy) * millimetersPerPixel),
        y: Math.round(original.y + (right.y * dx + down.y * dy) * millimetersPerPixel),
      } })
    }
    const end = () => {
      setAxisDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const startVerticalDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selectedFurniture) return
    event.preventDefault()
    event.stopPropagation()
    setAxisDragging(true)
    const startElevation = selectedFurniture.elevationMm ?? 0
    const furnitureId = selectedFurniture.id
    let lastY: number | undefined
    let accumulatedY = 0
    const move = (pointerEvent: PointerEvent) => {
      if (lastY === undefined) {
        lastY = pointerEvent.clientY
        return
      }
      accumulatedY += Math.max(-50, Math.min(50, pointerEvent.clientY - lastY))
      lastY = pointerEvent.clientY
      updateFurniture(furnitureId, { elevationMm: Math.max(0, Math.round(startElevation - accumulatedY * 10)) })
    }
    const end = () => {
      setAxisDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const bounds = useMemo(() => {
    const points = project.walls.flatMap((wall) => [wall.start, wall.end])
    if (!points.length) project.furniture.forEach((item) => points.push(item.position))
    const minX = points.length ? Math.min(...points.map((point) => meter(point.x))) : -2
    const maxX = points.length ? Math.max(...points.map((point) => meter(point.x))) : 2
    const minZ = points.length ? Math.min(...points.map((point) => meter(point.y))) : -2
    const maxZ = points.length ? Math.max(...points.map((point) => meter(point.y))) : 2
    return { minX, maxX, minZ, maxZ, center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 } }
  }, [project.furniture, project.walls])
  const width = Math.max(2, bounds.maxX - bounds.minX + 1)
  const depth = Math.max(2, bounds.maxZ - bounds.minZ + 1)
  const span = Math.max(width, depth, 4)
  const defaultCamera: [number, number, number] = [span * .72, span * .78, span * .72]
  const cameraPosition = project.viewState.camera3d?.position ?? defaultCamera
  const cameraTarget = project.viewState.camera3d?.target ?? [0, .7, 0]
  const saveCamera = () => {
    const controls = controlsRef.current
    if (!controls) return
    const position = controls.object.position.toArray() as [number, number, number]
    const target = controls.target.toArray() as [number, number, number]
    setCamera3D({ position, target })
  }
  const resetCamera = () => {
    setCamera3D({ position: defaultCamera, target: [0, .7, 0] })
    setResetKey((key) => key + 1)
  }

  return <div className="preview3d-wrap">
    <Canvas key={resetKey} shadows dpr={[1, 1.5]} gl={{ preserveDrawingBuffer: true }} camera={{ position: cameraPosition, fov: 44, near: .1, far: 200 }} onPointerMissed={() => setSelectedFurnitureId(undefined)}>
      <color attach="background" args={['#e9e7df']} />
      <ambientLight intensity={1.35} />
      <directionalLight castShadow intensity={2.1} position={[5, 10, 6]} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <group>
        <BoxMesh size={[width, .06, depth]} position={[0, -.03, 0]} color="#d5c4a8" roughness={.88} />
        {project.walls.map((wall) => <Wall3D key={wall.id} wall={wall} openings={resolvedOpenings} center={bounds.center} />)}
        {resolvedOpenings.map((opening) => <Opening3D key={opening.id} opening={opening} walls={project.walls} center={bounds.center} />)}
        {project.furniture.map((item) => <Furniture3D key={item.id} item={item} center={bounds.center} selected={item.id === selectedFurnitureId} onSelect={() => setSelectedFurnitureId(item.id)} />)}
      </group>
      {selectedFurniture && <Html center position={[
        meter(selectedFurniture.position.x) - bounds.center.x,
        meter((selectedFurniture.elevationMm ?? 0) + selectedFurniture.heightMm) + .32,
        meter(selectedFurniture.position.y) - bounds.center.z,
      ]} zIndexRange={[20, 0]}>
        <div className="preview3d-direct-controls" aria-label="선택 가구 직접 조작" onPointerDown={(event) => event.stopPropagation()}>
          <button className="axis-control" onPointerDown={startPlanarDrag} title="누른 채 도면의 상하좌우로 이동"><Move size={23} /><span>평면 이동</span></button>
          <button className="axis-control" onPointerDown={startVerticalDrag} title="누른 채 3D 높이 조절"><MoveVertical size={23} /><span>높이 이동</span></button>
          <button onClick={() => updateFurniture(selectedFurniture.id, { rotationDeg: (selectedFurniture.rotationDeg + 90) % 360 })} title="90도 회전"><RotateCw size={22} /><span>90° 회전</span></button>
          <button className="remove-control" onClick={() => { deleteFurniture(selectedFurniture.id); setSelectedFurnitureId(undefined) }} title="가구 제거"><Trash2 size={21} /><span>제거</span></button>
          <button className={`properties-control ${showFurnitureProperties ? 'active' : ''}`} aria-expanded={showFurnitureProperties} onClick={() => setShowFurnitureProperties((open) => !open)} title="세부 속성"><SlidersHorizontal size={21} /><span>속성</span></button>
        </div>
      </Html>}
      <Grid args={[Math.ceil(width + 4), Math.ceil(depth + 4)]} position={[0, -.061, 0]} cellSize={.5} cellThickness={.6} cellColor="#a8aaa3" sectionSize={2} sectionThickness={1} sectionColor="#858b84" fadeDistance={30} infiniteGrid />
      <ContactShadows position={[0, .002, 0]} opacity={.3} scale={span * 1.4} blur={2.4} far={8} />
      <OrbitControls
        ref={controlsRef}
        enabled={!axisDragging}
        makeDefault
        target={cameraTarget}
        enablePan
        screenSpacePanning
        mouseButtons={{ LEFT: cameraMode === 'pan' ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
        touches={{ ONE: cameraMode === 'pan' ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        minDistance={2}
        maxDistance={span * 3.2}
        maxPolarAngle={Math.PI / 2.02}
        zoomSpeed={.28}
        rotateSpeed={.62}
        panSpeed={.62}
        onEnd={saveCamera}
      />
      <CaptureBridge captureRef={captureRef} />
    </Canvas>
    <div className="preview3d-actions">
      <button onClick={() => setActiveStep('furniture')}><Box size={16} /> 2D 배치로 돌아가기</button>
      <button className={cameraMode === 'pan' ? 'active' : ''} onClick={() => setCameraMode((mode) => mode === 'pan' ? 'orbit' : 'pan')}><Hand size={16} /> {cameraMode === 'pan' ? '회전 모드' : '시점 이동'}</button>
      <button onClick={resetCamera}><RotateCcw size={16} /> 시점 초기화</button>
      <button onClick={() => void captureRef.current?.()}><Share2 size={16} /> 현재 3D 저장</button>
    </div>
    {!!project.furniture.length && <div className="preview3d-object-list"><span>가구 선택</span>{project.furniture.map((item) => <button key={item.id} className={item.id === selectedFurnitureId ? 'active' : ''} onClick={() => setSelectedFurnitureId(item.id)}>{item.name}</button>)}</div>}
    {!exportMode && <div className="preview3d-legend"><b>3D 미리보기</b><span>{cameraMode === 'pan' ? '한 손가락 이동 · 두 손가락 확대' : '한 손가락 회전 · 두 손가락 확대/이동'}</span><small>프리셋은 치수 기반 간소화 모델입니다.</small></div>}
    {selectedFurniture && showFurnitureProperties && <aside className="preview3d-inspector">
      <div className="preview3d-inspector-head"><div><b>{selectedFurniture.name}</b><span>3D에서 위치와 색상 수정</span></div><button onClick={() => setSelectedFurnitureId(undefined)}>×</button></div>
      <div className="preview3d-position-fields">
        <label><span>가로 위치 X</span><div><input type="number" step="10" value={Math.round(selectedFurniture.position.x)} onChange={(event) => updateFurniture(selectedFurniture.id, { position: { ...selectedFurniture.position, x: Number(event.target.value) || 0 } })} /><i>mm</i></div></label>
        <label><span>세로 위치 Y</span><div><input type="number" step="10" value={Math.round(selectedFurniture.position.y)} onChange={(event) => updateFurniture(selectedFurniture.id, { position: { ...selectedFurniture.position, y: Number(event.target.value) || 0 } })} /><i>mm</i></div></label>
        <label><span>3D 높이</span><div><input type="number" min="0" step="10" value={Math.round(selectedFurniture.elevationMm ?? 0)} onChange={(event) => updateFurniture(selectedFurniture.id, { elevationMm: Math.max(0, Number(event.target.value) || 0) })} /><i>mm</i></div></label>
      </div>
      <div className="preview3d-nudge" aria-label="가구 미세 이동">
        <button onClick={() => updateFurniture(selectedFurniture.id, { position: { ...selectedFurniture.position, y: selectedFurniture.position.y - 50 } })}>↑</button>
        <button onClick={() => updateFurniture(selectedFurniture.id, { position: { ...selectedFurniture.position, x: selectedFurniture.position.x - 50 } })}>←</button>
        <button onClick={() => updateFurniture(selectedFurniture.id, { position: { ...selectedFurniture.position, y: selectedFurniture.position.y + 50 } })}>↓</button>
        <button onClick={() => updateFurniture(selectedFurniture.id, { position: { ...selectedFurniture.position, x: selectedFurniture.position.x + 50 } })}>→</button>
        <span>50mm 이동</span>
      </div>
      <div className="preview3d-colors">
        {furnitureColors.map((color) => <button key={color.value} className={selectedFurniture.color.toUpperCase() === color.value ? 'active' : ''} title={color.name} aria-label={color.name} onClick={() => updateFurniture(selectedFurniture.id, { color: color.value })}><i style={{ background: color.value }} /></button>)}
        <label title="세부 RGB"><input type="color" value={selectedFurniture.color} onChange={(event) => updateFurniture(selectedFurniture.id, { color: event.target.value })} /><span>RGB</span></label>
      </div>
      <div className="preview3d-inspector-actions">
        <button onClick={() => updateFurniture(selectedFurniture.id, { rotationDeg: (selectedFurniture.rotationDeg + 90) % 360 })}><RotateCw size={15} /> 90° 회전</button>
        <button className="remove" onClick={() => { deleteFurniture(selectedFurniture.id); setSelectedFurnitureId(undefined) }}><Trash2 size={15} /> 가구 제거</button>
      </div>
    </aside>}
    {exportMode && <aside className="export-panel">
      <b>이미지로 저장</b><span>모바일에서는 공유 창에서 ‘이미지 저장’을 선택할 수 있어요.</span>
      <button onClick={() => void exportProject2D(project)}><Share2 size={18} /> 2D 도면 공유·저장</button>
      <button className="primary" onClick={() => void captureRef.current?.()}><Share2 size={18} /> 현재 3D 공유·저장</button>
    </aside>}
  </div>
}
