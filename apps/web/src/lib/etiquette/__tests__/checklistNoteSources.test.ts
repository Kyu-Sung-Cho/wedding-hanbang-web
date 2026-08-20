import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { noteSourceItemIds, noteSourceLink } from "@/lib/etiquette/noteSources";

/**
 * 항목 안내의 근거가 실제로 존재하고, 실제로 도달 가능한가.
 *
 * 안내를 읽고 "왜?"가 생기면 근거를 볼 수 있어야 한다. 그런데 분야 카드가 여는 편은
 * 분야마다 하나로 정해져 있어서(19개 분야 → 11편), 다른 편에서 온 문장은 그 편으로 갈
 * 길이 없었다. 특히 「결혼 비용 절약 가이드」는 19개 분야 어디서도 열리지 않는데
 * 계약 안내 여러 개의 근거다.
 *
 * 절 제목으로 위치를 찾으므로, 제목이 바뀌면 여기서 시끄럽게 실패해야 한다 —
 * 조용히 엉뚱한 절을 가리키는 것보다 낫다.
 */
const items = CATEGORY_CHECKLISTS.flatMap((category) =>
  category.items.map((item) => ({ category, item })),
);
const noted = items.filter(({ item }) => item.note);

describe("항목 안내의 근거", () => {
  it("근거가 적힌 항목이 있다", () => {
    expect(noteSourceItemIds().length).toBeGreaterThan(0);
  });

  it("근거는 전부 실재하는 편과 절을 가리킨다", () => {
    const broken = noteSourceItemIds().filter((id) => noteSourceLink(id) === null);
    expect(broken, "편이 없거나 절 제목이 바뀌었다").toEqual([]);
  });

  it("근거 링크가 그 절의 앵커를 가리킨다", () => {
    for (const id of noteSourceItemIds()) {
      const link = noteSourceLink(id)!;
      const part = MANNERS_PARTS.find((p) => link.href.startsWith(`/manners/${p.slug}#`))!;
      const index = part.sections.findIndex((s) => s.heading === link.heading);
      expect(link.href).toBe(`/manners/${part.slug}#section-${index + 1}`);
      expect(index).toBeGreaterThanOrEqual(0);
    }
  });

  it("근거가 붙은 항목은 전부 실재하는 체크리스트 항목이다", () => {
    const known = new Set(items.map(({ item }) => item.id));
    const ghosts = noteSourceItemIds().filter((id) => !known.has(id));
    expect(ghosts, "없는 항목에 근거가 달려 있다").toEqual([]);
  });

  it("근거가 붙은 항목에는 안내가 있다", () => {
    // 안내 없는 항목에 근거만 다는 것은 화면에 아무것도 만들지 않는다.
    const noteless = noteSourceItemIds().filter(
      (id) => !noted.some(({ item }) => item.id === id),
    );
    expect(noteless, "안내 없는 항목에 근거만 달렸다").toEqual([]);
  });

  /**
   * 이 테스트가 이 작업의 이유다. 근거 편이 분야 카드가 여는 편과 다른 안내가 실제로
   * 있었고, 그것들은 근거를 볼 길이 없었다. 0이 되면 이 링크는 군더더기가 된다.
   */
  it("분야 카드만으로는 닿지 않는 근거가 실제로 있다", () => {
    const unreachable = noteSourceItemIds().filter((id) => {
      const owner = items.find(({ item }) => item.id === id)!;
      const link = noteSourceLink(id)!;
      const categorySlug = mannersPartForCategory(owner.category.key)?.slug;
      return !link.href.startsWith(`/manners/${categorySlug}#`);
    });
    expect(unreachable.length, "분야 링크와 다른 편을 근거로 삼은 안내").toBeGreaterThan(0);
  });

  it("근거가 없는 안내는 무엇을 물어보라는 말이다", () => {
    // 참·거짓이 없는 문장에는 댈 근거도 없다. 그런 것만 비어 있어야 한다.
    const withSource = new Set(noteSourceItemIds());
    for (const { item } of noted) {
      if (withSource.has(item.id)) continue;
      expect(item.note, `${item.id}는 근거 없이 단정한다`).toMatch(/물어보세요|요청하세요|확인해 두세요|여쭤/);
    }
  });
});
