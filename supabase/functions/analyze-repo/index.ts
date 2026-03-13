import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

function extractOwnerRepo(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function classifyFile(path: string): string {
  const name = path.split("/").pop() || "";

  if (/\.test\.|\.spec\.|__tests__/.test(path)) return "test";
  if (/\.css$|\.scss$|\.less$|\.styled\./i.test(name)) return "style";
  if (/^(index|main|app|server)\.(ts|tsx|js|jsx)$/i.test(name)) return "entry";
  if (/config|\.config\.|\.env|tsconfig|package\.json|vite\.config/i.test(name)) return "config";
  if (/hook|use[A-Z]/i.test(name)) return "hook";
  if (/model|schema|entity/i.test(name)) return "model";
  if (/api|route|controller|handler/i.test(name)) return "api";
  if (/database|migration|seed|prisma/i.test(path)) return "database";
  if (/util|helper|lib/i.test(path)) return "utility";
  if (/component|page|view|layout|widget/i.test(path) || /\.(tsx|jsx)$/.test(name)) return "component";
  return "other";
}

function isKeyFile(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (/node_modules|\.git\/|\.lock$|\.png$|\.jpg$|\.svg$|\.ico$|\.woff/i.test(path)) return false;
  if (/^\./.test(name)) return false;

  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "json", "yaml", "yml", "toml"].includes(ext);
}

// Priority scoring for smarter file selection
function filePriority(path: string): number {
  const name = path.split("/").pop() || "";
  let score = 0;
  if (/^(index|main|app|server)\./i.test(name)) score += 10;
  if (/package\.json|tsconfig/i.test(name)) score += 8;
  if (/route|controller|handler|api/i.test(name)) score += 6;
  if (/hook|use[A-Z]/i.test(name)) score += 5;
  if (/component|page|view/i.test(path)) score += 4;
  if (/util|helper|lib/i.test(path)) score += 3;
  if (/model|schema/i.test(name)) score += 4;
  // Penalize deeply nested files
  const depth = path.split("/").length;
  score -= Math.max(0, depth - 3);
  return score;
}

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "GitVisualizer-AI",
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl } = await req.json();
    if (!repoUrl) throw new Error("repoUrl is required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const ghHeaders = getGitHubHeaders();

    // 1. Fetch repo tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      { headers: ghHeaders }
    );

    if (!treeRes.ok) {
      const errText = await treeRes.text();
      if (treeRes.status === 403 && errText.includes("rate limit")) {
        throw new Error("GitHub API rate limit exceeded. Try again later or configure a GitHub token for higher limits.");
      }
      if (treeRes.status === 404) {
        throw new Error("Repository not found. Make sure it's a valid public GitHub repository.");
      }
      throw new Error(`GitHub API error (${treeRes.status}): ${errText}`);
    }

    const treeData = await treeRes.json();
    const allFiles: GitHubTreeItem[] = treeData.tree || [];
    const totalFiles = allFiles.filter((f) => f.type === "blob").length;

    // Filter and sort by priority
    const keyFiles = allFiles
      .filter((f) => f.type === "blob" && isKeyFile(f.path))
      .sort((a, b) => filePriority(b.path) - filePriority(a.path));

    // Limit to ~60 most important files
    const limitedFiles = keyFiles.slice(0, 60);
    const wasTruncated = keyFiles.length > 60;

    // 2. Fetch content of important files (entry points, configs, key modules)
    const importantPaths = limitedFiles
      .filter((f) => {
        const name = f.path.split("/").pop() || "";
        return /^(index|main|app|server|package\.json|tsconfig)\./i.test(name)
          || /route|controller|handler/i.test(name);
      })
      .slice(0, 12);

    const fileContents: Record<string, string> = {};
    await Promise.all(
      importantPaths.map(async (f) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`,
            { headers: ghHeaders }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.content) {
              const decoded = atob(data.content.replace(/\n/g, ""));
              fileContents[f.path] = decoded.slice(0, 2000);
            }
          } else {
            await res.text(); // consume body
          }
        } catch { /* skip */ }
      })
    );

    // 3. Build the prompt for AI
    const fileList = limitedFiles.map((f) => `- ${f.path} (${classifyFile(f.path)})`).join("\n");
    const contentSection = Object.entries(fileContents)
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join("\n\n");

    const folders = new Set<string>();
    limitedFiles.forEach((f) => {
      const parts = f.path.split("/");
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          folders.add(parts.slice(0, i).join("/"));
        }
      }
    });

    const truncationNote = wasTruncated
      ? `\n\nNote: This repository has ${totalFiles} total files. Only the ${limitedFiles.length} most architecturally important files are shown. Focus on these key files.\n`
      : "";

    const prompt = `Analyze this GitHub repository "${owner}/${repo}" and create a system architecture diagram.
${truncationNote}
## File Tree
${fileList}

## Key Directories
${[...folders].join("\n")}

## File Contents
${contentSection}

## Instructions
You MUST respond with a JSON object using the tool provided. Generate:
1. **nodes**: Important files AND key directories. Each node needs:
   - id: unique string
   - name: filename or directory name
   - type: one of "folder", "component", "utility", "hook", "config", "entry", "style", "test", "database", "api", "model", "other"
   - summary: 1-2 sentence description of what this file/folder does
   - keyFunctions: array of key function/export names (for files)
   - tutorial: how this file connects to others in the system
   - codeSnippet: a short representative code snippet (3-8 lines) showing the core logic or exports of this file. Use real or realistic code.
   - path: full file path

2. **edges**: Dependencies between nodes:
   - id: unique string
   - source: source node id
   - target: target node id
   - type: "imports", "calls", "inherits", or "contains"
   - label: brief description

Focus on the most architecturally significant ~20-30 nodes. Include key directories as folder nodes. Show import/dependency relationships.`;

    // 4. Call Lovable AI with tool calling for structured output
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a software architecture analyzer. Analyze codebases and produce structured architecture diagrams." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_architecture_diagram",
              description: "Create an architecture diagram from analyzed repository data",
              parameters: {
                type: "object",
                properties: {
                  nodes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        type: { type: "string", enum: ["folder", "component", "utility", "hook", "config", "entry", "style", "test", "database", "api", "model", "other"] },
                        summary: { type: "string" },
                        keyFunctions: { type: "array", items: { type: "string" } },
                        tutorial: { type: "string" },
                        codeSnippet: { type: "string" },
                        path: { type: "string" },
                      },
                      required: ["id", "name", "type", "summary", "path"],
                      additionalProperties: false,
                    },
                  },
                  edges: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        source: { type: "string" },
                        target: { type: "string" },
                        type: { type: "string", enum: ["imports", "calls", "inherits", "contains"] },
                        label: { type: "string" },
                      },
                      required: ["id", "source", "target", "type"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["nodes", "edges"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_architecture_diagram" } },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      throw new Error(`AI analysis failed (${aiRes.status})`);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("No tool call in AI response:", JSON.stringify(aiData));
      throw new Error("AI did not return structured data");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    const result = {
      repoName: `${owner}/${repo}`,
      repoUrl,
      totalFiles,
      wasTruncated,
      nodes: parsed.nodes || [],
      edges: parsed.edges || [],
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-repo error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
