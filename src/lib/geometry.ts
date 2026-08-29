import type { PointMm, PointPx, ScaleCalibration } from '../types/project'

export const distance = (a: PointPx | PointMm, b: PointPx | PointMm) =>
  Math.hypot(b.x - a.x, b.y - a.y)

export const pxToMm = (point: PointPx, calibration: ScaleCalibration): PointMm => ({
  x: point.x * calibration.mmPerPixel,
  y: point.y * calibration.mmPerPixel,
})

export const mmToPx = (point: PointMm, calibration: ScaleCalibration): PointPx => ({
  x: point.x / calibration.mmPerPixel,
  y: point.y / calibration.mmPerPixel,
})

export const formatMm = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 1 : 2)} m` : `${Math.round(value)} mm`
