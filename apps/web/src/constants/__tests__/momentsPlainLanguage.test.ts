import { describe, expect, it } from "vitest";
import { MOMENT_LIST, type MomentCell } from "../moments";

function cellCopy(cell: MomentCell | undefined): string[] {
  if (!cell) return [];
  return [
    cell.message,
    ...(cell.checklist ?? []),
    cell.script ?? "",
    cell.question ?? "",
  ];
}

describe("Amora moment copy", () => {
  it("explains each preparation moment without requiring wedding-industry vocabulary", () => {
    const userFacingCopy = MOMENT_LIST.flatMap((moment) => [
      moment.label,
      ...cellCopy(moment.d3),
      ...cellCopy(moment.d1),
      ...cellCopy(moment.dAfter),
    ]).join("\n");

    expect(userFacingCopy).not.toMatch(
      /상견례|예식장|드레스 투어|피팅비|샵|가봉|청첩장|본식|보증인원|식순|잔금|사회자|사례비|피로연|답례품|스드메|부케|컨셉|바우처|양가/,
    );
    expect(userFacingCopy).toContain("양쪽 부모님이 함께 만나는 자리");
    expect(userFacingCopy).toContain("결혼식장에 보장하기로 한 최소 식사 인원");
    expect(userFacingCopy).toContain("계약별 남은 금액");
  });
});
