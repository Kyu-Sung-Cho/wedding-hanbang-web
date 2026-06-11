// 퍼널 이벤트 캡처 래퍼 — PostHog 미설정 시 no-op.
// 핵심 퍼널: $pageview(UTM 자동) → signup_started → chat_message_sent / quote_check_submitted
import posthog from "posthog-js";

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // 분석 실패가 기능을 깨면 안 됨
  }
}
