import { describe, expect, it } from "vitest";
import { buildAiHeaders, resolveAiConfig } from "../../api/lib/ai-config";

describe("resolveAiConfig", () => {
  it("allows custom OpenAI-compatible providers when base URL is supplied", () => {
    const config = resolveAiConfig({
      AI_PROVIDER: "custom-provider",
      AI_API_KEY: "test-key",
      AI_BASE_URL: "https://example.com/v1/",
      AI_MODEL: "my-model",
      AI_EMBEDDING_MODEL: "my-embedding-model",
    });

    expect(config.provider).toBe("custom-provider");
    expect(config.baseUrl).toBe("https://example.com/v1");
    expect(config.chatModel).toBe("my-model");
    expect(config.embeddingModel).toBe("my-embedding-model");
    expect(config.supportsEmbeddings).toBe(true);
  });

  it("prefers AI_CHAT_MODEL over AI_MODEL", () => {
    const config = resolveAiConfig({
      AI_PROVIDER: "openai",
      AI_API_KEY: "test-key",
      AI_MODEL: "fallback-model",
      AI_CHAT_MODEL: "preferred-model",
    });

    expect(config.chatModel).toBe("preferred-model");
  });

  it("lets users disable embeddings even when a preset supports them", () => {
    const config = resolveAiConfig({
      AI_PROVIDER: "openai",
      AI_API_KEY: "test-key",
      AI_ENABLE_EMBEDDINGS: "false",
    });

    expect(config.supportsEmbeddings).toBe(false);
  });
});

describe("buildAiHeaders", () => {
  it("adds OpenRouter compatibility headers when targeting OpenRouter", () => {
    const config = resolveAiConfig({
      AI_PROVIDER: "openrouter",
      AI_API_KEY: "test-key",
    });

    const headers = buildAiHeaders(config, {
      OPENROUTER_HTTP_REFERER: "https://example.app",
      OPENROUTER_APP_NAME: "Example App",
    });

    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["HTTP-Referer"]).toBe("https://example.app");
    expect(headers["X-Title"]).toBe("Example App");
  });
});
