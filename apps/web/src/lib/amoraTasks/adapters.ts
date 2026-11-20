import { assessAmoraSafetyText } from "@hanbang/shared/amora-crisis-classifier";

/**
 * 다른 갈래와 잇는 얇은 어댑터(25장 6절).
 *
 * 갈래 1(문지기), 2(앱 알림), 3(찾아보기), D-83 1단계(편지·답장)의 함수는 아직 main 에 없다.
 * 맡은 일 엔진은 이 파일의 모양만 안다. 각 갈래가 병합되면 `defaultAmoraTaskAdapters()` 안의 한 줄씩을
 * 실제 함수로 바꾼다. 시험은 이 모양에 맞춘 가짜를 넘긴다.
 *
 * 계약(부모 세션이 전한 이름):
 *   문지기  checkAmoraGate({ text, surface: "amora_task_request", userId, coupleId }) → { verdict: allow|out_of_scope|blocked_risk|crisis, reply }
 *   앱 알림  sendAmoraPush({ userId, kind: "task_done", deepLink: "home", dedupeKey: "task_done:<id>" }) → { sent, reason }
 *   찾아보기 searchWeb({ query, coupleId }), readPage({ url, coupleId })
 *   D-83    편지 초안과 답장 정리
 */

export type AmoraTaskGateResult = { allowed: boolean; reply: string | null };

/**
 * 갈래 2 `sendAmoraPush` 의 결과(2026-11-20 부모 세션이 전한 계약). 던지지 않는다.
 * reason: sent, disabled, provider_unconfigured, invalid, quiet_hours, not_consented, daily_cap, duplicate,
 * no_device, provider_error, unavailable. 조용한 시간·동의·하루 상한·같은 dedupeKey 는 그 함수가 판단한다.
 */
export type AmoraTaskPushResult = { sent: boolean; reason: string };

/**
 * 갈래 3 `searchWeb`·`readPage`(apps/web/src/lib/ai/webLookup/amoraWebLookup.ts)에 맞춘 모양(2026-11-20 부모 세션).
 *
 * - 네이버 결과(hits)는 **화면 전용**이다. 네이버 개발자센터 약관이 검색 데이터를 AI 입력으로 쓰는 것을 금지한다.
 *   그래서 `items` 는 서버가 표를 짜는 데만 쓰고 모델에게 주지 않는다. 모델에게는 갈래 3 의
 *   `webSearchSummaryForModel`·`pageReadSummaryForModel` 이 만든 `modelSummary` 와 번호표(ref)만 간다.
 * - `readPage` 는 `sourceUrls` 에 없는 주소를 읽지 않는다(지어낸 주소로 커플 정보가 새지 않게).
 * - 하루 30회·금액 상한·검색어 개인정보 검사는 갈래 3 함수 안에서 한다. `userTexts` 는 커플이 친 요청 문장이다.
 */
export type AmoraTaskWebSearchItem = {
  name: string;
  url: string | null;
  address: string | null;
  phone: string | null;
};

export type AmoraTaskWebSearchResult =
  | { ok: true; items: AmoraTaskWebSearchItem[]; checkedAt: string; modelSummary: unknown }
  | { ok: false; reason: string };

/** 공식 페이지에서 뽑은 가격(갈래 3 `prices[{ label, amount, quote }]`). */
export type AmoraTaskPagePrice = { label: string; amount: string; quote: string };

export type AmoraTaskPageReadResult =
  | {
    ok: true;
    url: string;
    domain: string;
    title: string;
    prices: AmoraTaskPagePrice[];
    checkedAt: string;
    modelSummary: unknown;
  }
  | { ok: false; reason: string };

export interface AmoraTaskWebSearchAdapter {
  search(input: { query: string; coupleId: string; userTexts: string[] }): Promise<AmoraTaskWebSearchResult>;
  readPage(input: { url: string; coupleId: string; sourceUrls: string[] }): Promise<AmoraTaskPageReadResult>;
}

export type AmoraTaskLetterDraft = { name: string; text: string };
export type AmoraTaskReplyDigestItem = { name: string; date: string | null; time: string | null; note: string | null };

export interface AmoraTaskInquiryAdapter {
  draftLetters(input: { coupleId: string; recipients: string[] }): Promise<AmoraTaskLetterDraft[]>;
  listReplies(input: { coupleId: string }): Promise<AmoraTaskReplyDigestItem[]>;
}

export interface AmoraTaskAdapters {
  checkGate(input: { text: string; surface: "amora_task_request"; userId: string; coupleId: string }): Promise<AmoraTaskGateResult>;
  /** 끝날 때 한 번만 부른다. 결과 까닭은 맡은 일 기록(`notify_reason`)에 남긴다. */
  sendPush(input: {
    userId: string;
    kind: "task_done";
    deepLink: "home" | "chat";
    dedupeKey: string;
  }): Promise<AmoraTaskPushResult>;
  /** 갈래 3 이 없으면 null. 그때 찾기가 드는 일은 카드로 내지 않는다. */
  webSearch: AmoraTaskWebSearchAdapter | null;
  /** D-83 1단계가 없으면 null. 그때 편지·답장 일은 카드로 내지 않는다. */
  inquiry: AmoraTaskInquiryAdapter | null;
}

/**
 * 문지기가 오기 전의 자리. 대화 입구가 이미 위기·범위 판정을 한 말에서 카드가 나오지만, 맡은 일의 조건 글을
 * 한 번 더 같은 위기 판정에 넣어 막는다. 낱말 목록을 새로 만들지 않는다(11-18 "막기만").
 * 갈래 1 이 병합되면 `checkAmoraGate` 로 바꾼다(그 함수가 위기·범위를 함께 본다).
 */
export async function localAmoraTaskGate(text: string): Promise<AmoraTaskGateResult> {
  const assessment = assessAmoraSafetyText(text);
  if (assessment.resolution === "immediate_crisis" || assessment.resolution === "non_immediate_safety") {
    return { allowed: false, reply: null };
  }
  return { allowed: true, reply: null };
}

/** 문지기의 판정 값을 이 엔진의 두 갈래로 줄인다. 모르는 값은 막는다. */
export function normalizeAmoraGateVerdict(value: unknown): AmoraTaskGateResult {
  if (!value || typeof value !== "object") return { allowed: false, reply: null };
  const record = value as { verdict?: unknown; reply?: unknown };
  const reply = typeof record.reply === "string" && record.reply.trim() ? record.reply.trim().slice(0, 300) : null;
  return { allowed: record.verdict === "allow", reply };
}

export function defaultAmoraTaskAdapters(): AmoraTaskAdapters {
  return {
    checkGate: ({ text }) => localAmoraTaskGate(text),
    // 갈래 2 병합 뒤: `sendAmoraPush` (apps/web/src/lib/amora/push/sendAmoraPush.ts) 로 바꾼다.
    sendPush: async () => ({ sent: false, reason: "unavailable" }),
    webSearch: null,
    inquiry: null,
  };
}
