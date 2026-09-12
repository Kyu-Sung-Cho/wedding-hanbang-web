import { describe, expect, it } from "vitest";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { noteSourceLink } from "@/lib/etiquette/noteSources";
import { buildAmoraPreparationHref, parseAmoraPreparationSource, resolveAmoraPreparationSource } from "./preparationHandoff";

describe("공개 준비 항목의 짧은 아모라 연결", () => {
  it("모든 정본 카테고리와 항목을 ID로 왕복하고 실제 이름과 출처를 복원한다", async () => {
    for (const category of Object.values(CHECKLIST_MAP)) {
      for (const item of [null, ...category.items]) {
        const source = { kind: "checklist" as const, categoryKey: category.key, ...(item ? { itemId: item.id } : {}) };
        const href = buildAmoraPreparationHref(source);
        expect(href).not.toBeNull();
        const url = new URL(href!, "https://hanbang.ai");
        const value = url.searchParams.get("amoraSource")!;
        expect([...url.searchParams.keys()]).toEqual(["amoraSource"]);
        expect(href!.length).toBeLessThan(190);
        expect(parseAmoraPreparationSource(value)).toEqual(source);
        const draft = await resolveAmoraPreparationSource(value);
        expect(draft?.sourceLabel).toContain(category.label);
        expect(draft?.text).toContain(item?.label ?? category.label);
        expect(draft?.sourceHref).toBe(`/checklist?category=${category.key}`);
        if (item) {
          expect(draft?.text).toContain(item.label);
          if (item.note) expect(draft?.referenceText).toContain(item.note);
          const note = noteSourceLink(item.id);
          if (note) expect(draft?.referenceText).toContain(note.heading);
        }
      }
    }
  });

  it("모든 가이드와 실제 절을 제목·절 제목·원래 anchor까지 보존한다", async () => {
    for (const part of MANNERS_PARTS) {
      for (let index = -1; index < part.sections.length; index++) {
        const sectionId = index < 0 ? undefined : `section-${index + 1}`;
        const href = buildAmoraPreparationHref({ kind: "manners", partSlug: part.slug, sectionId });
        const value = new URL(href!, "https://hanbang.ai").searchParams.get("amoraSource")!;
        const draft = await resolveAmoraPreparationSource(value);
        expect(draft?.text).toContain(part.title);
        expect(draft?.referenceText).toContain(part.caveat);
        expect(draft?.referenceText).toContain(part.description);
        expect(draft!.referenceText.length).toBeLessThanOrEqual(12_000);
        for (const source of part.sources) {
          for (const text of [source.url, source.checkedAt, source.scope, source.supports]) expect(draft?.referenceText).toContain(text);
        }
        if (index >= 0) {
          expect(draft?.referenceText).toContain(part.sections[index].heading);
          for (const block of part.sections[index].blocks) {
            if (block.kind === "paragraph") expect(draft?.referenceText).toContain(block.text);
            else if (block.kind === "dialogue") {
              expect(draft?.referenceText).toContain("실제 사용자 발언 아님");
              for (const line of block.lines) {
                expect(draft?.referenceText).toContain(line.say);
                if (line.note) expect(draft?.referenceText).toContain(line.note);
              }
            } else if (block.kind === "table") {
              for (const text of [block.caption, block.asOf, block.limits, ...block.columns, ...block.rows.flat()]) expect(draft?.referenceText).toContain(text);
              if (block.unsourced) expect(draft?.referenceText).toContain("검증된 가격·통계나 필수 관행을 뜻하지 않습니다");
            } else for (const item of block.items) expect(draft?.referenceText).toContain(item);
          }
        } else expect(draft?.referenceText).toContain("편 전체 본문 대신 소개와 절 목록");
        expect(draft?.sourceHref).toBe(`/manners/${part.slug}${sectionId ? `#${sectionId}` : ""}`);
      }
    }
  });

  it.each([
    "", "c", "x.venue", "c.venue.venue_04.extra", "c.__proto__", "c.constructor",
    "c.unknown", "c.venue.studio_01", "c.venue.fake_item", "g.no-such-guide",
    "g.cost-saving.section-999", "g.cost-saving.section-0", "g.cost-saving.section-01",
    "g.cost-saving.section-1?prefill=secret", "g.cost-saving.section-1#x", "c.venue.%76enue_04",
    "c.venue.\nvenue_04", "c.venue." + "x".repeat(180),
  ])("없는 항목·교차 범주·비정상 payload를 문맥으로 쓰지 않는다: %s", async value => {
    expect(await resolveAmoraPreparationSource(value)).toBeNull();
  });

  it("builder는 공개 ID 외의 자유 텍스트를 URL에 넣지 않는다", () => {
    expect(buildAmoraPreparationHref({ kind: "checklist", categoryKey: "venue&memo=비밀" })).toBeNull();
    expect(buildAmoraPreparationHref({ kind: "checklist", categoryKey: "venue", itemId: "이름/금액" })).toBeNull();
    expect(buildAmoraPreparationHref({ kind: "manners", partSlug: "cost-saving", sectionId: "section-1&name=가족" })).toBeNull();
  });

  it("큰 절의 주의문구를 자른 채 숫자만 전달하지 않는다", async () => {
    const part = MANNERS_PARTS[0];
    const original = part.sections[0].blocks;
    try {
      part.sections[0].blocks = [...original, { kind: "paragraph", text: "공개 참고문구 ".repeat(2_000) }];
      expect(await resolveAmoraPreparationSource(`g.${part.slug}.section-1`)).toBeNull();
    } finally { part.sections[0].blocks = original; }
  });
});
