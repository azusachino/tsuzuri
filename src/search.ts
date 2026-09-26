import type { Note } from "./vault.ts";

export interface Ranked {
  note: Note;
  score: number;
  snippet: string;
}

/** Query-independent text and word counts, held only until the vault's next scan. */
export interface SearchDocument {
  note: Note;
  lowered: string;
  termCounts: Map<string, number>;
}

export function indexDocument(note: Note): SearchDocument {
  const lowered = note.body.toLowerCase();
  const termCounts = new Map<string, number>();
  for (const match of lowered.matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = match[0];
    termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  }
  return { note, lowered, termCounts };
}

const K1 = 1.2;
const B = 0.75;
const TITLE_BOOST = 2;
const TAG_BOOST = 1.5;
const SNIPPET_RADIUS = 80;

type Term = { text: string; cjk: boolean };

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

/** Latin words match on word boundaries; a CJK run matches as a substring, since CJK has no spaces. */
export function terms(query: string): Term[] {
  const lowered = query.toLowerCase();
  const found = new Map<string, Term>();
  for (const run of lowered.match(CJK) ?? []) found.set(run, { text: run, cjk: true });
  for (const word of lowered.replace(CJK, " ").match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (word.length > 1 || /\d/.test(word)) found.set(word, { text: word, cjk: false });
  }
  return [...found.values()];
}

/** A counter of a term's occurrences, its word-boundary pattern compiled once for every note it scans. */
function counter(term: Term): (haystack: string) => number {
  if (term.cjk) {
    return (haystack) => {
      let count = 0;
      for (let at = haystack.indexOf(term.text); at !== -1; at = haystack.indexOf(term.text, at + term.text.length)) {
        count++;
      }
      return count;
    };
  }
  const escaped = term.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
  return (haystack) => haystack.match(pattern)?.length ?? 0;
}

function snippet(body: string, lowered: string, query: Term[]): string {
  const at = Math.min(...query.map((term) => lowered.indexOf(term.text)).filter((index) => index !== -1));
  const start = Number.isFinite(at) ? Math.max(0, at - SNIPPET_RADIUS) : 0;
  const text = body
    .slice(start, start + SNIPPET_RADIUS * 2)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${text}${start + SNIPPET_RADIUS * 2 < body.length ? "…" : ""}`;
}

/** BM25 over scan-held text/counts, plus boosts for terms in the title or tags. */
export function rank(docs: SearchDocument[], query: string, limit: number): Ranked[] {
  const wanted = terms(query);
  if (wanted.length === 0 || docs.length === 0) return [];

  const counters = wanted.map(counter);
  const averageLength = docs.reduce((sum, doc) => sum + doc.lowered.length, 0) / docs.length || 1;
  const countIn = (doc: SearchDocument, term: Term, i: number) =>
    term.cjk ? (counters[i] as (text: string) => number)(doc.lowered) : (doc.termCounts.get(term.text) ?? 0);
  const counts = docs.map((doc) => wanted.map((term, i) => countIn(doc, term, i)));
  const idf = wanted.map((_, i) => {
    const df = counts.filter((row) => (row[i] ?? 0) > 0).length;
    return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  });

  const hits: Ranked[] = [];
  for (const [index, { note, lowered }] of docs.entries()) {
    const termCounts = counts[index] as number[];
    const title = note.title.toLowerCase();
    const tags = note.tags.join(" ");
    let score = 0;
    counters.forEach((count, i) => {
      const tf = termCounts[i] ?? 0;
      const weight = idf[i] ?? 0;
      if (tf > 0) score += (weight * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * lowered.length) / averageLength));
      if (count(title) > 0) score += TITLE_BOOST * weight;
      if (count(tags) > 0) score += TAG_BOOST * weight;
    });
    if (score > 0) {
      hits.push({
        note,
        score: Number(score.toFixed(3)),
        snippet: snippet(note.body, lowered, wanted),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path)).slice(0, limit);
}
