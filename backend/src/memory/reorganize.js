import { getDb } from "./db.js";
import { runInTransaction } from "./sqliteTx.js";

function slugify(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function upsertConcept(db, label, reliabilityScore) {
  const slug = slugify(label);
  if (!slug) return null;

  const existing = db
    .prepare("SELECT id, reliability_ema, mention_count FROM concepts WHERE slug = ?")
    .get(slug);

  if (!existing) {
    const result = db
      .prepare(
        `INSERT INTO concepts (slug, label, mention_count, reliability_ema)
         VALUES (?, ?, 1, ?)`,
      )
      .run(slug, label.trim(), reliabilityScore);
    return Number(result.lastInsertRowid);
  }

  const ema =
    existing.reliability_ema * 0.8 + reliabilityScore * 0.2;
  db.prepare(
    `UPDATE concepts
     SET label = ?, mention_count = mention_count + 1,
         last_seen_at = datetime('now'), reliability_ema = ?
     WHERE id = ?`,
  ).run(label.trim(), ema, existing.id);
  return existing.id;
}

function reinforceLink(db, a, b) {
  if (a === b) return { created: 0, updated: 0 };
  const [fromId, toId] = a < b ? [a, b] : [b, a];
  const row = db
    .prepare(
      `SELECT weight, evidence_count FROM concept_links
       WHERE from_concept_id = ? AND to_concept_id = ? AND kind = 'co_occurrence'`,
    )
    .get(fromId, toId);

  if (!row) {
    db.prepare(
      `INSERT INTO concept_links
         (from_concept_id, to_concept_id, weight, evidence_count, kind)
       VALUES (?, ?, 1, 1, 'co_occurrence')`,
    ).run(fromId, toId);
    return { created: 1, updated: 0 };
  }

  db.prepare(
    `UPDATE concept_links
     SET weight = weight + 1,
         evidence_count = evidence_count + 1,
         last_reinforced_at = datetime('now')
     WHERE from_concept_id = ? AND to_concept_id = ? AND kind = 'co_occurrence'`,
  ).run(fromId, toId);
  return { created: 0, updated: 1 };
}

/**
 * After each saved conversation: upsert concepts, reinforce co-occurrence
 * links (neural links), record a reorg run. Purely local — no AI calls.
 */
export function reorganizeAfterConversation(conversationId, conceptLabels = []) {
  const db = getDb();
  const conv = db
    .prepare("SELECT id, reliability_score FROM conversations WHERE id = ?")
    .get(conversationId);
  if (!conv) {
    throw new Error(`conversation ${conversationId} not found`);
  }

  const labels = [...new Set(conceptLabels.map((l) => String(l).trim()).filter(Boolean))];
  let linksCreated = 0;
  let linksUpdated = 0;
  const conceptIds = [];

  runInTransaction(db, () => {
    for (const label of labels) {
      const id = upsertConcept(db, label, conv.reliability_score);
      if (id != null) {
        conceptIds.push(id);
        db.prepare(
          `INSERT OR IGNORE INTO conversation_concepts (conversation_id, concept_id)
           VALUES (?, ?)`,
        ).run(conversationId, id);
      }
    }

    for (let i = 0; i < conceptIds.length; i += 1) {
      for (let j = i + 1; j < conceptIds.length; j += 1) {
        const r = reinforceLink(db, conceptIds[i], conceptIds[j]);
        linksCreated += r.created;
        linksUpdated += r.updated;
      }
    }

    db.prepare(
      `INSERT INTO reorg_runs
         (conversation_id, concepts_touched, links_created, links_updated, notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      conversationId,
      conceptIds.length,
      linksCreated,
      linksUpdated,
      "post-conversation neural reorg",
    );
  });

  return {
    conversationId,
    conceptsTouched: conceptIds.length,
    linksCreated,
    linksUpdated,
  };
}
