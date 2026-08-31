# 커밋 기반 작업 기록

이 폴더는 기능 구현, 버그 수정, 리팩터링, 문서·배포 변경을 커밋 단위로 추적합니다. 새 커밋을 만들기 전 [WORK_LOG_GUIDE.md](WORK_LOG_GUIDE.md)를 확인하고 해당 작업 기록과 이 인덱스를 함께 갱신합니다.

## 기록 목록

| 날짜 | 커밋 또는 연결 방식 | 작업 | 기록 |
| --- | --- | --- | --- |
| 2026-09-01 | 이 기록을 포함하는 커밋 | 도면 편집·가구 조작 UX 개선 | [2026-09-01-floorplan-furniture-ux.md](2026-09-01-floorplan-furniture-ux.md) |
| 2026-08-31 | 이 기록을 포함하는 커밋 | 하이브리드 AI 평면도 자동 인식 적용 | [2026-08-31-hybrid-floorplan-recognition.md](2026-08-31-hybrid-floorplan-recognition.md) |
| 2026-08-30 | 이 기록을 포함하는 커밋 | Windows FP/STR 학습·검증 실행서 작성 | [2026-08-30-windows-str-training-runbook.md](2026-08-30-windows-str-training-runbook.md) |
| 2026-08-30 | 이 기록을 포함하는 커밋 | 업로드 기준 완화 및 일반문·창 자동인식 회귀 개선 | [2026-08-30-recognition-heuristic-regression.md](2026-08-30-recognition-heuristic-regression.md) |
| 2026-08-30 | 이 기록을 포함하는 커밋 | 소개 문서 및 커밋 작업 기록 체계 구축 | [2026-08-30-documentation-workflow.md](2026-08-30-documentation-workflow.md) |
| 2026-08-30 | `ac8fed9` | 모바일 사용성·자동인식·업로드 품질 개선 | [2026-08-30-mobile-recognition.md](2026-08-30-mobile-recognition.md) |
| 2026-08-29 | `35c8832` | 배포 및 운영 인수인계 문서화 | Git 이력 참고 |
| 2026-08-29 | `908a1f8` | Vercel Git 자동 배포 검증 | Git 이력 참고 |
| 2026-08-29 | `02d57ad` | 프로덕션 주소 문서 반영 | Git 이력 참고 |
| 2026-08-29 | `73627f7` | 아파트 평면도 플래너 MVP 구축 | Git 이력 참고 |

## 커밋 찾기

기록 파일이 포함된 커밋은 다음 명령으로 확인합니다.

```bash
git log --oneline -- work_dir/<기록-파일>.md
```

프로젝트 전체 변경 흐름은 다음 명령으로 함께 확인할 수 있습니다.

```bash
git log --date=short --pretty=format:'%h %ad %s'
```
