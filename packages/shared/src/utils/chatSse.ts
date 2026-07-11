export interface ChatSseToolResult {
  toolName?: string;
  success?: boolean;
  displayMessage?: string;
  toolOutput?: unknown;
  [key: string]: unknown;
}

export interface ParsedChatSse {
  content: string;
  completed: boolean;
  error?: string;
  toolResults?: ChatSseToolResult[];
  suggestions?: string[];
  quotaRemaining?: number;
  metadata?: Record<string, unknown>;
}

interface ChatSseEvent {
  type?: string;
  content?: unknown;
  fullContent?: unknown;
  message?: unknown;
  result?: unknown;
  suggestions?: unknown;
  remaining?: unknown;
  metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 서버가 전송한 증분 채팅 SSE를 현재까지의 안전한 화면 상태로 정규화한다. */
export function parseChatSse(raw: string): ParsedChatSse {
  let content = "";
  let completed = false;
  let error: string | undefined;
  const toolResults: ChatSseToolResult[] = [];
  let suggestions: string[] | undefined;
  let quotaRemaining: number | undefined;
  let metadata: Record<string, unknown> | undefined;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let event: ChatSseEvent;
    try {
      event = JSON.parse(payload) as ChatSseEvent;
    } catch {
      // 스트림의 마지막 JSON이 아직 덜 도착했거나 손상된 이벤트면 무시한다.
      continue;
    }

    if (event.type === "text_delta" && typeof event.content === "string") {
      content += event.content;
    } else if (event.type === "text_clear") {
      content = "";
    } else if (event.type === "tool_result" && isRecord(event.result)) {
      toolResults.push(event.result as ChatSseToolResult);
    } else if (event.type === "suggestions" && Array.isArray(event.suggestions)) {
      suggestions = event.suggestions.filter(
        (suggestion): suggestion is string => typeof suggestion === "string" && suggestion.trim().length > 0
      );
    } else if (event.type === "quota" && typeof event.remaining === "number" && Number.isFinite(event.remaining)) {
      quotaRemaining = Math.max(0, Math.floor(event.remaining));
    } else if (event.type === "metadata" && isRecord(event.metadata)) {
      metadata = { ...(metadata ?? {}), ...event.metadata };
    } else if (event.type === "done") {
      if (typeof event.fullContent === "string") content = event.fullContent;
      if (isRecord(event.metadata)) metadata = { ...(metadata ?? {}), ...event.metadata };
      completed = true;
    } else if (event.type === "error") {
      error = typeof event.message === "string" ? event.message : "AI 응답 생성에 실패했어요.";
    }
  }

  return {
    content,
    completed,
    ...(error ? { error } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    ...(suggestions ? { suggestions } : {}),
    ...(quotaRemaining !== undefined ? { quotaRemaining } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
