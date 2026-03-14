import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion, createEmbeddings, supportsEmbeddings } from "../lib/ai-client.js";
import { searchChunks, vectorSearchChunks } from "../lib/store.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { messages, repoContext } = req.body;
    if (!messages || !Array.isArray(messages) || !messages.length) throw new Error("messages array is required");
    if (!repoContext) throw new Error("repoContext is required");

    const userQuery = messages[messages.length - 1]?.content || "";
    let ragContext = "";
    let searchMethod = "none";
    let chunksRetrieved = 0;

    if (repoContext.repoUrl && userQuery) {
      // Try vector search if embeddings are available
      if (supportsEmbeddings()) {
        try {
          const embResult = await createEmbeddings([userQuery]);
          const queryEmbedding = embResult.data?.[0]?.embedding;
          if (queryEmbedding) {
            const chunks = vectorSearchChunks(repoContext.repoUrl, queryEmbedding, 0.25, 15);
            if (chunks.length > 0) {
              searchMethod = "vector";
              chunksRetrieved = chunks.length;
              ragContext = "\n\n## Retrieved Code Chunks (semantic search)\n" +
                chunks.map(c => `### [${c.file_path}:L${c.start_line}-L${c.end_line}] (${c.chunk_type}: ${c.chunk_name}) — similarity: ${(c.similarity * 100).toFixed(0)}%\n\`\`\`\n${c.content}\n\`\`\``).join("\n\n");
            }
          }
        } catch (e) { console.log("Vector search unavailable:", e); }
      }

      // Fallback to text search
      if (!ragContext) {
        const chunks = searchChunks(repoContext.repoUrl, userQuery, 15);
        if (chunks.length > 0) {
          searchMethod = "text";
          chunksRetrieved = chunks.length;
          ragContext = "\n\n## Retrieved Code Chunks (text search)\n" +
            chunks.map(c => `### [${c.file_path}:L${c.start_line}-L${c.end_line}] (${c.chunk_type}: ${c.chunk_name})\n\`\`\`\n${c.content}\n\`\`\``).join("\n\n");
        }
      }
    }

    const nodesSummary = (repoContext.nodes || []).map((n: any) => `- **${n.name}** (${n.type}) [${n.path}]: ${n.summary || ""}`).join("\n");
    const edgesSummary = (repoContext.edges || []).map((e: any) => `- ${e.source} → ${e.target} (${e.type}${e.label ? ": " + e.label : ""})`).join("\n");
    const hasRag = ragContext.length > 0;

    const systemPrompt = `You are an expert code assistant analyzing "${repoContext.repoName || "unknown"}".

## Repository Architecture
### Files & Modules
${nodesSummary}
### Dependencies
${edgesSummary}
${ragContext}

## Rules
1. ${hasRag ? "CITE with [filename:L##-L##]." : "Reference specific file paths."}
2. NO HALLUCINATION. Only reference code shown above.
3. If source not available, say so.
4. Be concise, use markdown.`;

    const aiRes = await chatCompletion(
      [{ role: "system", content: systemPrompt }, ...messages],
      { stream: true }
    );

    if (!aiRes.ok) {
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded." });
      throw new Error(`AI chat failed (${aiRes.status})`);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ searchMeta: { method: searchMethod, chunks: chunksRetrieved } })}\n\n`);

    if (aiRes.body) {
      const reader = (aiRes.body as any).getReader ? (aiRes.body as any).getReader() : null;
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } else {
        for await (const chunk of aiRes.body as any) { res.write(chunk); }
      }
    }

    res.end();
  } catch (e: any) {
    console.error("chat-repo error:", e);
    if (!res.headersSent) res.status(500).json({ error: e.message || "Unknown error" });
    else res.end();
  }
}
