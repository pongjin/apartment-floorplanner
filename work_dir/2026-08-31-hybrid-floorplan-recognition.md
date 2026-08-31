# 하이브리드 AI 평면도 자동 인식 적용

- 날짜: 2026-08-31
- 관련 커밋: 이 기록을 포함하는 커밋
- 커밋 제목: `feat: add hybrid AI floor plan recognition`

## 배경과 목표

휴리스틱-only 자동 인식은 벽 연결은 비교적 안정적이지만 문·창 기호 분류와 미닫이문 처리에 한계가 있었다. AI Hub STR 전이학습 모델의 문·창 분류력을 사용하면서 기존 휴리스틱 벽 그래프의 연속성을 유지하는 하이브리드 인식을 기본 자동 인식으로 적용하는 것이 목표다.

## 변경 내용

- 기존 `floorPlanDetection.ts`를 `src/legacy/floorPlanDetectionHeuristic.ts`로 이동해 휴리스틱-only 코드를 보존
- LRASPP 체크포인트를 opset 18 단일 파일 ONNX로 변환하고 `public/models`에 추가
- ONNX Runtime Web WASM 의존성과 버전 고정 런타임 자산 추가
- 벽은 휴리스틱 결과만 사용하고 AI 클래스 3~8의 문·창 연결요소만 제품 후보로 변환
- 문은 실제 유한 벽 선분 거리, 창은 같은 방향 벽 축으로 스냅
- 벽 범위·거리·짧은 고립 창·코너 창 필터와 중복 개구부 제거 적용
- 미닫이문·기타문·창 세부 분류명과 AI 확률을 저장·표시
- 자동 인식 모듈을 동적 import해 초기 앱 로딩에서 모델 런타임을 제외
- README, 프로젝트 현황, 인식 로드맵, 배포 문서와 전용 설계 문서 갱신

## 영향

자동 인식 버튼은 약 13.1MB ONNX 모델과 약 11.2MB WASM 런타임을 최초 한 번 내려받아 브라우저에서 추론한다. 도면은 서버로 전송하지 않는다. 기존 IndexedDB 스키마에는 optional 필드만 추가해 호환성을 유지하며, 과거 자동 미닫이문 보정은 새 AI 분류명이 없는 레거시 데이터에만 적용한다.

## 검증

- PyTorch와 ONNX Runtime CPU 출력 비교: `[1, 9, 480, 640]`, 최대 절대 오차 `2.17e-05`
- TypeScript project build 성공
- Vite production build 성공
- 배포 산출물에 ONNX 13,080,219 bytes와 WASM 11,210,254 bytes 포함 확인
- 로컬 production preview에서 앱, 모델, WASM HTTP 200 확인
- WASM Content-Type `application/wasm` 확인
- ONNX Runtime Web WASM 실제 추론: 입력 `image`, 출력 `logits [1, 9, 480, 640]`, 2,764,800 values
- Chromium production bundle 샘플 도면 추론: 벽 17개, 문 5개, 창 3개 생성 및 확인 후보의 부모 벽 연결 성공

## 배포

- 기능 브랜치 `feat/hybrid-floorplan-detection`과 `main`에 구현 커밋 `11a1362`를 push
- Vercel 빌드 상태는 성공했지만 동일 SHA를 기능 브랜치에 먼저 push해 Preview 배포가 먼저 생성되었고, 고정 Production 도메인은 이전 번들을 유지하는 현상 확인
- 이 작업 기록 갱신 커밋을 `main` 전용 새 SHA로 push해 Production 배포를 다시 트리거
- 배포 완료 후 고정 도메인의 번들 해시와 ONNX·MJS·WASM 정적 자산 응답을 재검증

## 남은 한계

- 객체 단위 정답 fixture가 없어 서비스 도면 precision/recall은 아직 산출하지 않았다.
- 첫 자동 인식은 약 24MB 다운로드와 모바일 CPU 추론으로 시간이 더 걸릴 수 있다.
- 벽 휴리스틱과 AI 후보는 모두 사용자 검토·수정이 필요한 보조 결과다.
- 모바일 Safari와 다양한 Android 기기의 실제 추론 시간·peak memory 회귀 측정이 후속 과제다.
