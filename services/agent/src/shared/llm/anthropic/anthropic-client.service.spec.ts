import { ConfigService } from "@nestjs/config";
import { firstValueFrom, toArray } from "rxjs";
import { AnthropicClientService } from "./anthropic-client.service";
import { LlmError } from "../llm.types";

interface FakeAnthropicInstance {
  messages: {
    create: jest.Mock;
    stream: jest.Mock;
  };
}

let fakeInstance: FakeAnthropicInstance;

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => fakeInstance),
}));

function createConfig(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe("AnthropicClientService", () => {
  beforeEach(() => {
    fakeInstance = {
      messages: {
        create: jest.fn(),
        stream: jest.fn(),
      },
    };
  });

  it("supportsModel matches the claude- prefix", () => {
    const svc = new AnthropicClientService(createConfig({ "llm.anthropic.apiKey": "test" }));
    expect(svc.supportsModel("claude-sonnet-4-5-20250929")).toBe(true);
    expect(svc.supportsModel("gpt-4o")).toBe(false);
  });

  it("createCompletion throws LlmError when API key missing", async () => {
    const svc = new AnthropicClientService(createConfig({}));
    await expect(
      svc.createCompletion({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-sonnet-4-5-20250929",
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("createCompletion calls SDK, extracts text content and usage", async () => {
    const svc = new AnthropicClientService(
      createConfig({ "llm.anthropic.apiKey": "test", "llm.anthropic.maxTokens": 1024 }),
    );
    fakeInstance.messages.create.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: ", world" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 42, output_tokens: 7 },
    });

    const result = await svc.createCompletion({
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "hi" },
      ],
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.2,
    });

    expect(result).toEqual({
      content: "Hello, world",
      model: "claude-sonnet-4-5-20250929",
      responseId: "msg_1",
      finishReason: "end_turn",
      usage: { inputTokens: 42, outputTokens: 7 },
    });
    expect(fakeInstance.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: "be helpful",
        temperature: 0.2,
      }),
    );
  });

  it("createCompletionStream emits deltas and a final usage chunk", async () => {
    const svc = new AnthropicClientService(createConfig({ "llm.anthropic.apiKey": "test" }));

    const events = [
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hel" },
      },
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "lo" },
      },
    ];
    const finalMessage = {
      id: "msg_42",
      model: "claude-sonnet-4-5",
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    fakeInstance.messages.stream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const e of events) yield e;
      },
      finalMessage: async () => finalMessage,
    });

    const chunks = await firstValueFrom(
      svc
        .createCompletionStream({
          messages: [{ role: "user", content: "hi" }],
          model: "claude-sonnet-4-5",
          stream: true,
        })
        .pipe(toArray()),
    );

    expect(chunks.map((c) => c.delta)).toEqual(["Hel", "lo", ""]);
    const last = chunks[chunks.length - 1];
    expect(last.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(last.finishReason).toBe("end_turn");
    expect(last.responseId).toBe("msg_42");
  });
});
