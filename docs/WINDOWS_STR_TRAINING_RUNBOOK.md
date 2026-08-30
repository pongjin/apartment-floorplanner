# Windows FP/STR 자동인식 학습·검증 실행서

- 작성일: 2026-08-30
- 대상 장비: Windows 11, Ryzen 5 5600X, GeForce RTX 4060 8GB
- 대상 제품: `sample_map.png`와 유사한 컬러 주거 평면도 편집 웹 앱
- 문서 목적: 새 Windows 프로젝트 경로와 AI Hub 학습 데이터 경로만 제공받아 데이터 검증, 표본 추출, 학습, 평가, ONNX 변환 및 웹 성능 검증 환경을 재현하기 위한 단일 인수인계 문서

> 이 문서의 `python -m floorplan_ml...` 명령은 새 학습 프로젝트가 제공해야 할 **구현 계약**이다. 현재 React 저장소에는 아직 해당 Python 패키지와 학습 스크립트가 없다. Windows에서 새 프로젝트를 만들 때 아래 디렉터리와 CLI를 구현한 뒤 순서대로 실행한다.

## 1. 결정 사항 요약

첫 모델은 AI Hub 건축 도면 데이터 중 `APT/FP/STR`만 사용한다. 전문 CAD 도면, 단면도(CS), 입면도(EP), 구조도(SD), 공간(SPA), 객체(OBJ), OCR은 첫 학습 범위에서 제외한다.

권장 첫 구성은 다음과 같다.

```text
데이터: AI Hub APT/FP/STR
표본: train 1,500 + validation 200 + test 300 = 총 2,000장
모델: MobileNetV3-Large + LR-ASPP
학습 출력: AI Hub STR 원본 세부 속성을 최대한 보존
제품 출력: 벽체 + 일반 여닫이문 + 창호
제품 제외: 미닫이문·베란다문·기타문 자동 후보
배포: ONNX, 모바일/데스크톱 브라우저 기기 내 추론
런타임: ONNX Runtime Web, WebGPU 우선 + WASM fallback
후처리: 벽 직선화·병합, 개구부의 부모 벽 연결, 제외 유형 필터
서버: 별도 추론 API/GPU 서버 없음
```

RTX 4060 PC를 주 학습기로 사용한다. M1 Mac은 Safari/WASM, iPhone, CoreML 및 결과 교차 검증에 사용한다. 무료 Colab은 주 환경이 아니라 재현성 확인과 일회성 비교 실험에만 사용한다.

## 2. 문제 범위와 비범위

### 2.1 목표

- 컬러 주거 평면도에서 벽, 일반 여닫이문, 창문을 자동 인식한다.
- 인식 결과를 현재 앱의 편집 가능한 벽·문·창 데이터로 변환한다.
- 미닫이문과 베란다문은 구분해서 학습하되 자동 후보로 제공하지 않는다.
- 모델이 실패하거나 신뢰도가 낮은 경우 기존 수동 편집 흐름을 유지한다.
- 도면과 추론은 사용자의 브라우저 또는 앱 기기 안에서 처리한다.
- 모델 캐시 후 모바일 웹에서도 약 10초 이내 응답을 목표로 한다.

### 2.2 현재 비범위

- 전문 CAD 원본, 구조 계산 도면, 다층 건물 전체 도면
- CS, EP, SD 도면 구조 인식
- 공간 이름 자동 부여
- 가구·위생기구 자동 배치
- OCR을 이용한 방 이름·치수 자동 추출
- 유료 추론 API, 유료 GPU 서버, 업로드 도면의 서버 저장
- 미닫이문과 베란다문의 자동 편집 후보 생성

### 2.3 데이터 종류 선택

| 코드 | 의미 | 첫 모델 사용 | 사유 |
| --- | --- | --- | --- |
| FP | 평면도 | 사용 | 벽·문·창을 위에서 본 제품 입력과 일치 |
| CS | 단면도 | 제외 | 수직 구조와 층고 기호가 중심 |
| EP | 입면도 | 제외 | 외관과 파사드의 창호 표현이 중심 |
| SD | 구조도 | 제외 | 기둥·보·철근 기호가 제품 의미와 다름 |
| STR | 구조 라벨 | 사용 | 출입문·창호·벽체 segmentation과 속성 제공 |
| SPA | 공간 라벨 | 2차 | room topology 보조 학습 후보 |
| OBJ | 객체 라벨 | 제외 | 현재 구조 인식 목표에 직접 기여가 작음 |
| OCR | 문자 라벨 | 제외 | 기본 구조 추론 지연과 복잡도를 높임 |

## 3. 데이터셋 사실과 라벨 정책

AI Hub 데이터셋 페이지 기준 `APT/FP/STR` 원천 이미지와 JSON은 각각 8,300개다. STR은 다음 세부 속성을 포함한다.

- 출입문: 여닫이문, 미닫이문, 기타문
- 창호: 여닫이창, 미닫이창, 기타창
- 벽체: 철근콘크리트벽, 기타벽

공식 데이터: [AI Hub 건축 도면 데이터](https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&dataSetSn=71465&topMenu=100)

### 3.1 원본 라벨 보존 원칙

데이터 전처리 단계에서 `category_id`만 보고 출입문·창호·벽체의 3개 클래스로 합치지 않는다. JSON의 `attributes`를 읽어 세부 유형을 유지한다.

권장 학습 ID는 다음과 같다. 실제 문자열과 철자는 데이터 전체 검사 결과를 기준으로 확정하고 `label_map.yaml`에 기록한다.

| 학습 ID | 의미 | 제품 후보 출력 |
| ---: | --- | --- |
| 0 | background | 아니오 |
| 1 | 철근콘크리트벽 | 벽 |
| 2 | 기타벽 | 벽 |
| 3 | 여닫이문 | 일반문 |
| 4 | 미닫이문 | 제외 |
| 5 | 기타문 | 제외 |
| 6 | 여닫이창 | 창문 |
| 7 | 미닫이창 | 창문 |
| 8 | 기타창 | 창문 또는 검토 후보 |
| 255 | ignore/불명확·가림 | 아니오 |

베란다문이 별도 속성으로 존재하지 않으면 미닫이문과 위치 문맥으로 처리한다. 첫 모델에서는 모든 미닫이문을 자동 후보에서 제외한다. `기타창`의 제품 출력 여부는 validation 결과에서 일반문 오탐을 확인한 후 확정한다.

### 3.2 데이터 품질이 좋아도 필요한 표본 수

고품질 라벨은 라벨 노이즈를 줄이지만 배치, 색상, 문·창 기호와 희귀 유형의 다양성을 대신하지 않는다. 첫 표본은 다음처럼 고정한다.

| 집합 | 수량 | 용도 |
| --- | ---: | --- |
| train | 1,500 | 모델 학습 |
| validation | 200 | epoch 선택과 threshold 조정 |
| test | 300 | 최종 성능 보고, 학습 중 열람 금지 |

학습 곡선은 같은 validation/test 분할을 유지하고 `250 → 500 → 1,000 → 1,500`장 순으로 측정한다. 1,000장에서 1,500장으로 늘렸을 때 주요 지표가 1%p 미만 개선되고 희귀 유형 recall도 포화되면 1,500장에서 멈춘다. 계속 상승하면 2,500~3,000장으로 늘리고, 5,000장 이상은 성능 상승이 실측된 경우에만 사용한다.

### 3.3 표본 추출 규칙

완전 무작위 표집을 사용하지 않는다. 다음 기준을 manifest에 함께 기록하고 층화 표집한다.

- 여닫이문·미닫이문·기타문 존재 여부와 개수
- 여닫이창·미닫이창·기타창 존재 여부와 개수
- 철근콘크리트벽·기타벽 존재 여부
- 전체 annotation 수와 구조 복잡도
- 가로세로 비율, 해상도, 여백 비율
- 컬러 비율, 평균 밝기, 대비, 텍스트 밀도
- 발코니 경계 및 긴 개구부가 있는 도면
- 문·창이 매우 적거나 매우 많은 도면
- `sample_map.png`와 시각적으로 가까운 표현 양식

희귀 클래스는 자연 분포만 따르지 말고 train에 의도적으로 더 포함한다. validation/test는 실제 제품 입력 분포를 유지하되 모든 세부 클래스의 평가 인스턴스를 확보한다.

### 3.4 중복 방지와 데이터 누수 차단

비슷한 도면이 train과 test에 동시에 들어가면 성능이 과대평가된다.

1. 축소 이미지의 perceptual hash를 계산한다.
2. 유사도가 높은 도면을 하나의 `duplicate_group_id`로 묶는다.
3. 같은 그룹 전체를 하나의 split에만 배정한다.
4. 가능하면 도면 번호·공급처·동일 평형 변형도 같은 그룹으로 묶는다.
5. split 생성 후 이미지 hash 교차 중복 검사를 다시 실행한다.

300장 test manifest는 첫 생성 후 변경하지 않는다. `sample_map.png`와 사용자가 제공한 회귀 도면은 별도 `regression` 집합으로 관리하며 학습에 넣지 않는다.

## 4. Windows 권장 환경

### 4.1 하드웨어 역할

| 장비 | 역할 |
| --- | --- |
| Ryzen 5600X + RTX 4060 8GB | 데이터 전처리, CUDA 학습, ONNX 생성, 데스크톱 벤치마크 |
| M1 MacBook | Safari/WASM, iOS/CoreML, 결과 교차 검증 |
| 무료 Colab | 선택적 재현성 확인; 주 학습 환경으로 사용하지 않음 |

### 4.2 운영체제

WSL2 Ubuntu 사용을 권장한다. Python/CUDA 학습 환경을 Linux 기준으로 통일할 수 있고 이후 CI나 다른 학습기로 옮기기 쉽다.

PowerShell 관리자 창에서 최초 한 번 실행한다.

```powershell
wsl --install -d Ubuntu
wsl --update
wsl --shutdown
```

재부팅 후 WSL 터미널에서 GPU가 보이는지 확인한다.

```bash
nvidia-smi
```

학습 데이터와 Python 프로젝트는 `/mnt/c/...`가 아니라 WSL 내부 ext4 경로에 두는 것을 권장한다. 대량의 작은 JSON과 마스크를 읽을 때 Windows 마운트 경로보다 안정적인 I/O를 얻기 위해서다.

예시:

```text
Windows 탐색기: \\wsl$\Ubuntu\home\<USER>\floorplan-ml
WSL 학습 프로젝트: /home/<USER>/floorplan-ml
WSL 데이터: /home/<USER>/datasets/aihub-building-drawings
React 앱: /home/<USER>/apartment-floorplanner
```

### 4.3 필수 도구

- Windows 11과 최신 NVIDIA 드라이버
- WSL2 Ubuntu
- Git
- Python 3.11 가상환경
- PyTorch CUDA와 torchvision
- Pillow, NumPy, OpenCV headless
- Albumentations 또는 동일 기능 augmentation 라이브러리
- ONNX, ONNX Runtime, ONNX Runtime GPU
- scikit-learn, pandas, tqdm, PyYAML
- perceptual hash 라이브러리
- Node.js 20.19 이상, Corepack, pnpm 10.15

프로젝트 생성 시 버전은 `pyproject.toml` 또는 잠금 파일에 고정한다. 설치 명령은 PyTorch 공식 selector에서 현재 드라이버와 호환되는 CUDA 빌드를 선택해 README에 복사한다. 임의의 오래된 CUDA 명령을 문서에 고정하지 않는다.

### 4.4 Python 환경 생성 예시

```bash
cd /home/<USER>/floorplan-ml
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

# 프로젝트가 pyproject.toml을 제공한 뒤 실행
pip install -e '.[train,export,test]'

python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO CUDA')"
```

합격 조건은 `torch.cuda.is_available()`가 `True`이고 장치 이름에 RTX 4060이 표시되는 것이다.

## 5. 데이터 배치와 경로 계약

### 5.1 다운로드 정책

AI Hub 데이터는 API로 매 batch 읽지 않고 필요한 archive를 한 번 다운로드해 로컬 SSD에 고정한다. API는 파일 목록·버전 확인과 신규 데이터 동기화에만 사용할 수 있다.

원본 데이터는 Git에 추가하지 않는다. 원본 archive, 추출 이미지, JSON, 생성 마스크와 모델 checkpoint는 모두 `.gitignore` 대상이다. 저장소에는 manifest, 설정, 코드, 소량의 라이선스상 허용된 합성 fixture만 둔다.

### 5.2 허용 입력 구조

학습 로더는 다음 두 형태 중 하나를 지원해야 한다.

```text
<DATA_ROOT>/
├── 01.원천데이터/
│   └── STR/
│       └── APT_FP_STR_XXXXXXXXX.PNG
└── 02.라벨링데이터/
    └── STR/
        └── APT_FP_STR_XXXXXXXXX.json
```

또는 전체 archive 구조:

```text
<DATA_ROOT>/
├── 원천데이터/APT/FP/STR/...
└── 라벨링데이터/APT/FP/STR/...
```

폴더명이 다른 경우 이미지와 JSON stem `APT_FP_STR_XXXXXXXXX`를 기준으로 재귀 검색해 pair를 만든다. 매칭 실패 파일은 자동 제외하지 말고 오류 보고서에 기록한다.

### 5.3 로컬 설정 파일

개인 경로를 코드에 하드코딩하지 않는다. Git에서 제외되는 `configs/local.windows.yaml`을 사용한다.

```yaml
project_root: /home/<USER>/floorplan-ml
data_root: /home/<USER>/datasets/aihub-building-drawings
app_root: /home/<USER>/apartment-floorplanner
artifact_root: /home/<USER>/floorplan-artifacts
seed: 20260830
device: cuda
```

학습에 사용한 비개인 설정은 실행 시점에 artifact 폴더로 복사한다. 절대경로는 보고서에서 제거하거나 `<DATA_ROOT>`로 치환한다.

## 6. 새 학습 프로젝트가 제공해야 할 구조

```text
floorplan-ml/
├── pyproject.toml
├── README.md
├── configs/
│   ├── local.windows.example.yaml
│   ├── labels.aihub-str.yaml
│   ├── lraspp-640.yaml
│   └── lraspp-768.yaml
├── floorplan_ml/
│   ├── cli/
│   ├── data/
│   ├── models/
│   ├── metrics/
│   ├── postprocess/
│   └── export/
├── tests/
├── reports/
├── scripts/
└── .gitignore
```

필수 CLI 계약은 다음과 같다.

```text
python -m floorplan_ml.inspect_dataset
python -m floorplan_ml.build_manifest
python -m floorplan_ml.render_masks
python -m floorplan_ml.train
python -m floorplan_ml.evaluate
python -m floorplan_ml.export_onnx
python -m floorplan_ml.benchmark_onnx
python -m floorplan_ml.predict
```

모든 CLI는 다음 공통 요건을 지킨다.

- `--config`로 설정 파일을 받는다.
- `--help`가 동작한다.
- seed를 명시하고 결과에 저장한다.
- 입력 파일을 변경하지 않는다.
- JSON과 CSV 요약 결과를 동시에 생성한다.
- 실패 파일 목록과 원인을 별도 저장한다.
- 실행 환경, Git SHA, 패키지 버전과 GPU 정보를 기록한다.

## 7. 단계별 실행 절차

### 단계 A. 데이터 감사

```bash
python -m floorplan_ml.inspect_dataset \
  --config configs/local.windows.yaml \
  --subset APT/FP/STR \
  --report reports/dataset-audit.json
```

검사 항목:

- 이미지와 JSON stem 1:1 매칭
- JSON schema와 필수 필드
- 이미지 실제 크기와 JSON width/height 일치
- polygon 좌표 범위, 짝수 좌표 수, 최소 점 개수
- 빈 segmentation, 음수 bbox, 0 area
- category와 attributes의 실제 문자열 분포
- 클래스별 이미지 수와 인스턴스 수
- occluded 비율
- 이미지 손상 여부

합격 기준:

- 선택된 pair의 매칭률 100%
- 파싱 실패 0건, 또는 수동 제외 목록과 사유 확정
- 라벨 매핑되지 않은 속성 0건
- 좌표 오류는 원본 수정 없이 ignore 목록으로 관리

### 단계 B. 중복 그룹과 층화 split 생성

```bash
python -m floorplan_ml.build_manifest \
  --config configs/local.windows.yaml \
  --subset APT/FP/STR \
  --train 1500 --val 200 --test 300 \
  --learning-curve 250 500 1000 1500 \
  --group-near-duplicates \
  --stratify-attributes \
  --output artifacts/manifests/v1
```

필수 산출물:

- `all-audited.csv`
- `train-1500.csv`, `val-200.csv`, `test-300.csv`
- `train-250.csv`, `train-500.csv`, `train-1000.csv`
- `duplicate-groups.csv`
- `class-distribution.json`
- `split-report.md`

### 단계 C. 마스크 생성과 육안 검증

```bash
python -m floorplan_ml.render_masks \
  --config configs/local.windows.yaml \
  --manifest artifacts/manifests/v1/train-1500.csv \
  --sizes 640x480 768x576 \
  --output artifacts/masks/v1
```

원본 비율을 유지하고 letterbox padding을 사용한다. 좌표 변환 정보는 마스크 metadata에 저장한다. 벽·문·창처럼 얇은 클래스가 bilinear resize로 훼손되지 않도록 라벨 마스크에는 nearest-neighbor 보간을 사용한다.

육안 검증용 overlay를 최소 100장 생성한다. 다음 사례를 의도적으로 포함한다.

- 여닫이문, 미닫이문, 기타문
- 여닫이창, 미닫이창, 기타창
- 발코니 경계
- 가는 벽, 짧은 벽, 이중선 벽
- 큰 여백과 하단 도곽
- 텍스트가 벽에 겹친 도면
- occluded annotation

### 단계 D. 20장 overfit

Sample 또는 train에서 20장을 선택한다.

```bash
python -m floorplan_ml.train \
  --config configs/lraspp-640.yaml \
  --train-manifest artifacts/manifests/v1/overfit-20.csv \
  --val-manifest artifacts/manifests/v1/overfit-20.csv \
  --run-name overfit-20
```

목적은 일반화가 아니라 구현 오류 탐지다. augmentation을 끄고 train mIoU 0.95 이상에 도달하지 못하면 전체 학습으로 넘어가지 않는다. 실패 시 라벨 우선순위, background polygon 덮어쓰기, resize 좌표, ignore index와 loss 구현을 점검한다.

### 단계 E. 학습 곡선

```bash
for N in 250 500 1000 1500; do
  python -m floorplan_ml.train \
    --config configs/lraspp-640.yaml \
    --train-manifest artifacts/manifests/v1/train-${N}.csv \
    --val-manifest artifacts/manifests/v1/val-200.csv \
    --run-name lraspp-640-n${N}
done
```

Windows PowerShell에서 실행할 경우:

```powershell
wsl bash -lc 'cd /home/<USER>/floorplan-ml && source .venv/bin/activate && for N in 250 500 1000 1500; do python -m floorplan_ml.train --config configs/lraspp-640.yaml --train-manifest artifacts/manifests/v1/train-${N}.csv --val-manifest artifacts/manifests/v1/val-200.csv --run-name lraspp-640-n${N}; done'
```

### 단계 F. 고정 test 평가

학습 설정을 선택하기 전에는 test를 열어 threshold를 조정하지 않는다. validation으로 모델과 threshold를 확정한 뒤 한 번 평가한다.

```bash
python -m floorplan_ml.evaluate \
  --checkpoint artifacts/runs/lraspp-640-n1500/best.pt \
  --manifest artifacts/manifests/v1/test-300.csv \
  --output artifacts/evaluation/lraspp-640-n1500
```

### 단계 G. ONNX 변환과 일치성 검증

```bash
python -m floorplan_ml.export_onnx \
  --checkpoint artifacts/runs/lraspp-640-n1500/best.pt \
  --input-size 640 480 \
  --static-shape \
  --quantize int8 \
  --output artifacts/models/floorplan-str-v1-int8.onnx

python -m floorplan_ml.benchmark_onnx \
  --model artifacts/models/floorplan-str-v1-int8.onnx \
  --manifest artifacts/manifests/v1/test-300.csv \
  --compare-pytorch \
  --output artifacts/benchmarks/onnx-desktop.json
```

ONNX 변환 전후의 클래스 마스크와 후처리 결과가 허용오차 안에서 일치해야 한다. INT8 정확도 하락이 문·창 F1 1%p를 넘으면 FP16 또는 동적/선택적 양자화를 비교한다.

### 단계 H. React 앱 통합

선택된 모델과 metadata를 앱의 정적 자산으로 복사한다.

```text
public/models/floorplan-str-v1-int8.onnx
public/models/floorplan-str-v1.metadata.json
```

metadata에 포함할 값:

- 모델 버전과 checkpoint hash
- 입력 크기, color order, normalization
- 학습 ID와 제품 출력 매핑
- ignore index
- 클래스별 threshold
- letterbox 좌표 복원 규칙
- 후처리 버전
- 학습 데이터 버전과 manifest hash

웹 구현 요구사항:

- 업로드 완료 후 또는 인식 버튼 노출 전에 모델 lazy preload
- Cache Storage 또는 IndexedDB에 모델 캐시
- 추론과 후처리를 Web Worker에서 실행
- 데스크톱·Android Chromium은 WebGPU 우선
- iOS Safari와 WebGPU 실패 환경은 WASM fallback
- 모델 다운로드 시간과 순수 추론 시간을 분리해서 기록
- 실패·메모리 부족 시 기존 휴리스틱 또는 수동 편집으로 복구
- 사용자 원본 이미지를 서버로 전송하지 않음
- 자동 인식 성공 안내는 약 3초 후 사라짐

현재 `sample_map.png`처럼 720×527px인 선명한 컬러 도면이 품질 검사에서 차단되지 않아야 한다. 모델 입력은 원본 화소 수가 아니라 640×480 또는 768×576으로 정규화한다. 고해상도 원본은 학습 라벨 품질에는 유리하지만 브라우저 추론 tensor로 그대로 사용하지 않는다.

## 8. 모델과 학습 설정

### 8.1 기준 모델

첫 모델은 `torchvision.models.segmentation.lraspp_mobilenet_v3_large`를 사용한다.

- ImageNet pretrained backbone 사용 가능
- segmentation head는 AI Hub STR 클래스 수로 교체
- 640×480 고정 입력부터 시작
- loss는 class-weighted cross entropy와 Dice 계열 조합을 초기 후보로 사용
- AMP 혼합정밀도 사용
- early stopping은 validation 핵심 지표로 결정
- best checkpoint와 last checkpoint를 모두 보존

전체 mIoU만 최적화하면 벽과 background가 문·창 오류를 가린다. 모델 선택 score는 벽 IoU, 여닫이문 F1, 창호 F1, 제외 문 오탐률을 함께 사용한다.

### 8.2 augmentation

허용:

- 작은 밝기·대비·채도 변화
- 가벼운 JPEG 열화와 blur
- 작은 scale·translation
- 90도 단위 회전은 제품 입력에서 실제 발생 가능할 때만 사용
- 선 두께 변화에 해당하는 제한적 morphology augmentation

금지 또는 매우 제한:

- 문 열림 방향을 파괴하는 임의 elastic transform
- 얇은 문·창을 없애는 강한 downscale/blur
- 실제 도면에 없는 강한 perspective
- 라벨 polygon과 불일치하는 이미지 전용 변환

### 8.3 클래스 불균형

- 픽셀 빈도 역수만 그대로 쓰지 말고 median-frequency 또는 capped weight 사용
- 희귀 미닫이문·기타문 포함 이미지를 sampler에서 oversample
- 문·창 주변 crop을 보조 batch로 사용할 수 있으나 전체 도면 batch도 유지
- excluded class를 background로 합치지 않음
- `occluded=true`를 무조건 폐기하지 말고 별도 성능을 보고 ignore 여부 결정

### 8.4 대안 모델로 넘어가는 조건

LR-ASPP 1,500장 기준에서 다음 문제가 반복될 때 BiSeNetV2를 동일 split으로 비교한다.

- 얇은 창호 마스크가 resize 후 지속적으로 끊김
- 벽 교차점과 짧은 벽 복원력이 부족함
- 문·창 recall을 높이면 오탐이 급격히 증가함
- 768px 입력에서도 boundary F1이 포화됨

대안 모델은 같은 데이터, 같은 split, 같은 후처리로 비교한다. 모델을 바꾸면서 평가 집합이나 threshold 정책까지 동시에 바꾸지 않는다.

## 9. 후처리와 제품 데이터 변환

모델은 픽셀 마스크를 출력하지만 앱은 편집 가능한 벽 선분과 개구부가 필요하다.

```text
모델 마스크
  → 작은 connected component 제거
  → 벽 마스크 closing
  → 벽 중심선 또는 평행 경계선 추출
  → 수평·수직 및 근접 선분 병합
  → 문·창 component 추출
  → 가장 가까운 부모 벽에 투영
  → 여닫이문·창만 후보 생성
  → 미닫이문·기타문 제거
  → 앱 좌표계로 역변환
```

OpenCV는 모델을 대체하는 인식기가 아니라 이 후처리에 사용한다. 브라우저에서는 전체 OpenCV.js를 기본 번들에 넣지 않는다. 먼저 TypeScript로 필요한 morphology, connected component, 선분 병합을 구현하고 부족할 때 Web Worker에서 최소 OpenCV.js 빌드를 lazy load한다.

모델과 현재 휴리스틱의 관계는 다음 순서로 운영한다.

1. 모델 추론 성공: 모델 마스크를 주 후보로 사용하고 기하 후처리 적용
2. 모델 저신뢰 또는 런타임 실패: 기존 휴리스틱 결과를 제공하거나 수동 편집 안내
3. 회귀 테스트 기간: 모델과 휴리스틱을 둘 다 실행해 결과를 로그에서 비교하되 사용자에게 중복 표시하지 않음

## 10. 평가 지표와 초기 합격 기준

### 10.1 데이터·학습 파이프라인

| 항목 | 합격 기준 |
| --- | --- |
| 이미지·JSON 매칭 | 선택 표본 100% |
| 미등록 label attribute | 0건 |
| mask 좌표와 이미지 정렬 | 육안 100장 오류 0건 |
| 20장 overfit | train mIoU 0.95 이상 |
| split 중복 | duplicate group 교차 0건 |
| 재현성 | 동일 seed manifest hash 동일 |

### 10.2 모델 정확도

다음 값은 첫 go/no-go 목표이며 실제 validation 분포를 확인한 뒤 변경 사유를 기록할 수 있다.

| 항목 | 초기 목표 |
| --- | ---: |
| 벽체 IoU | 0.85 이상 |
| 여닫이문 instance F1 | 0.80 이상 |
| 전체 창호 instance F1 | 0.80 이상 |
| 미닫이문→일반문 오탐률 | 5% 이하 |
| 창호→일반문 혼동률 | 5% 이하 |
| 부모 벽에 연결된 문·창 비율 | 95% 이상 |

Instance match는 단순 bbox IoU만 쓰지 않는다. 예측 개구부의 부모 벽, 벽 위 중심점 거리, 길이 overlap과 유형을 함께 사용한다. 벽은 pixel IoU뿐 아니라 선분 길이 precision/recall과 endpoint 오차도 보고한다.

### 10.3 제품 회귀

고정 회귀 fixture마다 눈으로 작성한 기대값을 JSON으로 보존한다.

- `sample_map.png`: 기존에 인식되던 벽·일반문·창 회귀 방지
- 사용자가 제공한 대표 컬러 도면
- 발코니·미닫이문이 많은 도면
- 문과 창 기호가 가까운 도면
- 작은 720×527px 도면
- 선명한 흑백 도면은 지원 정책에 따라 통과 또는 명시적 거절

개인 도면 원본은 Git에 넣지 않고 로컬 fixture manifest에서 참조한다. 공개 가능한 합성 fixture만 저장소 테스트에 포함한다.

### 10.4 성능

모델 캐시 후 end-to-end 시간을 측정한다. 이미지 decode, resize, model load, inference, postprocess를 각각 기록한다.

| 환경 | P50 목표 | P95 목표 |
| --- | ---: | ---: |
| RTX 4060 데스크톱 Chrome WebGPU | 2초 이하 | 4초 이하 |
| 일반 데스크톱 WASM | 4초 이하 | 7초 이하 |
| 중급 Android Chrome | 5초 이하 | 10초 이하 |
| iPhone Safari WASM | 8초 이하 | 10초 이하 |
| 최초 모델 다운로드 | 별도 기록 | UX에서 준비 상태 표시 |

추가 측정:

- peak JS/WASM memory
- 모델 파일 크기
- 첫 다운로드 크기와 시간
- UI main-thread long task
- 10회 연속 실행 시 메모리 증가
- WebGPU 실패 후 WASM fallback 성공 여부

저사양 기기에서 P95 10초를 넘으면 512 또는 640 입력을 자동 선택하고, threshold와 정확도를 별도 보고한다.

## 11. 테스트 행렬

| 범주 | 조건 |
| --- | --- |
| Python | unit test, schema 오류, 잘못된 polygon, 누락 pair |
| 데이터 | 20장 Sample, 2,000장 split, 희귀 클래스, 중복 그룹 |
| 모델 | 20장 overfit, 학습 곡선, test 300장, 양자화 전후 |
| 후처리 | 벽 병합, 부모 벽 연결, 미닫이문 제외, 좌표 역변환 |
| 데스크톱 | Chrome WebGPU, Edge WebGPU, Safari/Firefox WASM 가능 범위 |
| 모바일 웹 | Android Chrome, iPhone Safari |
| 앱 | 향후 Android NNAPI, iOS CoreML 선택 검증 |
| 실패 복구 | 모델 404, 캐시 손상, WebGPU 오류, WASM 오류, 메모리 부족 |
| UX | 진행 표시, 취소, 3초 성공 안내, 수동 편집 유지 |

테스트 보고서는 최소 다음 표를 포함한다.

```text
run_id / commit / model hash / manifest hash / device
class별 IoU
문·창 instance precision / recall / F1
제외 문 오탐률
도면별 실패 목록과 overlay
P50 / P95 latency
peak memory
PyTorch ↔ ONNX 정확도 차이
```

## 12. 예상 소요시간

RTX 4060과 한 명의 개발자, 데이터 접근이 준비됐다는 기준이다.

| 작업 | 예상 |
| --- | ---: |
| Windows/WSL/CUDA 환경 구축 | 0.5~1일 |
| 데이터 감사·라벨 매핑 | 1~2일 |
| manifest·중복·층화 표본 도구 | 2~4일 |
| 마스크 생성·overlay 검증 | 2~3일 |
| 20장 overfit과 오류 수정 | 1~2일 |
| 250~1,500장 학습 곡선 | 2~4일 |
| 모델·loss·augmentation 2~3회 개선 | 3~7일 |
| ONNX·INT8 변환과 일치성 | 2~3일 |
| React/Web Worker 통합 | 3~5일 |
| 모바일·데스크톱 브라우저 검증 | 3~5일 |
| 오류 분석과 최종 재학습 | 5~10일 |

- 학습 파이프라인 PoC: 약 3~5일
- 정확도 수치가 있는 첫 모델: 약 2~3주
- 웹 통합과 기기 검증을 포함한 배포 후보: 약 5~7주
- SPA 보조 학습: 첫 STR 모델 안정화 뒤 약 1~2주 추가

RTX 4060에서 1,500장, 640px, LR-ASPP의 40~60 epoch 학습 1회는 설정에 따라 대략 1~4시간 범위를 목표로 한다. 실제 첫 250장 run의 images/sec로 다시 산정하고 보고서에 실측값을 기록한다.

## 13. 산출물과 버전 관리

Git에 포함:

- Python 소스와 테스트
- 설정 예제와 label mapping
- manifest 생성 규칙과 schema
- 학습·평가 보고서의 개인정보 제거 요약
- ONNX metadata
- 앱 통합 코드
- 작업 기록

Git에 포함하지 않음:

- AI Hub 원본 archive와 이미지·JSON
- 사용자 도면
- 생성 마스크 전체
- checkpoint와 optimizer state
- 로컬 절대경로
- API 키와 토큰
- 라이선스상 재배포가 허용되지 않은 모델 파일

모델 파일을 제품 저장소에 넣기 전 AI Hub 이용정책과 모델 가중치 배포 가능 범위를 확인한다. 원본 데이터 라이선스와 PyTorch·모델 코드 라이선스는 별개다.

각 실험 artifact는 다음 구조를 따른다.

```text
artifacts/runs/<run-id>/
├── resolved-config.yaml
├── environment.json
├── manifest-hashes.json
├── train-history.csv
├── best.pt
├── last.pt
├── metrics.json
├── confusion-matrix.csv
├── overlays/
└── report.md
```

## 14. 중단·확장 판단

### 1,500장에서 멈춰도 되는 조건

- 1,000→1,500장에서 핵심 지표 향상이 모두 1%p 미만
- test와 실사용 회귀 도면이 초기 목표를 충족
- 희귀 문 유형이 충분히 평가됨
- 모바일 P95가 10초 이내
- 주요 오류가 데이터 부족보다 제품 후처리 문제로 분류됨

### 2,500~3,000장으로 확대할 조건

- 특정 스타일이나 복잡도에서 recall이 계속 낮음
- 희귀 속성 평가 인스턴스가 부족함
- 학습 곡선이 계속 유의미하게 상승함
- 과적합 없이 validation loss가 더 개선될 여지가 있음

### SPA 보조 학습으로 넘어갈 조건

- 벽은 잘 인식하지만 공간 경계에서 연결 오류가 반복됨
- 외벽 창호와 내부 개구부 구분이 불안정함
- 침실–발코니 경계의 미닫이문 제외 성능이 부족함
- STR 데이터 추가로 개선이 포화됨

SPA 이미지가 STR 이미지와 정확히 짝지어지지 않으면 공유 encoder에 task별 batch를 번갈아 넣고, 존재하는 라벨의 loss만 계산한다. 첫 제품 추론에서는 SPA head를 제거하거나 비활성화해 지연을 늘리지 않는다.

## 15. Windows 새 작업 시작용 전달문

새 Windows 프로젝트에서 다음 메시지와 실제 경로 두 개를 제공하면 된다.

```text
docs/WINDOWS_STR_TRAINING_RUNBOOK.md를 기준으로 FP/STR 자동인식 학습 프로젝트를 구축해줘.

학습 프로젝트 경로: <WINDOWS_OR_WSL_PROJECT_PATH>
AI Hub 데이터 경로: <WINDOWS_OR_WSL_DATA_PATH>
React 앱 경로: <WINDOWS_OR_WSL_APP_PATH>

먼저 원본을 변경하지 않는 데이터 감사를 실행하고 APT/FP/STR의 실제 폴더 구조, 이미지/JSON pair 수, attributes 분포를 보고해줘. 그다음 이 문서의 CLI 계약과 테스트를 구현하고, 20장 overfit이 통과한 뒤에만 250→500→1,000→1,500장 학습 곡선을 실행해줘. test 300장은 학습과 threshold 조정에 사용하지 말고, 모든 실행의 manifest hash·환경·성능을 저장해줘. 개인 도면과 AI Hub 원본은 Git에 추가하지 마.
```

## 16. 공식 참고 자료

- [AI Hub 건축 도면 데이터와 통계·라벨 포맷](https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&dataSetSn=71465&topMenu=100)
- [PyTorch Windows 설치와 CUDA 선택](https://pytorch.org/get-started/locally/)
- [Torchvision LR-ASPP MobileNetV3-Large](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.segmentation.lraspp_mobilenet_v3_large.html)
- [ONNX Runtime Web 설치와 브라우저 실행 제공자 지원표](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
- [ONNX Runtime Android NNAPI 실행 제공자](https://onnxruntime.ai/docs/execution-providers/NNAPI-ExecutionProvider.html)
- [ONNX Runtime Apple CoreML 실행 제공자](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)
- [MMSegmentation과 BiSeNetV2 대안](https://github.com/open-mmlab/mmsegmentation)
- [기존 휴리스틱·OpenCV 고도화 검토](RECOGNITION_ROADMAP.md)

## 17. 최종 체크리스트

```text
[ ] APT/FP/STR만 선택했다.
[ ] 원본 세부 attributes를 label map에 보존했다.
[ ] 미닫이문·기타문을 background로 합치지 않았다.
[ ] 이미지/JSON 1:1 감사에 통과했다.
[ ] 유사 도면을 그룹화한 뒤 split했다.
[ ] train 1,500 / val 200 / test 300 manifest를 고정했다.
[ ] 100장 mask overlay를 육안 확인했다.
[ ] 20장 overfit mIoU 0.95를 통과했다.
[ ] 250/500/1,000/1,500 학습 곡선을 동일 split으로 측정했다.
[ ] 벽 IoU 외에 문·창 instance F1과 제외 문 오탐을 측정했다.
[ ] PyTorch와 ONNX 결과 일치성을 확인했다.
[ ] INT8 정확도 하락과 속도 이득을 함께 기록했다.
[ ] 모델 캐시 후 모바일·데스크톱 P50/P95를 측정했다.
[ ] iPhone Safari WASM fallback을 확인했다.
[ ] 실패 시 기존 휴리스틱 또는 수동 편집으로 복구된다.
[ ] AI Hub 데이터와 개인 도면을 Git에 포함하지 않았다.
[ ] 보고서에 Git SHA, manifest hash, 모델 hash, 실행 환경이 남았다.
```
