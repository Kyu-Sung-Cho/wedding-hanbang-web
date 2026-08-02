import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAmoraProactiveChatEnabled,
  isAmoraTodayOneEnabled,
} from "./amoraCareFlags";

describe("Amora in-app care rollout flags", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps TodayOne default-off and exact-true", () => {
    expect(isAmoraTodayOneEnabled()).toBe(false);
    vi.stubEnv("AMORA_TODAY_ONE_ENABLED", "TRUE");
    expect(isAmoraTodayOneEnabled()).toBe(false);
    vi.stubEnv("AMORA_TODAY_ONE_ENABLED", "true");
    expect(isAmoraTodayOneEnabled()).toBe(true);
  });

  it("never enables legacy proactive chat at the same time as TodayOne", () => {
    vi.stubEnv("AMORA_PROACTIVE_CHAT_ENABLED", "true");
    expect(isAmoraProactiveChatEnabled()).toBe(true);

    vi.stubEnv("AMORA_TODAY_ONE_ENABLED", "true");
    expect(isAmoraProactiveChatEnabled()).toBe(false);
  });
});
