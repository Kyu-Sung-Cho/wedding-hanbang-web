// 퍼널 이벤트 캡처 래퍼 — PostHog 미설정 시 no-op.
// 핵심 퍼널: $pageview(UTM 자동) → signup_started → chat_message_sent
import posthog from "posthog-js";
import { THIRD_PARTY_TELEMETRY_ENABLED } from "@/lib/telemetryPolicy";
import { sanitizeTelemetryRecord } from "@/lib/telemetryPrivacy";

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!THIRD_PARTY_TELEMETRY_ENABLED) return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    posthog.capture(event, sanitizeTelemetryRecord(properties));
  } catch {
    // 분석 실패가 기능을 깨면 안 됨
  }
}
