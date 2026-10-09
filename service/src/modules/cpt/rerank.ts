export interface Candidate {
  code: string;
  descriptor: string;
  /** Dense (vector) similarity from Pinecone. */
  score: number;
}

const tokens = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Okapi BM25 of the query against each document; the shortlist itself is the corpus for IDF. */
export function bm25(query: string, docs: string[], k1: number, b: number): number[] {
  const docTokens = docs.map(tokens);
  const n = docTokens.length;
  if (!n) return [];
  const avgdl = docTokens.reduce((s, t) => s + t.length, 0) / n;
  const df = new Map<string, number>();
  for (const t of docTokens) for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1);
  const q = tokens(query);
  return docTokens.map((t) => {
    const tf = new Map<string, number>();
    for (const term of t) tf.set(term, (tf.get(term) ?? 0) + 1);
    let s = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const nq = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - nq + 0.5) / (nq + 0.5));
      const denom = f + k1 * (1 - b + b * (avgdl ? t.length / avgdl : 0));
      s += denom ? (idf * f * (k1 + 1)) / denom : 0;
    }
    return s;
  });
}

/** Min-max to [0, 1]; all equal (or one value) → 0.5. */
function minmax(v: number[]): number[] {
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return hi - lo < 1e-12 ? v.map(() => 0.5) : v.map((x) => (x - lo) / (hi - lo));
}

/** Hybrid rerank: denseWeight × dense + (1 − denseWeight) × BM25, both min-max normalised, top `topK`. */
export function rerank(query: string, pool: Candidate[], o: { denseWeight: number; topK: number; k1: number; b: number }): Candidate[] {
  if (!pool.length) return [];
  const d = minmax(pool.map((c) => c.score));
  const l = minmax(bm25(query, pool.map((c) => c.descriptor), o.k1, o.b));
  const fused = pool.map((_, i) => o.denseWeight * (d[i] ?? 0) + (1 - o.denseWeight) * (l[i] ?? 0));
  return pool
    .map((c, i) => ({ c, f: fused[i] ?? 0 }))
    .sort((x, y) => y.f - x.f)
    .slice(0, o.topK)
    .map((x) => x.c);
}
