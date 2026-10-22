/**
 * 초대 코드를 로그인 왕복 동안 들고 있는 자리(웹).
 *
 * ## 왜 필요한가
 *
 * `/invite`는 코드를 주소창의 `#` 뒤에 담아 온보딩으로 보내고 있었다. 그런데 온보딩은
 * 보호 경로라, 아직 로그인하지 않은 사람에게는 미들웨어가 **서버 307**로 `/login`을
 * 돌려준다(`src/lib/supabase/middleware.ts`). 서버 리다이렉트에는 프래그먼트를 읽을
 * 기회 자체가 없다 — 온보딩 화면이 마운트되지 않으니 해시를 읽는 코드도 돌지 않는다.
 * 초대를 받는 사람의 **주 경로**는 계정이 아예 없는 파트너라, 링크·QR로 들어온 사람은
 * 사실상 전부 이 길을 지난다. 결국 가입을 마치고 나면 코드 칸이 비어 있고, 사람은
 * `WH-` + 12자리를 손으로 옮겨 적는다 — 링크와 QR을 만든 이유가 사라진다.
 *
 * 그래서 **실제로 마운트되는 화면**인 `/invite`가 코드를 여기 넣어두고, 주소에는 코드를
 * 담지 않은 깨끗한 URL로 온보딩에 보낸다. 온보딩은 마운트되면 이 자리를 비우며 가져간다.
 *
 * 앱도 같은 문제를 같은 모양으로 막는다(`apps/mobile/src/lib/pendingCoupleInvite.mjs`).
 *
 * ## 왜 localStorage이고, 왜 만료가 반드시 필요한가
 *
 * 처음에는 `sessionStorage`를 썼다. 탭을 닫으면 열쇠가 함께 사라지니 더 안전해 보였다.
 * 그런데 그러면 **이 수정이 노린 바로 그 사람**에게 아무 소용이 없다.
 *
 * 계정이 없는 파트너의 가입은 이메일 확인을 강제한다(`api/auth/signup`이 보내는 메일의
 * action_link). 그 링크는 메일함에서 눌리므로 **새 탭**이거나, 메일 앱이 띄운 브라우저다.
 * `sessionStorage`는 탭을 따라가지 않는다 — 코드는 그 순간 사라지고, 사람은 다시
 * 손으로 옮겨 적는다. 초대의 주 경로가 정확히 여기다.
 *
 * `localStorage`는 같은 브라우저의 다른 탭에서도 읽히므로 그 왕복을 건넌다. 대신 오래
 * 남으면 안 되므로 **만료가 필수**다. 앱과 같은 30분을 쓰고, 읽는 즉시 지운다.
 * 앱도 같은 판단을 했다 — 메일 왕복을 건너려고 SecureStore에 30분 TTL로 남긴다.
 *
 * 남는 구멍: 메일 링크가 **다른 브라우저**(인앱 브라우저 등)에서 열리면 저장소가 갈려
 * 여전히 코드를 잃는다. 그때 남는 길은 `/invite` 화면에 크게 떠 있는 코드를 복사하는
 * 것이고, 그 버튼은 그대로 있다.
 *
 * 저장은 부르는 쪽이 넘긴 storage로도 할 수 있게 열어 둔다 — 만료 판정처럼 틀리기 쉬운
 * 로직이 브라우저 없이도 테스트되어야 하기 때문이다.
 */

import { isCoupleInviteCode, normalizeCoupleInviteCode } from "@hanbang/shared";

/** 저장된 코드를 유효하게 보는 시간. 메일 인증 왕복에는 넉넉하고, 한참 뒤엔 없는 것과 같다. */
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;

/** 저장소 키. 값 모양이 바뀌면 뒤 숫자를 올린다. */
export const PENDING_INVITE_STORAGE_KEY = "hanbang.pendingCoupleInvite.v1";

/** `window.localStorage`에서 실제로 쓰는 부분만. 테스트가 가짜를 넣을 수 있게 좁게 받는다. */
export interface PendingInviteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingInviteOptions {
  storage?: PendingInviteStorage | null;
  now?: number;
}

/**
 * 이 값은 앱 밖에서 온 문자열이다(링크의 프래그먼트). 넣는 쪽이 검사했더라도 저장소가
 * 아무 문자열이나 받아주면 나중에 이상한 값이 입력칸에 꽂힌다. 정본은 공유 계약이다.
 */
function toInviteCode(value: unknown): string | null {
  const normalized = normalizeCoupleInviteCode(value);
  return isCoupleInviteCode(normalized) ? normalized : null;
}

/**
 * 기본 저장소. 테스트가 **소스 문자열이 아니라 실제로 고른 객체**를 확인할 수 있게 내보낸다 —
 * 이 선택(탭을 건너는가)이 이 파일에서 가장 중요한 결정이다.
 */
export function resolveDefaultPendingInviteStorage(): PendingInviteStorage | null {
  return defaultStorage();
}

function defaultStorage(): PendingInviteStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // 저장소가 막힌 환경(프라이빗 모드, 서드파티 컨텍스트)에서는 없는 것으로 본다.
    return null;
  }
}

/** 저장할 문자열. 시각을 함께 넣어야 꺼낼 때 만료를 판정할 수 있다. */
export function serializePendingInvite(code: string, now: number): string {
  return JSON.stringify({ code, savedAt: now });
}

/**
 * 저장된 문자열에서 아직 유효한 코드를 꺼낸다.
 *
 * 모양이 깨졌거나, 시각이 없거나, 만료됐거나, 미래 시각이면 null이다. 미래 시각까지
 * 버리는 이유는 기기 시계가 뒤로 돌아간 뒤 저장된 값이 영영 만료되지 않는 것을 막기 위해서다.
 */
export function parsePendingInvite(
  raw: unknown,
  now: number,
  ttlMs: number = PENDING_INVITE_TTL_MS,
): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const row = parsed as Record<string, unknown>;
  const code = toInviteCode(row.code);
  if (!code) return null;

  const savedAt = row.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;

  const age = now - savedAt;
  if (age < 0 || age > ttlMs) return null;

  return code;
}

/**
 * 착지 화면이 꺼낸 코드를 기억한다. 형식을 통과하지 못하면 기억하지 않고, 이미 들고
 * 있던 값도 지운다 — 새 링크가 이전 링크를 덮는 것이 맞다.
 *
 * **실제로 보관에 들어갔을 때만** 코드를 돌려준다. 웹에는 메모리 대체재가 없다 —
 * 여기서 실패하면 다음 화면은 이 값을 볼 방법이 없으므로, 부르는 쪽이 옛 경로(주소의
 * `#`)를 그대로 쓸지 판단할 수 있어야 한다. 저장 실패를 성공처럼 돌려주면 사람은
 * 코드를 잃고도 아무 표시를 못 받는다.
 *
 * @returns 보관한 코드. 형식이 아니거나 보관하지 못했으면 null.
 */
export function rememberPendingCoupleInviteCode(
  value: unknown,
  options: PendingInviteOptions = {},
): string | null {
  const { storage = defaultStorage(), now = Date.now() } = options;
  const code = toInviteCode(value);
  if (!storage) return null;

  try {
    if (!code) {
      storage.removeItem(PENDING_INVITE_STORAGE_KEY);
      return null;
    }
    storage.setItem(PENDING_INVITE_STORAGE_KEY, serializePendingInvite(code, now));
    return code;
  } catch {
    // 저장이 막힌 환경(프라이빗 모드 등)에서 화면이 오류를 낼 이유는 없다. 코드는
    // 화면에 크게 떠 있고, 부르는 쪽은 null을 보고 옛 경로로 계속한다.
    return null;
  }
}

/**
 * 코드를 지우지 않고 읽기만 한다. 만료되었거나 형식이 깨진 값만 저장소에서 정리한다.
 * 온보딩 완료 전에 새로고침하거나 설정 화면으로 이동해도 코드가 사라지지 않도록 한다.
 */
export function peekPendingCoupleInviteCode(
  options: PendingInviteOptions = {},
): string | null {
  const { storage = defaultStorage(), now = Date.now() } = options;
  if (!storage) return null;

  try {
    const raw = storage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (raw === null) return null;
    const code = parsePendingInvite(raw, now);
    if (!code) {
      storage.removeItem(PENDING_INVITE_STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

/**
 * 보관된 초대 코드를 명시적으로 비운다. 온보딩이나 파트너 연결이 완료된 뒤에 부른다.
 */
export function clearPendingCoupleInviteCode(
  options: PendingInviteOptions = {},
): void {
  const { storage = defaultStorage() } = options;
  if (!storage) return;

  try {
    storage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // 저장소가 막힌 환경에서도 흐름을 막지 않는다.
  }
}

/**
 * 코드를 꺼내면서 지운다. 한 번만 쓰이도록 — 온보딩을 마치고 다시 들어왔을 때 예전
 * 링크의 코드가 되살아나면, 이미 연결된 사람이 남의 코드로 합류를 시도한다.
 */
export function consumePendingCoupleInviteCode(
  options: PendingInviteOptions = {},
): string | null {
  const { storage = defaultStorage(), now = Date.now() } = options;
  if (!storage) return null;

  try {
    const code = parsePendingInvite(storage.getItem(PENDING_INVITE_STORAGE_KEY), now);
    storage.removeItem(PENDING_INVITE_STORAGE_KEY);
    return code;
  } catch {
    // 읽지 못하면 없는 것으로 본다. 사람은 코드를 직접 넣으면 되고, 그게
    // 알 수 없는 오류 화면보다 낫다.
    return null;
  }
}
