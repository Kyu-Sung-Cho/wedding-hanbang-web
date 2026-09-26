/**
 * 아모라 대화에서 마지막으로 연 칸('함께 대화'·'나만 (상담)')을 이 기기에 계정별로 기억한다.
 *
 * 2026-09-26 파운더 결정: 아모라를 처음 열면 두 칸 중 하나를 고르게 하고, 고른 칸을 기억한다.
 * 키 모양·값 판정·어느 칸으로 열지는 `@hanbang/shared/amora-lane-choice` 한 벌을 웹과 같이 쓴다.
 * 이 파일은 앱 저장소(AsyncStorage)를 읽고 쓰는 일만 한다.
 *
 * - 읽기와 쓰기는 실패해도 던지지 않는다. 읽지 못하면 `null` 이고, 그러면 화면이 선택 카드를
 *   다시 띄운다. 모르는 채로 한쪽 칸을 여는 것보다 다시 묻는 편이 안전하다.
 * - 읽기에는 시간 제한을 둔다. 저장소가 대답하지 않으면 대화가 준비 중 화면에 멈춘다.
 *   제한을 넘기면 읽지 못한 것으로 본다(선택 카드가 뜬다).
 * - 저장되는 값은 칸 이름뿐이다. 대화 내용이나 누구와 연결됐는지는 담지 않는다.
 */
import {
  amoraLaneStorageKey,
  parseStoredAmoraLane,
  type AmoraLaneChoice,
} from "@hanbang/shared/amora-lane-choice";

/** AsyncStorage 에서 쓰는 두 메서드만. */
export interface AmoraLaneMemoryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** 이 시간 안에 저장소가 대답하지 않으면 읽지 못한 것으로 본다. */
export const AMORA_LANE_MEMORY_READ_TIMEOUT_MS = 2_000;

/**
 * 이 계정으로 기억된 칸을 읽는다. 없거나, 모르는 값이거나, 읽지 못했거나, 시간을 넘기면 `null`.
 * 사용자 id 가 비었으면 저장소를 건드리지 않는다.
 */
export async function readRememberedAmoraLane(
  storage: AmoraLaneMemoryStorage,
  userId: string | null | undefined,
  timeoutMs: number = AMORA_LANE_MEMORY_READ_TIMEOUT_MS,
): Promise<AmoraLaneChoice | null> {
  const key = amoraLaneStorageKey(userId);
  if (!key) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const stored: unknown = await Promise.race([storage.getItem(key), timedOut]);
    return parseStoredAmoraLane(stored);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 사람이 직접 고른 칸을 기억한다(선택 카드, 위쪽 탭). 저장하지 못하면 `false` 이고, 그 사람은
 * 다음에 열 때 선택 카드를 다시 본다.
 */
export async function rememberAmoraLane(
  storage: AmoraLaneMemoryStorage,
  userId: string | null | undefined,
  lane: AmoraLaneChoice,
): Promise<boolean> {
  const key = amoraLaneStorageKey(userId);
  const value = parseStoredAmoraLane(lane);
  if (!key || !value) return false;
  try {
    await storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
