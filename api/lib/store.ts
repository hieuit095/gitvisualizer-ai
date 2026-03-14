/**
 * In-memory store with optional file-based persistence.
 * No database required — works on Vercel serverless and local dev.
 *
 * On Vercel: data persists within a function invocation (good for caching within requests).
 * For durable persistence across deploys, set DATA_DIR env var to a writable path.
 *
 * This replaces the PostgreSQL dependency entirely.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ─── Types ─────────────────────────────────────────────────────────────

interface CacheEntry {
  id: string;
  repo_url: string;
  repo_name: string;
  result: any;
  total_files?: number;
  node_count?: number;
  edge_count?: number;
  was_truncated?: boolean;
  created_at: string;
  expires_at: string;
}

interface HistoryEntry {
  id: string;
  repo_url: string;
  repo_name: string;
  cache_id: string;
  version: number;
  node_count?: number;
  edge_count?: number;
  created_at: string;
}

interface CodeChunk {
  id: string;
  repo_url: string;
  file_path: string;
  chunk_index: number;
  chunk_type: string;
  chunk_name: string;
  content: string;
  start_line: number;
  end_line: number;
  summary?: string;
  embedding?: number[];
}

// ─── In-Memory Store ───────────────────────────────────────────────────

let analysisCache: CacheEntry[] = [];
let analysisHistory: HistoryEntry[] = [];
let codeChunks: CodeChunk[] = [];

function uuid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Optional File Persistence ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || "";

function getDataPath(filename: string): string | null {
  if (!DATA_DIR) return null;
  if (!existsSync(DATA_DIR)) {
    try { mkdirSync(DATA_DIR, { recursive: true }); } catch { return null; }
  }
  return join(DATA_DIR, filename);
}

function loadFromDisk() {
  try {
    const cachePath = getDataPath("analysis_cache.json");
    if (cachePath && existsSync(cachePath)) {
      analysisCache = JSON.parse(readFileSync(cachePath, "utf-8"));
    }
    const histPath = getDataPath("analysis_history.json");
    if (histPath && existsSync(histPath)) {
      analysisHistory = JSON.parse(readFileSync(histPath, "utf-8"));
    }
    const chunksPath = getDataPath("code_chunks.json");
    if (chunksPath && existsSync(chunksPath)) {
      codeChunks = JSON.parse(readFileSync(chunksPath, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load data from disk:", e);
  }
}

function saveToDisk(collection: "cache" | "history" | "chunks") {
  try {
    if (collection === "cache") {
      const p = getDataPath("analysis_cache.json");
      if (p) writeFileSync(p, JSON.stringify(analysisCache, null, 2));
    } else if (collection === "history") {
      const p = getDataPath("analysis_history.json");
      if (p) writeFileSync(p, JSON.stringify(analysisHistory, null, 2));
    } else {
      const p = getDataPath("code_chunks.json");
      if (p) writeFileSync(p, JSON.stringify(codeChunks, null, 2));
    }
  } catch { /* ignore write errors */ }
}

// Load on startup
loadFromDisk();

// ─── Analysis Cache ────────────────────────────────────────────────────

export function getCachedAnalysis(repoUrl: string): CacheEntry | null {
  const now = new Date().toISOString();
  const entry = analysisCache
    .filter(e => e.repo_url === repoUrl && e.expires_at > now)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return entry || null;
}

export function getCacheById(id: string): CacheEntry | null {
  return analysisCache.find(e => e.id === id) || null;
}

export function storeAnalysis(entry: Omit<CacheEntry, "id" | "created_at" | "expires_at">): string {
  const id = uuid();
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  analysisCache.push({
    ...entry,
    id,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });
  // Keep max 50 entries
  if (analysisCache.length > 50) analysisCache = analysisCache.slice(-50);
  saveToDisk("cache");
  return id;
}

// ─── Analysis History ──────────────────────────────────────────────────

export function getHistory(repoUrl: string): HistoryEntry[] {
  return analysisHistory
    .filter(e => e.repo_url === repoUrl)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "created_at" | "version">): void {
  analysisHistory.push({
    ...entry,
    id: uuid(),
    version: 1,
    created_at: new Date().toISOString(),
  });
  if (analysisHistory.length > 200) analysisHistory = analysisHistory.slice(-200);
  saveToDisk("history");
}

// ─── Code Chunks (RAG) ────────────────────────────────────────────────

export function getChunksForFile(repoUrl: string, filePath: string): CodeChunk[] {
  return codeChunks
    .filter(c => c.repo_url === repoUrl && c.file_path === filePath)
    .sort((a, b) => a.chunk_index - b.chunk_index);
}

export function deleteChunksForRepo(repoUrl: string): void {
  codeChunks = codeChunks.filter(c => c.repo_url !== repoUrl);
}

export function storeChunk(chunk: Omit<CodeChunk, "id">): void {
  codeChunks.push({ ...chunk, id: uuid() });
}

export function flushChunksToDisk(): void {
  saveToDisk("chunks");
}

// ─── Text Search (simple keyword matching, no pgvector needed) ─────────

export function searchChunks(
  repoUrl: string,
  queryText: string,
  maxResults = 15
): Array<CodeChunk & { rank: number }> {
  const terms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return [];

  const repoChunks = codeChunks.filter(c => c.repo_url === repoUrl);
  const scored = repoChunks.map(chunk => {
    const searchable = `${chunk.chunk_name || ""} ${chunk.summary || ""} ${chunk.content}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const matches = searchable.split(term).length - 1;
      score += matches;
    }
    return { ...chunk, rank: score };
  });

  return scored
    .filter(c => c.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxResults);
}

// ─── Vector Search (cosine similarity on in-memory embeddings) ─────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function vectorSearchChunks(
  repoUrl: string,
  queryEmbedding: number[],
  threshold = 0.3,
  maxResults = 15
): Array<CodeChunk & { similarity: number }> {
  const repoChunks = codeChunks.filter(
    c => c.repo_url === repoUrl && c.embedding && c.embedding.length > 0
  );

  const scored = repoChunks.map(chunk => ({
    ...chunk,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding!),
  }));

  return scored
    .filter(c => c.similarity > threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}
