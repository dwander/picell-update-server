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

WEB_PORT=5173
ENV_FILE="$ROOT/.env"

# .env에서 키 하나를 읽는다. Node의 --env-file은 **셸에 이미 있는 값을 덮지 않아**,
# 스크립트가 export한 값이 .env보다 우선한다. 그래서 PORT·DB_PATH처럼 여기서도
# 다루는 키는 .env 값을 먼저 읽어 존중해야 조용히 무시되는 일이 없다.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -nE "s/^$1=[\"']?([^\"']*)[\"']?[[:space:]]*$/\1/p" "$ENV_FILE" | tail -1
}

API_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --api-only) API_ONLY=1 ;;
    *) echo "알 수 없는 인자: $arg (지원: --api-only)" >&2; exit 2 ;;
  esac
done

fail() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }

# --- 의존성 프리플라이트 -----------------------------------------------------
# 의존성 기준은 npm(package-lock.json)이다. Railway 빌드도 npm ci를 쓴다.
# pnpm으로 설치해도 돌아가지만(pnpm-workspace.yaml의 allowBuilds 참고) 버전이
# 갈릴 수 있으므로 설치는 npm으로 맞추는 것을 권한다.
[ -d node_modules ] || fail "의존성이 설치되지 않았습니다." "npm ci"

# pnpm 10+는 네이티브 빌드 스크립트를 기본 차단한다. better-sqlite3가 이에 걸리면
# 서버가 부팅 중 "Could not locate the bindings file"로 죽는다 — 미리 잡는다.
#
# **require만으로는 못 잡는다.** 바인딩은 첫 `new Database()`에서 로드되므로
# require는 멀쩡히 성공한다. 실제 사용 시점까지 흉내 내야 의미가 있다.
if ! node -e "new (require('better-sqlite3'))(':memory:')" >/dev/null 2>&1; then
  fail "better-sqlite3 네이티브 바인딩을 불러올 수 없습니다." \
       "npm으로 다시 설치하면 해결됩니다 (이 프로젝트의 기준):" \
       "  npm ci" \
       "pnpm으로 설치했다면 빌드 스크립트가 차단된 것입니다:" \
       "  pnpm rebuild better-sqlite3" \
       "(pnpm-workspace.yaml의 allowBuilds 참고. pnpm 11부터 package.json의" \
       " pnpm 필드는 무시됩니다.)"
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

  # 따옴표가 안 닫힌 줄은 Node의 --env-file이 **다음 줄을 값으로 삼켜버린다.**
  # 그러면 뒤 변수가 통째로 사라지는데 아무 에러도 안 난다 — 미리 잡는다.
  UNBALANCED="$(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {
      v = substr($0, index($0, "=") + 1)
      n = gsub(/"/, "\"", v)
      if (n % 2 == 1) print NR": "$1
    }' "$ENV_FILE")"
  if [ -n "$UNBALANCED" ]; then
    fail ".env에 따옴표가 닫히지 않은 줄이 있습니다." \
         "$UNBALANCED" \
         "이 상태면 Node가 다음 줄까지 값으로 삼켜 뒤 변수가 조용히 사라집니다."
  fi

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

# 포트·DB 경로는 셸 > .env > 기본값 순으로 정한다.
API_PORT="${PORT:-$(env_value PORT)}"
API_PORT="${API_PORT:-3000}"

DB_PATH="${DB_PATH:-$(env_value DB_PATH)}"
if [ -z "$DB_PATH" ]; then
  # 아무 데도 지정이 없을 때만 로컬 전용 위치를 쓴다.
  DB_PATH="$ROOT/.data/dev.db"
  echo "✓ DB: $DB_PATH (기본값 — .env의 DB_PATH로 바꿀 수 있습니다)"
else
  echo "✓ DB: $DB_PATH"
fi
mkdir -p "$(dirname "$DB_PATH")"
export DB_PATH

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
