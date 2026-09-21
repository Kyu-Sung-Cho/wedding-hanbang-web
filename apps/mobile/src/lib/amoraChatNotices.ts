/**
 * 채팅 화면의 짧은 안내 문구와 그 판정. 화면(`app/(tabs)/chat.tsx`)은 여기서 고른 말만 그린다.
 *
 * 문구는 웹 채팅(`apps/web/src/components/app/chat/ChatContent.tsx`)과 같다 —
 * 같은 사실을 두 화면이 다르게 말하면 안 된다. `amoraChatNotices.test.mjs` 가 웹 소스와 대조한다.
 */

export type AmoraMemoryVisibility = "shared" | "bride_private" | "groom_private";

export interface AmoraMemoryStatus {
  /** 서버의 기억 연결 스위치. 꺼져 있으면 동의해 둔 범위도 새 기억을 쌓지 않는다. */
  runtimeEnabled: boolean;
  enabled: Partial<Record<AmoraMemoryVisibility, boolean>>;
}

export type AmoraMemoryLine =
  | { kind: "on" }
  | { kind: "off"; canEnable: boolean };

export const AMORA_MEMORY_ON_COPY = "이 탭의 장기 기억 사용이 켜져 있어요";
export const AMORA_MEMORY_OFF_COPY = "지금은 장기 기억을 저장하지 않아요";
export const AMORA_MEMORY_SETTINGS_LINK = "설정에서 켜기";

const MEMORY_VISIBILITIES: readonly AmoraMemoryVisibility[] = ["shared", "bride_private", "groom_private"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * GET `/api/amora/memory` 응답에서 범위별 `enabled` 만 읽는다. 설정 화면이 이미 쓰는 값이고,
 * 켜고 끄는 판정이나 저장 경로는 건드리지 않는다. 모양이 다르면 `null` — 못 읽으면 아무 말도 하지 않는다.
 */
export function readAmoraMemoryStatus(payload: unknown): AmoraMemoryStatus | null {
  if (!isRecord(payload) || !Array.isArray(payload.settings) || typeof payload.runtimeEnabled !== "boolean") {
    return null;
  }
  const enabled: Partial<Record<AmoraMemoryVisibility, boolean>> = {};
  for (const setting of payload.settings) {
    if (!isRecord(setting) || typeof setting.enabled !== "boolean") continue;
    const visibility = MEMORY_VISIBILITIES.find((item) => item === setting.visibility);
    if (visibility) enabled[visibility] = setting.enabled;
  }
  return { runtimeEnabled: payload.runtimeEnabled, enabled };
}

/**
 * 지금 탭에서 할 말. 함께 대화는 공유 기억, 나만 상담은 내 비공개 기억을 본다.
 *
 * 웹보다 한 가지를 더 조심한다 — 서버의 기억 연결이 꺼져 있으면(`runtimeEnabled: false`) 동의해 둔
 * 범위라도 "사용이 켜져 있어요"라고 하지 않고, 설정 화면의 스위치도 잠겨 있으므로 "설정에서 켜기"로 보내지 않는다.
 * 틀린 상태를 말하느니 침묵이 낫고, 누를 수 없는 스위치로 보내느니 링크를 빼는 편이 낫다.
 */
export function resolveAmoraMemoryLine(
  status: AmoraMemoryStatus | null,
  scope: "shared" | "private",
  role: "bride" | "groom" | null,
): AmoraMemoryLine | null {
  if (!status) return null;
  const visibility: AmoraMemoryVisibility | null = scope === "shared"
    ? "shared"
    : role ? `${role}_private` : null;
  if (!visibility) return null;
  const enabled = status.enabled[visibility];
  if (typeof enabled !== "boolean") return null;
  if (!status.runtimeEnabled) return { kind: "off", canEnable: false };
  return enabled ? { kind: "on" } : { kind: "off", canEnable: true };
}

/** 웹·앱이 같은 공용 계약으로 일일 한도와 전체 무료 한도를 구분한다. */
export { formatAmoraQuotaNotice } from "@hanbang/shared";
