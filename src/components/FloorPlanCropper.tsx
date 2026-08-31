import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Crop, X } from 'lucide-react'
import { cropFloorPlan } from '../hooks/useImageUpload'
import type { FloorPlanImage } from '../types/project'

type CropRect = { x: number; y: number; width: number; height: number }
type Edge = 'nw' | 'ne' | 'sw' | 'se'

export function FloorPlanCropper({ floorPlan, onCancel, onApply }: {
  floorPlan: FloorPlanImage
  onCancel: () => void
  onApply: (floorPlan: FloorPlanImage) => void
}) {
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 })
  const [saving, setSaving] = useState(false)

  const startResize = (edge: Edge, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const stage = event.currentTarget.closest<HTMLElement>('.crop-image-stage')
    if (!stage) return
    const origin = crop
    const start = { x: event.clientX, y: event.clientY }
    const move = (pointerEvent: PointerEvent) => {
      const bounds = stage.getBoundingClientRect()
      const dx = (pointerEvent.clientX - start.x) / bounds.width
      const dy = (pointerEvent.clientY - start.y) / bounds.height
      const min = .08
      let left = origin.x
      let top = origin.y
      let right = origin.x + origin.width
      let bottom = origin.y + origin.height
      if (edge.includes('w')) left = Math.max(0, Math.min(right - min, origin.x + dx))
      if (edge.includes('e')) right = Math.min(1, Math.max(left + min, origin.x + origin.width + dx))
      if (edge.includes('n')) top = Math.max(0, Math.min(bottom - min, origin.y + dy))
      if (edge.includes('s')) bottom = Math.min(1, Math.max(top + min, origin.y + origin.height + dy))
      setCrop({ x: left, y: top, width: right - left, height: bottom - top })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return <div className="crop-backdrop" role="dialog" aria-modal="true" aria-labelledby="crop-title">
    <section className="crop-modal">
      <header><div><b id="crop-title"><Crop size={18} /> 도면 영역 자르기</b><span>네 모서리를 밀어 빈 공간을 제외해 주세요.</span></div><button onClick={onCancel} aria-label="자르기 취소"><X size={20} /></button></header>
      <div className="crop-image-stage" style={{ aspectRatio: `${floorPlan.widthPx} / ${floorPlan.heightPx}` }}>
        <img src={floorPlan.dataUrl} alt="자를 도면 미리보기" />
        <div className="crop-shade crop-shade-top" style={{ height: `${crop.y * 100}%` }} />
        <div className="crop-shade crop-shade-left" style={{ top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
        <div className="crop-shade crop-shade-right" style={{ top: `${crop.y * 100}%`, left: `${(crop.x + crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
        <div className="crop-shade crop-shade-bottom" style={{ top: `${(crop.y + crop.height) * 100}%` }} />
        <div className="crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
          {(['nw', 'ne', 'sw', 'se'] as const).map((edge) => <button key={edge} className={`crop-handle ${edge}`} aria-label={`${edge} 모서리 조절`} onPointerDown={(event) => startResize(edge, event)} />)}
        </div>
      </div>
      <div className="crop-actions"><button onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 1 })}>전체 이미지 사용</button><button className="primary" disabled={saving} onClick={async () => {
        setSaving(true)
        try { onApply(await cropFloorPlan(floorPlan, crop)) } finally { setSaving(false) }
      }}>{saving ? '자르는 중…' : '이 영역으로 계속'}</button></div>
    </section>
  </div>
}
