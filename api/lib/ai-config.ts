interface ProviderPreset {
  baseUrl: string;
  chatModel: string;
  embeddingModel?: string;
  supportsEmbeddings: boolean;
}

export interface ResolvedAiConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string | null;
  supportsEmbeddings: boolean;
  isOpenRouter: boolean;
}

const DEFAULT_PROVIDER = "openai";

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
    supportsEmbeddings: true,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    chatModel: "google/gemini-2.0-flash-exp:free",
    supportsEmbeddings: false,
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    chatModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    embeddingModel: "togethercomputer/m2-bert-80M-8k-retrieval",
    supportsEmbeddings: true,
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    chatModel: "gemini-2.0-flash",
    embeddingModel: "text-embedding-004",
    supportsEmbeddings: true,
  },
};

function normalizeProvider(value?: string): string {
  return value?.trim().toLowerCase() || DEFAULT_PROVIDER;
}

function readFirst(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseBoolean(value?: string): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function resolveAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAiConfig {
  const provider = normalizeProvider(env.AI_PROVIDER);
  const preset = PROVIDER_PRESETS[provider];
  const apiKey = readFirst(env.AI_API_KEY);

  if (!apiKey) {
    throw new Error("AI_API_KEY is not configured.");
  }

  const baseUrl = readFirst(env.AI_BASE_URL, preset?.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `AI_BASE_URL is required when AI_PROVIDER is set to "${provider}".`,
    );
  }

  const chatModel = readFirst(env.AI_CHAT_MODEL, env.AI_MODEL, preset?.chatModel);
  if (!chatModel) {
    throw new Error(
      "Set AI_CHAT_MODEL or AI_MODEL to choose the chat/completions model.",
    );
  }

  const embeddingModel =
    readFirst(env.AI_EMBEDDING_MODEL, preset?.embeddingModel) ?? null;
  const requestedEmbeddings = parseBoolean(env.AI_ENABLE_EMBEDDINGS);
  const defaultEmbeddingsEnabled = preset
    ? preset.supportsEmbeddings
    : Boolean(embeddingModel);
  const supportsEmbeddings =
    (requestedEmbeddings ?? defaultEmbeddingsEnabled) && Boolean(embeddingModel);

  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return {
    provider,
    baseUrl: normalizedBaseUrl,
    apiKey,
    chatModel,
    embeddingModel,
    supportsEmbeddings,
    isOpenRouter:
      provider === "openrouter" || normalizedBaseUrl.includes("openrouter.ai"),
  };
}

export function buildAiHeaders(
  config: ResolvedAiConfig,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.isOpenRouter) {
    headers["HTTP-Referer"] =
      readFirst(env.OPENROUTER_HTTP_REFERER, env.APP_URL) ??
      "https://gitvisualizer.ai";
    headers["X-Title"] =
      readFirst(env.OPENROUTER_APP_NAME) ?? "GitVisualizer AI";
  }

  return headers;
}
