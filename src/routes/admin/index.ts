// 관리 API 마운트. /admin/api/* 전체가 세션 인증 뒤에 있고, 로그인 엔드포인트만
// 예외다(authRouter는 index.ts에서 이 라우터보다 먼저 마운트된다).

import { Hono } from "hono";
import { requireAuth } from "../helpers.js";
import { releasesRouter } from "./releases.js";
import { artifactsRouter } from "./artifacts.js";
import { opsRouter } from "./ops.js";
import { isStorageConfigured, bucketName, storagePrefix } from "../../services/storage.js";
import { isGithubConfigured } from "../../services/github.js";

export const adminRouter = new Hono();

adminRouter.use("*", requireAuth);

/** GET /admin/api/config — 콘솔이 기능 활성화 여부를 판단할 서버 설정 요약 */
adminRouter.get("/config", (c) =>
  c.json({
    storageConfigured: isStorageConfigured(),
    githubConfigured: isGithubConfigured(),
    bucket: bucketName(),
    keyPrefix: storagePrefix(),
  }),
);

adminRouter.route("/releases", releasesRouter);
adminRouter.route("/", artifactsRouter);
adminRouter.route("/", opsRouter);
