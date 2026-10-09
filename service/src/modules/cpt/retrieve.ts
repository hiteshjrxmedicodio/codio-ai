import { getConfig } from "../../core/config";
import { embed } from "../../core/llm/openai";
import { rerank, type Candidate } from "./rerank";

function settings() {
  const cfg = getConfig().cpt_pipeline.rag;
  const apiKey = process.env[cfg.api_key_env];
  if (!apiKey) throw new Error(`${cfg.api_key_env} is not set. Put it in service/.env`);
  return { ...cfg, apiKey };
}

async function pinecone(url: string, body?: unknown): Promise<unknown> {
  const s = settings();
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Api-Key": s.apiKey, "X-Pinecone-API-Version": s.api_version, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(s.timeout_ms),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pinecone ${new URL(url).pathname} returned ${res.status}: ${(data as { message?: string }).message ?? res.statusText}`);
  return data;
}

/** The index's data-plane host, looked up once per process. */
let host: Promise<string> | undefined;
function indexHost(): Promise<string> {
  const s = settings();
  host ??= pinecone(`${s.control_url}/indexes/${s.index_name}`).then((d) => `https://${(d as { host: string }).host}`);
  host.catch(() => (host = undefined));
  return host;
}

interface Match {
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Candidate codes for one procedure: embed the query, fetch from Pinecone (over-fetching when
 * reranking), dedupe by code keeping the best match first, then the dense + BM25 rerank.
 * `topScore` is the best dense score, the gate for whether the procedure is coded at all.
 */
export async function retrieveCandidates(query: string): Promise<{ candidates: Candidate[]; topScore: number }> {
  const s = settings();
  const q = s.lowercase_query ? query.toLowerCase() : query;
  const fetchK = s.rerank.enabled ? Math.max(s.rerank.retrieve_k, s.top_k) : s.top_k;
  const vector = await embed(q, s.embedding_model);
  const data = (await pinecone(`${await indexHost()}/query`, { namespace: s.namespace, vector, topK: fetchK, includeMetadata: true })) as {
    matches?: Match[];
  };

  const seen = new Set<string>();
  const pool: Candidate[] = [];
  for (const m of data.matches ?? []) {
    const code = String(m.metadata?.[s.code_field] ?? "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const descriptor = s.descriptor_fields.map((f) => String(m.metadata?.[f] ?? "").trim()).filter(Boolean).join(" | ");
    pool.push({ code, descriptor, score: m.score });
  }
  const topScore = pool.reduce((best, c) => Math.max(best, c.score), 0);
  const candidates = s.rerank.enabled
    ? rerank(q, pool, { denseWeight: s.rerank.dense_weight, topK: s.top_k, k1: s.rerank.bm25_k1, b: s.rerank.bm25_b })
    : pool.slice(0, s.top_k);
  return { candidates, topScore };
}
