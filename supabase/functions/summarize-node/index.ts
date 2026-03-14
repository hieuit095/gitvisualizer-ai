import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "GitVisualizer-AI",
  };
  const token = userToken || Deno.env.get("GITHUB_TOKEN");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl, filePath, nodeSummary, githubToken } = await req.json();
    if (!repoUrl || !filePath) throw new Error("repoUrl and filePath are required");

    const { owner, repo } = extractOwnerRepo(repoUrl);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const ghHeaders = getGitHubHeaders(githubToken);

    // Fetch full file content
    let fileContent = "";
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        { headers: ghHeaders }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.content) {
          fileContent = atob(data.content.replace(/\n/g, ""));
          // Limit to 8KB for LLM context
          if (fileContent.length > 8000) fileContent = fileContent.slice(0, 8000) + "\n// ... truncated";
        }
      } else {
        await res.text();
      }
    } catch { /* skip */ }

    const prompt = `Analyze this file from "${owner}/${repo}" in detail.

## File: ${filePath}
${nodeSummary ? `Brief summary: ${nodeSummary}` : ""}

## Full Content
\`\`\`
${fileContent || "Content unavailable"}
\`\`\`

## Instructions
Provide a detailed analysis using the tool. Generate:
- **summary**: A thorough 2-3 sentence description of what this file does and its role in the architecture
- **keyFunctions**: Array of the key exported functions, classes, or constants with brief descriptions like "functionName - what it does"
- **tutorial**: How this file connects to and interacts with other parts of the system. Explain the data flow.
- **codeSnippet**: The most representative 5-10 lines of code that capture the core logic of this file. Use the actual code.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a code analysis expert. Provide detailed, accurate file analysis." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
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
                },
                required: ["summary", "keyFunctions", "tutorial", "codeSnippet"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "provide_file_analysis" } },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      throw new Error(`AI analysis failed (${aiRes.status})`);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured data");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("summarize-node error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
