import { describe, expect, it } from "vitest";
import { V40_BANK_DATA, V40_BANK_IS_PLACEHOLDER, V40_BANK_SOURCE_SHA256 } from "@/constants/weddingCodeV40Bank";
import { V40_LAYOUT } from "@/lib/weddingCode/v40/layout";
import type { Item } from "@/lib/weddingCode/v40/types";

/**
 * 생성된 문항 은행(weddingCodeV40Bank.ts)이 동결된 배치 골격(layout.ts)과 극 배열 규칙을 지키는지 본다.
 * 은행 검사기(scripts/wedding-code-v40-bank-lint.mjs)가 원본 JSON 에서 하는 검사의 타입스크립트 쪽 짝이며,
 * 두 쪽이 같은 골격(layout.ts)을 본다는 것을 확인하는 것이 목적이다. 문구 규칙은 검사기 시험이 맡는다.
 */

const KEY_ARRANGEMENT = {
  recall: { "1": ["back:weak", "front:strong", "front:weak", "back:strong"], "-1": ["front:weak", "back:strong", "back:weak", "front:strong"] },
} as const;

function derivedKey(item: Item): 1 | -1 | null {
  const sign = (pole: string) => (pole === "front" ? 1 : pole === "back" ? -1 : null);
  switch (item.fmt) {
    case "pair":
    case "self":
      return sign(item.cards[0].pole);
    case "react":
      return sign(item.highPole);
    case "recall":
    case "instant": {
      const sig = item.options.map((o) => `${o.pole}:${o.strength}`);
      if (sig.join() === KEY_ARRANGEMENT.recall["1"].join()) return 1;
      if (sig.join() === KEY_ARRANGEMENT.recall["-1"].join()) return -1;
      return null;
    }
    case "bestworst": {
      const poles = item.cards.map((c) => c.pole).join();
      return poles === "front,back,back,front" ? 1 : poles === "back,front,front,back" ? -1 : null;
    }
    case "split": {
      const poles = item.entries.map((e) => e.pole).join();
      return poles === "front,back,neutral" ? 1 : poles === "back,front,neutral" ? -1 : null;
    }
  }
}

describe("생성된 웨딩코드 4.0 문항 은행", () => {
  it("문항 68개가 배치 골격의 순서, id, 주제, 측면, 구간, 화면, 형식, 종류, 키와 같다", () => {
    expect(V40_BANK_DATA.items).toHaveLength(68);
    V40_BANK_DATA.items.forEach((item, index) => {
      const slot = V40_LAYOUT[index];
      expect(item.id).toBe(slot.id);
      expect(item.axis).toBe(slot.axis);
      expect("facet" in item ? item.facet : null).toBe(slot.facet);
      expect(item.section).toBe(slot.section);
      expect(item.screen).toBe(slot.screen);
      expect(item.fmt).toBe(slot.fmt);
      expect("kind" in item ? item.kind : null).toBe(slot.kind);
      expect(item.key).toBe(slot.key);
    });
  });

  it("극 배열이 key 에서 파생한 배열과 같다", () => {
    for (const item of V40_BANK_DATA.items) expect(derivedKey(item), item.id).toBe(item.key);
  });

  it("문구 필드에 줄표, 아라비아 숫자, 퍼센트 기호가 없다", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    for (const item of V40_BANK_DATA.items) {
      const { id, axis, ...rest } = item as Item & Record<string, unknown>;
      void id;
      void axis;
      for (const [key, value] of Object.entries(rest)) if (!["facet", "fmt", "kind", "highPole"].includes(key)) walk(value);
    }
    expect(strings.length).toBeGreaterThan(500);
    // 줄표류(짧은 줄표, 긴 줄표, 가로선, 마이너스 기호)는 소스에 그대로 적지 않고 코드 값으로 만든다.
    const forbidden = new RegExp(`[${String.fromCodePoint(0x2013)}-${String.fromCodePoint(0x2015)}${String.fromCodePoint(0x2212)}%0-9]`);
    for (const s of strings) expect(s, s).not.toMatch(forbidden);
  });

  it("원본이 자리표시 문구인지 표시하고, 내용 해시가 있다", () => {
    expect(typeof V40_BANK_IS_PLACEHOLDER).toBe("boolean");
    expect(V40_BANK_SOURCE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
