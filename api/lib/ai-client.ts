// Unified AI client abstraction for OpenAI and Gemini

const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  model?: string;
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
}

interface EmbeddingResult {
  data: Array<{ index: number; embedding: number[] }>;
}

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return key;
}

export function getProvider(): string {
  return AI_PROVIDER;
}

// Map generic model names to provider-specific ones
function resolveModel(model?: string): string {
  if (AI_PROVIDER === "openai") {
    if (!model || model.includes("gemini")) return "gpt-4o-mini";
    return model;
  }
  // Gemini
  if (!model || model.includes("gpt")) return "gemini-2.0-flash";
  // Strip provider prefix if present
  return model.replace(/^google\//, "");
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<Response> {
  const model = resolveModel(options.model);

  if (AI_PROVIDER === "openai") {
    const body: any = {
      model,
      messages,
      stream: options.stream ?? false,
    };
    if (options.tools) {
      body.tools = options.tools;
      if (options.tool_choice) body.tool_choice = options.tool_choice;
    }

    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  // Gemini via OpenAI-compatible endpoint
  const body: any = {
    model,
    messages,
    stream: options.stream ?? false,
  };
  if (options.tools) {
    body.tools = options.tools;
    if (options.tool_choice) body.tool_choice = options.tool_choice;
  }

  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getGeminiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

export async function createEmbeddings(
  inputs: string[],
  dimensions = 768
): Promise<EmbeddingResult> {
  if (AI_PROVIDER === "openai") {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: inputs,
        dimensions,
      }),
    });
    if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
    return res.json();
  }

  // Gemini embeddings via OpenAI-compatible endpoint
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getGeminiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-004",
        input: inputs,
        dimensions,
      }),
    }
  );
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  return res.json();
}
