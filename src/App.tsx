import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Home, Info, RotateCcw, Ruler, ScanLine, Sparkles, Trash2, Undo2, Upload, XCircle } from 'lucide-react'
import { FloorPlanStage } from './components/FloorPlanStage'
import { FloorPlanCropper } from './components/FloorPlanCropper'
import { FurnitureLibrary } from './components/FurnitureLibrary'
import { Preview3D } from './components/Preview3D'
import { StepBar } from './components/StepBar'
import { distance } from './lib/geometry'
import { fileToFloorPlan, inspectFloorPlanQuality, urlToFloorPlan, type FloorPlanQuality } from './hooks/useImageUpload'
import { useProjectStore } from './store/projectStore'
import type { FloorPlanImage, PointPx, ScaleCalibration } from './types/project'

const guidance = {
  upload: { eyebrow: 'STEP 1', title: '평면도를 준비해 주세요', body: '휴대폰에 저장된 도면을 선택하거나 예시 도면으로 먼저 둘러보세요.' },
  scale: { eyebrow: 'STEP 2', title: '도면의 기준 길이를 알려주세요', body: '실제 길이를 아는 선의 양 끝을 도면에서 차례로 눌러주세요.' },
  walls: { eyebrow: 'STEP 3', title: '도면 구조를 확인해 주세요', body: '수정과 생성을 전환하고, 두 점으로 벽·문·창을 추가하세요.' },
  furniture: { eyebrow: 'STEP 4', title: '가구를 배치해 보세요', body: '프리셋을 누르거나 내 가구를 만들고, 도면에서 끌어 배치하세요.' },
  preview3d: { eyebrow: 'STEP 5', title: '3D로 공간을 확인하세요', body: '모바일은 한 손가락으로 이동하고, 버튼을 눌러 회전 모드로 바꿀 수 있어요.' },
  export: { eyebrow: 'STEP 6', title: '완성 이미지를 저장하세요', body: '2D 도면과 현재 보고 있는 3D 시점을 각각 PNG로 저장할 수 있어요.' },
} as const

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const project = useProjectStore((s) => s.project)
  const hydrated = useProjectStore((s) => s.hydrated)
  const hydrate = useProjectStore((s) => s.hydrate)
  const setFloorPlanImage = useProjectStore((s) => s.setFloorPlanImage)
  const setCalibration = useProjectStore((s) => s.setCalibration)
  const setActiveStep = useProjectStore((s) => s.setActiveStep)
  const clearWalls = useProjectStore((s) => s.clearWalls)
  const undoLastUserAction = useProjectStore((s) => s.undoLastUserAction)
  const canUndoWallAction = useProjectStore((s) => s.canUndoWallAction)
  const setDetectedLayout = useProjectStore((s) => s.setDetectedLayout)
  const resetProject = useProjectStore((s) => s.resetProject)
  const [calibrationPoints, setCalibrationPoints] = useState<PointPx[]>([])
  const [knownLength, setKnownLength] = useState('3900')
  const [error, setError] = useState('')
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [notice, setNotice] = useState('')
  const [uploadQuality, setUploadQuality] = useState<FloorPlanQuality>()
  const [pendingFloorPlan, setPendingFloorPlan] = useState<FloorPlanImage>()
  const [showScaleGuide, setShowScaleGuide] = useState(false)
  const step = project.viewState.activeStep
  const copy = guidance[step]
  const stepNavigation = step === 'walls'
    ? { previous: 'scale' as const, next: 'furniture' as const, nextDisabled: !project.walls.length }
    : step === 'furniture'
      ? { previous: 'walls' as const, next: 'preview3d' as const, nextDisabled: false }
      : step === 'preview3d'
        ? { previous: 'furniture' as const, next: 'export' as const, nextDisabled: false }
        : undefined

  useEffect(() => { void hydrate() }, [hydrate])
  useEffect(() => {
    if (project.calibration) setCalibrationPoints([project.calibration.imagePointA, project.calibration.imagePointB])
  }, [project.calibration])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (step === 'scale') setShowScaleGuide(true)
  }, [project.floorPlanImage?.id, step])

  const acceptFloorPlan = async (floorPlan: FloorPlanImage) => {
    try {
      const quality = await inspectFloorPlanQuality(floorPlan.dataUrl, floorPlan.widthPx, floorPlan.heightPx)
      if (!quality.accepted) {
        setUploadQuality(quality)
        setPendingFloorPlan(undefined)
        return
      }
      setFloorPlanImage(floorPlan)
      setCalibrationPoints([])
      setPendingFloorPlan(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '자른 도면을 처리하지 못했어요.')
      setPendingFloorPlan(undefined)
    }
  }

  const loadFile = async (file?: File) => {
    if (!file) return
    try {
      setError('')
      setUploadQuality(undefined)
      const floorPlan = await fileToFloorPlan(file)
      setPendingFloorPlan(floorPlan)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '이미지를 불러오지 못했어요.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const loadDemo = async () => {
    try {
      setLoadingDemo(true)
      setError('')
      setUploadQuality(undefined)
      setFloorPlanImage(await urlToFloorPlan('/sample_map.png', 'sample_map.png'))
      setCalibrationPoints([])
    } catch {
      setError('예시 도면을 불러오지 못했어요.')
    } finally {
      setLoadingDemo(false)
    }
  }

  const calibrate = () => {
    const realLengthMm = Number(knownLength)
    if (calibrationPoints.length !== 2) return setError('도면에서 기준선의 양 끝을 먼저 선택해 주세요.')
    if (!Number.isFinite(realLengthMm) || realLengthMm <= 0) return setError('실제 길이를 0보다 큰 숫자로 입력해 주세요.')
    const pixelDistance = distance(calibrationPoints[0], calibrationPoints[1])
    if (pixelDistance < 5) return setError('두 점을 조금 더 멀리 선택해 주세요.')
    const calibration: ScaleCalibration = {
      imagePointA: calibrationPoints[0], imagePointB: calibrationPoints[1], realLengthMm,
      pixelDistance, mmPerPixel: realLengthMm / pixelDistance, calibratedAt: new Date().toISOString(),
    }
    setError('')
    setCalibration(calibration)
  }

  const autoDetect = async () => {
    if (!project.floorPlanImage || !project.calibration) return
    if (project.walls.length && !window.confirm('현재 벽을 자동 인식 결과로 바꿀까요?')) return
    try {
      setDetecting(true)
      setError('')
      setNotice('')
      const { detectFloorPlan } = await import('./lib/floorPlanDetection')
      const result = await detectFloorPlan(project.floorPlanImage, project.calibration)
      if (!result.walls.length) throw new Error('굵은 벽선을 찾지 못했어요. 수동 그리기를 이용해 주세요.')
      setDetectedLayout(result.walls, result.openings)
      setNotice(`하이브리드 AI가 벽 ${result.summary.wallCount}개 · 문 ${result.summary.doorCount}개 · 창 ${result.summary.windowCount}개 후보를 찾았어요.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '도면 자동 인식에 실패했어요.')
    } finally {
      setDetecting(false)
    }
  }

  if (!hydrated) return <div className="loading-screen"><div className="brand-mark"><Home size={22} /></div><span>저장된 집을 불러오는 중…</span></div>

  return (
    <main className={`app-shell step-${step}`}>
      <header className="app-header">
        <div className="brand"><span className="brand-mark"><Home size={18} /></span><span>집그림</span></div>
        <span className="save-state">자동 저장됨</span>
        <button className="icon-button reset-button" aria-label="프로젝트 초기화" title="프로젝트 초기화" onClick={() => {
          if (window.confirm('현재 작업을 두고 새로 시작할까요?')) { resetProject(); setCalibrationPoints([]) }
        }}><RotateCcw size={18} /><span>초기화</span></button>
      </header>
      <StepBar />

      <section className="workspace">
        <div className="workspace-heading">
          <div><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.body}</p></div>
          <div className="workspace-heading-tools">
            {step === 'walls' && <div className="wall-count"><b>{project.walls.length}</b><span>벽 · 개구부 {project.openings.length}</span></div>}
            {stepNavigation && <div className="step-navigation" aria-label="단계 이동">
              <button className="previous" onClick={() => setActiveStep(stepNavigation.previous)}><ChevronLeft size={16} /> 이전</button>
              <button className="next" disabled={stepNavigation.nextDisabled} onClick={() => setActiveStep(stepNavigation.next)}>다음 <ChevronRight size={16} /></button>
            </div>}
          </div>
        </div>

        {step === 'upload' ? (
          <div className="upload-panel">
            <h2>평면도 한 장이면 충분해요</h2>
            <p>고해상도 컬러 원본을 준비해 주세요. 작은 썸네일·흑백 도면·흐릿한 사진은 자동 인식이 어려워요.</p>
            <div className="upload-guide" aria-label="도면 이미지 첨부 가이드">
              <figure className="good"><div><img src="/sample_map.png" alt="선명한 고해상도 컬러 평면도 예시" /></div><figcaption><CheckCircle2 size={14} /><span><b>이렇게 첨부해요</b>선명한 컬러 원본</span></figcaption></figure>
              <figure className="low-resolution"><div><img src="/sample_map.png" alt="화질이 낮은 작은 도면 예시" /></div><figcaption><XCircle size={14} /><span><b>피해 주세요</b>작은 캡처·썸네일</span></figcaption></figure>
              <figure className="monochrome"><div><img src="/sample_map.png" alt="흑백 도면 예시" /></div><figcaption><XCircle size={14} /><span><b>피해 주세요</b>흑백·저대비 도면</span></figcaption></figure>
            </div>
            <ul className="upload-checklist">
              <li>권장: 짧은 변 500px 이상 · 원본에 가까운 크기</li>
              <li>벽, 방, 문, 창이 색상과 선으로 또렷하게 구분</li>
              <li>메신저 미리보기 대신 원본 파일 사용</li>
            </ul>
            {uploadQuality && <div className="upload-quality-error" role="alert">
              <div><Info size={17} /><span><b>이 도면은 자동 인식하기 어려워요</b>다음 단계로 이동하지 않았습니다. 아래 내용을 확인하고 다시 첨부해 주세요.</span></div>
              <ul>{uploadQuality.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </div>}
            <button className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={18} /> 내 도면 선택하기</button>
            <button className="secondary-button" onClick={loadDemo} disabled={loadingDemo}><Sparkles size={17} /> {loadingDemo ? '불러오는 중…' : '예시 도면으로 시작'}</button>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
          </div>
        ) : project.floorPlanImage ? (
          step === 'preview3d' || step === 'export' ? <Preview3D exportMode={step === 'export'} /> : step === 'furniture' ? <div className="furniture-workspace">
            <FloorPlanStage calibrationPoints={calibrationPoints} setCalibrationPoints={setCalibrationPoints} />
            <FurnitureLibrary />
          </div> : <FloorPlanStage calibrationPoints={calibrationPoints} setCalibrationPoints={setCalibrationPoints} />
        ) : null}
      </section>

      {error && <div className="error-toast" role="alert"><Info size={16} />{error}</div>}
      {notice && <div className="success-toast" role="status"><ScanLine size={16} />{notice}<button onClick={() => setNotice('')}>×</button></div>}

      {pendingFloorPlan && <FloorPlanCropper floorPlan={pendingFloorPlan} onCancel={() => setPendingFloorPlan(undefined)} onApply={(floorPlan) => void acceptFloorPlan(floorPlan)} />}

      {step === 'scale' && showScaleGuide && <div className="scale-guide-backdrop" role="dialog" aria-modal="true" aria-labelledby="scale-guide-title">
        <section className="scale-guide-modal">
          <div className="scale-guide-example" aria-hidden="true"><span className="guide-point start" /><i /><span className="guide-point end" /><b>3,900 mm</b></div>
          <h2 id="scale-guide-title">축척은 이렇게 설정해요</h2>
          <p>도면에서 실제 길이를 아는 선의 <b>한쪽 끝과 반대쪽 끝</b>을 차례로 누른 뒤, 그 길이를 mm로 입력하세요.</p>
          <button className="primary-button" onClick={() => setShowScaleGuide(false)}>확인</button>
        </section>
      </div>}

      {step === 'scale' && (
        <aside className="bottom-sheet">
          <div className="sheet-handle" />
          <div className="sheet-row"><div><span className="field-label">선택한 기준선</span><strong>{calibrationPoints.length}/2 지점 선택</strong></div><button className="text-button" onClick={() => setCalibrationPoints([])}>다시 선택</button></div>
          <label className="length-field"><span><Ruler size={18} /> 실제 길이</span><div><input inputMode="numeric" value={knownLength} onChange={(e) => setKnownLength(e.target.value.replace(/[^0-9]/g, ''))} /><b>mm</b></div></label>
          <button className="primary-button" onClick={calibrate} disabled={calibrationPoints.length !== 2}>축척 적용하고 벽 그리기</button>
        </aside>
      )}

      {step === 'walls' && (
        <aside className="bottom-toolbar">
          <button className="danger-tool" onClick={() => project.walls.length && window.confirm('그린 벽을 모두 지울까요?') && clearWalls()} disabled={!project.walls.length}><Trash2 size={18} /><span>전체 삭제</span></button>
          <button className="undo-tool" onClick={undoLastUserAction} disabled={!canUndoWallAction}><Undo2 size={19} /><span>한 단계 취소</span></button>
          <button className="detect-tool" onClick={() => void autoDetect()} disabled={detecting}><ScanLine size={19} /><span>{detecting ? '인식 중…' : '자동 인식'}</span></button>
          <div className="wall-tip"><span className="tip-dot" /><p><b>새 벽 그리기</b><br />두 점 선택 후 생성</p></div>
        </aside>
      )}
    </main>
  )
}
