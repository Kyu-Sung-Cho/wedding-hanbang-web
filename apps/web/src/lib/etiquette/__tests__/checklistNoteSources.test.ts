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

  /**
   * 근거 없이 써도 되는 문장의 **문법**.
   *
   * 이 자리는 두 번 어휘 목록이었고 두 번 다 좋은 문구를 걸렀다. 처음에는 어미를
   * 나열했더니("물어보세요|요청하세요…") "확인하세요."가 걸렸고, 동사 목록으로 바꿨더니
   * 요청·대조·의논이 걸렸다. 세 번째로 늘리려던 순간에 목록 자체가 문제라는 게 분명해졌다 —
   * "살펴보고 바로 말하세요", "연락처를 미리 알려 두세요", "등기부등본을 떼어 보고 달라진
   * 데가 없는지 보세요"는 전부 참·거짓이 없는 좋은 문장인데 낱말이 목록 밖이라 걸렸다.
   * 목록을 늘릴수록 정작 막아야 할 단정도 함께 통과한다.
   *
   * 그래서 어휘가 아니라 **문법**을 본다. 이 파일의 형제 검사가 편집 지시문을 막을 때 쓴
   * 방법과 같다. 근거 없이 쓰는 문장은 사용자에게 **무엇을 하라고 시키는 말**이라 명령형으로
   * 끝난다. 사실을 알려주는 말("위약금이 붙어요", "보통 두 달 전에 보내요")은 시키는 것이
   * 없어서 이 꼴이 될 수 없다.
   *
   * 이유를 앞에 다는 것은 막지 않는다("…갈리니 먼저 물어보세요"). 그건 시키는 말의 일부다.
   * 근거를 댄 문장은 애초에 이 검사를 지나가지 않는다 — 참·거짓을 원문이 지고 있다.
   *
   * 위 검사와 아래 반례가 같은 값을 봐야 한다. 복사해 두면 규칙을 고쳤을 때 반례만 옛 값을
   * 보고 그대로 통과해서, 고친 쪽이 안전한지 아무도 확인하지 못한다.
   */
  const TELLS_USER_WHAT_TO_DO = /(세요|십시오)\.$/;

  it("근거가 없는 안내는 사용자가 할 일을 시킨다", () => {
    const withSource = new Set(noteSourceItemIds());
    for (const { item } of noted) {
      if (withSource.has(item.id)) continue;
      expect(item.note, `${item.id}는 근거 없이 단정한다`).toMatch(TELLS_USER_WHAT_TO_DO);
    }
  });

  /**
   * 위 검사가 정말 무는지 여기서 본다.
   *
   * 규칙이 사실상 아무거나 통과시키면 초록불은 안전이 아니라 착시다. 실제로 실릴 법한
   * 단정 문장을 넣어 보고 걸리는 것을 확인한다. 마지막 둘은 앞선 어휘 목록이 놓쳤던
   * 모양이다 — 목록에 있는 낱말을 품고도 시키는 것은 없는 문장이다.
   */
  it("단정하는 문장은 이 검사에 걸린다", () => {
    const 단정 = [
      "계약을 무르면 위약금이 붙어요.",
      "초대장은 두 달 전에 보내는 것이 보통이에요.",
      "촬영본은 업체가 계속 가지고 있어요.",
      "업체마다 확인해 주는 범위가 달라요.",
      "이야기해 두면 좋은 것이 몇 가지 있어요.",
    ];
    expect(단정.filter((sentence) => TELLS_USER_WHAT_TO_DO.test(sentence))).toEqual([]);
  });
});
