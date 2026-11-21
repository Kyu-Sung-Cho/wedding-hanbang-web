import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AmoraCarePreferenceControl from "./AmoraCarePreferenceControl";
import AmoraCareConsentPrompt from "./AmoraCareConsentPrompt";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-11-13T01:00:00.000Z";

type Payload = {
  available: boolean;
  emailAvailable: boolean;
  chat: { enabled: boolean; consentedAt: string | null };
  email: { enabled: boolean; consentedAt: string | null; verified: boolean; maskedAddress: string | null };
  partner: { connected: boolean; chatEnabled: boolean };
  promptAnswered: boolean;
  cadence: { intensity: string; windowStartHour: number; windowEndHour: number };
  couple: { intensity: string; windowStartHour: number; windowEndHour: number; dailyLimit: number; windowOpen: boolean };
};

function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    available: true,
    emailAvailable: false,
    chat: { enabled: false, consentedAt: null },
    email: { enabled: false, consentedAt: null, verified: true, maskedAddress: "am***@example.com" },
    partner: { connected: true, chatEnabled: false },
    promptAnswered: false,
    cadence: { intensity: "normal", windowStartHour: 9, windowEndHour: 20 },
    couple: { intensity: "normal", windowStartHour: 9, windowEndHour: 20, dailyLimit: 1, windowOpen: true },
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 409, json: vi.fn().mockResolvedValue(body) };
}

// 스위치는 기본 체크박스(role="switch"), 강도는 기본 라디오다. 손으로 만든 버튼 태그를 늘리지 않는다.
function switchNamed(container: HTMLElement, name: string) {
  return container.querySelector<HTMLInputElement>(`input[type="checkbox"][role="switch"][aria-label="${name}"]`);
}

function intensityRadio(container: HTMLElement, value: string) {
  return container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
}

function buttonWithText(container: HTMLElement, text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === text) ?? null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AmoraCarePreferenceControl (settings)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("draws nothing and hands opt-out back to the legacy row when no care path can run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload({ available: false })));
    vi.stubGlobal("fetch", fetchMock);
    const onAvailabilityChange = vi.fn();

    await act(async () => {
      root.render(<AmoraCarePreferenceControl onAvailabilityChange={onAvailabilityChange} />);
    });
    await flush();

    expect(container.querySelector('[data-testid="amora-care-preference"]')).toBeNull();
    expect(container.textContent).not.toContain("아모라가 먼저 알려 주기");
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(false);
  });

  it("tells the shared rule, then turns it on only after the server confirms", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse(payload({
        chat: { enabled: true, consentedAt: AT },
        promptAnswered: true,
      })));
    vi.stubGlobal("fetch", fetchMock);
    const onAvailabilityChange = vi.fn();

    await act(async () => {
      root.render(<AmoraCarePreferenceControl onAvailabilityChange={onAvailabilityChange} />);
    });
    await flush();

    expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain("두 분이 모두 켜야 와요. 한 분이 끄면 두 분 모두에게 멈춰요.");
    const chatSwitch = switchNamed(container, "아모라가 함께 대화에 먼저 글 남기기");
    expect(chatSwitch?.checked).toBe(false);
    // 메일 경로가 꺼져 있으면 메일 칸은 그리지 않는다.
    expect(switchNamed(container, "같은 글을 메일로도 받기")).toBeNull();

    await act(async () => {
      chatSwitch?.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenLastCalledWith("/api/amora/care-preferences", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ chat: true }),
    }));
    expect(switchNamed(container, "아모라가 함께 대화에 먼저 글 남기기")?.checked).toBe(true);
    expect(container.querySelector('[data-testid="amora-care-partner-state"]')?.textContent)
      .toBe("상대가 켜면 그날부터 와요.");
    expect(container.textContent).toContain("끄면 오늘 보내려던 글도 보내지 않아요.");
  });

  it("keeps the switch where it was when the server refuses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse({ error: "지금은 이 알림을 켤 수 없어요." }, false));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    await act(async () => {
      switchNamed(container, "아모라가 함께 대화에 먼저 글 남기기")?.click();
    });
    await flush();

    // 서버가 거절하면 화면의 칸도 원래대로 돌아와야 한다(체크박스가 먼저 바뀐 채 남지 않는다).
    expect(switchNamed(container, "아모라가 함께 대화에 먼저 글 남기기")?.checked).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("지금은 이 알림을 켤 수 없어요.");
  });

  it("offers email only after the shared-chat message is on and the signup email is confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload({ emailAvailable: true }))));
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    expect(switchNamed(container, "같은 글을 메일로도 받기")?.disabled).toBe(true);
    expect(container.textContent).toContain("함께 대화 알림을 켜면 고를 수 있어요.");

    await act(async () => root.unmount());
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload({
      emailAvailable: true,
      chat: { enabled: true, consentedAt: AT },
      email: { enabled: false, consentedAt: null, verified: false, maskedAddress: null },
    }))));
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    expect(switchNamed(container, "같은 글을 메일로도 받기")?.disabled).toBe(true);
    expect(container.textContent).toContain("가입 메일 확인을 마치면 켤 수 있어요.");

    await act(async () => root.unmount());
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload({
      emailAvailable: true,
      chat: { enabled: true, consentedAt: AT },
    }))));
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    expect(switchNamed(container, "같은 글을 메일로도 받기")?.disabled).toBe(false);
    expect(container.textContent).toContain("가입 메일 am***@example.com으로 같은 글을 하루 한 통까지 보내요.");
  });

  // 10장 P2: 강도와 받는 시간은 함께 대화 글을 켠 뒤에 고르고, 두 사람 설정을 합친 결과를 보여 준다.
  it("lets a person pick intensity and hours and says what the two settings add up to", async () => {
    const on = payload({ chat: { enabled: true, consentedAt: AT } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(on))
      .mockResolvedValueOnce(jsonResponse({
        ...on,
        cadence: { intensity: "light", windowStartHour: 9, windowEndHour: 20 },
        couple: { intensity: "light", windowStartHour: 10, windowEndHour: 18, dailyLimit: 1, windowOpen: true },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();

    expect(container.querySelector('[data-testid="amora-care-couple-cadence"]')?.textContent)
      .toBe("두 분 설정을 합쳐 하루 한 건까지, 오전 9시부터 오후 8시 전까지 와요.");
    expect(intensityRadio(container, "normal")?.checked).toBe(true);
    const light = intensityRadio(container, "light");
    expect(light?.closest("label")?.textContent).toBe("덜전날 확인만");
    await act(async () => {
      light?.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenLastCalledWith("/api/amora/care-preferences", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ intensity: "light" }),
    }));
    expect(container.querySelector('[data-testid="amora-care-couple-cadence"]')?.textContent)
      .toBe("두 분 설정을 합쳐 전날 확인만 하루 한 건, 오전 10시부터 오후 6시 전까지 와요.");
    expect(intensityRadio(container, "light")?.checked).toBe(true);
  });

  it("says plainly when the two chosen windows do not overlap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload({
      chat: { enabled: true, consentedAt: AT },
      couple: { intensity: "normal", windowStartHour: 15, windowEndHour: 12, dailyLimit: 1, windowOpen: false },
    }))));
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    expect(container.querySelector('[data-testid="amora-care-couple-cadence"]')?.textContent)
      .toBe("두 분이 고른 시간이 겹치지 않아 지금은 오지 않아요.");
  });

  it("hides intensity and hours until the shared-chat message is on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload())));
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    expect(container.querySelector('[data-testid="amora-care-cadence"]')).toBeNull();
  });

  it("does not trust a malformed server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ...payload(),
      email: { enabled: true, consentedAt: AT, verified: true, maskedAddress: "am***@example.com" },
    })));
    await act(async () => {
      root.render(<AmoraCarePreferenceControl />);
    });
    await flush();
    expect(switchNamed(container, "아모라가 함께 대화에 먼저 글 남기기")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("알림 설정을 불러오지 못했어요.");
  });
});

describe("AmoraCareConsentPrompt (lounge, asked once)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not ask, or even call the server, before the first planned schedule", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<AmoraCareConsentPrompt plannedScheduleCount={0} />);
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it.each([
    ["the person already answered", payload({ promptAnswered: true })],
    ["it is already on", payload({ chat: { enabled: true, consentedAt: AT } })],
    ["no care path can run", payload({ available: false })],
  ])("stays quiet when %s", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    await act(async () => {
      root.render(<AmoraCareConsentPrompt plannedScheduleCount={2} />);
    });
    await flush();
    expect(container.querySelector('[data-testid="amora-care-consent-prompt"]')).toBeNull();
  });

  it("records a decline and disappears without turning anything on", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse(payload({ promptAnswered: true })));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<AmoraCareConsentPrompt plannedScheduleCount={1} />);
    });
    await flush();
    expect(container.textContent).toContain("일정 전날, 아모라가 먼저 알려 드릴까요?");
    expect(container.textContent).toContain("두 분이 모두 켜야 오고, 설정에서 언제든 끌 수 있어요.");

    await act(async () => {
      buttonWithText(container, "괜찮아요")?.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenLastCalledWith("/api/amora/care-preferences", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ promptAnswered: true }),
    }));
    expect(container.querySelector('[data-testid="amora-care-consent-prompt"]')).toBeNull();
  });

  it("turns it on and says the partner still has to turn it on", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse(payload({
        chat: { enabled: true, consentedAt: AT },
        promptAnswered: true,
      })));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<AmoraCareConsentPrompt plannedScheduleCount={1} />);
    });
    await flush();
    await act(async () => {
      buttonWithText(container, "켜기")?.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenLastCalledWith("/api/amora/care-preferences", expect.objectContaining({
      body: JSON.stringify({ chat: true }),
    }));
    expect(container.querySelector('[data-testid="amora-care-consent-prompt-done"]')?.textContent)
      .toBe("켜 두었어요. 상대도 켜면 그날부터 와요.");
  });
});

describe("care consent copy rules", () => {
  it("uses neither the banned product words nor a dash in any visible sentence", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const file of ["AmoraCarePreferenceControl.tsx", "AmoraCareConsentPrompt.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), "src/components/app", file), "utf8");
      const visible = [...source.matchAll(/>\s*([^<>{}]*[가-힣][^<>{}]*)\s*</g)]
        .map((match) => match[1])
        .concat([...source.matchAll(/"([^"]*[가-힣][^"]*)"/g)].map((match) => match[1]));
      expect(visible.length, file).toBeGreaterThan(5);
      for (const sentence of visible) {
        expect(sentence, `${file}: ${sentence}`).not.toMatch(/플래너|파트너|베타|—|–/);
      }
    }
  });
});
