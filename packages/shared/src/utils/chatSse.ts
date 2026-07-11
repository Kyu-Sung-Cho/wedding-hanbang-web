export interface ParsedChatSse {
  content: string;
  completed: boolean;
  error?: string;
}

interface ChatSseEvent {
  type?: string;
  content?: unknown;
  fullContent?: unknown;
  message?: unknown;
}

/** 서버의 공급자 중립 채팅 SSE를 완결된 메시지로 정규화한다. */
export function parseChatSse(raw: string): ParsedChatSse {
  let content = "";
  let completed = false;
  let error: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let event: ChatSseEvent;
    try {
      event = JSON.parse(payload) as ChatSseEvent;
    } catch {
      continue;
    }

    if (event.type === "text_delta" && typeof event.content === "string") {
      content += event.content;
    } else if (event.type === "text_clear") {
      content = "";
    } else if (event.type === "done") {
      if (typeof event.fullContent === "string") content = event.fullContent;
      completed = true;
    } else if (event.type === "error") {
      error = typeof event.message === "string" ? event.message : "AI 응답 생성에 실패했어요.";
    }
  }

  return { content, completed, ...(error ? { error } : {}) };
}
