import { useMemo, useRef, useState } from 'react'
import { Box, ImagePlus, PackagePlus, Search, X } from 'lucide-react'
import { furnitureCategories, furnitureColors, furniturePresets } from '../lib/furniturePresets'
import { useProjectStore } from '../store/projectStore'
import type { FurnitureType } from '../types/project'

const defaultCustom = { name: '', widthMm: '800', depthMm: '600', heightMm: '750', color: '#F7F5EF', productUrl: '' }

export function FurnitureLibrary() {
  const imageRef = useRef<HTMLInputElement>(null)
  const addFurniture = useProjectStore((s) => s.addFurniture)
  const setActiveStep = useProjectStore((s) => s.setActiveStep)
  const furnitureCount = useProjectStore((s) => s.project.furniture.length)
  const [category, setCategory] = useState<'all' | FurnitureType>('all')
  const [query, setQuery] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState(defaultCustom)
  const [imageDataUrl, setImageDataUrl] = useState<string>()

  const filtered = useMemo(() => furniturePresets.filter((item) =>
    (category === 'all' || item.type === category) && item.name.includes(query.trim()),
  ), [category, query])

  const createCustom = () => {
    const widthMm = Number(custom.widthMm)
    const depthMm = Number(custom.depthMm)
    const heightMm = Number(custom.heightMm)
    if (!custom.name.trim() || ![widthMm, depthMm, heightMm].every((value) => Number.isFinite(value) && value > 0)) return
    addFurniture({
      type: 'custom', name: custom.name.trim(), widthMm, depthMm, heightMm,
      color: custom.color, imageDataUrl, productUrl: custom.productUrl.trim() || undefined, source: 'user',
    })
    setCustom(defaultCustom)
    setImageDataUrl(undefined)
    setShowCustom(false)
  }

  return <aside className="furniture-library" aria-label="가구 라이브러리">
    <div className="library-head">
      <div><b>가구 라이브러리</b><span>배치됨 {furnitureCount}개</span></div>
      <div className="library-actions"><button className="preview-open" onClick={() => setActiveStep('preview3d')}><Box size={15} /> 3D 보기</button><button className="custom-open" onClick={() => setShowCustom(true)}><PackagePlus size={16} /> 내 가구 만들기</button></div>
    </div>
    <label className="furniture-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="가구 검색" /></label>
    <div className="furniture-categories">
      {furnitureCategories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}
    </div>
    <div className="preset-grid">
      {filtered.map((preset) => <button key={preset.id} className="preset-card" onClick={() => addFurniture({
        type: preset.type, name: preset.name, widthMm: preset.widthMm, depthMm: preset.depthMm,
        heightMm: preset.heightMm, color: preset.color, source: 'preset', shape: preset.shape,
      })}>
        <span className="preset-symbol" style={{ background: preset.color }}>{preset.symbol}</span>
        <span><b>{preset.name}</b><small>{preset.widthMm} × {preset.depthMm} × H{preset.heightMm}</small></span>
        <i>＋</i>
      </button>)}
    </div>

    {showCustom && <div className="custom-furniture-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCustom(false)}>
      <section className="custom-furniture-modal">
        <header><div><b>내 가구 만들기</b><span>사진은 내 기기에만 저장돼요</span></div><button onClick={() => setShowCustom(false)} aria-label="닫기"><X size={20} /></button></header>
        <button className="furniture-image-field" onClick={() => imageRef.current?.click()}>
          {imageDataUrl ? <img src={imageDataUrl} alt="가구 미리보기" /> : <><ImagePlus size={25} /><span>가구 사진 추가</span><small>선택 사항 · PNG, JPG</small></>}
        </button>
        <input ref={imageRef} hidden type="file" accept="image/png,image/jpeg" onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' && setImageDataUrl(reader.result)
          reader.readAsDataURL(file)
        }} />
        <label className="custom-field"><span>이름</span><input value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} placeholder="예: 거실 원목 테이블" /></label>
        <div className="dimension-fields">
          {([['widthMm', '가로'], ['depthMm', '세로'], ['heightMm', '높이']] as const).map(([key, label]) => <label key={key} className="custom-field"><span>{label} (mm)</span><input inputMode="numeric" value={custom[key]} onChange={(event) => setCustom({ ...custom, [key]: event.target.value.replace(/[^0-9]/g, '') })} /></label>)}
        </div>
        <div className="custom-color-section">
          <span>대표 색상</span>
          <div className="color-preset-grid">
            {furnitureColors.map((color) => <button key={color.value} className={custom.color.toUpperCase() === color.value ? 'active' : ''} onClick={() => setCustom({ ...custom, color: color.value })} title={color.name} aria-label={color.name}>
              <i style={{ background: color.value }} /><b>{color.name}</b>
            </button>)}
          </div>
          <details className="rgb-details"><summary>세부 RGB 직접 선택</summary><div><input type="color" value={custom.color} onChange={(event) => setCustom({ ...custom, color: event.target.value })} /><code>{custom.color.toUpperCase()}</code></div></details>
        </div>
        <label className="custom-field"><span>상품 원본 링크 (선택)</span><input type="url" value={custom.productUrl} onChange={(event) => setCustom({ ...custom, productUrl: event.target.value })} placeholder="https://…" /></label>
        <p className="source-note">브랜드 상품은 이미지를 복사하지 않고, 직접 촬영한 사진이나 사용 허가를 받은 이미지를 등록해 주세요.</p>
        <button className="primary-button" onClick={createCustom} disabled={!custom.name.trim()}>도면 중앙에 추가</button>
      </section>
    </div>}
  </aside>
}
