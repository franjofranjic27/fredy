import { Observable } from "rxjs";
import { LlmStreamChunk } from "../llm/llm.types";

export interface AgentDescriptor {
  id: string;
  description: string;
  ownedBy?: string;
}

export interface AgentRequest {
  sessionId: string;
  userMessage: string;
  allowedToolNames?: string[];
  spaceKey?: string;
}

export interface AgentResponse {
  content: string;
  model: string;
}

export interface Agent {
  readonly descriptor: AgentDescriptor;
  processMessage(request: AgentRequest): Promise<AgentResponse>;
  processMessageStream(request: AgentRequest): Observable<LlmStreamChunk>;
}
