export type ID = string

export interface PointMm { x: number; y: number }
export interface PointPx { x: number; y: number }

export interface FloorPlanImage {
  id: ID
  name: string
  dataUrl: string
  widthPx: number
  heightPx: number
}

export interface ScaleCalibration {
  imagePointA: PointPx
  imagePointB: PointPx
  realLengthMm: number
  pixelDistance: number
  mmPerPixel: number
  calibratedAt: string
}

export interface Wall {
  id: ID
  start: PointMm
  end: PointMm
  thicknessMm: number
  heightMm: number
}

export type OpeningType = 'door' | 'window'
export interface Opening {
  id: ID
  type: OpeningType
  wallId?: ID
  offsetMm: number
  widthMm: number
  heightMm?: number
  sillHeightMm?: number
  detected?: boolean
  confidence?: number
  detectedClass?: string
  doorKind?: 'swing' | 'sliding' | 'balcony'
  start?: PointMm
  end?: PointMm
}

export type FurnitureType = 'bed' | 'mattress' | 'sofa' | 'table' | 'chair' | 'desk' | 'wardrobe' | 'shelf'
  | 'mirror' | 'vanity' | 'partition' | 'kids' | 'kitchen' | 'computer' | 'appliance' | 'plant' | 'lighting' | 'decor' | 'custom'
export type FurnitureShape = 'default' | 'round' | 'oval' | 'l-shape' | 'modular' | 'open-shelf' | 'drawer'
  | 'sink' | 'kitchen-combo' | 'counter' | 'cooktop' | 'range' | 'desktop' | 'monitor' | 'dual-monitor' | 'rug-round'
export interface FurnitureItem {
  id: ID
  type: FurnitureType
  name: string
  widthMm: number
  depthMm: number
  heightMm: number
  position: PointMm
  rotationDeg: number
  elevationMm?: number
  color: string
  locked?: boolean
  imageDataUrl?: string
  productUrl?: string
  source?: 'preset' | 'user'
  shape?: FurnitureShape
}

export type AppStep = 'upload' | 'scale' | 'walls' | 'furniture' | 'preview3d' | 'export'
export interface ProjectViewState {
  activeStep: AppStep
  selectedObjectId?: ID
  zoom: number
  panX: number
  panY: number
  showGrid: boolean
  showImage: boolean
  camera3d?: { position: [number, number, number]; target: [number, number, number] }
}

export interface Project {
  id: ID
  name: string
  floorPlanImage?: FloorPlanImage
  calibration?: ScaleCalibration
  walls: Wall[]
  openings: Opening[]
  furniture: FurnitureItem[]
  viewState: ProjectViewState
  createdAt: string
  updatedAt: string
}
