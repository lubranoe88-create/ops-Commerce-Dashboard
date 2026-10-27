import { getDb } from "./db.js";
import { runInTransaction } from "./sqliteTx.js";

function monthKeyFromDay(dayKey) {
  return dayKey.slice(0, 7); // YYYY-MM
}

function yearKeyFromDay(dayKey) {
  return dayKey.slice(0, 4); // YYYY
}

function daysInclusive(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.floor(ms / 86400000);
}

function consistencyScore({ appearanceCount, currentStreak, maxStreak, windowDays }) {
  const freq = appearanceCount / Math.max(windowDays, 1);
  const streakBonus = Math.min(currentStreak, windowDays) / Math.max(windowDays, 1);
  const peakBonus = Math.min(maxStreak, windowDays) / Math.max(windowDays, 1) * 0.25;
  return Number((freq * 0.6 + streakBonus * 0.3 + peakBonus * 0.1).toFixed(6));
}

function windowDaySpan(windowKind, windowKey) {
  if (windowKind === "year") {
    const y = Number(windowKey);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 366 : 365;
  }
  // month YYYY-MM — use calendar length; unknown → 30
  const [ys, ms] = windowKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Upsert month + year consistency rows for one business after it appears
 * in a daily top on `dayKey`.
 */
export function recordBusinessAppearance({
  businessKey,
  displayName,
  dayKey,
}) {
  const db = getDb();
  const windows = [
    { kind: "month", key: monthKeyFromDay(dayKey) },
    { kind: "year", key: yearKeyFromDay(dayKey) },
  ];

  runInTransaction(db, () => {
    for (const w of windows) {
      const row = db
        .prepare(
          `SELECT appearance_count, current_streak, max_streak, last_seen_day, first_seen_day
           FROM business_consistency
           WHERE business_key = ? AND window_kind = ? AND window_key = ?`,
        )
        .get(businessKey, w.kind, w.key);

      let appearanceCount = 1;
      let currentStreak = 1;
      let maxStreak = 1;
      let firstSeen = dayKey;
      let lastSeen = dayKey;

      if (row) {
        // Same day re-write: do not double-count
        if (row.last_seen_day === dayKey) {
          db.prepare(
            `UPDATE business_consistency
             SET display_name = ?, updated_at = datetime('now')
             WHERE business_key = ? AND window_kind = ? AND window_key = ?`,
          ).run(displayName, businessKey, w.kind, w.key);
          continue;
        }

        appearanceCount = row.appearance_count + 1;
        firstSeen = row.first_seen_day || dayKey;
        lastSeen = dayKey;
        const gap = daysInclusive(row.last_seen_day, dayKey);
        currentStreak = gap === 1 ? row.current_streak + 1 : 1;
        maxStreak = Math.max(row.max_streak, currentStreak);
      }

      const score = consistencyScore({
        appearanceCount,
        currentStreak,
        maxStreak,
        windowDays: windowDaySpan(w.kind, w.key),
      });

      db.prepare(
        `INSERT INTO business_consistency (
           business_key, display_name, window_kind, window_key,
           appearance_count, current_streak, max_streak,
           first_seen_day, last_seen_day, consistency_score, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(business_key, window_kind, window_key) DO UPDATE SET
           display_name = excluded.display_name,
           appearance_count = excluded.appearance_count,
           current_streak = excluded.current_streak,
           max_streak = excluded.max_streak,
           first_seen_day = excluded.first_seen_day,
           last_seen_day = excluded.last_seen_day,
           consistency_score = excluded.consistency_score,
           updated_at = datetime('now')`,
      ).run(
        businessKey,
        displayName,
        w.kind,
        w.key,
        appearanceCount,
        currentStreak,
        maxStreak,
        firstSeen,
        lastSeen,
        score,
      );
    }
  });
}

/**
 * Secondary ranking: businesses that keep showing up in daily tops.
 * Surfaces long-term working activities via frequency + streaks.
 */
export function getConsistencyRanking({
  windowKind = "month",
  windowKey,
  limit = 25,
} = {}) {
  if (!["month", "year"].includes(windowKind)) {
    throw new Error("windowKind must be 'month' or 'year'");
  }
  if (!windowKey) {
    const now = new Date();
    windowKey =
      windowKind === "year"
        ? String(now.getUTCFullYear())
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const db = getDb();
  return db
    .prepare(
      `SELECT business_key, display_name, window_kind, window_key,
              appearance_count, current_streak, max_streak,
              first_seen_day, last_seen_day, consistency_score
       FROM business_consistency
       WHERE window_kind = ? AND window_key = ?
       ORDER BY consistency_score DESC, appearance_count DESC, current_streak DESC
       LIMIT ?`,
    )
    .all(windowKind, windowKey, limit);
}
