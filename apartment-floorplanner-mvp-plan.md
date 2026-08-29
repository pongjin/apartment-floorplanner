# Apartment Floorplanner MVP Development Plan

## 1. Product Definition

This MVP is a mobile-first web app for checking whether real furniture fits inside a Korean apartment floor plan.

The app lets a user upload a floor plan image, manually calibrate its real-world scale, trace walls on top of the image, place furniture using real dimensions, preview the result in 2D and 3D, and save the final view as an image.

One-line definition:

> A mobile-first web app that imports a Korean apartment floor plan image, calibrates real-world dimensions manually, traces walls, places real-size furniture in 2D, previews the layout in 3D, and saves the result as an image.

The MVP intentionally excludes AI, OCR, automatic wall detection, backend services, accounts, collaboration, and cloud sync.

All project data is stored locally in the user's browser using IndexedDB.

## 2. Core Principles

- Mobile-first experience.
- No AI or OCR in MVP.
- No backend in MVP.
- The floor plan image is used only as a background reference layer.
- The user manually defines scale using a known real-world length.
- All editable geometry uses millimeters as the source of truth.
- 2D and 3D views are generated from the same project data.
- The first version should prioritize reliability over automation.
- The app should feel like a practical tool, not a design showcase.

## 3. User Flow

```text
Home
  -> New Project
  -> Upload Floor Plan Image
  -> Manual Scale Calibration
  -> Wall Tracing
  -> Optional Door / Window Placement
  -> Confirm 2D Plan
  -> Add Furniture
  -> Enter Real Furniture Dimensions
  -> Place Furniture in 2D
  -> Preview in 3D
  -> Adjust Placement
  -> Save 2D / 3D Image
```

The MVP can be implemented as a single-page app with step-based navigation.

Recommended primary steps:

1. Upload
2. Scale
3. Walls
4. Furniture
5. 3D Preview
6. Export

## 4. Target User

The target user is someone moving into, renovating, or furnishing a Korean apartment who wants to quickly answer questions such as:

- Will my sofa fit in this living room?
- Can this bed fit in the smaller room?
- How much walking space remains after placing a dining table?
- What does the layout roughly look like in 3D?

The app should not require CAD knowledge.

## 5. MVP Functional Requirements

### 5.1 Project Creation

Users can create a new local project.

A project contains:

- Project name
- Uploaded floor plan image
- Scale calibration data
- Walls
- Optional doors and windows
- Furniture items
- View preferences
- Created and updated timestamps

Projects are saved to IndexedDB and can be reopened later from the same browser.

### 5.2 Floor Plan Image Upload

Users can upload a JPG or PNG floor plan image.

The image is displayed as a locked background layer inside a 2D canvas editor.

The app should support:

- Image upload from mobile photo library or file picker
- Fit-to-screen preview
- Pinch zoom
- Pan
- Reset view

The app does not extract text, dimensions, walls, rooms, or symbols from the image.

### 5.3 Manual Scale Calibration

After image upload, the user calibrates scale manually.

Flow:

1. The app asks the user to select a known-length segment on the floor plan.
2. The user taps the start point.
3. The user taps the end point.
4. The user enters the real length in millimeters.
5. The app calculates `mmPerPixel`.

Formula:

```ts
pixelDistance = distance(pointA, pointB)
mmPerPixel = realLengthMm / pixelDistance
```

Example:

```text
Known wall length: 3900 mm
Measured image distance: 260 px

mmPerPixel = 3900 / 260 = 15
```

After calibration, every image-space point can be converted into real-world millimeter coordinates.

The MVP assumes that the uploaded floor plan is a clean digital image or a straight-on scan/photo. Strong perspective distortion is excluded.

### 5.4 Wall Tracing

Users manually trace walls over the uploaded image.

Basic interaction:

- Tap to create wall start point.
- Tap another point to create wall end point.
- Continue tapping to create connected wall segments.
- Select a wall to edit or delete it.

Wall behavior:

- Wall length is displayed in millimeters.
- Wall thickness has a default value.
- Wall height has a default value for 3D rendering.
- Users can adjust a wall's real length if manual correction is needed.

Recommended defaults:

```ts
defaultWallThicknessMm = 150
defaultWallHeightMm = 2400
```

For MVP, wall drawing can be simple line-segment based editing. Full polygon room detection is not required.

### 5.5 Door and Window Placement

Doors and windows are optional for the first MVP, but the data model should allow them.

If implemented in MVP:

- User selects a wall.
- User adds a door or window to that wall.
- User sets width in millimeters.
- Door/window appears in 2D as a symbol.
- In 3D, wall opening can be approximated visually or represented as a marker.

For the first implementation pass, door/window geometry can be simple and does not need boolean wall cutouts.

### 5.6 Furniture Library

Users can add furniture with real dimensions.

MVP furniture types:

- Bed
- Sofa
- Table
- Chair
- Desk
- Wardrobe
- Shelf
- Custom item

Each furniture item has:

- Name
- Type
- Width in millimeters
- Depth in millimeters
- Height in millimeters
- Position
- Rotation
- Color

Users can add a custom furniture item by entering dimensions manually.

Furniture is displayed in 2D as a top-down rectangle with label and rotation handle.

In 3D, furniture is shown as simple boxes with approximate proportions.

### 5.7 2D Furniture Placement

Users place furniture on the calibrated floor plan.

Required interactions:

- Drag furniture
- Rotate furniture
- Select furniture
- Edit dimensions
- Delete furniture
- Duplicate furniture
- Show approximate dimensions

Helpful MVP behaviors:

- Snap rotation to 0, 90, 180, 270 degrees when near those angles.
- Optional grid overlay in millimeters.
- Visual warning when furniture overlaps walls or other furniture.

Collision detection can be approximate in MVP.

### 5.8 3D Preview

The 3D view renders the traced walls and furniture from the same project data.

3D requirements:

- Use Three.js through React Three Fiber.
- Use Drei for camera controls and helpers.
- Render walls as rectangular prisms.
- Render furniture as simple boxes.
- Render a floor plane.
- Allow orbit, pan, and zoom.
- Include a reset camera button.

Coordinate mapping:

- App source data is in millimeters.
- Three.js scene units should use meters for manageable scale.
- Convert with:

```ts
meters = millimeters / 1000
```

The 3D preview is not expected to be photorealistic. It should be useful for spatial understanding.

### 5.9 Image Export

Users can save an image of:

- Current 2D layout
- Current 3D preview

2D export can use the Konva stage export API.

3D export can use the WebGL canvas image export approach.

The MVP should export PNG images.

## 6. Data Model

Use TypeScript types as the app's central contract.

```ts
export type ID = string

export interface PointMm {
  x: number
  y: number
}

export interface PointPx {
  x: number
  y: number
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
  wallId: ID
  offsetMm: number
  widthMm: number
  heightMm?: number
  sillHeightMm?: number
}

export type FurnitureType =
  | 'bed'
  | 'sofa'
  | 'table'
  | 'chair'
  | 'desk'
  | 'wardrobe'
  | 'shelf'
  | 'custom'

export interface FurnitureItem {
  id: ID
  type: FurnitureType
  name: string
  widthMm: number
  depthMm: number
  heightMm: number
  position: PointMm
  rotationDeg: number
  color: string
  locked?: boolean
}

export interface ProjectViewState {
  activeStep: AppStep
  selectedObjectId?: ID
  zoom: number
  panX: number
  panY: number
  showGrid: boolean
  showImage: boolean
}

export type AppStep =
  | 'upload'
  | 'scale'
  | 'walls'
  | 'furniture'
  | 'preview3d'
  | 'export'
```

## 7. Coordinate and Unit Design

### 7.1 Source of Truth

Use millimeters as the source of truth for editable project geometry.

Stored in millimeters:

- Wall start/end coordinates
- Wall thickness
- Wall height
- Furniture dimensions
- Furniture position
- Opening dimensions and offsets

Stored in pixels:

- Original image size
- Calibration tap points
- Canvas display transform

### 7.2 Image Pixel to Millimeter Conversion

The calibration creates a ratio:

```ts
mmPerPixel = realLengthMm / pixelDistance
```

Convert image pixel coordinates to project millimeter coordinates:

```ts
function pxToMm(point: PointPx, calibration: ScaleCalibration): PointMm {
  return {
    x: point.x * calibration.mmPerPixel,
    y: point.y * calibration.mmPerPixel,
  }
}
```

Convert project millimeter coordinates to image pixel coordinates:

```ts
function mmToPx(point: PointMm, calibration: ScaleCalibration): PointPx {
  return {
    x: point.x / calibration.mmPerPixel,
    y: point.y / calibration.mmPerPixel,
  }
}
```

This simple mapping assumes the image is not perspective-distorted.

### 7.3 2D Canvas Display Transform

React Konva should handle:

- Stage scale
- Stage pan
- Touch gestures
- Object selection
- Dragging

The canvas view transform is separate from the project data.

Example:

```ts
screenPoint -> stagePoint -> imagePx -> projectMm
```

### 7.4 3D Coordinate Mapping

2D project coordinates use:

```text
x = horizontal floor plan axis
y = vertical floor plan axis
```

3D scene coordinates should use:

```text
Three.js x = project x in meters
Three.js z = project y in meters
Three.js y = height in meters
```

Conversion:

```ts
const x = pointMm.x / 1000
const z = pointMm.y / 1000
const y = heightMm / 1000
```

## 8. Mobile UX Requirements

The MVP must feel good on a phone.

### 8.1 Layout

Recommended structure:

- Full-screen canvas or 3D viewport.
- Top compact step/status bar.
- Bottom tool drawer for current step actions.
- Floating icon buttons for undo, delete, reset view, and export.
- Selection inspector appears as a bottom sheet.

Avoid desktop-heavy sidebars as the primary mobile interface.

### 8.2 Touch Interactions

Required:

- Single tap to select.
- Tap points to create calibration segment and walls.
- Drag to move furniture.
- Pinch to zoom.
- Two-finger pan or drag empty canvas to pan.
- Large touch targets.

Recommended minimum touch target:

```text
44 x 44 px
```

### 8.3 Step Guidance

The app should guide the user one step at a time.

Examples:

- Upload: "평면도 이미지를 선택하세요."
- Scale: "실제 길이를 알고 있는 구간의 양 끝을 선택하세요."
- Walls: "벽을 따라 점을 찍어주세요."
- Furniture: "가구를 추가하고 실제 크기로 배치하세요."
- 3D Preview: "배치 결과를 입체로 확인하세요."

Keep text concise and task-oriented.

### 8.4 Editing Safety

Include:

- Undo for recent actions if feasible.
- Delete confirmation for major items.
- Clear selected object state.
- Save automatically after meaningful changes.

## 9. Technical Stack

Use:

- Vite
- React
- TypeScript
- Tailwind CSS
- react-konva
- Konva
- Zustand
- Three.js
- @react-three/fiber
- @react-three/drei
- Dexie
- IndexedDB

Recommended supporting libraries:

- `nanoid` for IDs
- `clsx` for conditional class names
- `lucide-react` for icons

Avoid:

- Backend framework
- Server database
- OCR library
- AI SDK
- Authentication
- Cloud storage

## 10. Suggested Folder Structure

```text
src/
  app/
    App.tsx
    routes.ts
  components/
    layout/
      AppShell.tsx
      StepBar.tsx
      BottomToolbar.tsx
      BottomSheet.tsx
    canvas2d/
      FloorPlanStage.tsx
      FloorPlanImageLayer.tsx
      CalibrationLayer.tsx
      WallLayer.tsx
      FurnitureLayer.tsx
      GridLayer.tsx
      SelectionHandles.tsx
    preview3d/
      Preview3D.tsx
      WallMesh.tsx
      FurnitureMesh.tsx
      FloorMesh.tsx
      CameraControls.tsx
    furniture/
      FurniturePicker.tsx
      FurnitureInspector.tsx
    project/
      ProjectList.tsx
      ProjectNameInput.tsx
  db/
    dexie.ts
    projectRepository.ts
  hooks/
    useImageUpload.ts
    useStageGestures.ts
    useAutosaveProject.ts
  lib/
    geometry.ts
    units.ts
    exportImage.ts
    collision.ts
  store/
    projectStore.ts
    uiStore.ts
  types/
    project.ts
  styles/
    globals.css
  main.tsx
```

## 11. State Management

Use Zustand for app state.

Recommended stores:

- `projectStore`: active project data and editing actions.
- `uiStore`: current step, selected tool, selected object, panels, transient UI state.

Project data should be serializable so it can be saved directly to IndexedDB.

Example action groups:

```ts
createProject()
loadProject(projectId)
setFloorPlanImage(image)
setCalibration(calibration)
addWall(wall)
updateWall(wallId, patch)
deleteWall(wallId)
addFurniture(item)
updateFurniture(itemId, patch)
deleteFurniture(itemId)
setActiveStep(step)
selectObject(id)
clearSelection()
```

## 12. IndexedDB Persistence

Use Dexie.

Database:

```ts
projects
```

Schema idea:

```ts
db.version(1).stores({
  projects: 'id, name, createdAt, updatedAt',
})
```

Each project can be stored as a single document-style record for MVP simplicity.

Autosave:

- Save after project mutations.
- Debounce writes to avoid excessive storage operations.
- Show saved state subtly if needed.

## 13. Implementation Order

### Phase 1: App Scaffold

- Create Vite React TypeScript app.
- Add Tailwind CSS.
- Add base layout.
- Add Zustand stores.
- Add Dexie setup.
- Add project TypeScript types.

### Phase 2: Project and Image Upload

- Create project screen.
- Upload JPG/PNG.
- Store image as Data URL.
- Render image in Konva stage.
- Implement pan and zoom.

### Phase 3: Scale Calibration

- Add calibration step.
- Let user select two image points.
- Let user input real length in millimeters.
- Calculate and store `mmPerPixel`.
- Display calibrated segment and length.

### Phase 4: Wall Tracing

- Add wall drawing mode.
- Convert tapped image points to millimeter coordinates.
- Store wall segments in project data.
- Render walls back onto Konva stage.
- Show wall length labels.
- Support select, edit, and delete.

### Phase 5: Furniture Placement

- Add furniture picker.
- Add default furniture presets.
- Add custom dimension form.
- Render furniture rectangles in 2D.
- Support drag, rotate, edit, duplicate, and delete.

### Phase 6: 3D Preview

- Add React Three Fiber scene.
- Convert walls to 3D meshes.
- Convert furniture to 3D boxes.
- Add floor plane.
- Add orbit controls.
- Add camera reset.

### Phase 7: Export and Polish

- Export 2D canvas to PNG.
- Export 3D canvas to PNG.
- Improve mobile bottom sheets and toolbars.
- Add empty states and concise step guidance.
- Add basic validation.
- Test on mobile viewport sizes.

## 14. MVP Completion Criteria

The MVP is complete when a user can:

- Open the app on a mobile browser.
- Create a local project.
- Upload a Korean apartment floor plan image.
- Select a known line segment and enter its real length.
- Trace at least several wall segments.
- Add furniture with real dimensions.
- Drag and rotate furniture in 2D.
- See the same walls and furniture in a 3D preview.
- Save/export a 2D layout image.
- Save/export a 3D preview image.
- Close and reopen the browser and still see the saved project.

Quality bar:

- No backend is required.
- No account is required.
- No OCR or AI behavior exists.
- Touch interactions work on a phone-sized viewport.
- The app does not lose project data during normal use.
- The 2D and 3D views agree on scale and placement.

## 15. Excluded From MVP

Do not implement these in the first version:

- OCR dimension reading
- AI floor plan interpretation
- Automatic wall detection
- Automatic room detection
- Perspective correction
- Backend API
- User accounts
- Cloud sync
- Collaboration
- Real estate listing import
- Furniture brand catalog
- Photorealistic rendering
- Advanced lighting/materials
- Boolean wall cutouts for doors/windows
- Building code validation
- Cost estimation
- AR mode

## 16. Future Expansion Ideas

After the MVP is stable, consider:

- Perspective correction by selecting four floor plan corners.
- Optional OCR for dimension text.
- Assisted wall detection.
- Room polygon detection.
- Door and window cutouts in 3D.
- Furniture templates for common Korean apartment layouts.
- Import/export project JSON.
- Shareable project links with a backend.
- Cloud account sync.
- AR furniture preview.
- Better collision detection.
- Walkthrough camera mode.
- Measurement tool.
- Multi-floor support.
- Branded furniture catalog.

## 17. Engineering Notes

### 17.1 Keep Geometry Simple

The first version should use wall line segments, not full CAD-style room modeling.

Walls can be rendered in 2D as thick lines and in 3D as rectangular prisms derived from start/end points, thickness, and height.

### 17.2 Avoid Premature Automation

The strongest MVP bet is user-guided manual input:

- One known dimension sets scale.
- User traces walls.
- User enters furniture dimensions.

This avoids brittle OCR and computer vision edge cases.

### 17.3 Validate Scale Early

After calibration, show the measured length of another drawn segment so users can immediately see whether the scale feels correct.

### 17.4 2D and 3D Must Share Data

Do not create separate data models for 2D and 3D.

All geometry should come from the same project state.

## 18. First Implementation Prompt For A New Codex Session

Use the following prompt to start a fresh Codex implementation session:

```text
Build the MVP described in apartment-floorplanner-mvp-plan.md.

Use Vite + React + TypeScript + Tailwind CSS.
Use react-konva/Konva for the 2D floor plan editor.
Use Zustand for state management.
Use Dexie/IndexedDB for local persistence.
Use Three.js with @react-three/fiber and @react-three/drei for the 3D preview.

Do not add AI, OCR, backend APIs, authentication, or cloud sync.

Start by scaffolding the app and implementing:

1. Project data types
2. Zustand project store
3. Dexie local project persistence
4. Mobile-first app shell with step navigation
5. Floor plan image upload
6. Konva canvas that displays the uploaded image with pan and zoom
7. Manual scale calibration by selecting two points and entering real length in millimeters
8. Basic wall tracing using calibrated millimeter coordinates

Keep the UI mobile-first with a full-screen editor, compact top step bar, and bottom toolbar/bottom sheet controls.

After the first implementation pass, run the app locally, verify the main flow in a mobile-sized viewport, and report what works plus the next implementation steps.
```

