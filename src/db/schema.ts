import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const downloads = sqliteTable("downloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: text("version").notNull(),
  platform: text("platform").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  machineId: text("machine_id"),
  downloadedAt: integer("downloaded_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
