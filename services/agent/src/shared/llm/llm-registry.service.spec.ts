import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Observable } from "rxjs";
import { LlmClient, LlmProviderId } from "./llm-client.interface";
import { LLM_CLIENTS } from "./llm.tokens";
import { LlmRegistryService } from "./llm-registry.service";
import { LlmCompletionResponse, LlmError, LlmModelInfo, LlmStreamChunk } from "./llm.types";

class StubClient implements LlmClient {
  constructor(
    public readonly providerId: LlmProviderId,
    private readonly modelPrefix: string,
    private readonly models: LlmModelInfo[] = [],
  ) {}
  supportsModel(modelId: string): boolean {
    return modelId.startsWith(this.modelPrefix);
  }
  createCompletion(): Promise<LlmCompletionResponse> {
    return Promise.resolve({ content: this.providerId, model: "x" });
  }
  createCompletionStream(): Observable<LlmStreamChunk> {
    return new Observable();
  }
  listModels(): Promise<LlmModelInfo[]> {
    return Promise.resolve(this.models);
  }
}

describe("LlmRegistryService", () => {
  const buildModule = async (
    clients: LlmClient[],
    fallback?: string,
  ): Promise<LlmRegistryService> => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LlmRegistryService,
        { provide: LLM_CLIENTS, useValue: clients },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === "llm.fallbackModel" ? fallback : undefined) },
        },
      ],
    }).compile();
    return moduleRef.get(LlmRegistryService);
  };

  it("resolves the client that supports the requested model", async () => {
    const anthropic = new StubClient("anthropic", "claude-");
    const openai = new StubClient("openai", "gpt-");
    const service = await buildModule([anthropic, openai]);

    expect(service.resolveClient("claude-sonnet-4-5").providerId).toBe("anthropic");
    expect(service.resolveClient("gpt-4o").providerId).toBe("openai");
  });

  it("falls back to the configured fallback model when none supports the request", async () => {
    const anthropic = new StubClient("anthropic", "claude-");
    const openai = new StubClient("openai", "gpt-");
    const service = await buildModule([anthropic, openai], "gpt-4o");

    const resolved = service.resolveClient("unknown-model");
    expect(resolved.providerId).toBe("openai");
  });

  it("uses the default Claude Sonnet fallback when no fallback configured", async () => {
    const anthropic = new StubClient("anthropic", "claude-sonnet-4-5-20250929");
    const openai = new StubClient("openai", "gpt-");
    const service = await buildModule([anthropic, openai]);

    const resolved = service.resolveClient("totally-unknown");
    expect(resolved.providerId).toBe("anthropic");
  });

  it("returns the first client when neither the request nor fallback match", async () => {
    const gemini = new StubClient("google.gemini", "gemini-");
    const service = await buildModule([gemini]);
    const resolved = service.resolveClient("gpt-4o");
    expect(resolved.providerId).toBe("google.gemini");
  });

  it("throws LlmError when no clients are registered", async () => {
    const service = await buildModule([]);
    expect(() => service.resolveClient("anything")).toThrow(LlmError);
  });

  it("aggregates models from all clients", async () => {
    const anthropic = new StubClient("anthropic", "claude-", [
      { id: "claude-sonnet-4-5", object: "model", owned_by: "anthropic" },
    ]);
    const openai = new StubClient("openai", "gpt-", [
      { id: "gpt-4o", object: "model", owned_by: "openai" },
    ]);
    const service = await buildModule([anthropic, openai]);
    const models = await service.listAllModels();
    expect(models.map((m) => m.id)).toEqual(["claude-sonnet-4-5", "gpt-4o"]);
  });
});
