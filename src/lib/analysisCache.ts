import type { AnalysisResult } from "@/types/repo";

const CACHE_KEY_PREFIX = "gv_analysis_";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHED = 5;

interface CachedEntry {
  result: AnalysisResult;
  timestamp: number;
}

function cacheKey(repoUrl: string): string {
  return CACHE_KEY_PREFIX + repoUrl.replace(/[^a-zA-Z0-9]/g, "_");
}

export function loadCachedAnalysis(repoUrl: string): AnalysisResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(repoUrl));
    if (!raw) return null;
    const entry: CachedEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(repoUrl));
      return null;
    }
    return entry.result;
  } catch {
    return null;
  }
}

export function cacheAnalysis(repoUrl: string, result: AnalysisResult): void {
  try {
    // Evict oldest if we have too many cached
    const allKeys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_KEY_PREFIX));
    if (allKeys.length >= MAX_CACHED) {
      let oldest = { key: "", time: Infinity };
      for (const k of allKeys) {
        try {
          const entry: CachedEntry = JSON.parse(localStorage.getItem(k) || "{}");
          if (entry.timestamp < oldest.time) {
            oldest = { key: k, time: entry.timestamp };
          }
        } catch {
          localStorage.removeItem(k);
        }
      }
      if (oldest.key) localStorage.removeItem(oldest.key);
    }

    const entry: CachedEntry = { result, timestamp: Date.now() };
    localStorage.setItem(cacheKey(repoUrl), JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

export function clearAnalysisCache(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_KEY_PREFIX));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
