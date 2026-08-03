import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { DB_PATH } from "../env.js";

const sqlite = new Database(DB_PATH);
// Railway 볼륨(네트워크 FS)에서 WAL이 불안정해 DELETE 저널을 유지한다 (커밋 d81a269).
sqlite.pragma("journal_mode = DELETE");

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;

export function newId(): string {
  return crypto.randomUUID();
}
