import type { AmoraTaskKind } from "@hanbang/shared/amora-tasks";

/**
 * 1차로 맡는 일의 종류(25장 2절).
 *
 * - `needs` 가 none 인 일은 다른 갈래 없이 처음부터 끝까지 돈다(할 일·마감, 날짜 후보, 받은 견적).
 * - web_search 는 갈래 3 의 찾아보기가 있어야, inquiry 는 D-83 1단계가 있어야 카드로 낸다.
 * - 표의 칸(같은 기준)은 서버가 정한다. 모델이 칸을 바꾸지 못한다.
 * - 계획 줄(카드에 보이는 두 줄)은 화면 문장이다. D-12 승인 대기.
 */

export type AmoraTaskNeeds = "none" | "web_search" | "inquiry";

export type AmoraTaskKindSpec = {
  needs: AmoraTaskNeeds;
  plan: readonly string[];
  columns: readonly string[];
};

export const AMORA_TASK_KIND_SPECS: Readonly<Record<AmoraTaskKind, AmoraTaskKindSpec>> = Object.freeze({
  todo_deadlines: {
    needs: "none",
    plan: ["등록한 일정과 할 일을 읽어요", "날짜가 가까운 순서로 한 표에 모아요"],
    columns: ["할 일", "날짜", "남은 날", "어디에 있나"],
  },
  date_candidates: {
    needs: "none",
    plan: ["등록한 일정과 예식일을 읽어요", "다른 일정과 겹치지 않는 날을 모아요"],
    columns: ["날짜", "요일", "남은 날", "그 주의 다른 일정"],
  },
  quote_compare: {
    needs: "none",
    plan: ["받은 견적을 같은 항목으로 나눠요", "예산과 함께 한 표에 모아요"],
    columns: ["업체", "합계", "포함 항목", "예산과 차이"],
  },
  hall_candidates: {
    needs: "web_search",
    plan: ["조건에 맞는 웨딩홀을 찾아봐요", "공식 안내에서 확인한 것만 같은 기준 표로 정리해요"],
    columns: ["웨딩홀", "지역", "식대(1인)", "대관료", "보증 인원", "확인한 날"],
  },
  sdm_candidates: {
    needs: "web_search",
    plan: ["조건에 맞는 업체를 찾아봐요", "공식 안내에서 확인한 것만 같은 기준 표로 정리해요"],
    columns: ["업체", "분야", "지역", "가격", "포함 항목", "확인한 날"],
  },
  inquiry_letters: {
    needs: "inquiry",
    plan: ["두 분의 조건으로 업체마다 문의 글을 써요", "보내기는 두 분이 직접 해요"],
    columns: ["업체", "문의 글"],
  },
  reply_digest: {
    needs: "inquiry",
    plan: ["받은 답장의 날짜와 시간을 모아요", "업체마다 한 줄로 정리해요"],
    columns: ["업체", "날짜", "시간", "메모"],
  },
});

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** 바깥에서 온 글을 한 줄로 정리하고 길이를 자른다(글자 단위). */
export function cleanTaskText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, max).join("");
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export const DATE_PURPOSES = ["상견례", "웨딩홀 투어", "스드메 상담", "가족 모임", "기타"] as const;
export const DATE_PREFERENCES = ["weekend", "weekday", "any"] as const;
export const SDM_FIELDS = ["스튜디오", "드레스", "메이크업", "스드메"] as const;

const MAX_WON = 10_000_000_000;

export type NormalizedTaskInput =
  | { ok: true; input: Record<string, unknown>; title: string }
  | { ok: false; reason: string };

function bad(reason: string): NormalizedTaskInput {
  return { ok: false, reason };
}

function normalizeQuotes(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 5) return null;
  const quotes: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const label = cleanTaskText(record.label, 30);
    if (!label) return null;
    const total = record.total_won === undefined || record.total_won === null
      ? null
      : wholeNumber(record.total_won, 0, MAX_WON);
    if (record.total_won !== undefined && record.total_won !== null && total === null) return null;
    const items: { name: string; won: number | null }[] = [];
    if (record.items !== undefined) {
      if (!Array.isArray(record.items) || record.items.length > 12) return null;
      for (const item of record.items) {
        if (!item || typeof item !== "object") return null;
        const name = cleanTaskText((item as Record<string, unknown>).name, 30);
        if (!name) return null;
        const wonRaw = (item as Record<string, unknown>).won;
        const won = wonRaw === undefined || wonRaw === null ? null : wholeNumber(wonRaw, 0, MAX_WON);
        if (wonRaw !== undefined && wonRaw !== null && won === null) return null;
        items.push({ name, won });
      }
    }
    if (total === null && !items.some((item) => item.won !== null)) return null;
    quotes.push({ label, total_won: total, items });
  }
  return quotes;
}

/**
 * 대화 도구가 넘긴 조건을 종류별 정해진 칸으로만 받는다. 모르는 칸은 버리고, 틀린 값이면 카드를 내지 않는다.
 * `todayYmd` 는 한국 날짜다.
 */
export function normalizeAmoraTaskInput(
  kind: AmoraTaskKind,
  raw: unknown,
  todayYmd: string,
): NormalizedTaskInput {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  switch (kind) {
    case "todo_deadlines": {
      const horizon = record.horizon_days === undefined ? 60 : wholeNumber(record.horizon_days, 14, 120);
      if (horizon === null) return bad("horizon_days");
      return { ok: true, input: { horizon_days: horizon }, title: "할 일과 마감 정리" };
    }
    case "date_candidates": {
      const purpose = record.purpose === undefined ? "상견례" : record.purpose;
      if (!DATE_PURPOSES.includes(purpose as (typeof DATE_PURPOSES)[number])) return bad("purpose");
      const prefer = record.prefer === undefined ? "weekend" : record.prefer;
      if (!DATE_PREFERENCES.includes(prefer as (typeof DATE_PREFERENCES)[number])) return bad("prefer");
      const from = record.from_date === undefined ? addDaysYmd(todayYmd, 1) : record.from_date;
      if (!isValidYmd(from) || from <= todayYmd) return bad("from_date");
      const to = record.to_date === undefined ? addDaysYmd(from, 42) : record.to_date;
      if (!isValidYmd(to) || to < from || daysBetweenYmd(from, to) > 90) return bad("to_date");
      return {
        ok: true,
        input: { purpose, prefer, from_date: from, to_date: to },
        title: `${purpose} 날짜 후보 모으기`,
      };
    }
    case "quote_compare": {
      const quotes = normalizeQuotes(record.quotes);
      if (!quotes) return bad("quotes");
      const category = record.category === undefined ? null : cleanTaskText(record.category, 20);
      return { ok: true, input: { category, quotes }, title: "받은 견적 비교" };
    }
    case "hall_candidates": {
      const region = cleanTaskText(record.region, 20);
      if (!region || [...region].length < 2) return bad("region");
      const guests = record.guest_count === undefined ? null : wholeNumber(record.guest_count, 10, 2000);
      if (record.guest_count !== undefined && guests === null) return bad("guest_count");
      const budget = record.budget_won === undefined ? null : wholeNumber(record.budget_won, 0, MAX_WON);
      if (record.budget_won !== undefined && budget === null) return bad("budget_won");
      const dateHint = record.date_hint === undefined ? null : cleanTaskText(record.date_hint, 20);
      return {
        ok: true,
        input: { region, guest_count: guests, budget_won: budget, date_hint: dateHint },
        title: `${region} 웨딩홀 후보 찾기`,
      };
    }
    case "sdm_candidates": {
      const region = cleanTaskText(record.region, 20);
      if (!region || [...region].length < 2) return bad("region");
      const field = record.field === undefined ? "스드메" : record.field;
      if (!SDM_FIELDS.includes(field as (typeof SDM_FIELDS)[number])) return bad("field");
      const budget = record.budget_won === undefined ? null : wholeNumber(record.budget_won, 0, MAX_WON);
      if (record.budget_won !== undefined && budget === null) return bad("budget_won");
      return { ok: true, input: { region, field, budget_won: budget }, title: `${region} ${field} 후보 찾기` };
    }
    case "inquiry_letters": {
      if (!Array.isArray(record.recipients) || record.recipients.length < 1 || record.recipients.length > 5) {
        return bad("recipients");
      }
      const recipients = record.recipients.map((name) => cleanTaskText(name, 30));
      if (recipients.some((name) => name === null)) return bad("recipients");
      return { ok: true, input: { recipients }, title: "업체별 문의 편지 초안" };
    }
    case "reply_digest":
      return { ok: true, input: {}, title: "받은 답장 정리" };
    default:
      return bad("kind");
  }
}

export function addDaysYmd(ymd: string, days: number): string {
  const time = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysBetweenYmd(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
