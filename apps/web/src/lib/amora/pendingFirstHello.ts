/**
 * 아모라의 첫마디를 라운지에서 대화 화면까지, 그리고 새로고침 너머까지 들고 가는 자리(웹).
 *
 * ## 왜 저장하는가
 *
 * 첫마디는 `buildAmoraFirstHello`가 온보딩 입력만으로 결정적으로 만든다(모델을 부르지
 * 않는다). 그런데 웹은 그것을 `useState`에만 담고 있었다. 안내를 끝냈다는 사실은 이미
 * 계정에 적히므로 안내는 다시 뜨지 않는데, 그 상태에서 새로고침을 한 번 하면 첫마디는
 * 그 계정에서 **영영** 사라진다. 사이드바의 "아모라"로 전체 페이지 대화(`/chat`)에
 * 들어간 사람은 애초에 만나지 못했다 — 말풍선은 라운지 레이아웃에만 있었기 때문이다.
 *
 * 앱은 같은 시나리오를 같은 모양의 보관으로 막는다(`apps/mobile/src/lib/amoraFirstHello.ts`).
 * "먼저 말을 거는 아모라"는 두 플랫폼이 같은 순간에 같은 말을 해야 한다.
 *
 * ## 왜 chat_messages에 쓰지 않는가
 *
 * 첫마디는 대화 기록이 아니라 인사다. DB에 쓰면 모델이 나중에 "내가 그렇게 말했다"를
 * 근거로 삼게 되고, 두 사람의 공유 대화에 사람이 부르지 않은 턴이 남는다. 화면에만
 * 보이는 로컬 메시지로 두는 편이 정직하다.
 *
 * ## 왜 만료가 있고, 왜 주인을 적어 두는가
 *
 * 한 달 뒤에 처음 대화를 여는 사람에게 "결혼식까지 N일" 같은 그때의 셈을 그대로 보여주면
 * 그건 인사가 아니라 틀린 정보다. 그래서 앱과 같은 3일이 지나면 없는 것으로 본다.
 *
 * 브라우저는 폰과 달리 여러 사람이 쓴다. 주인(로그인한 사람의 id)을 함께 적어두고 다른
 * 주인에게는 돌려주지 않는다 — 남의 예식일이 담긴 인사가 다음 사람 화면에 뜨면 안 된다.
 * 주인을 알 수 없으면 아예 저장하지 않는다.
 *
 * ## 말풍선과 첫마디는 다른 것이다
 *
 * 말풍선(preview)은 알림이고 첫마디(body)는 인사다. 말풍선을 닫는 것은 "알림 봤다"이지
 * "인사 필요 없다"가 아니다. 그래서 닫기는 `bubbleDismissed`만 올리고, 대화를 열면
 * 첫마디는 그대로 놓여 있다.
 */

import type { AmoraFirstHello } from "@hanbang/shared";

/** 저장소 키. 값 모양이 바뀌면 뒤 숫자를 올린다. */
export const PENDING_AMORA_FIRST_HELLO_KEY = "hanbang.amoraFirstHello.v1";

/** 이 인사를 유효하게 보는 기간. 앱과 같은 3일. */
export const PENDING_AMORA_FIRST_HELLO_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const MAX_PREVIEW_LENGTH = 160;
const MAX_BODY_LENGTH = 2000;

export interface PendingAmoraFirstHello extends AmoraFirstHello {
  /** 이 인사를 받은 사람. 다른 사람이 로그인해 있으면 돌려주지 않는다. */
  ownerId: string;
  savedAt: number;
  /** 말풍선을 사람이 닫았는가. 닫아도 첫마디 자체는 남는다. */
  bubbleDismissed: boolean;
}

/** `window.localStorage`에서 실제로 쓰는 부분만. 테스트가 가짜를 넣을 수 있게 좁게 받는다. */
export interface AmoraFirstHelloStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AmoraFirstHelloOptions {
  /** 지금 로그인한 사람의 id. 없으면 저장도 복원도 하지 않는다. */
  ownerId?: string | null;
  storage?: AmoraFirstHelloStorage | null;
  now?: number;
}

/**
 * 이번 페이지 로드에서 이미 대화 화면에 건네준 첫마디.
 *
 * 저장소에서는 꺼내는 순간 지운다(한 번만 건넨다). 그런데 그것만 하면 같은 화면이
 * 다시 마운트되는 순간 — 개발 모드의 이중 마운트, 탭 전환으로 인한 리렌더 — 인사가
 * 사라진다. 그래서 이번 로드 동안만 여기 남긴다.
 */
let deliveredInMemory: AmoraFirstHello | null = null;
/** 그 인사의 주인. 로그아웃 뒤 다른 사람이 같은 탭에서 이어 받는 것을 막는다. */
let deliveredOwnerId: string | null = null;

/** 테스트가 실행 간 상태를 격리할 때 쓴다. */
export function resetAmoraFirstHelloMemory(): void {
  deliveredInMemory = null;
  deliveredOwnerId = null;
}

/** 이번 페이지 로드에서 이 사람에게 이미 건넨 첫마디. 화면이 다시 마운트됐을 때 쓴다. */
export function getDeliveredAmoraFirstHello(
  ownerId: string | null | undefined,
): AmoraFirstHello | null {
  const owner = toOwnerId(ownerId);
  if (!owner || owner !== deliveredOwnerId) return null;
  return deliveredInMemory;
}

function toText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function toOwnerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function defaultStorage(): AmoraFirstHelloStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // 저장소가 막힌 환경에서는 없는 것으로 본다. 인사는 이번 화면에서만 살아 있다.
    return null;
  }
}

export function serializePendingAmoraFirstHello(
  record: PendingAmoraFirstHello,
): string {
  return JSON.stringify({
    preview: record.preview,
    body: record.body,
    ownerId: record.ownerId,
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
  const ownerId = toOwnerId(row.ownerId);
  if (!preview || !body || !ownerId) return null;

  const savedAt = row.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  const age = now - savedAt;
  if (age < 0 || age > ttlMs) return null;

  return {
    preview,
    body,
    ownerId,
    savedAt,
    bubbleDismissed: row.bubbleDismissed === true,
  };
}

/** 안내가 끝난 직후 만든 첫마디를 기억한다. 주인을 모르면 저장하지 않는다. */
export function rememberPendingAmoraFirstHello(
  hello: AmoraFirstHello | null | undefined,
  options: AmoraFirstHelloOptions = {},
): PendingAmoraFirstHello | null {
  const { ownerId: rawOwnerId = null, storage = defaultStorage(), now = Date.now() } = options;
  const preview = toText(hello?.preview, MAX_PREVIEW_LENGTH);
  const body = toText(hello?.body, MAX_BODY_LENGTH);
  const ownerId = toOwnerId(rawOwnerId);
  if (!preview || !body || !ownerId) return null;

  const record: PendingAmoraFirstHello = {
    preview,
    body,
    ownerId,
    savedAt: now,
    bubbleDismissed: false,
  };
  if (!storage) return record;

  try {
    storage.setItem(PENDING_AMORA_FIRST_HELLO_KEY, serializePendingAmoraFirstHello(record));
  } catch {
    // 저장에 실패해도 이번 화면에서는 부르는 쪽이 받은 값으로 이어간다.
  }
  return record;
}

/** 지우지 않고 보기만 한다. 라운지가 말풍선을 그릴지 정할 때 쓴다. */
export function peekPendingAmoraFirstHello(
  options: AmoraFirstHelloOptions = {},
): PendingAmoraFirstHello | null {
  const { ownerId: rawOwnerId = null, storage = defaultStorage(), now = Date.now() } = options;
  const ownerId = toOwnerId(rawOwnerId);
  if (!ownerId || !storage) return null;

  try {
    const record = parsePendingAmoraFirstHello(
      storage.getItem(PENDING_AMORA_FIRST_HELLO_KEY),
      now,
    );
    if (!record) return null;
    if (record.ownerId !== ownerId) {
      // 다른 사람이 로그인해 있다. 남의 인사는 돌려주지도, 남겨두지도 않는다.
      storage.removeItem(PENDING_AMORA_FIRST_HELLO_KEY);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/** 말풍선만 닫는다. 첫마디는 대화 화면에서 그대로 기다린다. */
export function dismissAmoraFirstHelloBubble(
  options: AmoraFirstHelloOptions = {},
): void {
  const { storage = defaultStorage() } = options;
  const current = peekPendingAmoraFirstHello(options);
  if (!current || !storage) return;

  try {
    storage.setItem(
      PENDING_AMORA_FIRST_HELLO_KEY,
      serializePendingAmoraFirstHello({ ...current, bubbleDismissed: true }),
    );
  } catch {
    // 닫힌 상태를 못 적어도 이번 화면에서는 상태값이 막는다.
  }
}

/**
 * 대화 화면이 첫마디를 가져간다. 저장소에서는 지우고 이번 페이지 로드 동안만 들고 있는다.
 */
export function consumePendingAmoraFirstHello(
  options: AmoraFirstHelloOptions = {},
): AmoraFirstHello | null {
  const { ownerId = null, storage = defaultStorage() } = options;
  const record = peekPendingAmoraFirstHello(options);

  if (record && storage) {
    try {
      storage.removeItem(PENDING_AMORA_FIRST_HELLO_KEY);
    } catch {
      // 지우기 실패는 만료가 대신 처리한다.
    }
  }

  if (record) {
    deliveredInMemory = { preview: record.preview, body: record.body };
    deliveredOwnerId = record.ownerId;
    return deliveredInMemory;
  }
  // 저장소에는 없지만 이번 로드에서 이미 건넨 인사가 있으면 그것을 다시 돌려준다.
  return getDeliveredAmoraFirstHello(ownerId);
}
