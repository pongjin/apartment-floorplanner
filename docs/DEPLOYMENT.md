# 배포 및 운영 인수인계

최종 갱신: 2026-08-29

## 운영 주소

| 항목 | 주소 / 값 |
| --- | --- |
| Production | https://apartment-floorplanner.vercel.app |
| GitHub | https://github.com/pongjin/apartment-floorplanner |
| GitHub 기본 브랜치 | `main` |
| Vercel Scope | `pongs` |
| Vercel Project | `apartment-floorplanner` |
| Framework | Vite + React |
| Build Command | `pnpm build` |
| Output Directory | `dist` |

GitHub 저장소는 공개 상태이며 Vercel GitHub 앱과 연결되어 있습니다. `main` 브랜치에 push하면 Vercel Production 배포가 자동 생성되고 고정 도메인에 승격됩니다.

## 최초 배포 완료 내역

1. 프로젝트 폴더를 독립 Git 저장소로 초기화
2. 실행·구조·구현 현황 문서 작성
3. GitHub `pongjin/apartment-floorplanner` 저장소 생성 및 push
4. Vercel `pongs/apartment-floorplanner` 프로젝트 생성
5. 프로덕션 빌드 및 고정 별칭 연결
6. Vercel GitHub 앱 설치 후 저장소 연결
7. 검증 커밋 `908a1f8`을 push해 Git 기반 자동 배포가 `Ready`가 되는 것 확인
8. `https://apartment-floorplanner.vercel.app`의 HTTP 200 응답과 브라우저 초기 화면 확인

## 일반 배포 절차

기능 작업을 완료한 뒤 다음 순서로 배포합니다.

```bash
pnpm install --frozen-lockfile
pnpm build
git status
git add <changed-files>
git commit -m "<type>: <summary>"
git push origin main
```

push 이후 Vercel이 자동으로 다음 작업을 수행합니다.

```text
GitHub main push
  → Vercel Production build
  → pnpm install
  → pnpm build
  → dist 배포
  → apartment-floorplanner.vercel.app 갱신
```

## 수동 배포

Git 연동 장애 또는 긴급 재배포 시 프로젝트 루트에서 다음 명령을 사용할 수 있습니다.

```bash
vercel link --yes --project apartment-floorplanner
vercel deploy --prod --yes
```

`.vercel/`과 Vercel이 생성하는 `.env.local`은 로컬 연결 정보이므로 Git에 포함하지 않습니다.

## 배포 상태 확인

```bash
vercel ls apartment-floorplanner
vercel inspect apartment-floorplanner.vercel.app
curl -I https://apartment-floorplanner.vercel.app
```

정상 상태의 기준:

- Vercel Deployment: `Ready`
- Target: `production`
- Production alias: `https://apartment-floorplanner.vercel.app`
- HTTP status: `200`
- 브라우저 콘솔에 애플리케이션 오류가 없음

## 환경변수와 데이터

- 애플리케이션 실행에 필수인 서버 환경변수는 없습니다.
- 사용자 도면과 프로젝트 상태는 각 브라우저의 IndexedDB에 저장됩니다.
- Vercel 배포 간 데이터베이스 마이그레이션은 필요하지 않습니다.
- 도메인이 바뀌면 브라우저 origin이 달라져 기존 IndexedDB 데이터가 보이지 않으므로 고정 Production 도메인을 사용합니다.
- `.env.local`에 생성될 수 있는 Vercel OIDC 정보는 외부 공유나 Git 커밋 대상이 아닙니다.

## 롤백

코드 기준 롤백:

```bash
git revert <commit>
git push origin main
```

Vercel 대시보드에서 이전 정상 Deployment를 선택해 Promote하는 방법도 사용할 수 있습니다. 이 경우 Git의 `main` 상태와 실제 Production Deployment가 달라질 수 있으므로 이후 코드 상태를 반드시 맞춥니다.

## 문제 해결

### GitHub push 후 배포가 생성되지 않는 경우

1. Vercel Project Settings → Git에서 `pongjin/apartment-floorplanner` 연결 여부 확인
2. GitHub의 Vercel 앱 설정에서 해당 저장소 접근 권한 확인
3. Vercel Deployments에서 ignored build 또는 권한 오류 확인
4. 필요 시 `vercel git disconnect` 후 대시보드에서 다시 연결

### 빌드는 성공하지만 화면이 열리지 않는 경우

1. Output Directory가 `dist`인지 확인
2. Vercel build log의 `pnpm build` 결과 확인
3. 정적 자산 경로가 `/assets/...` 형태인지 확인
4. 브라우저 콘솔과 Network 탭의 404 확인

### 로컬과 배포 결과가 다른 경우

```bash
git rev-parse HEAD
git status
vercel ls apartment-floorplanner
```

배포가 참조한 Git commit과 로컬 `HEAD`를 비교하고, 추적되지 않은 로컬 변경이 없는지 확인합니다.

## 운영상 알려진 사항

- 3D 번들 크기로 인해 Vite의 chunk size 경고가 발생하지만 현재 배포 실패 요인은 아닙니다.
- 브라우저 로컬 저장 방식이므로 서버 백업·계정 동기화·기기 간 이전은 제공하지 않습니다.
- 자동 배포 연결 과정에서 생성된 빈 Vercel 프로젝트 `build_house`는 실제 서비스와 무관합니다. 운영 프로젝트는 반드시 `apartment-floorplanner`를 사용합니다. 빈 프로젝트 삭제는 Vercel 대시보드에서 별도로 수행할 수 있습니다.
