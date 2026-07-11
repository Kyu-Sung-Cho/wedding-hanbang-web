import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("proactive care safety contract", () => {
  it("keeps both proactive insertion paths code-hard-off", () => {
    expect(read("apps/web/src/app/api/chat/proactive/route.ts")).toContain(
      "const PROACTIVE_CHAT_ENABLED = false"
    );
    expect(read("apps/web/src/app/api/cron/care-moments/route.ts")).toContain(
      "const CARE_MOMENTS_CRON_ENABLED = false"
    );
  });

  it("does not trigger hidden proactive work from the dashboard", () => {
    expect(read("apps/web/src/app/(app)/dashboard/page.tsx")).not.toContain(
      'fetch("/api/chat/proactive")'
    );
  });

  it("does not send partner messages through hidden conflict-model work", () => {
    expect(read("apps/web/src/app/api/chat/check-couple-conflict/route.ts")).toContain(
      "const AUTO_CONFLICT_MEDIATION_ENABLED = false"
    );
    expect(read("apps/web/src/stores/chatStore.ts")).not.toContain(
      'fetch("/api/chat/check-couple-conflict")'
    );
  });

  it("renders a local empty-chat greeting without spending an Amora turn", () => {
    for (const path of [
      "apps/web/src/components/app/chat/ChatContent.tsx",
      "apps/web/src/components/app/chat/ChatSidePanel.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain("requestInitialGreeting(");
      expect(source).toContain("채팅을 여는 것만으로 상담 횟수는 차감되지 않아요.");
    }
  });

  it("defaults and normalizes outbound consent to off", () => {
    const migration = read(
      "supabase/migrations/20260711136000_disable_unconsented_care_notifications.sql"
    );
    expect(migration).toContain("ALTER COLUMN care_notifications_enabled SET DEFAULT false");
    expect(migration).toContain("care_notifications_enabled = false");
    expect(migration).toContain("phone_care_consented_at = NULL");
  });

  it("refuses legacy clients that try to opt in before launch", () => {
    const route = read("apps/web/src/app/api/profile/route.ts");
    expect(route).toContain("아모라 선제 알림은 아직 준비 중입니다.");
    expect(route).toContain("문자·알림톡 자동 알림은 아직 준비 중입니다.");
  });
});
