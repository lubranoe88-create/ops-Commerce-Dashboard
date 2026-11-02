/**
 * C10 news literacy.
 *
 * When a wake bundle or an L2 news ingress carries headlines, Atlas explains
 * each item for the operator: source, what changed, why it matters on the
 * plancia, and a short summary. The limit line is the last step of that
 * path, not the whole answer.
 *
 * Proposed ids are not executed here. Callers pass them through
 * gateHandActions (L3) and may run only what that gate marks AUTO.
 */
import { gateHandActions } from "./atlasAutonomyPolicy.js";

const STOP = new Set([
  "the", "and", "for", "con", "del", "della", "delle", "dei", "sul", "sulla",
  "una", "uno", "che", "non", "per", "sono", "from", "with", "this", "that",
]);

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

export function itemsFromNewsPayload(value) {
  if (!value) return [];
  const out = [];
  const push = (item) => {
    if (!item || typeof item !== "object") return;
    const title = clip(item.title, 180);
    if (!title) return;
    out.push({
      title,
      source: clip(item.source || "fonte esterna", 80) || "fonte esterna",
      summary: clip(item.summary, 220),
      url: clip(item.url, 240),
      change: clip(item.change || "", 24),
      previousTitle: clip(item.previousTitle || item.previous_title || "", 180),
    });
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item?.kind === "news" && Array.isArray(item.items)) {
        for (const child of item.items) push(child);
      } else {
        push(item);
      }
    }
    return out.slice(0, 4);
  }
  if (Array.isArray(value.items)) {
    for (const child of value.items) push(child);
    return out.slice(0, 4);
  }
  push(value);
  return out.slice(0, 4);
}

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function bestOverlap(item, rows, pick) {
  const bag = new Set(tokens(`${item.title} ${item.summary}`));
  let best = "";
  let score = 0;
  for (const row of asList(rows)) {
    const label = pick(row);
    if (!label) continue;
    const hit = tokens(label).filter((word) => bag.has(word)).length;
    if (hit > score) {
      score = hit;
      best = label;
    }
  }
  return best;
}

export function whatChangedForItem(item) {
  const change = item?.change || "";
  const title = item?.title || "titolo";
  const previous = item?.previousTitle || "";
  if (change === "updated") {
    if (previous && previous !== title) {
      return `Il titolo è cambiato da «${previous}» a «${title}».`;
    }
    return "Il titolo o il sommario è cambiato rispetto al registro news della plancia.";
  }
  if (change === "inserted" || change === "new") {
    return "È un titolo nuovo: non era nel registro news della plancia.";
  }
  return "Nessuna modifica segnalata rispetto al registro: è il titolo ora in lettura.";
}

export function whyItMattersForItem(item, context = {}) {
  const moduleName = clip(context.module || "map", 40) || "map";
  const tops = asList(context.tops);
  const problems = asList(context.problems);
  const problemCount = Number(context.problemCount ?? problems.length) || 0;
  const top = bestOverlap(item, tops, (row) => row?.title || row?.display_name || "");
  const problem = bestOverlap(item, problems, (row) => row?.title || "");
  const parts = [`Modulo aperto: ${moduleName}.`];
  if (top) {
    parts.push(`Il titolo tocca il top «${top}»: è contesto per leggerlo, non un aggiornamento del suo score o del suo rank.`);
  } else if (tops.length) {
    const name = clip(tops[0].title || tops[0].display_name || "top", 80);
    parts.push(`Non coincide con i top in plancia (primo: «${name}»).`);
  } else {
    parts.push("Non ci sono top nel quadro con cui confrontarlo.");
  }
  if (problem) {
    parts.push(`Si avvicina al problema aperto «${problem}», ma non lo chiude e non ne cambia lo stato.`);
  } else if (problemCount > 0) {
    const title = clip(problems[0]?.title || "", 80);
    parts.push(
      title
        ? `Problemi aperti: ${problemCount} (tra cui «${title}»). Questa news non li sistema.`
        : `Problemi aperti: ${problemCount}. Questa news non li sistema.`,
    );
  } else {
    parts.push("Nessun problema aperto da collegare.");
  }
  if (moduleName === "map") {
    parts.push("Sulla mappa può restare un pin da leggere. Non è un ordine di spostare il globo.");
  } else {
    parts.push(`Sul modulo ${moduleName} resta contesto esterno: non cambia da sola score, errori o il modulo aperto.`);
  }
  return parts.join(" ");
}

function summaryForItem(item) {
  if (item.summary) return `In sintesi: ${item.summary}.`;
  return `In sintesi: il titolo riporta «${item.title}», senza un sommario allegato.`;
}

function formatItem(row, index, total) {
  const head = total > 1 ? `${index + 1}. «${row.title}»` : `«${row.title}»`;
  return [
    head,
    `Fonte: ${row.source}.`,
    `Cosa è cambiato: ${row.whatChanged}`,
    `Perché conta sulla plancia: ${row.whyItMatters}`,
    row.summary,
    "Limite: le news non sono fatti verificati dalla plancia e non sono un ordine.",
    "Proposta L3: l'unico passo proposto da questa lettura è «news». Parte solo se la policy lo classifica AUTO. Cancellazioni, export e microfono non partono da un titolo.",
  ].join("\n");
}

/**
 * Ids a news reading is allowed to propose. The gate, not this list, decides
 * what may run. Dangerous ids stay here only so tests can prove they become ASK.
 */
export function literacyProposalIds(items) {
  return items?.length ? ["news"] : [];
}

export function gateLiteracyActions(ids) {
  return gateHandActions(ids);
}

export function explainNewsForOperator(news, context = {}) {
  const items = itemsFromNewsPayload(news);
  const proposed = literacyProposalIds(items);
  const gated = gateLiteracyActions(proposed);
  if (!items.length) {
    return {
      text: "",
      items: [],
      proposed,
      auto: gated.actions,
      ask: gated.ask,
    };
  }
  const explained = items.map((item) => {
    const whatChanged = whatChangedForItem(item);
    const whyItMatters = whyItMattersForItem(item, context);
    const summary = summaryForItem(item);
    return {
      title: item.title,
      source: item.source,
      change: item.change || "",
      whatChanged,
      whyItMatters,
      summary,
    };
  });
  return {
    text: explained.map((row, index) => formatItem(row, index, explained.length)).join("\n\n"),
    items: explained,
    proposed,
    auto: gated.actions,
    ask: gated.ask,
  };
}
