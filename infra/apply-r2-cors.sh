#!/usr/bin/env bash
# picell-one 버킷에 CORS 규칙을 적용한다.
# 관리 콘솔은 presigned PUT으로 브라우저에서 R2에 직접 업로드하므로, 이 설정이
# 없으면 업로드가 브라우저 단계에서 CORS 오류로 실패한다(서버 로그엔 안 남는다).
#
# 사용법:
#   1) infra/r2-cors.json의 AllowedOrigins를 실제 도메인으로 수정
#   2) wrangler r2 bucket cors set picell-one --file infra/r2-cors.json
# 또는 Cloudflare 대시보드 → R2 → picell-one → Settings → CORS Policy에 붙여 넣기.
set -euo pipefail
BUCKET="${STORAGE_BUCKET:-picell-one}"
wrangler r2 bucket cors set "$BUCKET" --file "$(dirname "$0")/r2-cors.json"
