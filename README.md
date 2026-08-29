# 집그림 — 아파트 평면도 가구 배치 플래너

평면도 이미지 한 장을 실제 축척으로 보정하고, 벽·문·창을 확인한 뒤 실측 가구를 2D와 3D로 배치해 보는 모바일 우선 웹 애플리케이션입니다.

프로젝트 데이터는 서버로 전송하지 않고 브라우저의 IndexedDB에 저장합니다. 완성 결과는 2D PNG와 현재 카메라 시점의 3D PNG로 내려받을 수 있습니다.

**배포 주소:** [https://apartment-floorplanner.vercel.app](https://apartment-floorplanner.vercel.app)

## 주요 기능

- JPG/PNG 평면도 업로드 및 예시 도면 제공
- 두 점과 실제 길이를 이용한 축척 보정
- 평면도 기반 벽·문·창 후보 자동 인식
- 기존 구조 수정 / 신규 구조 생성 모드
- 벽, 일반문, 창문, 미닫이문, 베란다문 직접 추가 및 삭제
- 120개 이상의 치수 기반 가구·가전·식물 프리셋과 사용자 가구 생성
- 2D 드래그, 회전, 치수·높이·색상 변경 및 벽면 정렬
- 문과 창의 개구부를 반영한 파라메트릭 3D 미리보기
- 3D 평면 이동, 높이 이동, 회전, 삭제 및 카메라 이동
- 전체 2D PNG / 현재 시점 3D PNG 저장
- IndexedDB 자동 저장

## 기술 스택

- React 19 + TypeScript + Vite
- Zustand — 프로젝트 상태
- Dexie — IndexedDB 영속화
- React Konva — 2D 편집기
- Three.js + React Three Fiber + Drei — 3D 뷰어
- Lucide React — 아이콘

## 로컬 실행

### 요구 사항

- Node.js 20.19 이상
- Corepack 또는 pnpm 10

```bash
git clone <repository-url>
cd apartment-floorplanner
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

환경변수와 백엔드는 필요하지 않습니다. 예시 도면은 `public/sample_map.png`에 포함되어 있습니다.

## 빌드 및 프로덕션 확인

```bash
pnpm build
pnpm preview
```

빌드 결과는 `dist/`에 생성됩니다. Vercel은 Vite를 자동 감지하며 별도의 빌드 설정 없이 다음 값을 사용합니다.

| 항목 | 값 |
| --- | --- |
| Install Command | `pnpm install` |
| Build Command | `pnpm build` |
| Output Directory | `dist` |

## 사용 흐름

1. 평면도 이미지를 업로드하거나 예시 도면을 선택합니다.
2. 실제 길이를 아는 구간의 두 끝점을 선택하고 mm 값을 입력합니다.
3. 자동 인식 결과를 검토하거나 구조를 직접 추가·수정합니다.
4. 프리셋 또는 사용자 가구를 추가하고 위치·치수·색상을 조절합니다.
5. 3D에서 배치와 높이를 조정하고 카메라 시점을 선택합니다.
6. 저장 단계에서 2D와 3D PNG를 각각 내려받습니다.

## 데이터와 개인정보

- 업로드한 도면과 편집 데이터는 현재 브라우저의 IndexedDB에만 저장됩니다.
- 로그인, 서버 데이터베이스, 클라우드 동기화는 구현되어 있지 않습니다.
- 브라우저 데이터 삭제 또는 다른 기기/브라우저 사용 시 프로젝트가 자동 이전되지 않습니다.
- 배포를 갱신해도 동일 출처의 IndexedDB는 일반적으로 유지되지만, 중요한 결과는 PNG로 별도 저장하는 것이 좋습니다.

## 프로젝트 구조

```text
src/
├── components/
│   ├── FloorPlanStage.tsx    # 2D 도면·구조·가구 편집
│   ├── FurnitureLibrary.tsx  # 프리셋과 사용자 가구 UI
│   ├── Preview3D.tsx         # 3D 공간, 개구부, 가구 조작과 캡처
│   └── StepBar.tsx           # 단계 이동
├── db/                       # Dexie 저장소
├── hooks/                    # 이미지 업로드 처리
├── lib/
│   ├── floorPlanDetection.ts # 브라우저 기반 구조 후보 인식
│   ├── furniturePresets.ts   # 가구·가전·식물 프리셋
│   ├── geometry.ts           # 좌표와 스냅 계산
│   └── exportProjectImage.ts # 2D PNG 생성
├── store/projectStore.ts     # 프로젝트 상태와 자동 저장
└── types/project.ts          # 핵심 데이터 모델
```

구현 현황, 중요한 설계 결정과 다음 작업은 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)를 참고하세요. 최초 제품 기획은 [apartment-floorplanner-mvp-plan.md](apartment-floorplanner-mvp-plan.md)에 보존되어 있습니다.

## 알려진 제약

- 자동 인식은 영상 처리 기반 후보 생성이므로 도면 품질에 따라 수동 보정이 필요합니다.
- 3D 가구는 상품 원본 모델이 아닌 실측 치수 기반 간소화 모델입니다.
- 충돌과 벽면 스냅은 직교 배치에 최적화되어 있습니다.
- 사용자 프로젝트를 파일로 내보내거나 다른 기기로 동기화하는 기능은 아직 없습니다.

## 배포

Git 저장소를 Vercel 프로젝트에 연결하면 `main` 브랜치 push 시 프로덕션이 자동 갱신됩니다. 로컬에서 직접 배포할 때는 다음 명령을 사용할 수 있습니다.

```bash
vercel
vercel --prod
```
