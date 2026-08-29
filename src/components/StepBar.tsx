import { Check } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import type { AppStep } from '../types/project'

const steps: { id: AppStep; label: string }[] = [
  { id: 'upload', label: '도면' },
  { id: 'scale', label: '축척' },
  { id: 'walls', label: '벽' },
  { id: 'furniture', label: '가구' },
  { id: 'preview3d', label: '3D' },
  { id: 'export', label: '저장' },
]

export function StepBar() {
  const project = useProjectStore((s) => s.project)
  const setActiveStep = useProjectStore((s) => s.setActiveStep)
  const current = steps.findIndex((step) => step.id === project.viewState.activeStep)
  const maxReady = project.calibration ? 5 : project.floorPlanImage ? 1 : 0

  return <nav className="step-bar" aria-label="작업 단계">
    {steps.map((step, index) => {
      const enabled = index <= Math.max(current, maxReady)
      return <button key={step.id} className={index === current ? 'active' : ''} disabled={!enabled} onClick={() => setActiveStep(step.id)}>
        <span className="step-dot">{index < current ? <Check size={11} strokeWidth={3} /> : index + 1}</span>
        <span>{step.label}</span>
      </button>
    })}
  </nav>
}
