import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion, createEmbeddings, supportsEmbeddings } from "./lib/ai-client.js";
import { deleteChunksForRepo, storeChunk, flushChunksToDisk } from "./lib/store.js";
import {
  decodeBase64Utf8,
  extractOwnerRepo,
  getGitHubHeaders,
  isBlockedRepoPath as shouldSkip,
  isLikelySourceFile as isSourceFile,
  repoFilePriority as filePriority,
} from "./lib/github.js";

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

  const merged: CodeChunk[] = [];
  for (const chunk of chunks) {
    if (merged.length > 0 && chunk.content.split("\n").length < 5 && merged[merged.length - 1].content.split("\n").length < 60) {
      const prev = merged[merged.length - 1]; prev.content += "\n" + chunk.content; prev.endLine = chunk.endLine;
    } else merged.push({ ...chunk });
  }
  return merged;
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

    // Clear old chunks for this repo
    deleteChunksForRepo(repoUrl);

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

    // Generate embeddings if supported
    let embeddingsAvailable = false;
    const embeddingMap = new Map<number, number[]>();

    if (allChunks.length > 0 && supportsEmbeddings()) {
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

    // Generate text summaries if no embeddings
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

    // Store chunks in memory
    for (let i = 0; i < allChunks.length; i++) {
      const c = allChunks[i];
      storeChunk({
        repo_url: repoUrl,
        file_path: c.filePath,
        chunk_index: c.chunkIndex,
        chunk_type: c.chunkType,
        chunk_name: c.chunkName,
        content: c.content,
        start_line: c.startLine,
        end_line: c.endLine,
        embedding: embeddingMap.get(i),
        summary: summaryMap.get(i),
      });
    }
    flushChunksToDisk();

    res.json({
      success: true,
      filesProcessed: fetched,
      chunksStored: allChunks.length,
      embeddingsGenerated: embeddingsAvailable,
      embeddingCount: embeddingMap.size,
    });
  } catch (e: any) {
    console.error("embed-chunks error:", e);
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
