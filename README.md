# PiCell Update Server

PiCell One 데스크톱 앱의 **업데이트 배포 서버 + 관리 콘솔**입니다.
바이너리는 Cloudflare R2(`picell-one` 버킷)에 두고, 릴리즈·체인지로그·통계를 웹 콘솔에서 관리합니다.

> **v2 리뉴얼:** 이전 버전은 GitHub Releases를 매 요청 조회해 응답했고(레이트 리밋 → 502),
> 릴리즈 노트는 GitHub 본문 평문이었으며, 관리 화면은 읽기 전용 통계 페이지가 전부였습니다.
> 지금은 배포의 1차 출처가 R2 + 자체 DB이고, GitHub는 과거 릴리즈를 한 번 끌어오는
> [임포트 도구](#github-임포트)로만 남았습니다. 마이그레이션은 [docs/migration.md](docs/migration.md) 참고.

```
브라우저(관리 콘솔) ──presigned PUT──▶ R2 picell-one
        │                                    ▲
        │ /admin/api                         │ 302
        ▼                                    │
   Hono 서버 (Railway) ◀──/update/*──── 데스크톱 앱
        │
        └── SQLite (릴리즈 메타 · 체인지로그 · 통계)
```

---

## 빠른 시작

```bash
npm ci                  # 의존성 기준은 npm (package-lock.json)
cp .env.example .env    # ADMIN_PASSWORD와 STORAGE_* 채우기

pnpm dev:local          # API(3000) + 콘솔 HMR(5173) 한 번에 → http://localhost:5173/admin
pnpm build && pnpm start     # 프로덕션 빌드 후 실행 → http://localhost:3000/admin
pnpm typecheck          # tsc + svelte-check
```

> **설치는 npm으로 맞춥니다.** Railway 빌드가 `npm ci`를 쓰므로 로컬도 같은
> 락파일을 따라야 운영과 버전이 갈리지 않습니다. 스크립트 실행은 `pnpm run`이든
> `npm run`이든 동일하게 동작합니다(스크립트에 패키지 매니저 호출이 없습니다).
> `pnpm install`로 설치해도 돌아가긴 하지만(`pnpm-workspace.yaml`의 `allowBuilds`가
> 네이티브 빌드를 허용) `pnpm-lock.yaml`은 추적하지 않습니다.

`dev:local`은 두 프로세스를 함께 띄우고 로그에 `[api]` / `[web]` 프리픽스를 붙이며,
Ctrl+C 한 번에 둘 다 정리합니다. 한쪽이 죽으면 나머지도 내려 반쪽만 떠 있는 상태를
만들지 않습니다. 시작 전에 다음을 점검하고, 문제가 있으면 해결 방법을 알려줍니다:

- `.env` 로드 (Node의 `--env-file`, 별도 dotenv 의존성 없음)
- `better-sqlite3` 네이티브 바인딩 — **pnpm 10+는 빌드 스크립트를 기본 차단**합니다.
  `package.json`의 `pnpm.onlyBuiltDependencies`에 등록해 뒀지만, 그래도 막혔다면
  `pnpm rebuild better-sqlite3`로 해결합니다.
- `rolldown` 네이티브 바인딩 (콘솔 빌드용)
- `ADMIN_PASSWORD` · `STORAGE_*` 설정 여부

**접속은 5173입니다.** 3000은 API 전용이고, 콘솔은 vite dev 서버가 열되
`/admin/api`·`/update` 요청만 3000으로 프록시합니다.
로컬 DB는 `.data/dev.db`로 분리되고, `--api-only`로 API만 띄울 수도 있습니다.

> 운영 R2 버킷을 로컬에서 함께 쓴다면 `.env`에 `STORAGE_KEY_PREFIX=dev/`를 넣으세요.
> 로컬 업로드가 운영 스토리지 스캔에 섞이지 않습니다(미설정 시 경고가 뜹니다).

---

## 관리 콘솔 (`/admin`)

`ADMIN_PASSWORD`로 로그인합니다(httpOnly 세션 쿠키, 30일).

| 화면 | 하는 일 |
|------|---------|
| **대시보드** | 채널별 현재 배포 버전, 다운로드 추이, R2 사용량 |
| **릴리즈** | 릴리즈 생성·발행·철회·삭제, 아티팩트 업로드, 배포 설정 |
| **체인지로그** | 전체 릴리즈 노트 타임라인, 로케일 전환, `CHANGELOG.md` 형태로 복사 |
| **통계** | 다운로드 이력 + **설치 기반 현황**(실제로 돌고 있는 버전) |
| **스토리지** | R2 오브젝트 브라우저, 고아/누락 파일 점검·정리 |
| **도구** | GitHub Releases 임포트, 감사 로그 |

### 릴리즈 발행 흐름

1. **릴리즈 생성** — 버전(semver)과 채널을 정하면 `draft` 상태로 만들어집니다.
   설치 파일을 끌어다 놓으면 **파일명에서 버전·표시 이름·채널을 자동으로 채우고**,
   만든 직후 그 파일 업로드까지 그대로 이어집니다
   (`PiCell One-0.5.33-Setup.exe` → `0.5.33` / "PiCell One 0.5.33" / windows·x64).
   `-Setup` 같은 꼬리표를 프리릴리즈로 오해하지 않고, `-beta.2`만 베타 채널로 봅니다.
2. **아티팩트 업로드** — 파일을 끌어다 놓으면 브라우저가 presigned PUT으로 R2에 직접 올립니다.
   서버는 업로드 후 R2에서 파일을 되읽어 크기와 `sha256`을 확정합니다(클라이언트 보고를 믿지 않음).
3. **체인지로그 작성** — 항목(추가/개선/변경/수정/삭제/보안)으로 쓰거나 마크다운을 직접 씁니다.
   한국어·영문을 따로 관리하며, 클라이언트는 `locale` 파라미터로 골라 받습니다.
   앱의 `changelog.txt`를 끌어다 놓으면 **그 릴리즈 버전 블록만** 뽑아 채워 줍니다
   ([체인지로그 파일에서 가져오기](#체인지로그-파일에서-가져오기)).
4. **발행** — 업로드가 끝난 아티팩트가 하나도 없으면 발행이 거부됩니다.

### 배포 설정

| 설정 | 동작 |
|------|------|
| **채널** | `stable` / `beta`. 베타 채널 클라이언트는 안정 버전이 더 높으면 안정 버전을 받습니다. |
| **단계적 배포 (%)** | `machineId` 해시로 결정론적 분배 — 같은 PC는 같은 버전에 대해 판정이 바뀌지 않습니다. `machineId`를 보내지 않는 클라이언트는 100% 배포일 때만 대상입니다. |
| **강제 업데이트** | 이 릴리즈보다 낮은 모든 버전이 강제 대상. |
| **최소 지원 버전** | 지정값 미만만 강제 대상. 비우면 미적용. |
| (공통) | 두 설정은 **이후 릴리즈로 승계됩니다.** 1.5.0에 걸어두면 1.6.0·1.7.0을 올려도 1.5.0 미만 사용자는 계속 강제 대상입니다. 자세히는 [강제 업데이트 판정](#강제-업데이트-판정-mandatory--mandatorysince). |
| **철회(archived)** | 즉시 배포에서 내려가고 클라이언트는 그 아래 버전을 받습니다. |

---

## 클라이언트 API

**기존 계약을 그대로 유지합니다.** `/update/check`, `/update/download/:platform`의
파라미터·응답 필드는 v1과 호환되며 새 필드만 추가됐습니다.

### `GET /update/check`

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `platform` | 필수 | `windows` \| `macos` \| `linux` |
| `version` | 필수 | 현재 설치된 버전 (`1.0.0` 또는 `v1.0.0`) |
| `channel` | 선택 | `stable`(기본) \| `beta` |
| `arch` | 선택 | `x64`(기본) \| `arm64` \| `universal` |
| `locale` | 선택 | `ko`(기본) \| `en` |
| `machineId` | 선택 | PC 고유 식별자. **단계적 배포와 설치 통계에 필요** |

```json
{
  "updateAvailable": true,
  "channel": "stable",
  "mandatory": false,
  "mandatorySince": null,
  "latest": {
    "version": "2.0.0",
    "name": "PiCell One 2.0.0",
    "notes": "### 수정\n- 업데이트 중단 오류 수정",
    "summary": "안정성 개선",
    "items": [{ "type": "fixed", "text": "업데이트 중단 오류 수정" }],
    "publishedAt": "2026-08-03T15:39:17.000Z",
    "prerelease": false,
    "downloadUrl": "/update/download/windows?channel=stable&arch=x64",
    "fileName": "PiCellOne-2.0.0.exe",
    "fileSize": 90000000,
    "sha256": "…"
  }
}
```

발행된 릴리즈가 없으면 `latest`는 `null`입니다(v1은 502였습니다).
단계적 배포에서 빠진 클라이언트에게도 `latest`는 채워 보내고 `updateAvailable`만 `false`로 둡니다 —
앱이 "최신입니다"를 정확히 표시할 수 있게 하기 위함입니다.

#### 강제 업데이트 판정 (`mandatory` · `mandatorySince`)

**최신 릴리즈의 설정만 보지 않습니다.** 현재 버전과 최신 버전 **사이 구간
(현재 < v ≤ 최신)** 에 강제 조건을 건 릴리즈가 하나라도 있으면 `mandatory: true`입니다.
그러지 않으면 중간 릴리즈에 걸어둔 필수 지정이 다음 릴리즈를 올리는 순간
사라져, 오래된 사용자가 거절 가능한 안내만 받고 미지원 버전에 남습니다.

`mandatorySince`는 그 조건을 **처음 건 릴리즈 버전**입니다. 안내 문구에 쓰세요
("1.5.0의 보안 수정이 포함되어 업데이트가 필요합니다").

예 — 1.5.0에만 필수 지정, 이후 1.6.0·1.7.0은 일반 릴리즈:

| 현재 버전 | `mandatory` | `mandatorySince` | 받는 버전 |
|---|---|---|---|
| 1.0.0 | `true` | `1.5.0` | **1.7.0** |
| 1.4.5 | `true` | `1.5.0` | **1.7.0** |
| 1.5.0 | `false` | `null` | 1.7.0 |
| 1.7.0 | — (`updateAvailable: false`) | `null` | 1.7.0 |

**중간 버전을 거쳐 올라가지 않습니다.** 강제 여부만 구간 전체로 판정하고,
내려받는 파일은 언제나 최신본 하나입니다.

판정 기준 두 가지는 이렇게 다릅니다:

- **강제 업데이트** 플래그 — 그 릴리즈보다 낮은 **모든** 버전이 대상
- **최소 지원 버전** — 지정값 **미만**만 대상 (`minSupportedVersion: 1.4.0`이면
  1.3.9는 강제, 1.4.0은 아님)

강제 대상이면 단계적 배포에서 빠져 있어도 `updateAvailable: true`로 나갑니다.
플랫폼은 따지지 않습니다 — "이 버전 미만은 지원하지 않는다"는 선언은 특정
플랫폼에 빌드가 있었는지와 무관한 정책이기 때문입니다.

### `GET /update/download/:platform`

R2로 302 리다이렉트합니다. `STORAGE_PUBLIC_BASE_URL`이 있으면 그 도메인으로, 없으면 presigned GET으로.

| 파라미터 | 설명 |
|----------|------|
| `channel` | `stable`(기본) \| `beta` |
| `arch` | `x64`(기본) \| `arm64` \| `universal` |
| `machineId` | 제공 시 같은 버전에 대해 최초 1회만 카운트 |
| `version` | 특정 버전 고정 다운로드(구버전 재설치·롤백). 발행된 릴리즈만 대상 |

### `GET /update/changelog`

건너뛴 버전들의 변경점을 한 번에 보여줄 때 씁니다.

```
GET /update/changelog?channel=stable&locale=ko&since=1.9.0&limit=20
```

`since`보다 높은 발행 릴리즈만 최신순으로 반환합니다.

### `GET /update/latest`

다운로드 페이지·설치 스크립트용 요약(버전, 파일명, 크기, sha256, 다운로드 URL).

### `GET /healthz`

Railway 헬스체크용. `{ "status": "ok", "service": "…", "storage": "picell-one" }`

---

## 환경 변수

전체 목록과 설명은 [`.env.example`](.env.example)에 있습니다. 핵심만:

| 변수 | 필수 | 설명 |
|------|------|------|
| `ADMIN_PASSWORD` | 콘솔 사용 시 | 미설정이면 `/admin` 전체가 비활성화됩니다. 구 `STATS_PASSWORD`도 폴백으로 인식 |
| `DB_PATH` | **운영 필수** | Railway **볼륨 경로**를 지정할 것 (예: `/data/update.db`). 볼륨 없이 두면 재배포 때마다 릴리즈 메타와 통계가 사라집니다 |
| `STORAGE_ENDPOINT` | 업로드 시 | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | 업로드 시 | R2 API 토큰 |
| `STORAGE_BUCKET` | 업로드 시 | `picell-one` |
| `STORAGE_PUBLIC_BASE_URL` | 선택 | 공개 커스텀 도메인. 설정하면 다운로드가 캐시 가능해집니다 |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_TOKEN` | 임포트 시만 | 이관이 끝나면 지워도 서비스는 정상 동작합니다 |

### R2 버킷 준비

1. `picell-one` 버킷을 만듭니다. **`photo-works`(picell-works-cloud용)와 반드시 분리하세요** —
   그쪽의 고아 객체 정리 도구가 버킷 전체를 스캔하기 때문입니다.
2. **CORS를 설정합니다.** 콘솔이 브라우저에서 R2로 직접 업로드하므로 필수입니다.
   빠뜨리면 업로드가 브라우저 단계에서 실패하고 **서버 로그에는 아무것도 남지 않습니다.**
   ```bash
   # infra/r2-cors.json의 AllowedOrigins를 실제 도메인으로 바꾼 뒤
   wrangler r2 bucket cors set picell-one --file infra/r2-cors.json
   ```

### 스토리지 키 스키마

```
releases/{version}/{platform}-{arch}/{fileName}
```

릴리즈 삭제는 `releases/{version}/` 프리픽스 통삭제 한 번으로 끝납니다. **이 형태를 깨지 마세요.**

---

## 체인지로그 파일에서 가져오기

릴리즈 상세의 **체인지로그** 섹션에 앱의 `changelog.txt`를 끌어다 놓으면(또는 `파일에서
불러오기`) 파일을 버전 블록으로 갈라 **그 릴리즈의 버전 하나만** 편집기에 채웁니다.

```
## [0.5.33] 2026-07-18
### 개선
- 가져오기 후 빈 날짜 폴더가 생성되는 문제 수정
### 새 기능
- 자동 업데이트를 꺼도 새 버전 알림 표시
· 꼭 필요한 업데이트는 안내 후 자동으로 진행됩니다
```

- `## [버전] 날짜` 헤딩으로 블록을 나누고, `### 카테고리` / `- 항목` / `· 세부 설명`을 읽습니다.
- 파일에 그 버전 블록이 없으면 아무것도 바꾸지 않고 인식된 버전 목록을 알려줍니다.
- 채우기만 하고 **저장하지는 않습니다.** 미리보기로 확인한 뒤 `저장`을 눌러야 반영됩니다
  (편집 중인 내용이 있으면 덮어쓰기 전에 한 번 묻습니다).
- 카테고리는 한/영 이름을 항목 타입으로 자동 분류합니다(개선→improved, 새 기능→added,
  수정→fixed …). **분류표에 없는 제목(설정·UI·성능 등)도 정보가 사라지지 않습니다** —
  원문 마크다운을 그대로 함께 저장해 클라이언트에는 원래 구조가 나가고, 항목은
  구조화 표시용으로만 씁니다.

### 가운뎃점(`·`) 세부 설명

항목에 딸린 설명 줄은 앱 표기 그대로 `·`로 씁니다. 마크다운에는 그런 불릿 문자가 없어
그대로 두면 앞 항목에 이어붙은 한 문단이 되므로(들여쓰기·줄바꿈이 사라짐),
**렌더 직전에 두 칸 들여쓴 `- `로 바꿔 하위 목록**으로 내보냅니다. 저장되는 본문은 사람이
쓴 원문 그대로이고, 변환은 `renderNotes`(서버)와 콘솔 미리보기 양쪽에서 동일하게 일어납니다.
마크다운을 직접 쓸 때도 `·`로 시작한 줄이면 같게 동작합니다.

---

## GitHub 임포트

`도구 → GitHub Releases 임포트`에서 과거 릴리즈를 가져옵니다.

- 서버가 에셋을 직접 내려받아 R2로 스트리밍 업로드합니다(브라우저를 거치지 않음).
- 파일명으로 플랫폼·아키텍처를 추정하고, 추정 불가한 에셋은 건너뜁니다(목록에 표시됨).
- 릴리즈 본문은 마크다운 원문 그대로 보존하고, `### 섹션` / `- 항목` 형태는 체인지로그 항목으로도 파싱합니다.
- 가져온 릴리즈는 **초안** 상태로 들어옵니다. 발행은 사람이 확인 후 직접 합니다.
- 이미 있는 버전은 건드리지 않습니다(운영 중인 릴리즈 덮어쓰기 방지).

---

## 구 경로 호환

| 경로 | 처리 |
|------|------|
| `GET /` | 200 + `/admin`으로 meta refresh (헬스체크가 2xx를 요구해 302를 쓰지 않는다) |
| `GET /stats` | `/admin/stats`로 302 |
| `GET /api/stats` | Basic Auth(`admin` / `ADMIN_PASSWORD`) JSON 유지 |

---

## 프로젝트 구조

```
src/                    # Hono 서버
├── env.ts              # 환경변수를 읽는 유일한 곳
├── version.ts          # semver 파싱·비교 (프리릴리즈 우선순위 포함)
├── types.ts            # 서버↔콘솔 공유 타입의 단일 출처
├── db/                 # drizzle 스키마 + 부팅 시 멱등 마이그레이션
├── services/           # 도메인 로직 (릴리즈·아티팩트·체인지로그·스토리지·통계·인증)
└── routes/
    ├── update.ts       # 클라이언트 공개 API
    ├── legacy.ts       # 구 경로 호환
    └── admin/          # 관리 API (세션 인증 뒤)
web/                    # Svelte 5 + Tailwind 4 관리 콘솔 (→ dist/public)
infra/                  # R2 CORS 설정
docs/                   # 아키텍처·마이그레이션 노트
```

빌드는 `vite build`(콘솔 → `dist/public`) + `tsc`(서버 → `dist`) 두 단계이고,
Hono가 `dist/public`을 그대로 서빙하므로 **Railway 서비스는 하나 그대로**입니다.
