import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS, CHECKLIST_NOTE_SOURCES } from "@hanbang/shared/constants";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { noteSourceItemIds, noteSourceLink } from "@/lib/etiquette/noteSources";
import priorLinks from "./fixtures/note-source-links-before-housing-report.json";

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
  it("신혼집 신고 근거를 추가해도 기존 59개 링크의 목적지와 제목을 보존한다", () => {
    // 웹 중복 표를 제거하기 전 실제 반환값을 고정한 회귀 기준이다.
    expect(Object.keys(priorLinks)).toHaveLength(59);
    for (const [id, expected] of Object.entries(priorLinks)) {
      expect(noteSourceLink(id), id).toEqual(expected);
    }
  });

  it("공유 근거 목록의 모든 항목을 웹에서도 제공한다", () => {
    expect(noteSourceItemIds().sort()).toEqual(Object.keys(CHECKLIST_NOTE_SOURCES).sort());
    expect(noteSourceLink("housing_13")).toEqual({
      href: "/manners/home-conversation#section-5",
      partTitle: "신혼집 논의 예절",
      heading: "계약 직후 — 주택 임대차 계약 신고 대상 확인",
    });
  });

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

/**
 * 근거 링크가 **무엇으로 가는지** 화면에서 말하는가.
 *
 * 링크가 어디로 가는지는 이미 맞았다(위 검사들). 문제는 사용자가 그것을 모른다는 것이었다 —
 * 혼인신고 분야를 열면 똑같은 「근거 보기」가 **일곱 개** 늘어서는데, 실제 목적지는
 * 「가져갈 것」·「어디에 내나요」·「신고를 마친 뒤 챙길 것」·「자녀의 성과 본」으로 흩어져 있다.
 * 무엇을 얻을지 모르는 링크는 눌리지 않는다.
 *
 * **문구가 아니라 구별을 검사한다.** "절 제목을 쓴다"만 보면 한 분야의 링크가 전부 같은
 * 제목으로 뭉쳐도 통과한다. 한 화면 안에서 링크가 실제로 갈리는지를 본다.
 */
describe("근거 링크가 무엇으로 가는지 말한다", () => {
  /** 화면이 그리는 규칙과 같은 것만 적는다 — 표시에서만 절 번호를 벗긴다. */
  const displayHeading = (heading: string) => heading.replace(/^[0-9]+[.] */, "");

  it("컴포넌트가 절 제목을 실제로 쓴다", () => {
    // 소스를 읽는 이유: 이 문구는 렌더 시점에 만들어지고, 붙박이 문자열이 되돌아오는 것을
    // 막는 것이 목적이다. 낱말이 아니라 **배선**을 본다.
    const component = readFileSync(
      resolve(process.cwd(), "src/components/app/checklist/ChecklistItemSource.tsx"),
      "utf8",
    );

    expect(component.length, "컴포넌트를 못 읽었다 — 경로가 낡았다").toBeGreaterThan(500);
    expect(component, "같은 편 링크가 절 제목을 쓰지 않는다").toContain("source.heading");
    expect(component, "붙박이 「근거 보기」가 돌아왔다").not.toContain('"근거 보기"');
  });

  it("절 번호는 표시에서만 벗기고 조회 키는 그대로 둔다", () => {
    // 키를 자르면 `noteSourceLink` 의 절 조회가 통째로 깨진다. 번호가 붙은 편이 실재하는지
    // 부터 확인한다 — 0건이면 이 검사가 조용히 통과한다.
    const numbered = noteSourceItemIds()
      .map((id) => noteSourceLink(id)!)
      .filter((link) => /^[0-9]+[.] /.test(link.heading));
    expect(numbered.length, "번호 붙은 절 제목이 하나도 없다 — 이 검사가 죽어 있다")
      .toBeGreaterThan(0);

    for (const link of numbered) {
      expect(displayHeading(link.heading), "표시에서 절 번호가 안 벗겨졌다")
        .not.toMatch(/^[0-9]+[.] /);
      // 조회 키(원본 heading)로는 절이 여전히 찾아져야 한다.
      const part = MANNERS_PARTS.find((p) => link.href.startsWith(`/manners/${p.slug}#`))!;
      expect(
        part.sections.some((section) => section.heading === link.heading),
        "번호를 벗긴 값이 조회 키로 새어 들어갔다",
      ).toBe(true);
    }
  });

  it("서로 다른 절로 가는 링크는 서로 다른 문구를 단다", () => {
    // 혼인신고가 이 검사의 출발점이다 — 일곱 개가 전부 같은 다섯 글자 「근거 보기」였고,
    // 실제 목적지는 다섯 개의 다른 절이었다.
    //
    // **"문구가 다 다른가"를 묻지 않는다.** 그렇게 물었더니 예단·함이 걸렸는데, 그 둘은
    // 항목 넷이 정말로 **같은 절 하나**를 가리킨다 — 문구가 같은 것이 옳다. 물어야 할 것은
    // 절이 갈리는 만큼 문구도 갈리는가, 즉 절→문구가 일대일인가다.
    //
    // 다른 편으로 가는 링크는 편 제목을 쓰므로(같은 편에 여러 절이 있어도 한 문구다) 여기서
    // 뺀다. 그건 "이건 다른 편이다"를 알리는 것이 목적이라 뭉치는 것이 설계다.
    const perCategory = new Map<string, { sections: Set<string>; labels: Set<string> }>();
    for (const id of noteSourceItemIds()) {
      const categoryKey = id.slice(0, id.lastIndexOf("_"));
      const link = noteSourceLink(id)!;
      const categoryPart = mannersPartForCategory(categoryKey)?.slug;
      if (!link.href.startsWith(`/manners/${categoryPart}#`)) continue;
      if (!perCategory.has(categoryKey)) {
        perCategory.set(categoryKey, { sections: new Set(), labels: new Set() });
      }
      const bucket = perCategory.get(categoryKey)!;
      bucket.sections.add(link.heading);
      bucket.labels.add(displayHeading(link.heading));
    }

    // 측정기 자가검증 — 절이 여럿인 분야가 없으면 아래 대조가 조용히 통과한다.
    const multi = [...perCategory].filter(([, b]) => b.sections.size >= 2);
    expect(multi.length, "절이 둘 이상인 분야가 없다 — 이 검사가 죽어 있다").toBeGreaterThan(0);

    const collapsed = multi
      .filter(([, b]) => b.labels.size !== b.sections.size)
      .map(([key, b]) => `${key}(절 ${b.sections.size} → 문구 ${b.labels.size})`);
    expect(
      collapsed,
      `다른 절로 가는데 같은 문구를 단다: ${collapsed.join(", ")}`,
    ).toEqual([]);
  });
});
