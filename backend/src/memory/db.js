import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance = null;

export function defaultDbPath() {
  const fromEnv = process.env.MEMORY_DB_PATH?.trim();
  // Always resolve to an absolute path so cwd changes cannot fork a second DB.
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, "../../data/memory.sqlite");
}

export function openMemoryDb(dbPath = defaultDbPath()) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  dbInstance = db;
  return db;
}

export function getDb() {
  if (!dbInstance) {
    return openMemoryDb();
  }
  return dbInstance;
}

export function closeMemoryDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
