import {
  amoraPushTtlSeconds,
  buildAmoraPushMessage,
  isAmoraPushKind,
  isAmoraPushRoute,
  isWithinAmoraPushWindow,
  type AmoraPushKind,
  type AmoraPushRoute,
} from "@hanbang/shared/amora-push";

import { createAdminClient } from "@/lib/supabase/admin";
import { ymdInKst } from "@/lib/utils/kstDate";

import { sendExpoPushMessages, type AmoraPushProviderError } from "./expoPushClient";

/**
 * 아모라 앱 알림 하나를 보낸다(결정 D-86). 갈래 4(맡은 일)는 일이 끝나면 이 함수를 부른다.
 *
 *   await sendAmoraPush({ userId, kind: "task_done", deepLink: "home", dedupeKey: `task_done:${taskId}` })
 *
 * 이 함수 안에서 지키는 것(하나라도 걸리면 보내지 않고 이유만 돌려준다):
 *   1. 발송 스위치 `AMORA_APP_PUSH_ENABLED === "true"` 와 `EXPO_ACCESS_TOKEN` (기본 꺼짐)
 *   2. 한국 시각 09~20시(DB 가 그 사람이 좁힌 받는 시간을 한 번 더 본다)
 *   3. 앱 알림 동의(메일·커뮤니티 동의와 따로), 하루 상한 2건, 같은 일 한 번 — DB 함수
 *      `claim_amora_push_delivery` 가 사람별 잠금 안에서 다시 지킨다
 * 알림에는 내용이 없다(고정 문장 하나와 열 화면 이름). 실패해도 던지지 않는다.
 */

export type SendAmoraPushReason =
  | "sent"
  | "disabled"
  | "provider_unconfigured"
  | "invalid"
  | "quiet_hours"
  | "not_consented"
  | "daily_cap"
  | "duplicate"
  | "no_device"
  | "provider_error"
  | "unavailable";

export type SendAmoraPushResult = { sent: boolean; reason: SendAmoraPushReason };

export type SendAmoraPushInput = {
  userId: string;
  kind: AmoraPushKind;
  /** 누르면 열 화면. 앱이 이 이름을 자기 주소로 바꾼다. */
  deepLink: AmoraPushRoute;
  /** 같은 일로 두 번 보내지 않게 하는 열쇠. 없으면 "종류:한국 날짜"(종류마다 하루 한 번). */
  dedupeKey?: string;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type SendAmoraPushDeps = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  admin?: () => RpcClient;
  fetcher?: typeof fetch;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEDUPE_RE = /^[a-z0-9:_-]{1,120}$/;
const CLAIM_REASONS = new Set(["invalid", "not_consented", "quiet_hours", "duplicate", "daily_cap", "no_device"]);

export function isAmoraAppPushEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AMORA_APP_PUSH_ENABLED === "true";
}

function readAccessToken(env: Record<string, string | undefined>): string | null {
  const token = env.EXPO_ACCESS_TOKEN;
  return typeof token === "string" && token.length > 0 && token.length <= 4096 && token.trim() === token ? token : null;
}

type Target = { installationId: string; pushToken: string; bindingEpoch: number };

function parseClaim(value: unknown):
  | { claimed: true; deliveryId: string; targets: Target[]; windowEndsAt: string | null }
  | { claimed: false; reason: SendAmoraPushReason }
  | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.claimed === false) {
    return typeof record.reason === "string" && CLAIM_REASONS.has(record.reason)
      ? { claimed: false, reason: record.reason as SendAmoraPushReason }
      : null;
  }
  if (record.claimed !== true || typeof record.deliveryId !== "string" || !UUID_RE.test(record.deliveryId)) return null;
  if (!Array.isArray(record.targets) || record.targets.length < 1 || record.targets.length > 8) return null;
  const targets: Target[] = [];
  for (const raw of record.targets) {
    if (!raw || typeof raw !== "object") return null;
    const target = raw as Record<string, unknown>;
    if (
      typeof target.installationId !== "string" || !UUID_RE.test(target.installationId)
      || typeof target.pushToken !== "string" || !/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(target.pushToken)
      || typeof target.bindingEpoch !== "number" || !Number.isSafeInteger(target.bindingEpoch) || target.bindingEpoch < 1
    ) {
      return null;
    }
    targets.push({ installationId: target.installationId, pushToken: target.pushToken, bindingEpoch: target.bindingEpoch });
  }
  const windowEndsAt = typeof record.windowEndsAt === "string" ? record.windowEndsAt : null;
  return { claimed: true, deliveryId: record.deliveryId, targets, windowEndsAt };
}

export async function sendAmoraPush(
  input: SendAmoraPushInput,
  deps: SendAmoraPushDeps = {},
): Promise<SendAmoraPushResult> {
  const env = deps.env ?? process.env;
  const now = deps.now?.() ?? new Date();
  if (!isAmoraAppPushEnabled(env)) return { sent: false, reason: "disabled" };
  const accessToken = readAccessToken(env);
  if (!accessToken) return { sent: false, reason: "provider_unconfigured" };

  const dedupeKey = input.dedupeKey ?? `${input.kind}:${ymdInKst(now)}`;
  if (
    typeof input.userId !== "string" || !UUID_RE.test(input.userId)
    || !isAmoraPushKind(input.kind) || !isAmoraPushRoute(input.deepLink) || !DEDUPE_RE.test(dedupeKey)
  ) {
    return { sent: false, reason: "invalid" };
  }
  // DB 가 다시 보지만, 창 밖이면 DB 까지 가지 않는다.
  if (!isWithinAmoraPushWindow(now)) return { sent: false, reason: "quiet_hours" };

  try {
    const admin = (deps.admin ?? createAdminClient)();
    const { data, error } = await admin.rpc("claim_amora_push_delivery", {
      p_recipient_id: input.userId,
      p_kind: input.kind,
      p_dedupe_key: dedupeKey,
      p_route: input.deepLink,
    });
    const claim = error ? null : parseClaim(data);
    if (!claim) {
      console.error("[amora-push] claim failed");
      return { sent: false, reason: "unavailable" };
    }
    if (!claim.claimed) return { sent: false, reason: claim.reason };

    // 꺼진 기기가 받는 시간이 끝난 뒤에 받지 않게 알림의 유효 시간을 그 끝까지로 줄인다. 그사이 창이 닫혔으면
    // 보내지 않는다(기록 줄은 claimed 로 남아 그날 상한에 세이고 같은 열쇠를 막는다 — 닫힌 쪽으로 실패한다).
    const ttlSeconds = amoraPushTtlSeconds({ now, windowEndsAt: claim.windowEndsAt });
    if (ttlSeconds < 1) return { sent: false, reason: "quiet_hours" };

    const messages = claim.targets.map((target) => buildAmoraPushMessage({
      to: target.pushToken,
      deliveryId: claim.deliveryId,
      route: input.deepLink,
      ttlSeconds,
    }));
    const tickets = await sendExpoPushMessages(messages, accessToken, deps.fetcher);
    const ticketed = tickets.filter((ticket) => ticket.ok).length;
    const firstError = tickets.find((ticket): ticket is { ok: false; error: AmoraPushProviderError } => !ticket.ok);
    const unregistered = claim.targets
      .filter((_, index) => {
        const ticket = tickets[index];
        return ticket && !ticket.ok && ticket.error === "DeviceNotRegistered";
      })
      .map((target) => ({ installationId: target.installationId, bindingEpoch: target.bindingEpoch }));
    const { error: recordError } = await admin.rpc("record_amora_push_result", {
      p_delivery_id: claim.deliveryId,
      p_ticketed_count: ticketed,
      p_error_code: firstError?.error ?? null,
      p_unregistered: unregistered,
    });
    if (recordError) console.error("[amora-push] result not recorded");
    return ticketed > 0 ? { sent: true, reason: "sent" } : { sent: false, reason: "provider_error" };
  } catch {
    console.error("[amora-push] send failed");
    return { sent: false, reason: "unavailable" };
  }
}
