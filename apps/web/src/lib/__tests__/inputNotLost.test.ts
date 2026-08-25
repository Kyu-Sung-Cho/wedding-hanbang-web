// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

/**
 * **누른 것이 사라지거나 두 번 들어가지 않는지** 본다.
 *
 * 감사에서 나온 같은 종류의 네 건이다. 셋은 화면이 조용한 것이고, 하나는 조용한 것보다
 * 나쁜 것 — 같은 하객이 두 줄로 남아 정산이 어긋난다.
 *
 * 문구가 아니라 배선을 본다. 문구만 보면 죽은 코드가 남아 있어도 통과한다.
 */

const web = (...parts: string[]) => resolve(process.cwd(), "src", ...parts);

/** 주석을 지우고 읽는다 — 설명문이 검사를 통과시키면 안 된다. */
function read(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("총 예산 저장이 조용히 끝나지 않는다", () => {
  const budget = read(web("components", "app", "budget", "BudgetContent.tsx"));

  it("검사가 실제로 파일을 읽는다", () => {
    expect(budget.length).toBeGreaterThan(5000);
    expect(budget).toContain("handleTotalBudgetSave");
  });

  it("조건에 안 맞으면 이유를 말한다", () => {
    // 예전에는 `if (!isNaN(num) && num > 0)` 조건이 거짓이면 **함수가 아무것도
    // 안 했다.** 닫히지도, 저장되지도, 말해주지도 않아 버튼이 죽은 것처럼 보였다.
    const fn = budget.slice(
      budget.indexOf("const handleTotalBudgetSave"),
      budget.indexOf("return (", budget.indexOf("const handleTotalBudgetSave")),
    );
    expect(fn.length, "저장 함수를 못 찾았다").toBeGreaterThan(100);
    // **빈 문자열을 세우는 것과 이유를 말하는 것은 다르다.** 첫 판은 함수 이름만
    // 봤는데, 성공 경로의 `setTotalBudgetError("")` 가 통과시켰다(변형 시험이 잡음).
    expect(fn, "거절 갈래가 사람에게 할 말을 세우지 않는다")
      .toMatch(/setTotalBudgetError\(\s*"[^"]{10,}"\s*\)/);
    // 거절 갈래가 조기 반환해야 한다 — 안 그러면 잘못된 값이 저장된다.
    const guardAt = fn.indexOf("isNaN(num) || num <= 0");
    const saveAt = fn.indexOf("saveJourney(");
    expect(guardAt, "0 이하를 거르는 가드가 없다").toBeGreaterThan(-1);
    expect(guardAt, "가드가 저장보다 뒤에 있다").toBeLessThan(saveAt);
  });

  it("그 이유를 화면에 그린다", () => {
    expect(budget).toContain("{totalBudgetError}");
  });
});

describe("축의금이 두 번 저장되지 않는다", () => {
  const money = read(web("app", "(app)", "money", "page.tsx"));

  it("저장 중이면 다시 받지 않는다", () => {
    // 예식장 로비처럼 회선이 느린 곳에서 실제로 두 번 눌린다. 같은 하객이 두 줄로
    // 남으면 정산이 어긋나고, 사용자는 그것을 나중에야 발견한다.
    const fn = money.slice(
      money.indexOf("const handleSubmit"),
      money.indexOf("const handleEdit"),
    );
    expect(fn.length, "제출 함수를 못 찾았다").toBeGreaterThan(200);
    const guardAt = fn.indexOf("if (saving) return;");
    const writeAt = Math.min(
      ...["addMoney(", "updateMoney("].map((s) => {
        const at = fn.indexOf(s);
        return at === -1 ? Number.MAX_SAFE_INTEGER : at;
      }),
    );
    expect(guardAt, "진행 중 가드가 없다").toBeGreaterThan(-1);
    expect(guardAt, "가드가 저장보다 뒤에 있다").toBeLessThan(writeAt);
    // 실패해도 풀려야 한다 — 안 그러면 한 번 실패한 뒤 영영 못 넣는다.
    expect(fn).toContain("setSaving(false)");
    expect(fn).toContain("} finally {");
  });

  it("저장 중인 것이 화면에 보인다", () => {
    expect(money).toContain("aria-busy={saving}");
    expect(money).toContain('saving ? "저장 중..."');
  });
});

describe("검색이 가이드 제목까지 본다", () => {
  const checklist = read(
    web("components", "app", "checklist", "ChecklistContent.tsx"),
  );

  it("가이드 제목이 검색 대상에 들어간다", () => {
    // 없을 때는 "이바지" 처럼 항목 라벨에 없는 말을 별칭에 억지로 박아야 했고,
    // 그러다 엉뚱한 분야로 보냈다 — 「이바지·답례품 예절」을 여는 것은 예단이
    // 아니라 선물 분야다.
    expect(checklist).toContain("${guide?.title ?? \"\"}");
  });

  it("억지 별칭을 지웠다", () => {
    // 순서가 중요하다. 가이드 제목을 넣기 전에 별칭을 빼면 검색이 0건이 된다.
    const aliases = checklist.slice(
      checklist.indexOf("CATEGORY_SEARCH_ALIASES"),
      checklist.indexOf("};", checklist.indexOf("CATEGORY_SEARCH_ALIASES")),
    );
    expect(aliases.length).toBeGreaterThan(50);
    expect(aliases, "예단 별칭에 이바지가 남아 있다").not.toContain("이바지");
  });
});

describe("확정일자 note 가 잔금과의 선후를 말한다", () => {
  it("남은 금액과 견주라고 말한다", () => {
    const registration = CATEGORY_CHECKLISTS.find((c) => c.key === "registration");
    const note = registration?.items.find((i) => i.label.includes("확정일자"))?.note;
    expect(note, "확정일자 항목을 못 찾았다").toBeTruthy();
    // 이 파일은 "잔금" 이 아니라 "남은 금액" 을 쓴다(일상어 규칙).
    expect(note).toContain("남은 금액");
    expect(note!.length, "note 상한 80자를 넘었다").toBeLessThanOrEqual(80);
  });
});
