import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { notificationStorageKey } from "@/hooks/useNotifications";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("in-app notification trust contract", () => {
  it("derives stable account-scoped keys and refuses anonymous persistence", () => {
    expect(notificationStorageKey("notification", " user-123 ")).toBe("notification:user-123");
    expect(notificationStorageKey("notification", null)).toBeNull();
    expect(notificationStorageKey("notification", "   ")).toBeNull();
  });

  it("uses only user-recorded schedule events, not generic D-day templates", () => {
    const hook = read("src/hooks/useNotifications.ts");

    expect(hook).toContain("getEvents");
    expect(hook).not.toContain("NOTIFICATION_TEMPLATES");
    expect(hook).not.toContain("ddayInKst");
    expect(hook).not.toContain("ddayTrigger");
  });

  it("opens the canonical schedule instead of a stale checklist mutation modal", () => {
    const topNav = read("src/components/app/TopNav.tsx");
    const panel = read("src/components/app/NotificationPanel.tsx");

    expect(topNav).not.toContain("CategoryChecklistModal");
    expect(topNav).toContain('router.push(weddingPath("/schedule"))');
    expect(panel).toContain("일정 보기");
    expect(panel).not.toContain("체크리스트 보기");
  });

  it("does not expose notification switches with no implemented producer", () => {
    const settings = read("src/app/(app)/settings/page.tsx");

    expect(settings).toContain("내가 등록한 일정 알림");
    expect(settings).not.toContain("앱 안 예산 카드");
    expect(settings).not.toContain("앱 안 준비 팁");
  });

  it("keeps browser-only notification state isolated by the signed-in account", () => {
    const hook = read("src/hooks/useNotifications.ts");
    const topNav = read("src/components/app/TopNav.tsx");
    const settings = read("src/app/(app)/settings/page.tsx");
    const privacy = read("src/app/privacy/page.tsx");

    expect(hook).toContain("notificationStorageKey");
    expect(hook).toContain("ownerId: string | null");
    expect(hook).toContain("localStorage.removeItem(PREFS_KEY)");
    expect(hook).toContain("localStorage.removeItem(DISMISSED_KEY)");
    expect(hook).toContain("if (!ownerId || !prefs.schedule) return [];");
    expect(topNav).toContain("useNotificationPrefs(profile?.id ?? null)");
    expect(topNav).toMatch(/prefs,\s*profile\?\.id \?\? null/);
    expect(settings).toContain("useNotificationPrefs(profile?.id ?? null)");
    expect(privacy).toContain("현재 브라우저의 저장소에 내부 계정 ID별로 분리해 저장합니다");
    expect(privacy).toContain("다른 기기에서는 복구되지 않습니다");
  });

  it("describes the empty state as directly recorded schedules only", () => {
    const panel = read("src/components/app/NotificationPanel.tsx");

    expect(panel).toContain("현재 표시할 일정 알림이 없어요");
    expect(panel).toContain("직접 등록한 예정 일정만 이곳에 표시돼요");
    expect(panel).not.toContain("새로운 알림이 오면 여기에 표시됩니다");
  });

  it("retires unused prescriptive D-day templates", () => {
    expect(existsSync(resolve(process.cwd(), "src/constants/notifications.ts"))).toBe(false);
  });
});
