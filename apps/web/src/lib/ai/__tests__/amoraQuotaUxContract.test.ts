import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
}

describe("Amora unlimited test-stage UX", () => {
  it("defaults usage limits off without removing durable provider metering", () => {
    const guard = source("src/lib/ai/costGuard.ts");
    const envExample = source(".env.example");
    const webChat = source("src/components/app/chat/ChatContent.tsx");
    const mobileChat = source("../mobile/app/(tabs)/chat.tsx");
    const profileEditor = source("src/lib/ai/amora-profile.ts");

    expect(guard).not.toContain("AMORA_FREE_MESSAGES_PER_COUPLE");
    expect(guard).toContain('process.env.AMORA_USAGE_LIMITS_ENABLED === "true"');
    expect(guard).toContain('"reserve_amora_usage_unlimited_v1"');
    expect(envExample).toContain("AMORA_USAGE_LIMITS_ENABLED=false");
    expect(guard.match(/p_count_user_turn: false/g)).toHaveLength(2);
    expect(webChat).not.toContain("베타 무료 상담");
    expect(mobileChat).not.toContain("베타 무료 상담");
    expect(profileEditor).not.toMatch(/무료 이용자|질문 횟수.*아끼/);
    expect(profileEditor).toContain("불필요한 재질문을 줄이기 위해");
  });

  it("keeps old rolling and future opt-in limit errors terminal", () => {
    const route = source("src/app/api/chat/route.ts");
    const mobileChat = source("../mobile/app/(tabs)/chat.tsx");

    expect(route).toContain('code: preflight.reason ?? "guard_unavailable"');
    expect(route).toContain('{ code: err.result.reason ?? "guard_unavailable" }');
    expect(mobileChat).toContain('retry: isTerminalLimit ? "none" : "ai"');
    expect(mobileChat).toContain('sendIssue.retry !== "none"');
  });
});
