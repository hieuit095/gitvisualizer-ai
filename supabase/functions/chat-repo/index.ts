import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // ─── RAG: Retrieve relevant code chunks ────────────────────
    const userQuery = messages[messages.length - 1]?.content || "";
    let ragContext = "";
    let searchMethod = "none";

    if (repoContext.repoUrl && userQuery) {
      // Try vector search first (if embeddings are available)
      try {
        const embRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/text-embedding-3-small",
            input: [userQuery],
            dimensions: 768,
          }),
        });

        if (embRes.ok) {
          const embData = await embRes.json();
          const queryEmbedding = embData.data?.[0]?.embedding;

          if (queryEmbedding) {
            const { data: chunks } = await db.rpc("match_code_chunks_vector", {
              query_embedding: JSON.stringify(queryEmbedding),
              match_repo_url: repoContext.repoUrl,
              match_threshold: 0.25,
              match_count: 15,
            });

            if (chunks && chunks.length > 0) {
              searchMethod = "vector";
              ragContext = "\n\n## Retrieved Code Chunks (semantic vector search)\n" +
                chunks
                  .map(
                    (c: any) =>
                      `### [${c.file_path}:L${c.start_line}-L${c.end_line}] (${c.chunk_type}: ${c.chunk_name}) — similarity: ${(c.similarity * 100).toFixed(0)}%\n\`\`\`\n${c.content}\n\`\`\``
                  )
                  .join("\n\n");
            }
          }
        }
      } catch (e) {
        console.log("Vector search unavailable, falling back to text search:", e);
      }

      // Fall back to text search if vector search didn't return results
      if (!ragContext) {
        try {
          const { data: chunks } = await db.rpc("match_code_chunks", {
            query_text: userQuery,
            match_repo_url: repoContext.repoUrl,
            match_count: 15,
          });

          if (chunks && chunks.length > 0) {
            searchMethod = "text";
            ragContext = "\n\n## Retrieved Code Chunks (from actual source code)\n" +
              chunks
                .map(
                  (c: any) =>
                    `### [${c.file_path}:L${c.start_line}-L${c.end_line}] (${c.chunk_type}: ${c.chunk_name})\n\`\`\`\n${c.content}\n\`\`\``
                )
                .join("\n\n");
          }
        } catch (e) {
          console.error("Text search error:", e);
        }
      }
    }

    console.log(`RAG search method: ${searchMethod}, context length: ${ragContext.length}`);

    // ─── Build compact repo structure ──────────────────────────
    const nodesSummary = (repoContext.nodes || [])
      .map((n: any) => `- **${n.name}** (${n.type}) [${n.path}]: ${n.summary || ""}`)
      .join("\n");

    const edgesSummary = (repoContext.edges || [])
      .map((e: any) => `- ${e.source} → ${e.target} (${e.type}${e.label ? ": " + e.label : ""})`)
      .join("\n");

    const hasRagChunks = ragContext.length > 0;

    const systemPrompt = `You are an expert code assistant analyzing the GitHub repository "${repoContext.repoName || "unknown"}".

## Repository Architecture

### Files & Modules
${nodesSummary}

### Dependencies & Relationships
${edgesSummary}
${ragContext}

## Guidelines
- ${hasRagChunks ? "**ALWAYS cite your sources** using the format \`[filename:L##-L##]\` when referencing code from the retrieved chunks above." : "Reference specific file paths and function names in your answers."}
- ${hasRagChunks ? "Base your answers on the actual code shown in the retrieved chunks. Do NOT invent code that isn't shown." : "Explain data flows by tracing through the dependency graph."}
- When asked "where is X", identify the most relevant file(s)${hasRagChunks ? " and cite the exact line ranges" : ""}
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
