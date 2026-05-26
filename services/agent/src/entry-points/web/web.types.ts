export interface ResolvedChatRequest {
  sessionId: string;
  model: string;
  stream: boolean;
  userMessage: string;
  allowedToolNames?: string[];
}
