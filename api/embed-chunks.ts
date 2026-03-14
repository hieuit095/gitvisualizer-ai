import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion, createEmbeddings } from "./lib/ai-client";
import { query } from "./lib/db";

function decodeBase64Utf8(base64: string): string {
  return Buffer.from(base64.replace(/\n/g, ""), "base64").toString("utf-8");
}

function extractOwnerRepo(url: string) {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function getGitHubHeaders(userToken?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "GitVisualizer-AI" };
  const token = userToken || process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

interface CodeChunk {
  filePath: string; chunkIndex: number; chunkType: string; chunkName: string;
  content: string; startLine: number; endLine: number;
}

const FUNC_PATTERN = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=|def\s+(\w+)|func\s+(\w+)|fn\s+(\w+))/;

function chunkFile(content: string, filePath: string): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  let currentChunk: string[] = [];
  let currentName = filePath.split("/").pop() || "block";
  let currentType = "block"; let chunkStart = 1; let braceDepth = 0; let chunkIndex = 0;

  const flush = () => {
    if (!currentChunk.length) return;
    chunks.push({ filePath, chunkIndex: chunkIndex++, chunkType: currentType, chunkName: currentName, content: currentChunk.join("\n"), startLine: chunkStart, endLine: chunkStart + currentChunk.length - 1 });
    currentChunk = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const trimmed = line.trim();
    if (braceDepth <= 1) {
      const match = FUNC_PATTERN.exec(trimmed);
      if (match) {
        const name = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (name && currentChunk.length > 0) { flush(); chunkStart = i + 1; }
        if (name) { currentName = name; currentType = match[2] ? "class" : "function"; }
      }
    }
    if (braceDepth === 0 && /^import\s/.test(trimmed) && currentType !== "import") {
      if (currentChunk.length > 3) { flush(); chunkStart = i + 1; }
      currentType = "import"; currentName = "imports";
    }
    currentChunk.push(line);
    braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (braceDepth < 0) braceDepth = 0;
    if (currentChunk.length >= 80) { flush(); chunkStart = i + 2; currentName = filePath.split("/").pop() || "block"; currentType = "block"; }
  }
  flush();

  // Merge small chunks
  const merged: CodeChunk[] = [];
  for (const chunk of chunks) {
    if (merged.length > 0 && chunk.content.split("\n").length < 5 && merged[merged.length - 1].content.split("\n").length < 60) {
      const prev = merged[merged.length - 1]; prev.content += "\n" + chunk.content; prev.endLine = chunk.endLine;
    } else merged.push({ ...chunk });
  }
  return merged;
}

const BLOCKED_DIRS = new Set(["node_modules", "venv", ".venv", "env", ".git", "dist", "build", "out", "target", ".next", ".nuxt", "vendor", "coverage", "__pycache__", ".cache"]);
const BLOCKED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".mp4", ".mp3", ".wav", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".woff", ".woff2", ".ttf", ".map", ".min.js", ".min.css"]);
const LOCK_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "bun.lockb", "bun.lock"]);

function shouldSkip(path: string): boolean {
  const segments = path.split("/");
  for (const seg of segments.slice(0, -1)) { if (BLOCKED_DIRS.has(seg)) return true; if (seg.startsWith(".") && seg.length > 1 && seg !== ".github") return true; }
  const filename = segments[segments.length - 1];
  if (LOCK_FILES.has(filename)) return true;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1 && BLOCKED_EXTENSIONS.has(filename.slice(dotIdx).toLowerCase())) return true;
  return false;
}

const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "rb", "php", "css", "scss", "html", "vue", "svelte", "sql", "graphql", "proto", "sh"]);

function isSourceFile(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (["Makefile", "Dockerfile", "Procfile"].includes(name)) return true;
  return SOURCE_EXTENSIONS.has((name.split(".").pop() || "").toLowerCase());
}

function filePriority(path: string): number {
  const name = path.split("/").pop() || "";
  let score = 0;
  if (/^(index|main|app|server)\./i.test(name)) score += 10;
  if (/package\.json|tsconfig/i.test(name)) score += 8;
  if (/route|controller|handler|api/i.test(name)) score += 6;
  if (/\.test\.|\.spec\./i.test(name)) score -= 3;
  score -= Math.max(0, path.split("/").length - 3);
  return score;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { repoUrl, githubToken } = req.body;
    if (!repoUrl) throw new Error("repoUrl is required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const ghHeaders = getGitHubHeaders(githubToken);

    // Delete old chunks
    await query(`DELETE FROM code_chunks WHERE repo_url = $1`, [repoUrl]);

    // Fetch tree
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers: ghHeaders });
    if (!treeRes.ok) throw new Error(`GitHub tree fetch failed (${treeRes.status})`);
    const treeData = await treeRes.json();
    const allFiles = (treeData.tree || []).filter((f: any) => f.type === "blob" && !shouldSkip(f.path) && isSourceFile(f.path));
    const sorted = allFiles.sort((a: any, b: any) => filePriority(b.path) - filePriority(a.path));
    const targets = sorted.slice(0, 40);

    const allChunks: CodeChunk[] = [];
    let fetched = 0;
    for (const file of targets) {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, { headers: ghHeaders });
        if (!r.ok) { await r.text(); continue; }
        const d = await r.json(); if (!d.content) continue;
        let content = decodeBase64Utf8(d.content);
        if (content.length > 15000) content = content.slice(0, 15000);
        allChunks.push(...chunkFile(content, file.path));
        fetched++;
        if (fetched % 10 === 0) await new Promise(r => setTimeout(r, 500));
      } catch { }
    }

    // Generate embeddings
    let embeddingsAvailable = false;
    const embeddingMap = new Map<number, number[]>();

    if (allChunks.length > 0) {
      try {
        const BATCH = 20;
        for (let i = 0; i < allChunks.length; i += BATCH) {
          const batch = allChunks.slice(i, i + BATCH);
          const inputs = batch.map(c => `${c.chunkType}: ${c.chunkName} in ${c.filePath}\n${c.content.slice(0, 500)}`);
          const embResult = await createEmbeddings(inputs);
          if (embResult.data) {
            embeddingsAvailable = true;
            for (const item of embResult.data) embeddingMap.set(i + item.index, item.embedding);
          }
          if (i + BATCH < allChunks.length) await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) { console.error("Embedding error:", e); }
    }

    // Generate summaries if no embeddings
    const summaryMap = new Map<number, string>();
    if (!embeddingsAvailable && allChunks.length > 0) {
      try {
        const BATCH = 30;
        for (let i = 0; i < Math.min(allChunks.length, 90); i += BATCH) {
          const batch = allChunks.slice(i, i + BATCH);
          const chunkList = batch.map((c, j) => `[${i + j}] ${c.filePath} (${c.chunkType}: ${c.chunkName}): ${c.content.slice(0, 200)}`).join("\n");
          const sumRes = await chatCompletion([
            { role: "system", content: "Generate a brief 5-10 word description for each code chunk. Return one line per chunk: [index] description" },
            { role: "user", content: chunkList },
          ]);
          if (sumRes.ok) {
            const sumData = await sumRes.json();
            const text = sumData.choices?.[0]?.message?.content || "";
            for (const line of text.split("\n")) {
              const match = line.match(/\[(\d+)\]\s*(.+)/);
              if (match) summaryMap.set(parseInt(match[1]), match[2].trim());
            }
          }
        }
      } catch { }
    }

    // Insert chunks
    const IBATCH = 50;
    for (let i = 0; i < allChunks.length; i += IBATCH) {
      const batch = allChunks.slice(i, i + IBATCH);
      const values: string[] = [];
      const params: any[] = [];
      batch.forEach((c, j) => {
        const gi = i + j;
        const offset = gi * 9;
        const embedding = embeddingMap.get(gi);
        const summary = summaryMap.get(gi);
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}::vector)`);
        params.push(repoUrl, c.filePath, c.chunkIndex, c.chunkType, c.chunkName, c.content, c.startLine, c.endLine,
          embedding ? JSON.stringify(embedding) : null
        );
        // We'll handle summary separately or add as 10th param
      });
      // Simplified: use individual inserts with summary
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j]; const gi = i + j;
        const embedding = embeddingMap.get(gi);
        const summary = summaryMap.get(gi);
        await query(
          `INSERT INTO code_chunks (repo_url, file_path, chunk_index, chunk_type, chunk_name, content, start_line, end_line, embedding, summary)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)`,
          [repoUrl, c.filePath, c.chunkIndex, c.chunkType, c.chunkName, c.content, c.startLine, c.endLine,
            embedding ? JSON.stringify(embedding) : null, summary || null]
        );
      }
    }

    res.json({ success: true, filesProcessed: fetched, chunksStored: allChunks.length, embeddingsGenerated: embeddingsAvailable, embeddingCount: embeddingMap.size });
  } catch (e: any) {
    console.error("embed-chunks error:", e);
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
