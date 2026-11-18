import { cleanOptionalKoreanMobile, isRecord, isUuid } from "@/utils/requestValidation";
import type { StoredShares } from "./inquiryRepository";
import { budgetShareValues, formatMobile } from "./letter";

/**
 * PUT `/api/invitation/letter` 본문 검사. 받는 곳, 글, 알려줄 정보를 받는다. 맺음말과 예산 값은 서버가 만든다.
 * 끈 정보는 값을 남기지 않는다. 휴대폰을 켜면서 값을 비우면 앞 판의 번호를 쓴다(화면은 가린 번호만 받기 때문).
 */

export const MAX_LETTER_BODY_CHARS = 1000;
const MAX_NAME_CHARS = 40;
const UNSAFE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type LetterShareInput = {
  name: { on: boolean; value: string | null };
  phone: { on: boolean; value: string | null };
  budget: { on: boolean };
};

export type LetterInput = {
  letterId: string | null;
  recipientHallIds: string[];
  body: string;
  shares: LetterShareInput;
};

export type LetterInputResult = { ok: true; value: LetterInput } | { ok: false; error: string };

const fail = (error: string): LetterInputResult => ({ ok: false, error });

/** 줄바꿈은 남기고 그 밖의 제어·서식 문자는 막는다. 앞뒤 공백과 세 줄 넘는 빈 줄은 정리한다. */
export function normalizeLetterBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^[ \n]+|[ \n]+$/g, "");
  const length = Array.from(body).length;
  if (length < 1 || length > MAX_LETTER_BODY_CHARS) return null;
  if (body.split("\n").some((line) => UNSAFE_LINE.test(line))) return null;
  return body;
}

function shareInput(value: unknown, withValue: boolean): { on: boolean; value: string | null } | null {
  if (!isRecord(value) || typeof value.on !== "boolean") return null;
  const allowed = withValue ? ["on", "value"] : ["on"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  if (!withValue) return { on: value.on, value: null };
  if (value.value !== undefined && value.value !== null && typeof value.value !== "string") return null;
  return { on: value.on, value: typeof value.value === "string" ? value.value : null };
}

export function parseLetterInput(body: unknown): LetterInputResult {
  if (!isRecord(body)) return fail("요청 형식이 올바르지 않아요.");
  if (Object.keys(body).some((key) => !["letterId", "recipientHallIds", "body", "shares"].includes(key))) {
    return fail("알 수 없는 항목이 있어요.");
  }
  const letterId = body.letterId;
  if (letterId !== undefined && letterId !== null && !isUuid(letterId)) return fail("편지를 다시 불러와 주세요.");

  const ids = body.recipientHallIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || !ids.every(isUuid)) return fail("받는 곳을 다시 골라 주세요.");
  const recipientHallIds = ids.map((id) => (id as string).toLowerCase());
  if (new Set(recipientHallIds).size !== recipientHallIds.length) return fail("같은 곳이 두 번 들어 있어요.");

  const text = normalizeLetterBody(body.body);
  if (!text) return fail(`편지 글은 1자부터 ${MAX_LETTER_BODY_CHARS}자 사이로 써 주세요.`);

  const shares = body.shares;
  if (!isRecord(shares) || Object.keys(shares).some((key) => !["name", "phone", "budget"].includes(key))) {
    return fail("알려줄 정보를 다시 확인해 주세요.");
  }
  const name = shareInput(shares.name, true);
  const phone = shareInput(shares.phone, true);
  const budget = shareInput(shares.budget, false);
  if (!name || !phone || !budget) return fail("알려줄 정보를 다시 확인해 주세요.");

  return {
    ok: true,
    value: {
      letterId: typeof letterId === "string" ? letterId.toLowerCase() : null,
      recipientHallIds,
      body: text,
      shares: { name, phone, budget: { on: budget.on } },
    },
  };
}

export type ShareResolution = { ok: true; shares: StoredShares } | { ok: false; error: string };

/** 저장할 알려줄 정보를 만든다. 켠 칸만 값을 남긴다. */
export function resolveShares(input: LetterShareInput, previous: StoredShares | null, totalBudget: number | null): ShareResolution {
  let name: StoredShares["name"] = { on: false, value: null };
  if (input.name.on) {
    const given = input.name.value?.trim() ?? "";
    const value = given.length > 0 ? given : previous?.name.on ? previous.name.value ?? "" : "";
    if (Array.from(value).length < 1 || Array.from(value).length > MAX_NAME_CHARS || UNSAFE_LINE.test(value)) {
      return { ok: false, error: "알려줄 이름을 적어 주세요." };
    }
    name = { on: true, value };
  }

  let phone: StoredShares["phone"] = { on: false, value: null };
  if (input.phone.on) {
    let value: string | null = null;
    if (input.phone.value && input.phone.value.trim().length > 0) {
      const digits = cleanOptionalKoreanMobile(input.phone.value);
      value = typeof digits === "string" ? formatMobile(digits) : null;
      if (!value) return { ok: false, error: "휴대폰 번호를 다시 확인해 주세요." };
    } else if (previous?.phone.on && previous.phone.value) {
      value = previous.phone.value;
    }
    if (!value) return { ok: false, error: "알려줄 휴대폰 번호를 적어 주세요." };
    phone = { on: true, value };
  }

  const budget: StoredShares["budget"] = input.budget.on
    ? { on: true, value: budgetShareValues(totalBudget).stored }
    : { on: false, value: null };

  return { ok: true, shares: { name, phone, budget } };
}
