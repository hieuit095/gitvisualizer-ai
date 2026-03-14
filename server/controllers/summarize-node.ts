import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion } from "../lib/ai-client.js";
import { getChunksForFile } from "../lib/store.js";
import { extractOwnerRepo } from "../lib/github.js";
import { loadRepositorySnapshot } from "../lib/repository-source.js";
import { analyzeSourceFile } from "../lib/static-analysis.js";
import { extractStructuredArguments } from "../lib/structured-output.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { repoUrl, filePath, nodeSummary, githubToken } = req.body;
    if (!repoUrl || !filePath) throw new Error("repoUrl and filePath are required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const repoSnapshot = await loadRepositorySnapshot(repoUrl, githubToken);

    // Try indexed chunks first
    const ragChunks = getChunksForFile(repoUrl, filePath);

    // Fetch file content so Tree-sitter can provide structure even when RAG chunks exist.
    let fullFileContent = "";
    let displayFileContent = "";
    try {
      fullFileContent = await repoSnapshot.readTextFile(filePath) || "";
      displayFileContent = fullFileContent.length > 8000
        ? fullFileContent.slice(0, 8000) + "\n// ... truncated"
        : fullFileContent;
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

    const toolSchema = {
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
    } as const;

    const messages = [
      { role: "system" as const, content: "You are a code analysis expert. Provide detailed, accurate file analysis." },
      { role: "user" as const, content: prompt },
    ];

    const aiRes = await chatCompletion(
      messages,
      {
        tools: [toolSchema],
        tool_choice: { type: "function", function: { name: "provide_file_analysis" } },
      }
    );

    if (!aiRes.ok) {
      if (aiRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded." });
      throw new Error(`AI analysis failed (${aiRes.status})`);
    }

    const aiData = await aiRes.json();
    let structuredArguments = extractStructuredArguments(aiData);

    if (!structuredArguments) {
      const fallbackRes = await chatCompletion(
        [
          { role: "system", content: "You are a code analysis expert. Return ONLY valid JSON. No markdown, no commentary." },
          {
            role: "user",
            content: `${prompt}\n\nReturn ONLY a JSON object matching this schema:\n${JSON.stringify(toolSchema.function.parameters)}`,
          },
        ],
      );

      if (!fallbackRes.ok) {
        if (fallbackRes.status === 429) return res.status(429).json({ error: "Rate limit exceeded." });
        throw new Error(`AI analysis fallback failed (${fallbackRes.status})`);
      }

      const fallbackData = await fallbackRes.json();
      structuredArguments = extractStructuredArguments(fallbackData);
    }

    if (!structuredArguments) throw new Error("AI did not return structured data");

    res.json(JSON.parse(structuredArguments));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e) || "Unknown error";
    console.error("summarize-node error:", message, e);
    res.status(500).json({ error: message });
  }
}
