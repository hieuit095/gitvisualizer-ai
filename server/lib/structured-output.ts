export function extractStructuredArguments(aiData: any): string | null {
  const toolArguments = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof toolArguments === "string" && toolArguments.trim()) {
    return toolArguments;
  }

  const messageContent = aiData?.choices?.[0]?.message?.content;
  if (typeof messageContent !== "string" || !messageContent.trim()) {
    return null;
  }

  return extractJsonObject(messageContent);
}

export function extractJsonObject(text: string): string | null {
  const candidates = [
    text.match(/```json\s*([\s\S]*?)```/i)?.[1],
    text.match(/```\s*([\s\S]*?)```/i)?.[1],
    text,
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  for (const candidate of candidates) {
    const direct = tryParseJson(candidate.trim());
    if (direct) return direct;

    for (const fragment of extractBalancedJsonFragments(candidate)) {
      const parsed = tryParseJson(fragment);
      if (parsed) return parsed;
    }
  }

  return null;
}

function tryParseJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    const normalized = normalizeStructuredPayload(parsed);
    return normalized ? JSON.stringify(normalized) : null;
  } catch {
    return null;
  }
}

function normalizeStructuredPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const normalized = normalizeStructuredPayload(item);
      if (normalized) return normalized;
    }
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (record.parameters && typeof record.parameters === "object") {
    return normalizeStructuredPayload(record.parameters);
  }

  if (record.function && typeof record.function === "object") {
    const fn = record.function as Record<string, unknown>;
    if (typeof fn.arguments === "string") {
      const parsedArguments = tryParseJson(fn.arguments);
      if (parsedArguments) return JSON.parse(parsedArguments);
    }
    if (fn.parameters && typeof fn.parameters === "object") {
      return normalizeStructuredPayload(fn.parameters);
    }
  }

  if (typeof record.arguments === "string") {
    const parsedArguments = tryParseJson(record.arguments);
    if (parsedArguments) return JSON.parse(parsedArguments);
  }

  return Object.keys(record).length > 0 ? record : null;
}

function extractBalancedJsonFragments(text: string): string[] {
  const fragments: string[] = [];
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;

    const closing = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = start; index < text.length; index++) {
      const char = text[index];

      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === open) depth++;
      if (char === closing) depth--;

      if (depth === 0) {
        fragments.push(text.slice(start, index + 1).trim());
        break;
      }
    }
  }
  return fragments;
}
