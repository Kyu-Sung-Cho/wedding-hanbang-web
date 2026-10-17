// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CongratulatoryMoney } from "@/types/money.types";
import { buildMoneyCsv } from "./csv";

// CSV 문법을 읽는 상태기계로 셀/행 경계와 값의 왕복을 확인한다.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = csv.startsWith("\uFEFF") ? 1 : 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += char;
  }
  if (quoted) throw new Error("끝나지 않은 CSV 셀");
  if (row.length || value) { row.push(value); rows.push(row); }
  return rows;
}
const row: CongratulatoryMoney = {
  id: "synthetic", couple_id: "synthetic-couple", guest_name: '친구, "대학동창"',
  amount: 0, side: "both", relation: "친구", method: "transfer",
  memo: "첫째 줄\r\n둘째 줄, 메모", received_at: "2026-10-17",
  created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
};
describe("축의금 CSV", () => {
  it("쉼표·따옴표·줄바꿈을 가진 한글 값과 컬럼 순서를 보존한다", () => {
    const csv = buildMoneyCsv([row]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(parseCsv(csv)).toEqual([
      ["이름", "금액", "신랑/신부", "관계", "수단", "메모", "날짜"],
      [row.guest_name, "0", "공통", "친구", "transfer", row.memo, "2026-10-17"],
    ]);
  });
  it.each(["=1+1", "+SUM(1,2)", "-2+3", "@SUM(A1)", " \t=1+1", "\r\n+1+1", "\t-3", "\uFEFF@SUM(A1)"])(
    "사용자 문자열의 수식 접두사를 텍스트로 내보낸다: %j", (value) => {
      const cells = parseCsv(buildMoneyCsv([{ ...row, guest_name: value, relation: value, memo: value }]))[1];
      expect(cells[0]).toBe("'" + value);
      expect(cells[3]).toBe("'" + value);
      expect(cells[5]).toBe("'" + value);
    },
  );
  it("숫자 금액 0과 음수는 문자열 수식 방어로 바꾸지 않는다", () => {
    const rows = parseCsv(buildMoneyCsv([row, { ...row, amount: -1000 }]));
    expect(rows[1][1]).toBe("0");
    expect(rows[2][1]).toBe("-1000");
  });
  it("빈 목록은 BOM과 헤더만 만든다", () => {
    expect(parseCsv(buildMoneyCsv([]))).toEqual([["이름", "금액", "신랑/신부", "관계", "수단", "메모", "날짜"]]);
  });
});
