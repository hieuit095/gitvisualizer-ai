/**
 * Unified AI Client — works with any OpenAI-compatible API
 *
 * Supported providers (all use OpenAI-compatible endpoints):
 *   - openai:      https://api.openai.com/v1
 *   - openrouter:  https://openrouter.ai/api/v1
 *   - together:    https://api.together.xyz/v1
 *   - gemini:      https://generativelanguage.googleapis.com/v1beta/openai
 *
 * Environment variables:
 *   AI_PROVIDER   — "openai" | "openrouter" | "together" | "gemini" (default: "openai")
 *   AI_API_KEY    — Your API key for the chosen provider
 *   AI_BASE_URL   — (optional) Override the base URL for any custom endpoint
 *   AI_MODEL      — (optional) Override the default model name
 */

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

// ─── Provider Config ───────────────────────────────────────────────────

interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
  embeddingModel: string;
  supportsEmbeddings: boolean;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
    supportsEmbeddings: true,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.0-flash-exp:free",
    embeddingModel: "",
    supportsEmbeddings: false,
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    embeddingModel: "togethercomputer/m2-bert-80M-8k-retrieval",
    supportsEmbeddings: true,
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    embeddingModel: "text-embedding-004",
    supportsEmbeddings: true,
  },
};

function getConfig(): ProviderConfig & { apiKey: string } {
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const config = PROVIDERS[provider];
  if (!config) {
    throw new Error(
      `Unknown AI_PROVIDER "${provider}". Supported: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      `AI_API_KEY is not configured. Set it to your ${provider} API key.`
    );
  }

  return {
    ...config,
    baseUrl: process.env.AI_BASE_URL || config.baseUrl,
    apiKey,
  };
}

export function getProvider(): string {
  return (process.env.AI_PROVIDER || "openai").toLowerCase();
}

export function getModelName(): string {
  return process.env.AI_MODEL || getConfig().defaultModel;
}

// ─── Chat Completion ───────────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<Response> {
  const config = getConfig();
  const model = options.model || process.env.AI_MODEL || config.defaultModel;

  const body: any = {
    model,
    messages,
    stream: options.stream ?? false,
  };
  if (options.tools) {
    body.tools = options.tools;
    if (options.tool_choice) body.tool_choice = options.tool_choice;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  // OpenRouter requires extra headers
  if (getProvider() === "openrouter") {
    headers["HTTP-Referer"] = process.env.APP_URL || "https://gitvisualizer.ai";
    headers["X-Title"] = "GitVisualizer AI";
  }

  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ─── Embeddings ────────────────────────────────────────────────────────

export async function createEmbeddings(
  inputs: string[],
  dimensions = 768
): Promise<EmbeddingResult> {
  const config = getConfig();

  if (!config.supportsEmbeddings || !config.embeddingModel) {
    throw new Error(
      `Provider "${getProvider()}" does not support embeddings. RAG search will use text matching instead.`
    );
  }

  const model = config.embeddingModel;
  const body: any = { model, input: inputs };

  // Only OpenAI and Gemini support dimensions parameter
  if (getProvider() === "openai" || getProvider() === "gemini") {
    body.dimensions = dimensions;
  }

  const res = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embedding failed (${res.status}): ${text}`);
  }
  return res.json();
}

export function supportsEmbeddings(): boolean {
  try {
    const config = getConfig();
    return config.supportsEmbeddings && !!config.embeddingModel;
  } catch {
    return false;
  }
}
