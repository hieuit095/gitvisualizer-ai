import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractOwnerRepo(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function getGitHubHeaders(userToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitVisualizer-AI",
  };
  const token = userToken || Deno.env.get("GITHUB_TOKEN");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function decodeBase64Utf8(base64: string): string {
  const cleaned = base64.replace(/\n/g, "");
  const binaryStr = atob(cleaned);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// ─── Semantic Chunking ─────────────────────────────────────────────────

interface CodeChunk {
  filePath: string;
  chunkIndex: number;
  chunkType: string;
  chunkName: string;
  content: string;
  startLine: number;
  endLine: number;
}

const FUNC_PATTERN =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=|def\s+(\w+)|func\s+(\w+)|fn\s+(\w+))/;

function chunkFile(content: string, filePath: string): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  let currentChunk: string[] = [];
  let currentName = filePath.split("/").pop() || "block";
  let currentType = "block";
  let chunkStart = 1;
  let braceDepth = 0;
  let chunkIndex = 0;

  const flush = () => {
    if (currentChunk.length === 0) return;
    chunks.push({
      filePath,
      chunkIndex: chunkIndex++,
      chunkType: currentType,
      chunkName: currentName,
      content: currentChunk.join("\n"),
      startLine: chunkStart,
      endLine: chunkStart + currentChunk.length - 1,
    });
    currentChunk = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect function/class declarations at top level
    if (braceDepth <= 1) {
      const match = FUNC_PATTERN.exec(trimmed);
      if (match) {
        const name = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (name && currentChunk.length > 0) {
          flush();
          chunkStart = i + 1;
        }
        if (name) {
          currentName = name;
          currentType = match[2] ? "class" : "function";
        }
      }
    }

    // Track import blocks
    if (braceDepth === 0 && /^import\s/.test(trimmed) && currentType !== "import") {
      if (currentChunk.length > 3) {
        flush();
        chunkStart = i + 1;
      }
      currentType = "import";
      currentName = "imports";
    }

    currentChunk.push(line);

    // Track brace depth
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    braceDepth += opens - closes;
    if (braceDepth < 0) braceDepth = 0;

    // Cap chunk size at ~80 lines
    if (currentChunk.length >= 80) {
      flush();
      chunkStart = i + 2;
      currentName = filePath.split("/").pop() || "block";
      currentType = "block";
    }
  }

  flush();

  // Merge very small chunks (< 5 lines) with neighbors
  const merged: CodeChunk[] = [];
  for (const chunk of chunks) {
    if (
      merged.length > 0 &&
      chunk.content.split("\n").length < 5 &&
      merged[merged.length - 1].content.split("\n").length < 60
    ) {
      const prev = merged[merged.length - 1];
      prev.content += "\n" + chunk.content;
      prev.endLine = chunk.endLine;
    } else {
      merged.push({ ...chunk });
    }
  }

  return merged;
}

// ─── Priority filter (same as analyze-repo) ────────────────────────────

const BLOCKED_DIRS = new Set([
  "node_modules", "venv", ".venv", "env", ".git", "dist", "build", "out",
  "target", ".next", ".nuxt", "vendor", "coverage", "__pycache__", ".cache",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
  ".mp4", ".mp3", ".wav", ".pdf", ".zip", ".tar", ".gz",
  ".exe", ".dll", ".so", ".woff", ".woff2", ".ttf",
  ".map", ".min.js", ".min.css",
]);

const LOCK_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
  "bun.lockb", "bun.lock",
]);

function shouldSkip(path: string): boolean {
  const segments = path.split("/");
  for (const seg of segments.slice(0, -1)) {
    if (BLOCKED_DIRS.has(seg)) return true;
    if (seg.startsWith(".") && seg.length > 1 && seg !== ".github") return true;
  }
  const filename = segments[segments.length - 1];
  if (LOCK_FILES.has(filename)) return true;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = filename.slice(dotIdx).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "rb", "php",
  "css", "scss", "html", "vue", "svelte",
  "sql", "graphql", "proto", "sh",
]);

function isSourceFile(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (["Makefile", "Dockerfile", "Procfile"].includes(name)) return true;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return SOURCE_EXTENSIONS.has(ext);
}

function filePriority(path: string): number {
  const name = path.split("/").pop() || "";
  let score = 0;
  if (/^(index|main|app|server)\./i.test(name)) score += 10;
  if (/package\.json|tsconfig/i.test(name)) score += 8;
  if (/route|controller|handler|api/i.test(name)) score += 6;
  if (/hook|use[A-Z]/i.test(name)) score += 5;
  if (/component|page|view/i.test(path)) score += 4;
  if (/model|schema|types/i.test(name)) score += 4;
  if (/\.test\.|\.spec\./i.test(name)) score -= 3;
  score -= Math.max(0, path.split("/").length - 3);
  return score;
}

// ─── Main Handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl, githubToken } = await req.json();
    if (!repoUrl) throw new Error("repoUrl is required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const ghHeaders = getGitHubHeaders(githubToken);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // Check if chunks already exist for this repo (skip if recent)
    const { data: existing } = await db
      .from("code_chunks")
      .select("id")
      .eq("repo_url", repoUrl)
      .limit(1);

    if (existing && existing.length > 0) {
      // Delete old chunks before re-indexing
      await db.from("code_chunks").delete().eq("repo_url", repoUrl);
    }

    // Fetch repo tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      { headers: ghHeaders }
    );
    if (!treeRes.ok) {
      const t = await treeRes.text();
      throw new Error(`GitHub tree fetch failed (${treeRes.status}): ${t}`);
    }

    const treeData = await treeRes.json();
    const allFiles = (treeData.tree || []).filter(
      (f: any) => f.type === "blob" && !shouldSkip(f.path) && isSourceFile(f.path)
    );

    // Sort by priority, take top 40
    const sorted = allFiles.sort((a: any, b: any) => filePriority(b.path) - filePriority(a.path));
    const targets = sorted.slice(0, 40);

    // Fetch full file contents and chunk them
    const allChunks: CodeChunk[] = [];
    let fetched = 0;

    for (const file of targets) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`,
          { headers: ghHeaders }
        );
        if (!res.ok) {
          await res.text();
          continue;
        }
        const data = await res.json();
        if (!data.content) continue;

        let content = decodeBase64Utf8(data.content);
        // Limit very large files
        if (content.length > 15000) {
          content = content.slice(0, 15000);
        }

        const chunks = chunkFile(content, file.path);
        allChunks.push(...chunks);
        fetched++;

        // Rate limit protection
        if (fetched % 10 === 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        // Skip file on error
      }
    }

    // Insert chunks in batches of 50
    const batchSize = 50;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize).map((c) => ({
        repo_url: repoUrl,
        file_path: c.filePath,
        chunk_index: c.chunkIndex,
        chunk_type: c.chunkType,
        chunk_name: c.chunkName,
        content: c.content,
        start_line: c.startLine,
        end_line: c.endLine,
      }));

      const { error } = await db.from("code_chunks").insert(batch);
      if (error) {
        console.error("Chunk insert error:", error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        filesProcessed: fetched,
        chunksStored: allChunks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("embed-chunks error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
