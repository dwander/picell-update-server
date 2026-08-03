# v1 → v2 마이그레이션 절차

기존 배포(GitHub Releases 프록시)를 R2 배포 관리 앱으로 전환하는 순서.
**클라이언트 API는 호환되므로 앱을 먼저 고칠 필요가 없다.**

---

## 0. 사전 준비 (배포 전)

### R2 버킷

1. Cloudflare R2에 `picell-one` 버킷 생성.
   `photo-works`(picell-works-cloud용)와 **분리** — 이유는 [architecture.md §2](architecture.md#2-왜-버킷을-분리했나-picell-one--photo-works).
2. API 토큰 발급 (Object Read & Write, `picell-one` 스코프).
3. **CORS 설정** — 안 하면 콘솔 업로드가 브라우저에서 조용히 실패한다.
   `infra/r2-cors.json`의 `AllowedOrigins`를 실제 Railway 도메인으로 바꾼 뒤:
   ```bash
   wrangler r2 bucket cors set picell-one --file infra/r2-cors.json
   ```
   또는 Cloudflare 대시보드 → R2 → picell-one → Settings → CORS Policy에 붙여넣기.

### Railway 볼륨 (필수)

릴리즈 메타와 통계가 SQLite 한 파일에 있다. 볼륨이 없으면 재배포마다 전부 사라진다.

1. 서비스에 볼륨을 붙이고 마운트 경로를 `/data`로 지정.
2. 환경변수 `DB_PATH=/data/update.db`.
3. **기존 통계를 살리려면** 현재 인스턴스의 `data.db`를 볼륨으로 옮긴다.
   (안 옮기면 다운로드 이력이 0부터 시작한다. 릴리즈 메타는 v1에 없었으므로 손실 없음.)

### 환경변수

```
ADMIN_PASSWORD=<새 비밀번호>          # 기존 STATS_PASSWORD도 폴백으로 동작
DB_PATH=/data/update.db
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=…
STORAGE_SECRET_ACCESS_KEY=…
STORAGE_BUCKET=picell-one
STORAGE_PUBLIC_BASE_URL=            # 커스텀 도메인 붙였으면 설정 (선택)
GITHUB_OWNER=dwander                # 임포트가 끝나면 지워도 됨
GITHUB_REPO=picell-releases
GITHUB_TOKEN=…                      # 레이트 리밋 회피용 (선택)
```

---

## 1. 배포

빌드가 2단계(`vite build` → `dist/public`, `tsc` → `dist`)로 늘었지만 `npm run build`
하나에 묶여 있고 `nixpacks.toml`도 갱신돼 있다. **서비스는 하나 그대로.**

헬스체크 경로는 `/healthz`다(`railway.json`에 반영됨). 다만 `/`도 200을 돌려주므로
대시보드에 구 설정(`/`)이 남아 있어도 배포가 막히지 않는다.

배포 후 확인:

```bash
curl https://<도메인>/healthz
# {"status":"ok","service":"picell-update-server","storage":"picell-one"}
```

`storage`가 `null`이면 STORAGE_* 환경변수가 덜 들어간 것이다.

---

## 2. 과거 릴리즈 임포트

`/admin` 로그인 → **도구** → **릴리즈 조회**.

1. GitHub 레포의 릴리즈 목록이 뜬다. 분류 불가 에셋은 목록에 따로 표시된다.
2. 필요한 버전마다 **가져오기**. 서버가 에셋을 R2로 스트리밍 복사한다(용량에 따라 수 분).
3. 가져온 릴리즈는 **초안** 상태다. **릴리즈** 화면에서 내용을 확인하고 발행한다.

> 최신 안정 버전 하나, 최신 베타 하나만 가져와도 서비스는 정상 동작한다.
> 과거 버전 전체를 옮길지는 다운로드 이력 보존 목적에 따라 결정하면 된다.

---

## 3. 전환 확인

**최소 하나의 릴리즈를 발행하기 전까지** `/update/check`는 `latest: null`을 돌려준다
(v1처럼 502를 내지는 않지만, 클라이언트가 업데이트를 못 받는 상태다).
발행 직후 실제 응답으로 확인:

```bash
curl "https://<도메인>/update/check?platform=windows&version=1.0.0"
# updateAvailable / latest.version / latest.downloadUrl 확인

curl -sI "https://<도메인>/update/download/windows" | grep -i location
# R2(또는 커스텀 도메인) URL로 302 되는지 확인
```

기존 클라이언트가 그대로 동작하는지 실제 앱으로 한 번 확인한 뒤 GitHub 릴리즈를
정리하는 것을 권한다.

---

## 4. 정리 (선택)

- 이관이 끝나면 `GITHUB_*` 환경변수를 지워도 서비스는 정상 동작한다
  (도구 화면의 임포트 기능만 비활성화된다).
- **스토리지** 화면에서 고아/누락 파일을 점검한다. 임포트 중 끊긴 잔재가 있으면 여기서 보인다.

---

## 클라이언트 앱에서 추가로 쓸 수 있는 것 (선택)

전부 하위 호환이라 안 고쳐도 되지만, 고치면 얻는 것:

| 추가 | 얻는 것 |
|------|---------|
| `machineId` 파라미터 전달 | 단계적 배포 대상이 되고, 설치 버전 통계가 잡힌다 |
| `mandatory` 응답 처리 | 강제 업데이트를 서버에서 제어할 수 있다 |
| `sha256` 검증 | 다운로드 무결성 확인 |
| `items` 렌더 | 타입별 아이콘·색으로 릴리즈 노트 표시 |
| `/update/changelog?since=` | 여러 버전 건너뛴 사용자에게 누적 변경점 표시 |
