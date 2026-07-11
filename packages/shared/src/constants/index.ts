export const COUPLE_INVITE_CODE_LENGTH = 15;
export const COUPLE_INVITE_CODE_EXAMPLE = "WH-A1B2C3D4E5F6";

const COUPLE_INVITE_CODE_PATTERN = /^WH-[A-Z0-9]{12}$/;

export function normalizeCoupleInviteCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("WH")) {
    return `WH-${compact.slice(2, 14)}`;
  }
  return compact.slice(0, COUPLE_INVITE_CODE_LENGTH);
}

export function isCoupleInviteCode(value: unknown): value is string {
  return typeof value === "string" && COUPLE_INVITE_CODE_PATTERN.test(value);
}

export function manwonInputToWon(value: string): number {
  const normalized = value.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(normalized)) return 0;

  const manwon = Number(normalized);
  const won = manwon * 10_000;
  return Number.isSafeInteger(won) && won > 0 && won <= 10_000_000_000 ? won : 0;
}

export function wonToManwonInput(value: unknown): string {
  const won = Number(value);
  return Number.isFinite(won) && won > 0 ? String(won / 10_000) : "";
}
