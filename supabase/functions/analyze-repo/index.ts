import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

// ─── Smart Ignore Engine ───────────────────────────────────────────────

const BLOCKED_DIRS = new Set([
  "node_modules", "venv", ".venv", "env", ".git", "dist", "build", "out",
  "target", ".next", ".nuxt", "vendor", "coverage", "__pycache__", ".cache",
  ".idea", ".vscode", ".gradle", "bower_components", ".terraform", ".serverless",
  "eggs", ".eggs", ".tox", ".mypy_cache", ".pytest_cache",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".wmv",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt",
  ".zip", ".tar", ".gz", ".rar", ".7z", ".bz2",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".map", ".min.js", ".min.css",
]);

const LOCK_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
  "Pipfile.lock", "composer.lock", "Gemfile.lock", "Cargo.lock",
  "bun.lockb", "bun.lock", "shrinkwrap.json",
]);

const FILE_SIZE_THRESHOLD = 100 * 1024; // 100KB

// Allowed hidden files that should not be filtered
const ALLOWED_HIDDEN_FILES = new Set([
  ".gitignore", ".env.example", ".editorconfig", ".eslintrc",
  ".eslintrc.js", ".eslintrc.json", ".prettierrc", ".prettierrc.json",
]);

function parseGitignore(content: string): ((path: string) => boolean) {
  const rules: { pattern: RegExp; negate: boolean }[] = [];
  for (const raw of content.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    let regex = line
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "§§")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/§§/g, ".*");
    if (line.endsWith("/")) regex = regex.slice(0, -2) + "(/|$)";
    if (!line.includes("/")) regex = "(^|.*/)" + regex;
    else if (!line.startsWith("/")) regex = "(^|.*/)" + regex;
    else regex = "^" + regex.slice(2);
    try {
      rules.push({ pattern: new RegExp(regex), negate });
    } catch { /* skip invalid patterns */ }
  }
  return (path: string) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.pattern.test(path)) ignored = !rule.negate;
    }
    return ignored;
  };
}

function isBlockedByEngine(path: string, size?: number): boolean {
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
    const prevDot = filename.lastIndexOf(".", dotIdx - 1);
    if (prevDot !== -1) {
      const doubleExt = filename.slice(prevDot).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(doubleExt)) return true;
    }
  }
  if (size !== undefined && size > FILE_SIZE_THRESHOLD) return true;
  // Hidden files — allow known config files
  if (filename.startsWith(".") && !ALLOWED_HIDDEN_FILES.has(filename)) return true;
  return false;
}

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "scala", "rb", "php",
  "json", "yaml", "yml", "toml", "xml",
  "css", "scss", "less", "html", "vue", "svelte",
  "sql", "graphql", "gql", "proto",
  "sh", "bash", "zsh", "ps1",
  "md", "mdx", "txt", "env",
  "c", "cpp", "h", "hpp", "cs", "swift", "dart", "lua", "ex", "exs", "erl", "hs",
]);

function isSourceFile(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (["Makefile", "Dockerfile", "Procfile", "Rakefile", "Gemfile", "Pipfile"].includes(name)) return true;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return SOURCE_EXTENSIONS.has(ext);
}

// ─── Base64 → UTF-8 safe decoding ─────────────────────────────────────

function decodeBase64Utf8(base64: string): string {
  const cleaned = base64.replace(/\n/g, "");
  const binaryStr = atob(cleaned);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// ─── Concurrency-limited fetch ─────────────────────────────────────────

async function fetchWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = 5,
  retries = 2,
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      let attempt = 0;
      while (attempt <= retries) {
        try {
          await fn(item);
          break;
        } catch (e: any) {
          if (attempt < retries && (e?.status === 429 || e?.message?.includes("rate limit"))) {
            // Exponential backoff on rate limit
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            attempt++;
          } else {
            // Non-retryable or exhausted retries — skip silently
            break;
          }
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
}

// ─── File Classification & Priority ────────────────────────────────────

function classifyFile(path: string): string {
  const name = path.split("/").pop() || "";
  if (/\.test\.|\.spec\.|__tests__|_test\./.test(path)) return "test";
  if (/\.css$|\.scss$|\.less$|\.styled\./i.test(name)) return "style";
  if (/^(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/i.test(name)) return "entry";
  if (/config|\.config\.|\.env|tsconfig|package\.json|vite\.config|webpack|babel|jest\.config/i.test(name)) return "config";
  if (/hook|use[A-Z]/i.test(name)) return "hook";
  if (/model|schema|entity|types?\.(ts|js)/i.test(name)) return "model";
  if (/api|route|controller|handler|endpoint/i.test(name)) return "api";
  if (/database|migration|seed|prisma|drizzle/i.test(path)) return "database";
  if (/util|helper|lib/i.test(path)) return "utility";
  if (/component|page|view|layout|widget/i.test(path) || /\.(tsx|jsx|vue|svelte)$/.test(name)) return "component";
  return "other";
}

function filePriority(path: string): number {
  const name = path.split("/").pop() || "";
  let score = 0;
  if (/^(index|main|app|server)\./i.test(name)) score += 10;
  if (/package\.json|tsconfig|Cargo\.toml|go\.mod|pyproject\.toml/i.test(name)) score += 8;
  if (/route|controller|handler|api/i.test(name)) score += 6;
  if (/hook|use[A-Z]/i.test(name)) score += 5;
  if (/component|page|view/i.test(path)) score += 4;
  if (/model|schema|types/i.test(name)) score += 4;
  if (/util|helper|lib/i.test(path)) score += 3;
  if (/\.test\.|\.spec\./i.test(name)) score -= 3;
  const depth = path.split("/").length;
  score -= Math.max(0, depth - 3);
  return score;
}

// ─── File Header Extraction (Layer 2) ──────────────────────────────────

function extractFileHeader(content: string, maxLines = 60): string {
  const lines = content.split("\n");
  const header: string[] = [];
  let braceDepth = 0;
  for (const line of lines) {
    if (header.length >= maxLines) break;
    const trimmed = line.trim();
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    // Keep line if we're at top level, or it's a declaration/comment/blank
    if (
      braceDepth <= 1 ||
      /^(import|export|interface|type|class|enum|const|let|var|function|async|abstract|public|private|protected|def |fn |func )/.test(trimmed) ||
      trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed === ""
    ) {
      header.push(line);
    }
    braceDepth += opens - closes;
    if (braceDepth < 0) braceDepth = 0;
  }
  return header.join("\n");
}

// ─── Pass 1: Import/Export Extraction ──────────────────────────────────

interface ShallowFileInfo {
  path: string;
  type: string;
  imports: string[];
  exports: string[];
  signatures: string[];
  lineCount?: number;
  exportCount?: number;
}

function extractShallowInfo(path: string, content: string): ShallowFileInfo {
  const imports: string[] = [];
  const exports: string[] = [];
  const signatures: string[] = [];

  const importRegex = /(?:import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]|from\s+(\S+)\s+import|require\(['"]([^'"]+)['"]\))/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const mod = match[1] || match[2] || match[3];
    if (mod) imports.push(mod);
  }

  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    if (match[1]) exports.push(match[1]);
  }

  const sigRegex = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|def\s+(\w+)|func\s+(\w+)|fn\s+(\w+))/gm;
  while ((match = sigRegex.exec(content)) !== null) {
    const name = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
    if (name) signatures.push(name);
  }

  const lineCount = content.split("\n").length;
  return { path, type: classifyFile(path), imports, exports, signatures, lineCount, exportCount: exports.length };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function extractOwnerRepo(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function getGitHubHeaders(userToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "GitVisualizer-AI",
  };
  const token = userToken || Deno.env.get("GITHUB_TOKEN");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ─── Main Handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl, githubToken, forceRefresh } = await req.json();
    if (!repoUrl) throw new Error("repoUrl is required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Initialize Supabase client with service role for DB cache
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // ─── Check DB cache first ────────────────────────────
    if (!forceRefresh) {
      try {
        const { data: cached } = await db
          .from("analysis_cache")
          .select("id, result, repo_name")
          .eq("repo_url", repoUrl)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (cached?.result) {
          // Return cached result immediately as NDJSON
          const encoder = new TextEncoder();
          const cacheStream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", step: "done", message: "Loaded from cache" }) + "\n"));
              controller.enqueue(encoder.encode(JSON.stringify({ type: "result", data: { ...cached.result, cached: true, _cacheId: cached.id } }) + "\n"));
              controller.close();
            },
          });
          return new Response(cacheStream, {
            headers: { ...corsHeaders, "Content-Type": "application/x-ndjson" },
          });
        }
      } catch { /* no cache hit — proceed with analysis */ }
    }

    const ghHeaders = getGitHubHeaders(githubToken);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        };

        try {
          // ─── Step 1: Fetch repo tree ───────────────────────
          send({ type: "progress", step: "fetch", message: "Fetching repository tree..." });

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
              throw new Error("Repository not found. For private repos, add a GitHub Personal Access Token with repo access.");
            }
            if (treeRes.status === 401 || treeRes.status === 403) {
              throw new Error("Access denied. This may be a private repository — add a GitHub Personal Access Token with repo access.");
            }
            throw new Error(`GitHub API error (${treeRes.status}): ${errText}`);
          }

          const treeData = await treeRes.json();
          const allFiles: GitHubTreeItem[] = treeData.tree || [];
          const totalFiles = allFiles.filter((f) => f.type === "blob").length;

          send({ type: "progress", step: "fetch_done", message: `Fetched ${totalFiles} files from repository`, totalFiles });

          // ─── Step 2: Smart Ignore filtering ────────────────
          send({ type: "progress", step: "filter", message: "Applying Smart Ignore filters..." });

          let gitignoreFilter: ((path: string) => boolean) | null = null;
          try {
            const giRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/contents/.gitignore`,
              { headers: ghHeaders }
            );
            if (giRes.ok) {
              const giData = await giRes.json();
              if (giData.content) {
                const decoded = decodeBase64Utf8(giData.content);
                gitignoreFilter = parseGitignore(decoded);
              }
            } else {
              await giRes.text();
            }
          } catch { /* no .gitignore */ }

          const blobs = allFiles.filter(f => f.type === "blob");
          const afterEngine = blobs.filter(f => !isBlockedByEngine(f.path, f.size));
          const afterGitignore = gitignoreFilter
            ? afterEngine.filter(f => !gitignoreFilter!(f.path))
            : afterEngine;
          const sourceFiles = afterGitignore.filter(f => isSourceFile(f.path));
          const filteredOut = totalFiles - sourceFiles.length;

          send({
            type: "progress", step: "filter_done",
            message: `Filtered out ${filteredOut} non-essential files, keeping ${sourceFiles.length} source files`,
            filteredOut, kept: sourceFiles.length,
          });

          const prioritized = sourceFiles.sort((a, b) => filePriority(b.path) - filePriority(a.path));
          const MAX_FILES = 80;
          const limitedFiles = prioritized.slice(0, MAX_FILES);
          const wasTruncated = sourceFiles.length > MAX_FILES;

          // ─── Step 3: Pass 1 — Shallow extraction ──────────
          send({
            type: "progress", step: "extract",
            message: `Extracting imports & signatures from ${limitedFiles.length} files...`,
          });

          const contentTargets = limitedFiles.slice(0, 25);
          const fileContents: Record<string, string> = {};

          // Use concurrency-limited fetching (5 at a time with retry)
          await fetchWithConcurrency(contentTargets, async (f) => {
            const res = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`,
              { headers: ghHeaders }
            );
            if (res.ok) {
              const data = await res.json();
              if (data.content) {
                const decoded = decodeBase64Utf8(data.content);
                fileContents[f.path] = decoded.slice(0, 3000);
              }
            } else {
              const status = res.status;
              await res.text(); // consume body
              if (status === 429 || status === 403) {
                const err = new Error("rate limit");
                (err as any).status = 429;
                throw err;
              }
            }
          }, 5, 2);

          const shallowMap: ShallowFileInfo[] = limitedFiles.map(f => {
            const content = fileContents[f.path];
            if (content) return extractShallowInfo(f.path, content);
            return { path: f.path, type: classifyFile(f.path), imports: [], exports: [], signatures: [] };
          });

          send({
            type: "progress", step: "extract_done",
            message: `Extracted ${shallowMap.reduce((s, f) => s + f.imports.length, 0)} imports and ${shallowMap.reduce((s, f) => s + f.signatures.length, 0)} signatures`,
          });

          // ─── Step 4: Pass 2 — AI structural analysis ──────
          send({ type: "progress", step: "analyze", message: "AI analyzing architecture..." });

          const shallowSummary = shallowMap
            .map(f => {
              let line = `- ${f.path} [${f.type}]`;
              if (f.exports.length) line += ` exports: ${f.exports.slice(0, 8).join(", ")}`;
              if (f.imports.length) line += ` imports: ${f.imports.slice(0, 8).join(", ")}`;
              if (f.signatures.length) line += ` fns: ${f.signatures.slice(0, 6).join(", ")}`;
              return line;
            })
            .join("\n");

          const contentSection = Object.entries(fileContents)
            .slice(0, 15)
            .map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``)
            .join("\n\n");

          const folders = new Set<string>();
          limitedFiles.forEach((f) => {
            const parts = f.path.split("/");
            for (let i = 1; i < parts.length; i++) {
              folders.add(parts.slice(0, i).join("/"));
            }
          });

          const truncationNote = wasTruncated
            ? `\n\nNote: This repository has ${totalFiles} total files. After smart filtering, ${sourceFiles.length} source files remain. Showing the ${limitedFiles.length} highest-priority files.\n`
            : "";

          const prompt = `Analyze this GitHub repository "${owner}/${repo}" and create a system architecture diagram.
${truncationNote}
## Shallow Analysis (imports, exports, signatures)
${shallowSummary}

## Key Directories
${[...folders].slice(0, 40).join("\n")}

## File Contents (key files)
${contentSection}

## Instructions
Generate the architecture using the tool provided. Create:
1. **nodes**: The ~20-35 most architecturally significant files AND key directories. Each node needs:
   - id, name, type (folder/component/utility/hook/config/entry/style/test/database/api/model/other)
   - summary: 1-sentence HIGH-LEVEL description (keep brief — detailed summaries load on-demand)
   - keyFunctions: top 3-5 function/export names
   - path: full file path
   Note: Do NOT include tutorial or codeSnippet — those are loaded lazily on user request.

2. **edges**: Dependencies between nodes (id, source, target, type, label)

Focus on architecture structure. Keep summaries concise.`;

          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You are a software architecture analyzer. Produce structured architecture diagrams." },
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
            if (aiRes.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
            if (aiRes.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
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

          send({ type: "progress", step: "done", message: "Building diagram..." });

          const result = {
            repoName: `${owner}/${repo}`,
            repoUrl,
            totalFiles,
            wasTruncated,
            filteredFiles: sourceFiles.length,
            filteredOut,
            nodes: parsed.nodes || [],
            edges: parsed.edges || [],
          };

          // Store result in DB cache and history (fire-and-forget)
          const cacheInsert = db.from("analysis_cache").insert({
            repo_url: repoUrl,
            repo_name: `${owner}/${repo}`,
            result,
            total_files: totalFiles,
            node_count: (parsed.nodes || []).length,
            edge_count: (parsed.edges || []).length,
            was_truncated: wasTruncated,
          }).select("id").single();

          cacheInsert.then(({ data: cacheData, error: cacheErr }) => {
            if (cacheErr) {
              console.error("Cache store error:", cacheErr);
              return;
            }
            // Also insert into history
            db.from("analysis_history").insert({
              repo_url: repoUrl,
              repo_name: `${owner}/${repo}`,
              cache_id: cacheData.id,
              node_count: (parsed.nodes || []).length,
              edge_count: (parsed.edges || []).length,
            }).then(({ error: histErr }) => {
              if (histErr) console.error("History store error:", histErr);
            });

            // Attach cache ID to result
            result._cacheId = cacheData.id;
          });

          send({ type: "result", data: result });
          controller.close();
        } catch (e) {
          const message = e instanceof Error ? e.message : "Unknown error";
          send({ type: "error", error: message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "application/x-ndjson" },
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
