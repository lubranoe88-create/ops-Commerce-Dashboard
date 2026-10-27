import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance = null;

export function defaultDbPath() {
  const fromEnv = process.env.MEMORY_DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  return path.resolve(__dirname, "../../../data/memory.sqlite");
}

export function openMemoryDb(dbPath = defaultDbPath()) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
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
