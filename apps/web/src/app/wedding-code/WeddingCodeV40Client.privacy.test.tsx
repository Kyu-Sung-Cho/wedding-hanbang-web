import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click } from "@/components/wedding-code/v40/inputTestKit";
import { V40_COUNTS, V40_STORAGE, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_FUNNEL_EVENTS, WEDDING_CODE_FUNNEL_PROPERTIES } from "@/lib/analyticsPrivacy";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { browserStorage, readHistory, readProgress } from "@/lib/weddingCode/v40/storage";
import {
  DAY,
  FakeStorage,
  NOW,
  answerScreenLikeFixture,
  bank,
  decodedOf,
  driveToEnd,
  fixture,
  hasButtonWithText,
  mountClient,
  pressText,
  randomFor,
  screenName,
  settle,
  textOf,
  type Mounted,
} from "./WeddingCodeV40Client.testKit";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn(), captureEvent: vi.fn() }));

const capture = vi.mocked(captureWeddingCodeEvent);
const mounted: Mounted[] = [];

async function open(overrides: Parameters<typeof mountClient>[0] = {}): Promise<Mounted> {
  const view = await mountClient({ shareOrigin: "https://hanbang.ai", ...overrides });
  mounted.push(view);
  return view;
}

const SHORT_VALUE = /^[a-z0-9][a-z0-9._-]{0,15}$/u;

beforeEach(() => {
  capture.mockClear();
  window.history.replaceState(null, "", "/wedding-code");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) await mounted.pop()?.unmount();
});

describe("웨딩코드 4.0 클라이언트: 이용 통계는 고지한 것만", () => {
  it("받은 링크로 끝까지 하고 보내기까지 해도 이벤트와 속성이 모두 고지한 목록 안이고, 값에 답이나 링크가 없다", async () => {
    const own = fixture("swua-example");
    const partner = decodedOf(fixture("couple-partner"));
    const written: string[] = [];
    const view = await open({
      initial: { partner, both: null },
      deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own), shareEnv: { writeText: async (text) => void written.push(text) } },
    });
    await driveToEnd(view.container, own);
    for (const box of view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await click(box);
    await pressText(view.container, V40_COPY.coupleSend.sendButton);
    await settle(0);

    const events = new Set<string>(WEDDING_CODE_FUNNEL_EVENTS);
    const properties = new Set<string>(WEDDING_CODE_FUNNEL_PROPERTIES);
    expect(capture.mock.calls.length).toBeGreaterThan(40);
    for (const [event, props] of capture.mock.calls) {
      expect(events.has(event), `고지하지 않은 이벤트: ${event}`).toBe(true);
      for (const [key, value] of Object.entries(props ?? {})) {
        expect(properties.has(key), `고지하지 않은 속성: ${key}`).toBe(true);
        if (typeof value === "string") expect(SHORT_VALUE.test(value), `짧은 식별자가 아닌 값: ${key}=${value}`).toBe(true);
        else if (typeof value === "number") expect(value >= 0 && value <= 1000).toBe(true);
        else expect(typeof value).toBe("boolean");
        expect(String(key === "version" ? WEDDING_CODE_V40_VERSION : value)).not.toContain("#");
      }
    }
    // 판 이름은 모든 이벤트에 v4 로 실린다.
    expect(new Set(capture.mock.calls.map(([, props]) => (props as { version?: string }).version))).toEqual(new Set([WEDDING_CODE_V40_VERSION]));
    // 답 70자, 링크 주소, 글자 코드가 어디에도 없다.
    const everything = JSON.stringify(capture.mock.calls);
    for (const person of [own, fixture("couple-partner")]) expect(everything).not.toContain(encodeCode(bank, person.formBit, person.responses) ?? "unreachable");
    expect(everything).not.toContain("hanbang.ai");
    expect(everything).not.toContain("SWUA");
    // 링크를 복사한 것은 한 번이다.
    expect(capture.mock.calls.filter(([event]) => event === "wedding_code_share_copied")).toHaveLength(1);
  }, 60_000);

  it("두 사람 결과 링크를 열면 comparison_viewed 만 보내고 시작이나 끝냈다는 이벤트는 보내지 않는다", async () => {
    const first = decodedOf(fixture("couple-partner"));
    const second = decodedOf(fixture("swua-example"));
    await open({ initial: { partner: null, both: { first, second } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(capture.mock.calls.map(([event]) => event)).toEqual(["wedding_code_comparison_viewed"]);
  });

  it("결과 화면에 다시 들어와도(이어 하기, 답 다시 보기) 끝냈다는 이벤트를 또 보내지 않는다", async () => {
    const own = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    const before = capture.mock.calls.filter(([event]) => event === "wedding_code_completed").length;
    const review = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => textOf(button) === V40_COPY.block.reviewAxisButton);
    await click(review);
    await pressText(view.container, V40_COPY.edit.backToResultButton);
    expect(screenName(view.container)).toBe("result");
    expect(capture.mock.calls.filter(([event]) => event === "wedding_code_completed")).toHaveLength(before);
    expect(before).toBe(1);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 개발 서버처럼 효과를 두 번씩 돌려도", () => {
  it("StrictMode 에서도 이벤트를 두 번 보내지 않고 끝까지 간다", async () => {
    const own = fixture("swua-example");
    const view = await open({ strict: true, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    const count = (name: string) => capture.mock.calls.filter(([event]) => event === name).length;
    expect(count("wedding_code_intro_viewed")).toBe(1);
    expect(count("wedding_code_started")).toBe(1);
    expect(count("wedding_code_scene_reached")).toBe(V40_COUNTS.screens);
    expect(count("wedding_code_completed")).toBe(1);
    expect(screenName(view.container)).toBe("result");
  }, 60_000);

  it("StrictMode 의 받은 링크 흐름에서도 주소를 한 번 지우고 상대의 답을 잃지 않는다", async () => {
    const partner = decodedOf(fixture("couple-partner"));
    const own = fixture("swua-example");
    const view = await open({ strict: true, initial: { partner, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    expect(screenName(view.container)).toBe("receiver");
    const log = await driveToEnd(view.container, own);
    expect(log.last).toBe("couple");
    expect(capture.mock.calls.filter(([event]) => event === "wedding_code_comparison_viewed")).toHaveLength(1);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 서버 요청이 없다", () => {
  it("끝까지 하고 링크를 보내고 다시 하기까지 해도 fetch, XMLHttpRequest, sendBeacon, 쿠키가 쓰이지 않는다", async () => {
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn();
    const xhrSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhrSpy);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy });
    const cookieBefore = document.cookie;

    const own = fixture("swua-example");
    const written: string[] = [];
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own), shareEnv: { writeText: async (text) => void written.push(text) } } });
    await driveToEnd(view.container, own);
    await click(view.container.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await pressText(view.container, V40_COPY.send.sendButton);
    await pressText(view.container, V40_COPY.copyCode.button);
    await settle(0);
    expect(written).toHaveLength(2);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(document.cookie).toBe(cookieBefore);
    expect(document.querySelectorAll('script[src], img[src^="http"], link[href^="http"], iframe').length).toBe(0);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 자동 저장 끄기와 이전 판", () => {
  it("자동 저장을 끈 채 끝까지 하면 저장소에 자동 저장 선호 하나만 남는다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    await driveToEnd(view.container, own);
    expect(screenName(view.container)).toBe("result");
    expect([...storage.data.keys()]).toEqual([V40_STORAGE.autosaveKey]);
    expect(storage.data.get(V40_STORAGE.autosaveKey)).toBe("off");
    expect(readHistory(storage, NOW).entries).toHaveLength(0);
    // 끈 채로는 지난번 비교도 없다.
    expect(view.container.querySelector('[data-result-section="history"]')).toBeNull();
  }, 60_000);

  it("이전 웨딩코드(v3.1)에 남긴 답이 있으면 읽기만 하는 카드를 보이고, 자동 저장을 끄면 그 답도 지운다고 미리 알린 뒤 지운다", async () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31ProgressKey, JSON.stringify({ savedAt: NOW - DAY }));
    const view = await open({ deps: { storage, now: () => NOW } });
    expect(textOf(view.container)).toContain(V40_COPY.intro.legacy.title);
    expect(view.container.querySelector("[data-autosave-warning]")).not.toBeNull();
    // 카드는 읽기만 한다: 누를 단추가 없다.
    expect(hasButtonWithText(view.container, V40_COPY.intro.newVersionButton)).toBe(false);
    expect(storage.data.has(V40_STORAGE.legacyV31ProgressKey)).toBe(true);
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    expect(storage.data.has(V40_STORAGE.legacyV31ProgressKey)).toBe(false);
    expect(textOf(view.container)).not.toContain(V40_COPY.intro.legacy.title);
  });

  it("다른 탭에서 자동 저장을 끄면 이 탭은 더 쓰지 않고, 저장할 수 없다는 안내가 아니라 꺼 두었다는 안내를 보인다(저장소의 off 상태)", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    // 이 탭이 시작한 뒤에 다른 탭이 자동 저장을 껐다(이 탭은 아직 켜짐으로 알고 있다).
    storage.data.set(V40_STORAGE.autosaveKey, "off");
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(storage.data.has(V40_STORAGE.progressKey)).toBe(false);
    expect(view.container.querySelector('[data-save-note="off"]')).not.toBeNull();
    expect(textOf(view.container)).not.toContain(V40_COPY.storageNotice.unavailable);
  });

  it("이전 웨딩코드에서 자동 저장을 꺼 둔 사람은 v4 에서도 처음부터 저장되지 않는다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31AutosaveKey, "off");
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    expect(view.container.querySelector('[data-autosave-toggle][data-autosave="off"]')).not.toBeNull();
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(storage.writes()).toEqual([]);
  });

  it("자동 저장을 다시 켜면 그때까지 답한 것을 바로 저장한다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
    // 쉬는 카드가 아니어도 질문 화면 위쪽의 알림은 없으니, 다음 쉬는 카드까지 가서 켠다.
    for (let step = 0; step < 40 && screenName(view.container) !== "rest"; step += 1) {
      if (screenName(view.container) === "questions") {
        await answerScreenLikeFixture(view.container, own);
        await click(view.container.querySelector('[data-nav="next"]'));
      }
    }
    expect(screenName(view.container)).toBe("rest");
    expect(textOf(view.container)).toContain(V40_COPY.rest.autosaveOff);
    await pressText(view.container, V40_COPY.rest.turnOnAutosaveButton);
    expect(readProgress(storage, bank, NOW).status).toBe("ready");
    expect(textOf(view.container)).toContain(V40_COPY.rest.saved);
  }, 60_000);

  it("쉬는 카드는 저장이 됐을 때만 저장했다고 말한다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    for (let step = 0; step < 40 && screenName(view.container) !== "rest"; step += 1) {
      await answerScreenLikeFixture(view.container, own);
      await click(view.container.querySelector('[data-nav="next"]'));
    }
    expect(screenName(view.container)).toBe("rest");
    expect(textOf(view.container)).toContain(V40_COPY.rest.saved);
    expect(readProgress(storage, bank, NOW).status).toBe("ready");
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 화면이 바뀔 때의 초점", () => {
  it("화면이 바뀔 때마다 새 화면의 뿌리로 초점이 간다", async () => {
    const own = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    expect(document.activeElement?.getAttribute("data-screen")).toBe("intro");
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(document.activeElement?.getAttribute("data-screen")).toBe("questions");
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(document.activeElement?.getAttribute("data-screen")).toBe("questions");
    await driveToEnd(view.container, own, { start: false });
    expect(document.activeElement?.getAttribute("data-screen")).toBe("result");
  }, 60_000);

  it("두 사람 결과에서는 결과 화면의 제목으로 초점이 간다(이름 없는 뿌리 덩어리가 아니라 제목을 읽는다)", async () => {
    const first = decodedOf(fixture("couple-partner"));
    const second = decodedOf(fixture("swua-example"));
    await open({ initial: { partner: null, both: { first, second } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.closest("[data-screen]")?.getAttribute("data-screen")).toBe("couple");
  });
});

describe("웨딩코드 4.0 클라이언트: 화면 그리기 오류", () => {
  it("그리다가 오류가 나면 빈 화면 대신 새로고침을 권하는 대체 화면을 보인다", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const view = await open({
        deps: {
          storage: new FakeStorage(),
          now: () => {
            throw new Error("시계 오류");
          },
        },
      });
      expect(view.container.querySelector('[data-screen="boundary"]')).not.toBeNull();
      expect(textOf(view.container)).toContain(V40_COPY.error.boundary.title);
      expect(hasButtonWithText(view.container, V40_COPY.error.boundary.reloadButton)).toBe(true);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("웨딩코드 4.0 저장소 핸들", () => {
  it("브라우저의 저장소를 돌려주고, 접근이 막히면 던지지 않고 null 이다", () => {
    expect(browserStorage()).toBe(window.localStorage);
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("실제 브라우저 저장소로도 시작해서 첫 화면을 넘기면 진행이 저장된다", async () => {
    window.localStorage.clear();
    const own = fixture("swua-example");
    const view = await open({ deps: { now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(window.localStorage.getItem(V40_STORAGE.progressKey)).not.toBeNull();
    window.localStorage.clear();
  });
});
