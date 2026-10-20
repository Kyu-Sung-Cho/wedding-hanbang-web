import type { CongratulatoryMoney } from "@/types/money.types";

function quoteCell(value: string | number): string {
  let text = String(value);
  // 사용자 문자열은 선행 공백/제어문자 뒤의 수식도 실행하지 않게 한다.
  // 원 단위 숫자는 0/음수까지 그대로 보존한다.
  if (typeof value === "string" && /^\s*[=+@-]/u.test(text)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

export function buildMoneyCsv(moneyList: readonly CongratulatoryMoney[]): string {
  const rows: (string | number)[][] = [
    ["이름", "금액", "신랑/신부", "관계", "수단", "메모", "날짜"],
    ...moneyList.map((money) => [
      money.guest_name,
      money.amount,
      money.side === "groom" ? "신랑" : money.side === "bride" ? "신부" : "공통",
      money.relation ?? "",
      money.method,
      money.memo ?? "",
      money.received_at,
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(quoteCell).join(",")).join("\r\n") + "\r\n";
}
