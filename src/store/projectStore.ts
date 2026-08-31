import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { projectRepository } from '../db/projectRepository'
import type { AppStep, FloorPlanImage, FurnitureItem, Opening, OpeningType, PointMm, Project, ScaleCalibration, Wall } from '../types/project'

const now = () => new Date().toISOString()

const createProject = (): Project => ({
  id: nanoid(),
  name: '우리 집 배치',
  walls: [],
  openings: [],
  furniture: [],
  viewState: { activeStep: 'upload', zoom: 1, panX: 0, panY: 0, showGrid: false, showImage: true },
  createdAt: now(),
  updatedAt: now(),
})

type ProjectStore = {
  project: Project
  hydrated: boolean
  canUndoWallAction: boolean
  hydrate: () => Promise<void>
  resetProject: () => void
  setProjectName: (name: string) => void
  setFloorPlanImage: (image: FloorPlanImage) => void
  setCalibration: (calibration: ScaleCalibration) => void
  setActiveStep: (step: AppStep) => void
  addWall: (start: PointMm, end: PointMm) => void
  updateWall: (id: string, patch: Partial<Wall>) => void
  deleteWall: (id: string) => void
  undoLastUserAction: () => void
  addOpening: (wallId: string, type: OpeningType) => void
  addStandaloneOpening: (start: PointMm, end: PointMm, kind: 'door' | 'window' | 'sliding' | 'balcony') => void
  deleteOpening: (id: string) => void
  setDetectedLayout: (walls: Wall[], openings: Opening[]) => void
  clearWalls: () => void
  addFurniture: (item: Omit<FurnitureItem, 'id' | 'position' | 'rotationDeg'>) => void
  updateFurniture: (id: string, patch: Partial<FurnitureItem>) => void
  deleteFurniture: (id: string) => void
  duplicateFurniture: (id: string) => void
  setCamera3D: (camera3d: NonNullable<Project['viewState']['camera3d']>) => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let wallActionHistory: Array<Pick<Project, 'walls' | 'openings'>> = []
const persist = (project: Project) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void projectRepository.save(project), 250)
}

export const useProjectStore = create<ProjectStore>((set, get) => {
  const mutate = (fn: (project: Project) => Project) => {
    const project = fn(get().project)
    const next = { ...project, updatedAt: now() }
    set({ project: next })
    persist(next)
  }

  const clearWallActionHistory = () => {
    wallActionHistory = []
    set({ canUndoWallAction: false })
  }

  const mutateUserWallAction = (fn: (project: Project) => Project) => {
    const current = get().project
    const project = fn(current)
    if (project === current) return
    wallActionHistory.push({ walls: current.walls, openings: current.openings })
    if (wallActionHistory.length > 50) wallActionHistory.shift()
    const next = { ...project, updatedAt: now() }
    set({ project: next, canUndoWallAction: true })
    persist(next)
  }

  return {
    project: createProject(),
    hydrated: false,
    canUndoWallAction: false,
    hydrate: async () => {
      const saved = await projectRepository.getLatest()
      const normalized = saved ? {
        ...saved,
        openings: saved.openings.map((opening) => opening.detected && opening.doorKind === 'sliding' && !opening.detectedClass
          ? { ...opening, type: 'window' as const, doorKind: undefined }
          : opening),
      } : get().project
      wallActionHistory = []
      set({ project: normalized, hydrated: true, canUndoWallAction: false })
    },
    resetProject: () => {
      const project = createProject()
      wallActionHistory = []
      set({ project, canUndoWallAction: false })
      persist(project)
    },
    setProjectName: (name) => mutate((p) => ({ ...p, name })),
    setFloorPlanImage: (floorPlanImage) => {
      clearWallActionHistory()
      mutate((p) => ({
        ...p,
        floorPlanImage,
        calibration: undefined,
        walls: [],
        openings: [],
        viewState: { ...p.viewState, activeStep: 'scale' },
      }))
    },
    setCalibration: (calibration) => {
      clearWallActionHistory()
      mutate((p) => ({
        ...p,
        calibration,
        viewState: { ...p.viewState, activeStep: 'walls' },
      }))
    },
    setActiveStep: (activeStep) => mutate((p) => ({ ...p, viewState: { ...p.viewState, activeStep } })),
    addWall: (start, end) => mutateUserWallAction((p) => ({
      ...p,
      walls: [...p.walls, { id: nanoid(), start, end, thicknessMm: 150, heightMm: 2400 } satisfies Wall],
    })),
    updateWall: (id, patch) => mutateUserWallAction((p) => ({ ...p, walls: p.walls.map((wall) => wall.id === id ? { ...wall, ...patch } : wall) })),
    deleteWall: (id) => mutateUserWallAction((p) => ({
      ...p,
      walls: p.walls.filter((wall) => wall.id !== id),
      openings: p.openings.filter((opening) => opening.wallId !== id),
    })),
    undoLastUserAction: () => {
      const previous = wallActionHistory.pop()
      if (!previous) return
      const next = { ...get().project, ...previous, updatedAt: now() }
      set({ project: next, canUndoWallAction: wallActionHistory.length > 0 })
      persist(next)
    },
    addOpening: (wallId, type) => mutateUserWallAction((p) => {
      const wall = p.walls.find((item) => item.id === wallId)
      if (!wall) return p
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
      const widthMm = Math.min(type === 'door' ? 900 : 1200, Math.max(300, length * 0.6))
      return {
        ...p,
        openings: [...p.openings, {
          id: nanoid(), type, wallId, widthMm, detected: false,
          offsetMm: Math.max(0, (length - widthMm) / 2),
          heightMm: type === 'door' ? 2100 : 1200,
          sillHeightMm: type === 'window' ? 900 : 0,
        }],
      }
    }),
    addStandaloneOpening: (start, end, kind) => mutateUserWallAction((p) => {
      const widthMm = Math.hypot(end.x - start.x, end.y - start.y)
      if (widthMm < 100) return p
      const type: OpeningType = kind === 'window' ? 'window' : 'door'
      const doorKind = kind === 'window' ? undefined : kind === 'door' ? 'swing' : kind
      return {
        ...p,
        openings: [...p.openings, {
          id: nanoid(), type, doorKind, detected: false,
          start, end, offsetMm: 0, widthMm,
          heightMm: type === 'window' ? 1200 : 2100,
          sillHeightMm: type === 'window' ? 900 : 0,
        }],
      }
    }),
    deleteOpening: (id) => mutateUserWallAction((p) => ({ ...p, openings: p.openings.filter((opening) => opening.id !== id) })),
    setDetectedLayout: (walls, openings) => {
      clearWallActionHistory()
      mutate((p) => ({ ...p, walls, openings }))
    },
    clearWalls: () => mutateUserWallAction((p) => ({ ...p, walls: [], openings: [] })),
    addFurniture: (item) => mutate((p) => {
      const points = p.walls.flatMap((wall) => [wall.start, wall.end])
      const center = points.length ? {
        x: (Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.x))) / 2,
        y: (Math.min(...points.map((point) => point.y)) + Math.max(...points.map((point) => point.y))) / 2,
      } : p.floorPlanImage && p.calibration ? {
        x: p.floorPlanImage.widthPx * p.calibration.mmPerPixel / 2,
        y: p.floorPlanImage.heightPx * p.calibration.mmPerPixel / 2,
      } : { x: 1500, y: 1500 }
      return { ...p, furniture: [...p.furniture, { ...item, id: nanoid(), position: center, rotationDeg: 0, elevationMm: 0 }] }
    }),
    updateFurniture: (id, patch) => mutate((p) => ({
      ...p,
      furniture: p.furniture.map((item) => item.id === id ? { ...item, ...patch } : item),
    })),
    deleteFurniture: (id) => mutate((p) => ({ ...p, furniture: p.furniture.filter((item) => item.id !== id) })),
    duplicateFurniture: (id) => mutate((p) => {
      const item = p.furniture.find((candidate) => candidate.id === id)
      if (!item) return p
      return { ...p, furniture: [...p.furniture, { ...item, id: nanoid(), position: { x: item.position.x + 180, y: item.position.y + 180 } }] }
    }),
    setCamera3D: (camera3d) => mutate((p) => ({ ...p, viewState: { ...p.viewState, camera3d } })),
  }
})
