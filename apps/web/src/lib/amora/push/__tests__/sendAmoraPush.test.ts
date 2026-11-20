// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { sendAmoraPush, type SendAmoraPushDeps } from "../sendAmoraPush";
import { EXPO_PUSH_SEND_URL } from "../expoPushClient";

// D-86: 동의·조용한 시간·하루 상한을 이 함수 안에서 지키고, 알림에는 내용을 넣지 않는다.

const USER = "10000000-0000-4000-8000-000000000001";
const DELIVERY = "40000000-0000-4000-8000-000000000001";
const DEVICE_A = "30000000-0000-4000-8000-00000000000a";
const DEVICE_B = "30000000-0000-4000-8000-00000000000b";
const ON = { AMORA_APP_PUSH_ENABLED: "true", EXPO_ACCESS_TOKEN: "expo-test-token" };
const KST_10AM = new Date("2026-11-20T01:00:00.000Z");

function claimed(targets = [DEVICE_A]) {
  return {
    claimed: true,
    deliveryId: DELIVERY,
    targets: targets.map((installationId, index) => ({
      installationId,
      pushToken: `ExponentPushToken[token${index}abcdefghij]`,
      platform: "android",
      bindingEpoch: 1,
    })),
  };
}

function deps(overrides: {
  env?: Record<string, string | undefined>;
  now?: Date;
  claim?: unknown;
  expo?: (call: { url: string; body: unknown }) => Response | Promise<Response>;
} = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_amora_push_delivery") {
      return { data: "claim" in overrides ? overrides.claim : claimed(), error: null };
    }
    if (name === "record_amora_push_result") return { data: true, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body)) };
    return overrides.expo ? overrides.expo(call) : new Response(JSON.stringify({
      data: (call.body as unknown[]).map((_, index) => ({ status: "ok", id: `ticket-${index}-abcdefghijklmnop` })),
    }), { status: 200 });
  });
  const value: SendAmoraPushDeps = {
    env: overrides.env ?? ON,
    now: () => overrides.now ?? KST_10AM,
    admin: () => ({ rpc }),
    fetcher: fetcher as unknown as typeof fetch,
  };
  return { value, rpc, fetcher };
}

const INPUT = { userId: USER, kind: "today_one" as const, deepLink: "home" as const };

describe("sendAmoraPush", () => {
  it("스위치가 꺼져 있거나 Expo 열쇠가 없으면 DB 도 Expo 도 부르지 않는다", async () => {
    for (const env of [{}, { AMORA_APP_PUSH_ENABLED: "TRUE", EXPO_ACCESS_TOKEN: "x" }, { AMORA_APP_PUSH_ENABLED: "true" }, { AMORA_APP_PUSH_ENABLED: "true", EXPO_ACCESS_TOKEN: " padded " }]) {
      const { value, rpc, fetcher } = deps({ env });
      const result = await sendAmoraPush(INPUT, value);
      expect(result.sent).toBe(false);
      expect(["disabled", "provider_unconfigured"]).toContain(result.reason);
      expect(rpc).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("한국 시각 09시 전, 20시부터는 DB 에 가지 않고 보내지 않는다", async () => {
    for (const now of ["2026-11-19T23:59:59.000Z", "2026-11-20T11:00:00.000Z", "2026-11-20T15:00:00.000Z"]) {
      const { value, rpc, fetcher } = deps({ now: new Date(now) });
      expect(await sendAmoraPush(INPUT, value)).toEqual({ sent: false, reason: "quiet_hours" });
      expect(rpc).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("DB 가 동의 없음·상한·중복·기기 없음이라고 하면 그 이유로 멈춘다", async () => {
    for (const reason of ["not_consented", "daily_cap", "duplicate", "no_device", "quiet_hours"]) {
      const { value, fetcher } = deps({ claim: { claimed: false, reason } });
      expect(await sendAmoraPush(INPUT, value)).toEqual({ sent: false, reason });
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("종류마다 하루 한 번을 기본 열쇠로 쓰고, 잘못된 입력은 DB 에 넘기지 않는다", async () => {
    const { value, rpc } = deps();
    await sendAmoraPush(INPUT, value);
    expect(rpc).toHaveBeenCalledWith("claim_amora_push_delivery", {
      p_recipient_id: USER,
      p_kind: "today_one",
      p_dedupe_key: "today_one:2026-11-20",
      p_route: "home",
    });
    for (const bad of [
      { ...INPUT, userId: "not-a-uuid" },
      { ...INPUT, kind: "anything" as never },
      { ...INPUT, deepLink: "/settings" as never },
      { ...INPUT, dedupeKey: "Has Spaces" },
    ]) {
      const fresh = deps();
      expect(await sendAmoraPush(bad, fresh.value)).toEqual({ sent: false, reason: "invalid" });
      expect(fresh.rpc).not.toHaveBeenCalled();
    }
  });

  it("알림에는 고정 문장 하나와 열 화면 이름만 넣고 결과를 기록한다", async () => {
    const { value, rpc, fetcher } = deps({ claim: claimed([DEVICE_A, DEVICE_B]) });
    expect(await sendAmoraPush(INPUT, value)).toEqual({ sent: true, reason: "sent" });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(EXPO_PUSH_SEND_URL);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer expo-test-token");
    const messages = JSON.parse(String(init?.body));
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(Object.keys(message).sort()).toEqual(["body", "collapseId", "data", "priority", "sound", "tag", "title", "to", "ttl"]);
      expect(message.title).toBe("웨딩한방");
      expect(message.body).toBe("아모라가 정리한 게 있어요.");
      expect(message.data).toEqual({ type: "amora", deliveryId: DELIVERY, route: "home" });
    }
    expect(rpc).toHaveBeenLastCalledWith("record_amora_push_result", {
      p_delivery_id: DELIVERY,
      p_ticketed_count: 2,
      p_error_code: null,
      p_unregistered: [],
    });
  });

  it("꺼져 있던 기기가 받는 시간이 끝난 뒤에 받지 않게 유효 시간을 줄이고, 이미 끝났으면 보내지 않는다", async () => {
    const ttlOf = (fetcher: ReturnType<typeof deps>["fetcher"]) =>
      JSON.parse(String(fetcher.mock.calls[0][1]?.body))[0].ttl as number;
    // 오후 7시 30분에 오후 8시까지인 사람에게 보내면 30분.
    const evening = deps({ now: new Date("2026-11-20T10:30:00.000Z"), claim: { ...claimed(), windowEndsAt: "2026-11-20T20:00:00+09:00" } });
    expect(await sendAmoraPush(INPUT, evening.value)).toEqual({ sent: true, reason: "sent" });
    expect(ttlOf(evening.fetcher)).toBe(1800);
    // 받는 시간을 오후 6시까지로 좁힌 사람인데 보내려는 때 이미 6시면 보내지 않는다.
    const closed = deps({ now: new Date("2026-11-20T09:00:00.000Z"), claim: { ...claimed(), windowEndsAt: "2026-11-20T18:00:00+09:00" } });
    expect(await sendAmoraPush(INPUT, closed.value)).toEqual({ sent: false, reason: "quiet_hours" });
    expect(closed.fetcher).not.toHaveBeenCalled();
    // DB 가 끝 시각을 주지 않으면 오후 8시까지로 보고, 오전 10시면 상한 4시간이다.
    const morning = deps();
    await sendAmoraPush(INPUT, morning.value);
    expect(ttlOf(morning.fetcher)).toBe(4 * 60 * 60);
  });

  it("등록되지 않은 기기만 해제하도록 넘기고, 전부 실패하면 보내지 못했다고 한다", async () => {
    const { value, rpc } = deps({
      claim: claimed([DEVICE_A, DEVICE_B]),
      expo: () => new Response(JSON.stringify({ data: [
        { status: "error", message: "secret text", details: { error: "DeviceNotRegistered" } },
        { status: "ok", id: "ticket-1-abcdefghijklmnop" },
      ] }), { status: 200 }),
    });
    expect(await sendAmoraPush(INPUT, value)).toEqual({ sent: true, reason: "sent" });
    expect(rpc).toHaveBeenLastCalledWith("record_amora_push_result", {
      p_delivery_id: DELIVERY,
      p_ticketed_count: 1,
      p_error_code: "DeviceNotRegistered",
      p_unregistered: [{ installationId: DEVICE_A, bindingEpoch: 1 }],
    });

    const down = deps({ expo: () => { throw new Error("offline"); } });
    expect(await sendAmoraPush(INPUT, down.value)).toEqual({ sent: false, reason: "provider_error" });
    // 잠깐의 네트워크 오류로 남의 기기를 풀지 않는다(등록되지 않은 기기만 푼다).
    expect(down.rpc).toHaveBeenLastCalledWith("record_amora_push_result", {
      p_delivery_id: DELIVERY,
      p_ticketed_count: 0,
      p_error_code: "network_error",
      p_unregistered: [],
    });
  });

  it("DB 응답이 모양에 맞지 않으면 보내지 않는다", async () => {
    for (const claim of [null, { claimed: true }, { claimed: true, deliveryId: DELIVERY, targets: [] }, { claimed: false, reason: "made_up" }]) {
      const { value, fetcher } = deps({ claim });
      expect(await sendAmoraPush(INPUT, value)).toEqual({ sent: false, reason: "unavailable" });
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});
