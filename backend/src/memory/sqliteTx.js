/** DatabaseSync has no .transaction(); wrap BEGIN/COMMIT/ROLLBACK. */
export function runInTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}
