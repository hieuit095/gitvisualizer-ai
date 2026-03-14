import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion } from "./lib/ai-client";
import { getChunksForFile } from "./lib/store";

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

    // Fallback: fetch from GitHub
    let fileContent = "";
    if (ragChunks.length === 0) {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, { headers: ghHeaders });
        if (r.ok) {
          const d = await r.json();
          if (d.content) {
            fileContent = decodeBase64Utf8(d.content);
            if (fileContent.length > 8000) fileContent = fileContent.slice(0, 8000) + "\n// ... truncated";
          }
        } else await r.text();
      } catch { }
    }

    let contentSection: string;
    const chunkBoundaries: string[] = [];
    if (ragChunks.length > 0) {
      contentSection = ragChunks.map(c => {
        chunkBoundaries.push(`${c.chunk_type}:${c.chunk_name} (L${c.start_line}-L${c.end_line})`);
        return `### ${c.chunk_type}: ${c.chunk_name} [L${c.start_line}-L${c.end_line}]\n\`\`\`\n${c.content}\n\`\`\``;
      }).join("\n\n");
    } else {
      contentSection = `\`\`\`\n${fileContent || "Content unavailable"}\n\`\`\``;
    }

    const prompt = `Analyze this file from "${owner}/${repo}" in detail.
## File: ${filePath}
${nodeSummary ? `Brief summary: ${nodeSummary}` : ""}
## ${ragChunks.length > 0 ? "Code Chunks" : "Full Content"}
${contentSection}
${ragChunks.length > 0 ? `## Chunk Boundaries\n${chunkBoundaries.join("\n")}` : ""}

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
