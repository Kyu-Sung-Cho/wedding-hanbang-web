/**
 * 아모라의 첫마디를 라운지에서 대화 화면까지 들고 가는 자리.
 *
 * ## 왜 저장하는가
 *
 * 첫마디는 `buildAmoraFirstHello`가 온보딩 입력만으로 결정적으로 만든다(모델을 부르지
 * 않는다). 만드는 곳은 라운지이고 보이는 곳은 대화 화면이라, 그 사이를 건널 것이 필요하다.
 *
 * 메모리만으로도 라우터 이동은 건널 수 있다. 그런데 안내를 막 끝낸 사람이 말풍선을 보고
 * 앱을 잠깐 내려놓는 일은 드물지 않고, 그동안 OS가 앱을 회수하면 첫마디는 사라진다.
 * 완료 사실은 이미 프로필에 적혀서 안내는 다시 뜨지 않으므로, 그 사람은 "먼저 말을 거는
 * 아모라"를 영영 못 만난다. 그래서 기기에 남긴다.
 *
 * ## 왜 chat_messages에 쓰지 않는가
 *
 * 첫마디는 대화 기록이 아니라 인사다. DB에 쓰면 모델이 나중에 "내가 그렇게 말했다"를
 * 근거로 삼게 되고, 두 사람의 공유 대화에 사람이 부르지 않은 턴이 남는다. 화면에만
 * 보이는 로컬 메시지로 두는 편이 정직하다.
 *
 * ## 말풍선과 첫마디는 다른 것이다
 *
 * 말풍선(preview)은 알림이고 첫마디(body)는 인사다. 말풍선을 닫는 것은 "알림 봤다"이지
 * "인사 필요 없다"가 아니다. 그래서 닫기는 `bubbleDismissed`만 올리고, 대화를 열면
 * 첫마디는 그대로 놓여 있다.
 */

import type { AmoraFirstHello } from "@hanbang/shared";

/** 저장소 키. 값 모양이 바뀌면 뒤 숫자를 올린다. */
export const PENDING_AMORA_FIRST_HELLO_KEY =
  "@hanbang/amora_first_hello_pending.v1";

/**
 * 이 인사를 유효하게 보는 기간.
 *
 * 한 달 뒤에 처음 대화를 여는 사람에게 "결혼식까지 N일" 같은 그때의 셈을 그대로 보여주면
 * 그건 인사가 아니라 틀린 정보다. 기간이 지나면 없는 것으로 본다.
 */
export const PENDING_AMORA_FIRST_HELLO_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const MAX_PREVIEW_LENGTH = 160;
const MAX_BODY_LENGTH = 2000;

export interface PendingAmoraFirstHello extends AmoraFirstHello {
  savedAt: number;
  /** 말풍선을 사람이 닫았는가. 닫아도 첫마디 자체는 남는다. */
  bubbleDismissed: boolean;
}

/** AsyncStorage와 같은 모양. */
export interface AmoraFirstHelloStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AmoraFirstHelloOptions {
  storage?: AmoraFirstHelloStorage | null;
  now?: number;
}

let pendingInMemory: PendingAmoraFirstHello | null = null;
/**
 * 이미 대화 화면에 건네준 첫마디.
 *
 * 저장소에서 꺼내는 순간 지우지 않으면 이 인사는 열 때마다 다시 나타난다. 그렇다고 꺼내면서
 * 통째로 버리면, 대화를 열었다가 잠깐 라운지로 갔다 온 사람에게서 인사가 사라진다.
 * 그래서 저장소에서는 지우고 이번 실행 동안만 여기 남긴다.
 */
let deliveredInMemory: AmoraFirstHello | null = null;

/** 테스트가 실행 간 상태를 격리할 때 쓴다. */
export function resetAmoraFirstHelloMemory(): void {
  pendingInMemory = null;
  deliveredInMemory = null;
}

function toText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

export function serializePendingAmoraFirstHello(
  record: PendingAmoraFirstHello,
): string {
  return JSON.stringify({
    preview: record.preview,
    body: record.body,
    savedAt: record.savedAt,
    bubbleDismissed: record.bubbleDismissed,
  });
}

/**
 * 저장된 문자열에서 아직 유효한 인사를 꺼낸다.
 *
 * 모양이 깨졌거나, 시각이 없거나, 만료됐거나, 미래 시각이면 null이다. 미래 시각까지
 * 버리는 이유는 기기 시계가 뒤로 돌아간 뒤 저장된 값이 영영 만료되지 않는 것을 막기 위해서다.
 */
export function parsePendingAmoraFirstHello(
  raw: unknown,
  now: number,
  ttlMs: number = PENDING_AMORA_FIRST_HELLO_TTL_MS,
): PendingAmoraFirstHello | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const row = parsed as Record<string, unknown>;
  const preview = toText(row.preview, MAX_PREVIEW_LENGTH);
  const body = toText(row.body, MAX_BODY_LENGTH);
  if (!preview || !body) return null;

  const savedAt = row.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  const age = now - savedAt;
  if (age < 0 || age > ttlMs) return null;

  return {
    preview,
    body,
    savedAt,
    bubbleDismissed: row.bubbleDismissed === true,
  };
}

/** 안내가 끝난 직후 만든 첫마디를 기억한다. */
export async function rememberPendingAmoraFirstHello(
  hello: AmoraFirstHello,
  options: AmoraFirstHelloOptions = {},
): Promise<PendingAmoraFirstHello | null> {
  const { storage = null, now = Date.now() } = options;
  const preview = toText(hello?.preview, MAX_PREVIEW_LENGTH);
  const body = toText(hello?.body, MAX_BODY_LENGTH);
  if (!preview || !body) return null;

  const record: PendingAmoraFirstHello = {
    preview,
    body,
    savedAt: now,
    bubbleDismissed: false,
  };
  pendingInMemory = record;

  if (storage) {
    try {
      await storage.setItem(
        PENDING_AMORA_FIRST_HELLO_KEY,
        serializePendingAmoraFirstHello(record),
      );
    } catch {
      // 저장에 실패해도 이번 실행 안에서는 메모리 값으로 이어진다.
    }
  }
  return record;
}

/** 지우지 않고 보기만 한다. 라운지가 말풍선을 그릴지 정할 때 쓴다. */
export async function peekPendingAmoraFirstHello(
  options: AmoraFirstHelloOptions = {},
): Promise<PendingAmoraFirstHello | null> {
  const { storage = null, now = Date.now() } = options;
  if (pendingInMemory) return pendingInMemory;
  if (!storage) return null;
  try {
    const record = parsePendingAmoraFirstHello(
      await storage.getItem(PENDING_AMORA_FIRST_HELLO_KEY),
      now,
    );
    pendingInMemory = record;
    return record;
  } catch {
    return null;
  }
}

/** 말풍선만 닫는다. 첫마디는 대화 화면에서 그대로 기다린다. */
export async function dismissAmoraFirstHelloBubble(
  options: AmoraFirstHelloOptions = {},
): Promise<void> {
  const { storage = null, now = Date.now() } = options;
  const current = await peekPendingAmoraFirstHello({ storage, now });
  if (!current) return;

  const dismissed: PendingAmoraFirstHello = { ...current, bubbleDismissed: true };
  pendingInMemory = dismissed;
  if (!storage) return;
  try {
    await storage.setItem(
      PENDING_AMORA_FIRST_HELLO_KEY,
      serializePendingAmoraFirstHello(dismissed),
    );
  } catch {
    // 닫힌 상태를 못 적어도 이번 실행에서는 메모리가 막는다.
  }
}

/**
 * 대화 화면이 첫마디를 가져간다. 저장소에서는 지우고 이번 실행 동안만 들고 있는다.
 */
export async function consumePendingAmoraFirstHello(
  options: AmoraFirstHelloOptions = {},
): Promise<AmoraFirstHello | null> {
  const { storage = null, now = Date.now() } = options;
  const record = await peekPendingAmoraFirstHello({ storage, now });
  pendingInMemory = null;

  if (storage) {
    try {
      await storage.removeItem(PENDING_AMORA_FIRST_HELLO_KEY);
    } catch {
      // 지우기 실패는 만료가 대신 처리한다.
    }
  }

  if (!record) return null;
  deliveredInMemory = { preview: record.preview, body: record.body };
  return deliveredInMemory;
}

/** 이번 실행에서 이미 건네준 첫마디. 대화 화면이 다시 열렸을 때 쓴다. */
export function getDeliveredAmoraFirstHello(): AmoraFirstHello | null {
  return deliveredInMemory;
}
