#!/usr/bin/env bash
# 로컬 개발 서버 일괄 실행 — API(3000) + 관리 콘솔 HMR(5173).
#
# 콘솔은 vite dev 서버에서 열고(HMR), /admin/api·/update 요청만 API로 프록시된다
# (vite.config.ts). 그래서 **접속은 5173**이고 3000은 API 전용이다.
#
# 사용법:
#   pnpm dev:local              # API + 콘솔
#   pnpm dev:local --api-only   # API만 (콘솔 빌드본을 3000에서 그대로 볼 때)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${PORT:-3000}"
WEB_PORT=5173
ENV_FILE="$ROOT/.env"

API_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --api-only) API_ONLY=1 ;;
    *) echo "알 수 없는 인자: $arg (지원: --api-only)" >&2; exit 2 ;;
  esac
done

fail() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }

# --- 의존성 프리플라이트 -----------------------------------------------------
[ -d node_modules ] || fail "의존성이 설치되지 않았습니다." "pnpm install"

# pnpm 10+는 네이티브 빌드 스크립트를 기본 차단한다. better-sqlite3가 이에 걸리면
# 서버가 부팅 중 "Could not locate the bindings file"로 죽는다 — 미리 잡는다.
if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  fail "better-sqlite3 네이티브 바인딩을 불러올 수 없습니다." \
       "pnpm이 빌드 스크립트를 차단했을 가능성이 큽니다. 아래 중 하나로 해결하세요:" \
       "  pnpm rebuild better-sqlite3" \
       "  pnpm approve-builds        # 대화형으로 허용" \
       "(package.json의 pnpm.onlyBuiltDependencies에 이미 등록돼 있습니다)"
fi

# vite 8의 번들러(rolldown) 네이티브 바인딩 — 없으면 콘솔 빌드가 죽는다.
if [ "$API_ONLY" -eq 0 ]; then
  node scripts/ensure-native-deps.mjs
fi

# --- 환경변수 프리플라이트 ---------------------------------------------------
ENV_ARG=()
if [ -f "$ENV_FILE" ]; then
  ENV_ARG=(--env-file="$ENV_FILE")
  echo "✓ .env 로드"

  if ! grep -qE '^(ADMIN_PASSWORD|STATS_PASSWORD)=.+' "$ENV_FILE"; then
    echo "⚠ ADMIN_PASSWORD가 비어 있어 관리 콘솔이 비활성화됩니다 (.env에 추가하세요)."
  fi
  if ! grep -qE '^STORAGE_ENDPOINT=.+' "$ENV_FILE"; then
    echo "⚠ STORAGE_* 미설정 — 릴리즈 조회·통계는 되지만 업로드는 막힙니다."
  fi
  # 운영 버킷을 공유해도 로컬 업로드가 운영 스캔에 섞이지 않게 프리픽스를 권한다.
  if grep -qE '^STORAGE_ENDPOINT=.+' "$ENV_FILE" && ! grep -qE '^STORAGE_KEY_PREFIX=.+' "$ENV_FILE"; then
    echo "⚠ STORAGE_KEY_PREFIX가 없습니다. 운영 버킷을 쓴다면 .env에 STORAGE_KEY_PREFIX=dev/ 를 권합니다."
  fi
else
  echo "⚠ .env가 없습니다 (cp .env.example .env). 환경변수 없이 시작합니다."
fi

# 로컬 DB는 운영 파일과 절대 섞이지 않게 .data/ 아래에 따로 둔다.
mkdir -p "$ROOT/.data"
export DB_PATH="${DB_PATH:-$ROOT/.data/dev.db}"
echo "✓ DB: $DB_PATH"

# --- 실행 --------------------------------------------------------------------
PIDS=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "▶ API      http://localhost:${API_PORT}"
# 프로세스 치환으로 로그 프리픽스를 붙인다. `cmd | sed &` 형태로 쓰면 $!가 sed의
# PID라서 정리 트랩이 정작 tsx/vite를 못 죽이고 고아로 남긴다.
DB_PATH="$DB_PATH" PORT="$API_PORT" \
  "$ROOT/node_modules/.bin/tsx" watch "${ENV_ARG[@]}" src/index.ts \
  > >(sed "s/^/[api] /") 2>&1 &
PIDS+=($!)

if [ "$API_ONLY" -eq 1 ]; then
  echo "▶ 콘솔은 실행하지 않습니다 (--api-only). 빌드본을 보려면 pnpm build:web 후 http://localhost:${API_PORT}/admin"
else
  echo "▶ 콘솔     http://localhost:${WEB_PORT}/admin  ← 여기로 접속"
  "$ROOT/node_modules/.bin/vite" --port "$WEB_PORT" --strictPort \
    > >(sed "s/^/[web] /") 2>&1 &
  PIDS+=($!)
fi

# 어느 한쪽이 죽으면 전체를 내린다 (반쪽만 떠 있는 상태를 만들지 않는다).
wait -n
echo "✗ 프로세스 하나가 종료되어 전체를 내립니다." >&2
