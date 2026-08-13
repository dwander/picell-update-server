// 릴리즈 도메인. 구 버전은 GitHub Releases API를 매 요청 조회하고 5분 캐시로
// 버텼지만(레이트 리밋 → 502 장애), 이제 릴리즈 메타는 우리 DB가, 바이너리는
// R2가 1차 출처다. 외부 의존이 사라져 캐시·스테일 폴백 자체가 불필요해졌다.

import { db, newId } from "../db/index.js";
import { artifacts, changelogs, downloads, releases } from "../db/schema.js";
import type { ArtifactRow, ReleaseRow } from "../db/schema.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { compareVersions, isValidVersion, normalizeVersion } from "../version.js";
import { deleteChangelogs, getChangelog } from "./changelog.js";
import { deleteByPrefix } from "./storage.js";
import {
  LOCALES,
  type Arch,
  type ArtifactDTO,
  type ArtifactKind,
  type Channel,
  type DownloadCountAdjustment,
  type Locale,
  type Platform,
  type ReleaseDTO,
  type ReleaseStatus,
  type ReleaseSummaryDTO,
} from "../types.js";

/** 다운로드 엔드포인트가 아티팩트를 하나만 고를 때의 선호 순서. */
const KIND_PREFERENCE: ArtifactKind[] = ["installer", "portable", "zip", "other", "blockmap"];

export class ReleaseError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ─── 집계 ────────────────────────────────────────────────────────────────────

function downloadCountsByRelease(): Map<string, number> {
  const rows = db
    .select({ releaseId: downloads.releaseId, count: sql<number>`count(*)` })
    .from(downloads)
    .groupBy(downloads.releaseId)
    .all();
  const map = new Map<string, number>();
  for (const r of rows) if (r.releaseId) map.set(r.releaseId, r.count);
  return map;
}

function downloadCountsByArtifact(releaseId: string): Map<string, number> {
  const rows = db
    .select({ artifactId: downloads.artifactId, count: sql<number>`count(*)` })
    .from(downloads)
    .where(eq(downloads.releaseId, releaseId))
    .groupBy(downloads.artifactId)
    .all();
  const map = new Map<string, number>();
  for (const r of rows) if (r.artifactId) map.set(r.artifactId, r.count);
  return map;
}

// ─── 매핑 ────────────────────────────────────────────────────────────────────

function toArtifactDTO(row: ArtifactRow, downloadCount: number): ArtifactDTO {
  return {
    id: row.id,
    releaseId: row.releaseId,
    platform: row.platform as Platform,
    arch: row.arch as Arch,
    kind: row.kind as ArtifactKind,
    fileName: row.fileName,
    storageKey: row.storageKey,
    size: row.size,
    sha256: row.sha256,
    contentType: row.contentType,
    status: row.status === "ready" ? "ready" : "uploading",
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    downloadCount,
  };
}

export function listArtifacts(releaseId: string): ArtifactRow[] {
  return db.select().from(artifacts).where(eq(artifacts.releaseId, releaseId)).all();
}

export function toReleaseDTO(row: ReleaseRow): ReleaseDTO {
  const counts = downloadCountsByArtifact(row.id);
  const artifactRows = listArtifacts(row.id);
  return {
    id: row.id,
    version: row.version,
    channel: row.channel as Channel,
    name: row.name,
    status: row.status as ReleaseStatus,
    mandatory: row.mandatory,
    minSupportedVersion: row.minSupportedVersion,
    rolloutPercent: row.rolloutPercent,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    artifacts: artifactRows.map((a) => toArtifactDTO(a, counts.get(a.id) ?? 0)),
    changelogs: LOCALES.map((l) => getChangelog(row.id, l)),
    downloadCount: [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

/** 최신 버전이 앞. 같은 버전은 있을 수 없다(version unique). */
function sortByVersionDesc<T extends { version: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareVersions(b.version, a.version));
}

export function listReleaseRows(): ReleaseRow[] {
  return sortByVersionDesc(db.select().from(releases).all());
}

export function listReleaseSummaries(): ReleaseSummaryDTO[] {
  const rows = listReleaseRows();
  if (rows.length === 0) return [];
  const dlCounts = downloadCountsByRelease();
  const ids = rows.map((r) => r.id);
  const artifactRows = db.select().from(artifacts).where(inArray(artifacts.releaseId, ids)).all();
  const summaryRows = db
    .select()
    .from(changelogs)
    .where(and(inArray(changelogs.releaseId, ids), eq(changelogs.locale, "ko")))
    .all();
  const summaryByRelease = new Map(summaryRows.map((r) => [r.releaseId, r.summary]));

  return rows.map((r) => {
    const mine = artifactRows.filter((a) => a.releaseId === r.id);
    return {
      id: r.id,
      version: r.version,
      channel: r.channel as Channel,
      name: r.name,
      status: r.status as ReleaseStatus,
      mandatory: r.mandatory,
      rolloutPercent: r.rolloutPercent,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      artifactCount: mine.length,
      totalBytes: mine.reduce((sum, a) => sum + a.size, 0),
      platforms: [...new Set(mine.map((a) => a.platform as Platform))],
      downloadCount: dlCounts.get(r.id) ?? 0,
      summary: summaryByRelease.get(r.id) ?? "",
    };
  });
}

export function getReleaseRow(id: string): ReleaseRow | undefined {
  return db.select().from(releases).where(eq(releases.id, id)).get();
}

export function getReleaseRowByVersion(version: string): ReleaseRow | undefined {
  return db.select().from(releases).where(eq(releases.version, normalizeVersion(version))).get();
}

export function requireReleaseRow(id: string): ReleaseRow {
  const row = getReleaseRow(id);
  if (!row) throw new ReleaseError("릴리즈를 찾을 수 없습니다.", 404);
  return row;
}

// ─── 생성·수정 ───────────────────────────────────────────────────────────────

export interface CreateReleaseInput {
  version: string;
  channel: Channel;
  name?: string;
  mandatory?: boolean;
  minSupportedVersion?: string | null;
  rolloutPercent?: number;
}

export function createRelease(input: CreateReleaseInput): ReleaseDTO {
  const version = normalizeVersion(input.version);
  if (!isValidVersion(version)) {
    throw new ReleaseError(`올바른 semver가 아닙니다: ${input.version}`);
  }
  if (getReleaseRowByVersion(version)) {
    throw new ReleaseError(`이미 존재하는 버전입니다: ${version}`, 409);
  }
  const now = new Date();
  const row = {
    id: newId(),
    version,
    channel: input.channel,
    name: input.name?.trim() || `PiCell One ${version}`,
    status: "draft" as const,
    mandatory: input.mandatory ?? false,
    minSupportedVersion: normalizeOptionalVersion(input.minSupportedVersion),
    rolloutPercent: clampPercent(input.rolloutPercent ?? 100),
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(releases).values(row).run();
  return toReleaseDTO(row as ReleaseRow);
}

export interface UpdateReleaseInput {
  channel?: Channel;
  name?: string;
  mandatory?: boolean;
  minSupportedVersion?: string | null;
  rolloutPercent?: number;
  status?: ReleaseStatus;
}

export function updateRelease(id: string, input: UpdateReleaseInput): ReleaseDTO {
  const row = requireReleaseRow(id);
  const patch: Partial<ReleaseRow> = { updatedAt: new Date() };

  if (input.channel !== undefined) patch.channel = input.channel;
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.mandatory !== undefined) patch.mandatory = input.mandatory;
  if (input.minSupportedVersion !== undefined) {
    patch.minSupportedVersion = normalizeOptionalVersion(input.minSupportedVersion);
  }
  if (input.rolloutPercent !== undefined) patch.rolloutPercent = clampPercent(input.rolloutPercent);

  if (input.status !== undefined && input.status !== row.status) {
    if (input.status === "published") {
      assertPublishable(row);
      // 최초 발행 시각만 남긴다 — 재발행으로 게시일이 밀리면 이력이 왜곡된다.
      patch.publishedAt = row.publishedAt ?? new Date();
    }
    patch.status = input.status;
  }

  db.update(releases).set(patch).where(eq(releases.id, id)).run();
  return toReleaseDTO(requireReleaseRow(id));
}

/** 발행 전 최소 조건: 업로드가 끝난 아티팩트가 최소 1개. */
function assertPublishable(row: ReleaseRow): void {
  const ready = db
    .select({ count: sql<number>`count(*)` })
    .from(artifacts)
    .where(and(eq(artifacts.releaseId, row.id), eq(artifacts.status, "ready")))
    .get();
  if ((ready?.count ?? 0) === 0) {
    throw new ReleaseError("업로드 완료된 아티팩트가 없어 발행할 수 없습니다.");
  }
}

function normalizeOptionalVersion(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const n = normalizeVersion(v);
  if (!n) return null;
  if (!isValidVersion(n)) throw new ReleaseError(`올바른 semver가 아닙니다: ${v}`);
  return n;
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 릴리즈와 R2 오브젝트를 함께 삭제한다. 스토리지 실패는 삼키지 않고 알린다. */
export async function deleteRelease(id: string): Promise<{ deletedObjects: number }> {
  const row = requireReleaseRow(id);
  const deletedObjects = await deleteByPrefix(`releases/${row.version}/`);
  db.delete(artifacts).where(eq(artifacts.releaseId, id)).run();
  deleteChangelogs(id);
  db.delete(releases).where(eq(releases.id, id)).run();
  // 다운로드 이력은 통계를 위해 남긴다(version 문자열로 계속 집계 가능).
  return { deletedObjects };
}

// ─── 다운로드 수 보정 ────────────────────────────────────────────────────────

/**
 * 보정으로 넣은 다운로드 행의 표시. `user_agent`는 어떤 집계에도 쓰이지 않아 표시를
 * 넣어도 숫자가 흔들리지 않고, 나중에 실제 기록과 구분해 먼저 지울 수 있다.
 */
export const ADJUSTED_DOWNLOAD_UA = "admin:manual-adjust";

/** 한 릴리즈에 지정할 수 있는 다운로드 수 상한. 오타 한 번에 행 수십만 개가 생기지 않게 막는다. */
export const DOWNLOAD_COUNT_MAX = 10_000;

/** 한 번의 insert에 담을 행 수 — SQLite 바인딩 파라미터 한도(32766) 안에 넉넉히 든다. */
const INSERT_CHUNK = 500;

/**
 * 릴리즈의 다운로드 수를 `count`로 맞춘다. 통계 정리로 실수로 지운 기록을 되살리기 위한
 * 보정 도구다 — 원래 행의 machineId·IP·시각은 복구할 수 없어 **숫자만** 맞춘다.
 *
 * 오프셋 칼럼 하나로 처리하지 않는 이유: 다운로드 집계가 버전별·플랫폼별·채널별·일별로
 * 여러 벌인데 오프셋은 그중 일부에만 반영돼 카드끼리 숫자가 어긋난다. 실제 행을 넣고
 * 빼면 기존 집계는 손대지 않아도 맞는다.
 */
export function setReleaseDownloadCount(id: string, count: number): DownloadCountAdjustment {
  const row = requireReleaseRow(id);
  if (!Number.isInteger(count) || count < 0 || count > DOWNLOAD_COUNT_MAX) {
    throw new ReleaseError(`다운로드 수는 0 이상 ${DOWNLOAD_COUNT_MAX} 이하의 정수여야 합니다.`);
  }

  const current = countReleaseDownloads(id);
  const diff = count - current;
  if (diff === 0) return { version: row.version, downloadCount: current, added: 0, removed: 0 };

  if (diff > 0) {
    // 보정 행의 시각은 발행일로 둔다. 오늘로 찍으면 "일별 다운로드"에 없던 봉우리가 생긴다.
    const at = row.publishedAt ?? row.createdAt;
    const platform = inferDownloadPlatform(id);
    db.transaction((tx) => {
      for (let done = 0; done < diff; done += INSERT_CHUNK) {
        const size = Math.min(INSERT_CHUNK, diff - done);
        tx.insert(downloads)
          .values(
            Array.from({ length: size }, () => ({
              version: row.version,
              platform,
              channel: row.channel,
              arch: null,
              releaseId: row.id,
              artifactId: null,
              ip: null,
              userAgent: ADJUSTED_DOWNLOAD_UA,
              machineId: null,
              downloadedAt: at,
            })),
          )
          .run();
      }
    });
    return { version: row.version, downloadCount: count, added: diff, removed: 0 };
  }

  // 줄일 때는 보정 행부터 지운다. machineId·IP가 남은 실제 기록이 정보가 더 많아 오래
  // 남길 가치가 있고, 그마저 지워야 할 때는 최근 것부터 — 되돌리기 쉬운 순서다.
  db.run(sql`
    delete from downloads
     where id in (
       select id from downloads
        where release_id = ${row.id}
        order by (case when user_agent = ${ADJUSTED_DOWNLOAD_UA} then 1 else 0 end) desc,
                 downloaded_at desc, id desc
        limit ${-diff}
     )
  `);
  return { version: row.version, downloadCount: count, added: 0, removed: -diff };
}

function countReleaseDownloads(releaseId: string): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(downloads)
      .where(eq(downloads.releaseId, releaseId))
      .get()?.count ?? 0
  );
}

/**
 * 보정 행에 넣을 플랫폼. `platform`은 NOT NULL이라 무엇이든 정해야 하는데 틀린 값을
 * 넣으면 "플랫폼별" 카드가 뒤틀린다. 남아 있는 기록의 최다 플랫폼 → 릴리즈 아티팩트의
 * 플랫폼 → `unknown` 순으로 고른다.
 */
function inferDownloadPlatform(releaseId: string): string {
  const fromDownloads = db
    .select({ platform: downloads.platform, count: sql<number>`count(*)` })
    .from(downloads)
    .where(eq(downloads.releaseId, releaseId))
    .groupBy(downloads.platform)
    .orderBy(desc(sql`count(*)`))
    .get();
  if (fromDownloads) return fromDownloads.platform;

  const fromArtifacts = db
    .select({ platform: artifacts.platform })
    .from(artifacts)
    .where(eq(artifacts.releaseId, releaseId))
    .get();
  return fromArtifacts?.platform ?? "unknown";
}

// ─── 채널 해석 (클라이언트 업데이트 확인의 핵심) ─────────────────────────────

export interface ResolvedRelease {
  release: ReleaseRow;
  artifact: ArtifactRow | null;
}

/**
 * 채널·플랫폼에 대해 배포 가능한 최신 릴리즈를 고른다.
 * - published 상태만 후보 (draft/archived 제외)
 * - beta 채널은 beta ∪ stable 중 최신 — 안정 버전이 더 높으면 그쪽을 준다(구 동작 승계)
 * - 해당 플랫폼 아티팩트가 없는 릴리즈는 건너뛰고 그 아래 버전을 본다
 */
export function resolveLatest(
  channel: Channel,
  platform: Platform,
  arch: Arch,
): ResolvedRelease | null {
  const candidateChannels: Channel[] = channel === "beta" ? ["beta", "stable"] : ["stable"];
  const rows = sortByVersionDesc(
    db
      .select()
      .from(releases)
      .where(and(eq(releases.status, "published"), inArray(releases.channel, candidateChannels)))
      .all(),
  );

  for (const row of rows) {
    const artifact = pickArtifact(listArtifacts(row.id), platform, arch);
    if (artifact) return { release: row, artifact };
  }
  return null;
}

/** 플랫폼·아키텍처에 맞는 대표 아티팩트. arch 정확 일치 > universal > 그 외. */
export function pickArtifact(
  rows: ArtifactRow[],
  platform: Platform,
  arch: Arch,
): ArtifactRow | null {
  const ready = rows.filter((a) => a.status === "ready" && a.platform === platform);
  if (ready.length === 0) return null;

  const archScore = (a: ArtifactRow): number =>
    a.arch === arch ? 0 : a.arch === "universal" ? 1 : 2;
  const kindScore = (a: ArtifactRow): number => {
    const idx = KIND_PREFERENCE.indexOf(a.kind as ArtifactKind);
    return idx === -1 ? KIND_PREFERENCE.length : idx;
  };

  return (
    [...ready].sort((a, b) => archScore(a) - archScore(b) || kindScore(a) - kindScore(b))[0] ?? null
  );
}

/**
 * 발행된 릴리즈를 버전으로 찾는다. 채널은 따지지 않는다 — 버전을 콕 집어 요청했다면
 * 그게 beta든 stable이든 그 릴리즈를 가리킨다. 초안·철회본(draft/archived)은 제외한다.
 */
export function findPublishedRowByVersion(version: string): ReleaseRow | null {
  const row = getReleaseRowByVersion(normalizeVersion(version));
  return row && row.status === "published" ? row : null;
}

/**
 * 릴리즈에 포함된 파일을 **이름으로** 찾는다.
 *
 * 클라이언트가 임의의 파일명을 보내와도 후보는 그 릴리즈에 등록된 아티팩트 행뿐이고,
 * 실제 다운로드에 쓰는 키는 DB의 `storageKey`다 — 요청 문자열이 키를 만들지 않으므로
 * 경로 탈출·키 인젝션이 성립하지 않는다.
 *
 * 파일명 비교는 대소문자를 무시한다(같은 파일을 `App.pdb`/`app.pdb`로 부르는 관행).
 * `platform`·`arch`는 **요구가 아니라 힌트**다. 같은 이름의 아티팩트가 플랫폼별로
 * 여럿일 때만 좁히는 데 쓰고, 좁힌 결과가 비면 무시한다 — "릴리즈에 그 파일이 있으면
 * 준다"가 이 조회의 규칙이기 때문이다.
 */
export function findArtifactByFileName(
  releaseId: string,
  fileName: string,
  hint: { platform?: Platform | undefined; arch?: Arch | undefined } = {},
): ArtifactRow | null {
  const wanted = fileName.trim().toLowerCase();
  if (!wanted) return null;

  let rows = listArtifacts(releaseId).filter(
    (a) => a.status === "ready" && a.fileName.toLowerCase() === wanted,
  );
  if (rows.length === 0) return null;

  if (hint.platform) {
    const narrowed = rows.filter((a) => a.platform === hint.platform);
    if (narrowed.length > 0) rows = narrowed;
  }
  if (hint.arch) {
    const narrowed = rows.filter((a) => a.arch === hint.arch);
    if (narrowed.length > 0) rows = narrowed;
  }
  return rows[0] ?? null;
}

export interface MandatoryResolution {
  required: boolean;
  /** 강제 조건을 처음 건 릴리즈 버전. 클라이언트가 이유를 안내하는 데 쓴다. */
  since: string | null;
}

/**
 * 강제 업데이트 여부를 **현재 버전과 최신 버전 사이 구간 전체**로 판정한다.
 *
 * 최신 릴리즈의 플래그만 보면, 중간 릴리즈에 걸어둔 강제 조건이 다음 릴리즈를
 * 올리는 순간 조용히 사라진다 — 1.5.0을 필수로 지정해도 1.6.0을 그냥 내보내면
 * 1.0.0 사용자는 거절 가능한 안내만 받고 미지원 버전에 남는다.
 * 그래서 (현재, 최신] 구간에 강제 조건을 건 릴리즈가 하나라도 있으면 강제로 본다.
 * **받는 파일은 여전히 최신본 하나**다 — 중간 버전을 거쳐 올라가지 않는다.
 *
 * 구간 안쪽도 **`resolveLatest`와 같은 기준으로 릴리즈의 존재를 판정한다** — 그 플랫폼에
 * 받을 아티팩트가 없는 릴리즈는 그 플랫폼에 존재하지 않는 것으로 친다. 예전에는 플랫폼을
 * 따지지 않았는데(정책은 빌드 유무와 무관하다는 생각), 그러면 한쪽 OS 만 낸 릴리즈의 강제가
 * **다음에 반대쪽 OS 빌드를 올리는 순간 되살아난다** — 상한이 올라가면서 건너뛴 릴리즈가
 * 구간에 들어오기 때문이다. 받을 수도 없었던 버전을 근거로 강제되는 셈이라 규칙을 맞췄다.
 *
 * 그래서 "이 버전 미만 미지원" 을 전 플랫폼에 걸고 싶으면 **그 플랫폼에 실제로 나가는
 * 릴리즈**에 `mandatory`/`minSupportedVersion` 을 건다.
 */
export function resolveMandatory(
  channel: Channel,
  currentVersion: string,
  latestVersion: string,
  platform: Platform,
  arch: Arch,
): MandatoryResolution {
  const triggers = listPublishedRows(channel)
    .filter(
      (r) =>
        compareVersions(r.version, currentVersion) > 0 &&
        compareVersions(r.version, latestVersion) <= 0 &&
        (r.mandatory ||
          (r.minSupportedVersion
            ? compareVersions(currentVersion, r.minSupportedVersion) < 0
            : false)) &&
        // 아티팩트 조회는 DB 를 타므로 버전·플래그 검사를 통과한 소수 행에만 돌도록 마지막에 둔다.
        pickArtifact(listArtifacts(r.id), platform, arch) !== null,
    )
    // 가장 낮은(먼저 조건을 건) 릴리즈를 근거로 남긴다.
    .sort((a, b) => compareVersions(a.version, b.version));

  const first = triggers[0];
  return { required: Boolean(first), since: first?.version ?? null };
}

/** 발행된 릴리즈를 최신순으로 (체인지로그 피드용). */
export function listPublishedRows(channel: Channel): ReleaseRow[] {
  const candidateChannels: Channel[] = channel === "beta" ? ["beta", "stable"] : ["stable"];
  return sortByVersionDesc(
    db
      .select()
      .from(releases)
      .where(and(eq(releases.status, "published"), inArray(releases.channel, candidateChannels)))
      .all(),
  );
}

/** 관리 콘솔 타임라인용 — 상태 무관 전체, 최신순. */
export function listChangelogTimeline(locale: Locale) {
  return listReleaseRows().map((row) => ({
    id: row.id,
    version: row.version,
    channel: row.channel as Channel,
    name: row.name,
    status: row.status as ReleaseStatus,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    changelog: getChangelog(row.id, locale),
  }));
}
