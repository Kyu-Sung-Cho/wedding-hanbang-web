import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("retired Amora action UI contract", () => {
  it("uses checklist and explicit schedule as the only active preparation surfaces", () => {
    const lounge = read("src/app/(app)/lounge/page.tsx");
    const weekly = read("src/components/app/WeeklyCard.tsx");

    for (const source of [lounge, weekly]) {
      expect(source).not.toContain("/api/amora/actions");
      expect(source).not.toContain("getAmoraActions");
      expect(source).not.toContain("아모라가 기억하는 다음 행동");
    }
    expect(weekly).not.toContain("actions?:");
    expect(lounge).toContain("직접 입력한 일정, 금액 기록, 체크리스트");
  });

  it("does not mirror retired action results into local journey state", () => {
    const store = read("src/stores/chatStore.ts");
    const chat = read("src/components/app/chat/ChatContent.tsx");

    for (const name of ["add_amora_action", "update_amora_action"]) {
      expect(store).not.toContain(name);
      expect(chat).not.toContain(name);
    }
    expect(store).not.toContain("__amora_actions");
  });

  it("renders legacy action tool results as a historical non-interactive notice", () => {
    const card = read("src/components/app/chat/ActionCard.tsx");

    expect(card).toContain("이전 기능 기록");
    expect(card).toContain("현재 일정·예산·웨딩 정보의 상태를 증명하거나 변경하지 않습니다.");
    expect(card).toContain("최신 상태는 각 관리 화면에서 직접 확인해 주세요.");
    expect(card).not.toContain("ActionItemsMiniCard");
    expect(card).not.toContain("getActionStatusLabel");
    expect(card).not.toContain("result.toolOutput.action");
  });

  it("has no dormant AI action implementation module", () => {
    expect(existsSync(resolve(process.cwd(), "src/lib/ai/tools/amoraActionTools.ts"))).toBe(false);
  });
});
