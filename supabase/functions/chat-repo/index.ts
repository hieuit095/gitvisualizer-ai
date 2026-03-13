import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, repoContext } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages array is required");
    }
    if (!repoContext) {
      throw new Error("repoContext is required");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build a concise context string from the analysis result
    const nodesSummary = (repoContext.nodes || [])
      .map((n: any) => {
        let entry = `- **${n.name}** (${n.type}) [${n.path}]: ${n.summary || ""}`;
        if (n.keyFunctions?.length) entry += `\n  Functions: ${n.keyFunctions.join(", ")}`;
        if (n.codeSnippet) entry += `\n  \`\`\`\n  ${n.codeSnippet}\n  \`\`\``;
        return entry;
      })
      .join("\n");

    const edgesSummary = (repoContext.edges || [])
      .map((e: any) => `- ${e.source} → ${e.target} (${e.type}${e.label ? ": " + e.label : ""})`)
      .join("\n");

    const systemPrompt = `You are an expert code assistant analyzing the GitHub repository "${repoContext.repoName || "unknown"}".

You have deep knowledge of this codebase from the architecture analysis below. Answer questions about the code structure, dependencies, how components work together, and suggest improvements. Be specific and reference actual files/functions when possible.

## Repository Architecture

### Files & Modules
${nodesSummary}

### Dependencies & Relationships
${edgesSummary}

## Guidelines
- Reference specific file paths and function names in your answers
- Explain data flows by tracing through the dependency graph
- When asked "where is X", identify the most relevant file(s)
- Provide code examples when helpful
- Be concise but thorough
- Use markdown formatting for readability`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI chat failed (${response.status})`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat-repo error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
