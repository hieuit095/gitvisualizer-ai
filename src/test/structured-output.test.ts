import { describe, expect, it } from "vitest";
import { extractJsonObject, extractStructuredArguments } from "../../api/lib/structured-output";

describe("structured output parsing", () => {
  it("prefers tool call arguments when present", () => {
    const result = extractStructuredArguments({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  arguments: "{\"ok\":true}",
                },
              },
            ],
            content: "{\"ok\":false}",
          },
        },
      ],
    });

    expect(result).toBe("{\"ok\":true}");
  });

  it("extracts fenced json from content-only responses", () => {
    const result = extractStructuredArguments({
      choices: [
        {
          message: {
            content: "```json\n{\"nodes\":[],\"edges\":[]}\n```",
          },
        },
      ],
    });

    expect(result).toBe("{\"nodes\":[],\"edges\":[]}");
  });

  it("extracts embedded json objects from plain text", () => {
    expect(extractJsonObject("Here is the payload: {\"summary\":\"ok\"}")).toBe("{\"summary\":\"ok\"}");
  });

  it("unwraps tool-style arrays returned in message content", () => {
    const result = extractStructuredArguments({
      choices: [
        {
          message: {
            content: "[{\"name\":\"create_architecture_diagram\",\"parameters\":{\"nodes\":[],\"edges\":[]}}]",
          },
        },
      ],
    });

    expect(result).toBe("{\"nodes\":[],\"edges\":[]}");
  });

  it("extracts balanced json fragments from mixed content", () => {
    const result = extractJsonObject("Result:\n[{\"name\":\"tool\",\"parameters\":{\"summary\":\"ok\"}}]\nDone");
    expect(result).toBe("{\"summary\":\"ok\"}");
  });
});
