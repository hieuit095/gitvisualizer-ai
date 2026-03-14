import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion } from "./lib/ai-client.js";
import { getChunksForFile } from "./lib/store.js";
import {
  decodeBase64Utf8,
  extractOwnerRepo,
  getGitHubHeaders,
} from "./lib/github.js";
import { analyzeSourceFile } from "./lib/static-analysis.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { repoUrl, filePath, nodeSummary, githubToken } = req.body;
    if (!repoUrl || !filePath) throw new Error("repoUrl and filePath are required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const ghHeaders = getGitHubHeaders(githubToken);

    // Try indexed chunks first
    const ragChunks = getChunksForFile(repoUrl, filePath);

    // Fetch file content so Tree-sitter can provide structure even when RAG chunks exist.
    let fullFileContent = "";
    let displayFileContent = "";
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, { headers: ghHeaders });
      if (r.ok) {
        const d = await r.json();
        if (d.content) {
          fullFileContent = decodeBase64Utf8(d.content);
          displayFileContent = fullFileContent.length > 8000
            ? fullFileContent.slice(0, 8000) + "\n// ... truncated"
            : fullFileContent;
        }
      } else await r.text();
    } catch { }

    const staticAnalysis = fullFileContent ? analyzeSourceFile(fullFileContent, filePath) : null;

    let contentSection: string;
    const chunkBoundaries: string[] = [];
    if (ragChunks.length > 0) {
      contentSection = ragChunks.map(c => {
        chunkBoundaries.push(`${c.chunk_type}:${c.chunk_name} (L${c.start_line}-L${c.end_line})`);
        return `### ${c.chunk_type}: ${c.chunk_name} [L${c.start_line}-L${c.end_line}]\n\`\`\`\n${c.content}\n\`\`\``;
      }).join("\n\n");
    } else {
      contentSection = `\`\`\`\n${displayFileContent || "Content unavailable"}\n\`\`\``;
    }

    const prompt = `Analyze this file from "${owner}/${repo}" in detail.
## File: ${filePath}
${nodeSummary ? `Brief summary: ${nodeSummary}` : ""}
${staticAnalysis ? `## Static Analysis Assistant
Parser: ${staticAnalysis.parser || "fallback"}
Imports: ${staticAnalysis.imports.length ? staticAnalysis.imports.join(", ") : "none"}
Exports: ${staticAnalysis.exports.length ? staticAnalysis.exports.join(", ") : "none"}
Top-level symbols: ${staticAnalysis.topLevelSymbols.length ? staticAnalysis.topLevelSymbols.map(symbol => `${symbol.kind}:${symbol.name}`).join(", ") : "none"}

## Skeleton
\`\`\`
${staticAnalysis.skeletonText || "No skeleton available"}
\`\`\`
` : ""}
## ${ragChunks.length > 0 ? "Code Chunks" : "Full Content"}
${contentSection}
${ragChunks.length > 0 ? `## Chunk Boundaries\n${chunkBoundaries.join("\n")}` : ""}

Use the static-analysis section to understand structure first, and the code only for behavior details.

Provide: summary, keyFunctions, tutorial, codeSnippet, references.`;

    const aiRes = await chatCompletion(
      [
        { role: "system", content: "You are a code analysis expert. Provide detailed, accurate file analysis." },
        { role: "user", content: prompt },
      ],
      {
        tools: [{
          type: "function",
          function: {
            name: "provide_file_analysis",
            description: "Provide detailed analysis of a source file",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string" },
                keyFunctions: { type: "array", items: { type: "string" } },
                tutorial: { type: "string" },
                codeSnippet: { type: "string" },
                references: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { filePath: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } },
                    required: ["filePath", "startLine", "endLine"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "keyFunctions", "tutorial", "codeSnippet"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "provide_file_analysis" } },
      }
    );

    if (!aiRes.ok) {
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded." });
      throw new Error(`AI analysis failed (${aiRes.status})`);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured data");

    res.json(JSON.parse(toolCall.function.arguments));
  } catch (e: any) {
    console.error("summarize-node error:", e);
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}
