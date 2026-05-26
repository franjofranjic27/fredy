export const AGENT_MODEL_ID = "fredy-it-agent";

export interface ResolvedChatRequest {
  sessionId: string;
  model: string;
  stream: boolean;
  userMessage: string;
  allowedToolNames?: string[];
}
