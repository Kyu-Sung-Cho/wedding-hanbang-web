// ============================================================
// 축의금 관리 타입 (구 invitation.types.ts에서 분리 — 청첩장 기능 제거 후 독립)
// ============================================================

export type Side = "groom" | "bride" | "both";

export type MoneyMethod = "cash" | "transfer" | "etc";

export type Relation = "친구" | "직장동료" | "가족" | "친척" | "은사" | "이웃" | "기타";

export interface CongratulatoryMoney {
  id: string;
  couple_id: string;
  guest_name: string;
  amount: number;
  side: Side;
  relation: string | null;
  method: MoneyMethod;
  memo: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
}
