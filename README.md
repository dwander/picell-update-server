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
pnpm install
cp .env.example .env    # ADMIN_PASSWORD와 STORAGE_* 채우기

pnpm dev:local          # API(3000) + 콘솔 HMR(5173) 한 번에 → http://localhost:5173/admin
pnpm build && pnpm start     # 프로덕션 빌드 후 실행 → http://localhost:3000/admin
pnpm typecheck          # tsc + svelte-check
```

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
   여러 버전을 한 번에 채우려면 [체인지로그 파일 임포트](#체인지로그-파일-임포트)를 쓰세요.
4. **발행** — 업로드가 끝난 아티팩트가 하나도 없으면 발행이 거부됩니다.

### 배포 설정

| 설정 | 동작 |
|------|------|
| **채널** | `stable` / `beta`. 베타 채널 클라이언트는 안정 버전이 더 높으면 안정 버전을 받습니다. |
| **단계적 배포 (%)** | `machineId` 해시로 결정론적 분배 — 같은 PC는 같은 버전에 대해 판정이 바뀌지 않습니다. `machineId`를 보내지 않는 클라이언트는 100% 배포일 때만 대상입니다. |
| **강제 업데이트** | 응답의 `mandatory`를 `true`로. |
| **최소 지원 버전** | 이 버전 미만 사용자만 강제 업데이트 대상. 단계적 배포에서 빠져 있어도 강제 대상이면 업데이트가 나갑니다. |
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

## 체인지로그 파일 임포트

`도구 → 체인지로그 파일 임포트`에서 앱의 `changelog.txt`를 올리면 버전별로 갈라
매칭되는 릴리즈에 한 번에 반영합니다. 릴리즈마다 노트를 옮겨 적을 필요가 없습니다.

```
## [0.5.33] 2026-07-18
### 개선
- 가져오기 후 빈 날짜 폴더가 생성되는 문제 수정
### 새 기능
- 자동 업데이트를 꺼도 새 버전 알림 표시
```

- `## [버전] 날짜` 헤딩으로 블록을 나누고, `### 카테고리` / `- 항목`을 읽습니다.
- `[latest]` 블록은 개발 중 버전이라 **건너뜁니다.** 해당 릴리즈가 없는 버전도 건너뜁니다
  (반영 전에 목록에서 무엇이 매칭됐는지 확인할 수 있습니다).
- 카테고리는 한/영 이름을 항목 타입으로 자동 분류합니다(개선→improved, 새 기능→added,
  수정→fixed …). **분류표에 없는 제목(설정·UI·성능 등)도 정보가 사라지지 않습니다** —
  원문 마크다운을 그대로 함께 저장해 클라이언트에는 원래 구조가 나가고, 항목은
  구조화 표시용으로만 씁니다.
- 반영은 **덮어쓰기**입니다. 기존에 작성한 노트가 있으면 사라집니다.

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
