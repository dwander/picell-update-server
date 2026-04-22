# PiCell Update Server

GitHub Releases 기반 자동 업데이트 서버입니다. 클라이언트가 업데이트 여부를 확인하고, 다운로드를 수행하면 GitHub 에셋 URL로 리다이렉트합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `GITHUB_OWNER` | `dwander` | GitHub 사용자명 또는 조직명 |
| `GITHUB_REPO` | `picell-releases` | 릴리즈가 올라오는 저장소명 |
| `GITHUB_TOKEN` | (없음) | GitHub Personal Access Token (rate limit 방지용, 선택) |
| `STATS_PASSWORD` | (없음) | 통계 대시보드 접근 비밀번호 (미설정 시 통계 비활성화) |
| `DB_PATH` | `data.db` | SQLite 데이터베이스 파일 경로 |

---

## API 엔드포인트

### `GET /`

서버 상태 확인 (헬스체크).

**응답**
```json
{ "status": "ok", "service": "picell-update-server" }
```

---

### `GET /update/check`

클라이언트가 현재 버전 대비 업데이트 가능 여부를 확인합니다.

**쿼리 파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `platform` | 필수 | 플랫폼 (`windows`) |
| `version` | 필수 | 현재 설치된 버전 (예: `1.0.0` 또는 `v1.0.0`) |
| `channel` | 선택 | `stable` (기본값) 또는 `beta` |

**요청 예시**
```
GET /update/check?platform=windows&version=1.0.0
GET /update/check?platform=windows&version=1.0.0&channel=beta
```

**응답**
```json
{
  "updateAvailable": true,
  "channel": "stable",
  "latest": {
    "version": "1.2.0",
    "name": "PiCell v1.2.0",
    "notes": "릴리즈 노트 내용",
    "publishedAt": "2025-01-01T00:00:00Z",
    "prerelease": false,
    "downloadUrl": "/update/download/windows?channel=stable",
    "fileSize": 84123456
  }
}
```

- `channel=beta`이고 베타 릴리즈가 없으면 `404` 반환
- `fileSize`는 바이트 단위

---

### `GET /update/download/:platform`

GitHub 에셋 URL로 302 리다이렉트합니다. 리다이렉트 전에 다운로드 이력을 기록합니다.

**경로 파라미터**

| 파라미터 | 설명 |
|----------|------|
| `platform` | 플랫폼 (`windows`) |

**쿼리 파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `channel` | 선택 | `stable` (기본값) 또는 `beta` |
| `machineId` | 선택 | PC 고유 식별자. 제공 시 같은 버전에 대해 최초 1회만 카운트 |

**요청 예시**
```
GET /update/download/windows
GET /update/download/windows?channel=beta
GET /update/download/windows?machineId=ABC123-UNIQUE-ID
GET /update/download/windows?channel=beta&machineId=ABC123-UNIQUE-ID
```

**응답**
- `302 Found` — GitHub 에셋 직접 다운로드 URL로 리다이렉트
- `404 Not Found` — 해당 플랫폼/채널의 에셋 없음

---

## 통계 대시보드

`STATS_PASSWORD` 환경 변수가 설정된 경우에만 활성화됩니다.  
Basic Auth 인증 정보: username `admin`, password는 `STATS_PASSWORD` 값.

### `GET /stats`

브라우저용 HTML 대시보드. 60초마다 자동 갱신됩니다.

- 전체 다운로드 수
- 버전별 다운로드 수
- 플랫폼별 다운로드 수
- 최근 30일 일별 다운로드 차트

### `GET /api/stats`

통계 데이터를 JSON으로 반환합니다.

**응답**
```json
{
  "total": 1234,
  "byVersion": [
    { "version": "1.2.0", "count": 800 },
    { "version": "1.1.0", "count": 434 }
  ],
  "byPlatform": [
    { "platform": "windows", "count": 1234 }
  ],
  "daily": [
    { "date": "2025-01-01", "count": 42 },
    { "date": "2025-01-02", "count": 37 }
  ]
}
```

---

## 릴리즈 채널

| 채널 | GitHub 릴리즈 타입 | API 파라미터 |
|------|-------------------|--------------|
| 안정 (stable) | 정식 릴리즈 | `channel=stable` (기본값) |
| 베타 (beta) | Pre-release | `channel=beta` |

GitHub에서 릴리즈 생성 시 **Pre-release** 체크박스를 선택하면 베타 채널로 제공됩니다.  
릴리즈 정보는 5분간 캐싱됩니다.

---

## 실행

```bash
# 의존성 설치
npm install

# 개발 서버
npm run dev

# 빌드
npm run build

# 프로덕션 실행
node dist/index.js
```
