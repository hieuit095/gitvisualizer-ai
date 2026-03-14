import { buildAiHeaders, resolveAiConfig } from "./ai-config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type ChatTool = Record<string, unknown>;
type ToolChoice = Record<string, unknown> | string;

interface ChatOptions {
  model?: string;
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: ToolChoice;
}

interface EmbeddingResult {
  data: Array<{ index: number; embedding: number[] }>;
}

export function getProvider(): string {
  return resolveAiConfig().provider;
}

export function getModelName(): string {
  return resolveAiConfig().chatModel;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<Response> {
  const config = resolveAiConfig();
  const model = options.model || config.chatModel;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: options.stream ?? false,
  };

  if (options.tools?.length) {
    body.tools = options.tools;
    if (options.tool_choice) body.tool_choice = options.tool_choice;
  }

  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildAiHeaders(config),
    body: JSON.stringify(body),
  });
}

export async function createEmbeddings(
  inputs: string[],
  dimensions = 768,
): Promise<EmbeddingResult> {
  const config = resolveAiConfig();

  if (!config.supportsEmbeddings || !config.embeddingModel) {
    throw new Error(
      `Embeddings are not configured for provider "${config.provider}". Set AI_EMBEDDING_MODEL and optionally AI_ENABLE_EMBEDDINGS=true to enable semantic search.`,
    );
  }

  const body: Record<string, unknown> = {
    model: config.embeddingModel,
    input: inputs,
  };

  if (config.provider === "openai" || config.provider === "gemini") {
    body.dimensions = dimensions;
  }

  const res = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: buildAiHeaders(config),
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
    const config = resolveAiConfig();
    return config.supportsEmbeddings && !!config.embeddingModel;
  } catch {
    return false;
  }
}
