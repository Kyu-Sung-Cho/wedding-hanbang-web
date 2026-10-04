import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click } from "@/components/wedding-code/v40/inputTestKit";
import { visibleNumberProblems } from "@/components/wedding-code/v40/startFlowTestKit";
import { V40_COUNTS, V40_STORAGE, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { V40_COPY, V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { buildResult } from "@/lib/weddingCode/v40/score";
import { appendHistory, readHistory, readProgress } from "@/lib/weddingCode/v40/storage";
import { historyEntryOf } from "./WeddingCodeV40Client.model";
import {
  DAY,
  FakeStorage,
  NOW,
  answerScreenLikeFixture,
  bank,
  buttonWithText,
  decodedOf,
  driveToEnd,
  fixture,
  hasButtonWithText,
  itemsOnScreen,
  mountClient,
  overwriteProgress,
  partialSnapshotOf,
  pressText,
  randomFor,
  resultSnapshotOf,
  screenName,
  seedProgress,
  settle,
  shownCode,
  textOf,
  type Mounted,
} from "./WeddingCodeV40Client.testKit";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn(), captureEvent: vi.fn() }));

const capture = vi.mocked(captureWeddingCodeEvent);
const mounted: Mounted[] = [];

async function open(overrides: Parameters<typeof mountClient>[0] = {}): Promise<Mounted> {
  const view = await mountClient(overrides);
  mounted.push(view);
  return view;
}

function eventsNamed(name: string) {
  return capture.mock.calls.filter(([event]) => event === name);
}

/** 확인 창(alertdialog)의 단추를 이름으로 누른다. 창은 문서 맨 아래(portal)에 있다. */
async function confirmDialog(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((entry) => textOf(entry) === label);
  if (button === undefined) throw new Error(`확인 창 단추가 없어요: ${label}`);
  await click(button);
}

async function nextPage(container: HTMLElement): Promise<void> {
  await click(container.querySelector('[data-nav="next"]'));
}

function beforeUnloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  capture.mockClear();
  window.history.replaceState(null, "", "/wedding-code");
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.unmount();
});

describe("웨딩코드 4.0 클라이언트: 시작", () => {
  it("주소 해석이 끝나기 전에도 시작 화면을 보이되 저장소는 읽지 않고 시작 단추는 누를 수 없으며, 끝나면 단추가 풀린다", async () => {
    const storage = new FakeStorage();
    const view = await open({ resolved: false, deps: { storage, now: () => NOW } });
    // 서버가 그리는 화면과 같다: 제목과 소개 글이 있고, 단추는 눌러도 아무 일이 없다.
    expect(screenName(view.container)).toBe("intro");
    expect(view.container.querySelector('[data-screen="intro"]')?.hasAttribute("data-pending")).toBe(true);
    expect(view.container.querySelectorAll("h1")).toHaveLength(1);
    expect(textOf(view.container.querySelector("h1")!)).toBe(V40_COPY.intro.title);
    expect(textOf(view.container)).toContain(V40_COPY.intro.lede);
    const waiting = buttonWithText(view.container, V40_COPY.intro.startButton);
    expect(waiting.disabled).toBe(true);
    expect(waiting.getAttribute("aria-busy")).toBe("true");
    expect(textOf(view.container.querySelector("[data-intro-pending]")!)).toBe(V40_COPY.common.loadingLabel);
    expect(view.container.querySelector("[data-autosave-toggle]")).toBeNull();
    // 저장소를 읽지 않았고 통계도 보내지 않았다. 눌러도 시작되지 않는다.
    expect(storage.log).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
    await click(waiting);
    expect(screenName(view.container)).toBe("intro");
    expect(eventsNamed("wedding_code_started")).toEqual([]);
    expect(storage.log).toEqual([]);

    await view.rerender({ resolved: true });
    // 같은 화면이 속성만 바꿔 이어진다: 대기 표시가 걷히고 단추가 풀리며 자동 저장 단추가 생긴다. 시작 화면을 봤다는 통계는 이때 한 번만 나간다.
    expect(screenName(view.container)).toBe("intro");
    expect(view.container.querySelector('[data-screen="intro"]')?.hasAttribute("data-pending")).toBe(false);
    expect(view.container.querySelector("[data-intro-pending]")).toBeNull();
    const ready = buttonWithText(view.container, V40_COPY.intro.startButton);
    expect(ready.disabled).toBe(false);
    expect(ready.getAttribute("aria-busy")).toBeNull();
    expect(view.container.querySelector("[data-autosave-toggle]")).not.toBeNull();
    expect(eventsNamed("wedding_code_intro_viewed")).toHaveLength(1);
    expect(storage.log.length).toBeGreaterThan(0);
  });

  it("받은 링크나 두 사람 결과 링크가 입구에서 넘어왔으면 주소 해석이 끝날 때까지 시작 화면 없이 불러오는 중이라고만 한다", async () => {
    const first = decodedOf(fixture("couple-partner"));
    const second = decodedOf(fixture("swua-example"));
    for (const initial of [
      { partner: first, both: null },
      { partner: null, both: { first, second } },
    ]) {
      const storage = new FakeStorage();
      const view = await open({ resolved: false, initial, deps: { storage, now: () => NOW } });
      expect(screenName(view.container)).toBe("loading");
      expect(textOf(view.container)).toBe(V40_COPY.common.loadingLabel);
      expect(view.container.querySelector("h1")).toBeNull();
      expect(hasButtonWithText(view.container, V40_COPY.intro.startButton)).toBe(false);
      expect(storage.log).toEqual([]);
      expect(capture).not.toHaveBeenCalled();
    }
  });

  it("시작 화면을 처음 보일 때 한 번만 intro_viewed 를 보내고, 시작하면 started 를 보낸다", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(eventsNamed("wedding_code_intro_viewed")).toEqual([
      ["wedding_code_intro_viewed", { version: WEDDING_CODE_V40_VERSION, scene_total: V40_COUNTS.screens, has_partner_link: false, placement: "intro" }],
    ]);
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(eventsNamed("wedding_code_started")).toEqual([
      ["wedding_code_started", { version: WEDDING_CODE_V40_VERSION, scene_total: V40_COUNTS.screens, has_partner_link: false }],
    ]);
    expect(eventsNamed("wedding_code_intro_viewed")).toHaveLength(1);
    expect(screenName(view.container)).toBe("questions");
  });

  it("입구가 넘긴 안내(initialNotice)를 시작 화면 위에 보이고 시작하면 사라진다", async () => {
    const view = await open({ initialNotice: V40_COPY.error.brokenLink.notice, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(textOf(view.container)).toContain(V40_COPY.error.brokenLink.notice);
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(textOf(view.container)).not.toContain(V40_COPY.error.brokenLink.notice);
  });

  it("시작 화면과 첫 질문 화면에 번호와 A/B 라벨이 없다", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(visibleNumberProblems(view.container as HTMLElement, [`${V40_COUNTS.items}개`, "30일"])).toEqual([]);
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(visibleNumberProblems(view.container as HTMLElement)).toEqual([]);
  });
});

describe("웨딩코드 4.0 클라이언트: 끝까지", () => {
  it("swua-example 표본으로 끝까지 답하면 쉬는 카드 셋과 마지막 정리를 거쳐 표본의 코드가 결과로 나온다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    const log = await driveToEnd(view.container, sample);

    expect(log.last).toBe("result");
    expect(log.screens.filter((name) => name === "rest")).toHaveLength(V40_COUNTS.restCards);
    expect(log.screens.filter((name) => name === "self-intro")).toHaveLength(1);
    expect(shownCode(view.container)).toBe(buildResult(bank, sample.formBit, sample.responses).code);
    expect(shownCode(view.container)).toBe("SWUA");
    // 이 화면에는 고지가 한 번 있다.
    expect(textOf(view.container).split(V40_NOT_VALIDATED_PHRASE).length - 1).toBe(1);
    // 끝까지 갔다고 한 번 알렸다: 개수만이고 답은 없다.
    expect(eventsNamed("wedding_code_completed")).toEqual([
      [
        "wedding_code_completed",
        {
          version: WEDDING_CODE_V40_VERSION,
          scene_total: V40_COUNTS.screens,
          answered_count: V40_COUNTS.items,
          skipped_count: 0,
          result_kind: "solo",
          placement: "result",
        },
      ],
    ]);
    // 결과의 진행은 이 기기에 저장돼 있고, 지난번 비교 기록에도 한 건이 남았다.
    const saved = readProgress(storage, bank, NOW);
    expect(saved.status === "ready" ? saved.snapshot.screen : null).toBe("result");
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
  }, 60_000);

  it("질문 화면마다 scene_reached 를 화면당 한 번, 1에서 42까지 보낸다", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await driveToEnd(view.container, sample);
    const scenes = eventsNamed("wedding_code_scene_reached").map(([, props]) => props as { scene_index: number; scene_total: number; placement: string });
    expect(scenes.map((props) => props.scene_index)).toEqual(Array.from({ length: V40_COUNTS.screens }, (_, index) => index + 1));
    expect(new Set(scenes.map((props) => props.scene_total))).toEqual(new Set([V40_COUNTS.screens]));
    expect(scenes[0].placement).toBe("c1");
    expect(scenes[scenes.length - 1].placement).toBe("self");
  }, 60_000);

  it("잘 모르겠어요가 많은 skip-hint 표본도 끝까지 가서 코드를 보이고 건너뜀 힌트를 한 번 보인다", async () => {
    const sample = fixture("skip-hint");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    const log = await driveToEnd(view.container, sample);
    expect(log.last).toBe("result");
    expect(textOf(view.container).split(V40_COPY.quality.skipHint).length - 1).toBe(1);
    const completed = eventsNamed("wedding_code_completed")[0][1] as { answered_count: number; skipped_count: number };
    expect(completed.answered_count + completed.skipped_count).toBe(V40_COUNTS.items);
    expect(completed.skipped_count).toBeGreaterThan(16);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 이 기기에 저장하고 이어 하기", () => {
  it("다음을 눌러 넘길 때마다 저장하고, 다시 열면 하던 답 카드가 나와 이어서 하기로 같은 자리에서 이어진다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const first = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(first.container, V40_COPY.intro.startButton);
    const before = storage.writes().length;
    await answerScreenLikeFixture(first.container, sample);
    // 고르기만 해서는 저장하지 않는다: 넘긴 답까지만 저장한다.
    expect(storage.writes().length).toBe(before);
    await nextPage(first.container);
    expect(storage.writes().length).toBeGreaterThan(before);
    const secondPageKey = first.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    expect(textOf(first.container)).toContain(V40_COPY.leave.autosaveOnNote);
    await first.unmount();
    mounted.pop();

    const again = await open({ deps: { storage, now: () => NOW + DAY, random: randomFor(sample) } });
    expect(screenName(again.container)).toBe("intro");
    expect(textOf(again.container)).toContain(V40_COPY.intro.resume.title);
    expect(hasButtonWithText(again.container, V40_COPY.intro.startButton)).toBe(false);
    await pressText(again.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(again.container)).toBe("questions");
    expect(again.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(secondPageKey);
    // 이어 한다고 started 를 다시 보내지 않는다.
    expect(eventsNamed("wedding_code_started")).toHaveLength(1);
  }, 60_000);

  it("결과까지 끝낸 저장을 열면 결과가 바로 나오고 지난번 비교 기록에 같은 결과를 또 남기지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(view.container)).toBe("result");
    expect(shownCode(view.container)).toBe("SWUA");
    expect(readHistory(storage, NOW).entries).toHaveLength(0);
    expect(eventsNamed("wedding_code_completed")).toHaveLength(0);
  });

  it("30일이 지난 저장은 실제로 지운 뒤에 지웠다는 안내를 보이고, 하던 답 카드 없이 처음부터 시작한다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(sample, 5), NOW);
    appendHistory(storage, historyEntryOf(buildResult(bank, sample.formBit, sample.responses), NOW), NOW);
    appendHistory(storage, historyEntryOf(buildResult(bank, sample.formBit, sample.responses), NOW + 10 * DAY), NOW + 10 * DAY);
    const view = await open({ deps: { storage, now: () => NOW + 31 * DAY } });
    expect(textOf(view.container)).not.toContain(V40_COPY.intro.resume.title);
    expect(view.container.querySelector('[data-storage-notice="expired"]')).not.toBeNull();
    expect(hasButtonWithText(view.container, V40_COPY.intro.startButton)).toBe(true);
    // 안내가 참이다: 기간이 지난 진행 저장은 지워졌고, 기록은 기간이 지난 건만 덜어 냈다.
    expect(readProgress(storage, bank, NOW + 31 * DAY).status).toBe("empty");
    expect(readHistory(storage, NOW + 31 * DAY).entries.map((entry) => entry.at)).toEqual([NOW + 10 * DAY]);
    expect(storage.data.get(V40_STORAGE.historyKey)).not.toContain(String(NOW));
  });

  it("기간이 지난 저장을 지우지 못하면 지웠다는 안내를 하지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(sample, 5), NOW);
    storage.failRemove = true;
    const view = await open({ deps: { storage, now: () => NOW + 31 * DAY } });
    expect(view.container.querySelector('[data-storage-notice="expired"]')).toBeNull();
    expect(textOf(view.container)).not.toContain(V40_COPY.intro.resume.title);
    expect(hasButtonWithText(view.container, V40_COPY.intro.startButton)).toBe(true);
  });

  it("읽을 수 없는 저장은 읽지 못했다는 안내를 보이고, 시작해서 넘기면 덮어써서 저장한다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.progressKey, "{깨진 값");
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    expect(view.container.querySelector('[data-storage-notice="invalid"]')).not.toBeNull();
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(readProgress(storage, bank, NOW).status).toBe("ready");
  });

  it("저장 시각이 하루를 넘는 미래라 읽지 못하면 폰 날짜와 시간을 확인하라고 덧붙이고, 다른 이유로 못 읽을 때는 덧붙이지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(sample, 5), NOW + 3 * DAY);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    expect(view.container.querySelector('[data-storage-notice="invalidClock"]')?.textContent).toBe(`${V40_COPY.storageNotice.invalid} 폰 날짜와 시간이 맞는지 확인해 보세요.`);
    expect(view.container.querySelector('[data-storage-notice="invalid"]')).toBeNull();
    const other = new FakeStorage();
    other.data.set(V40_STORAGE.progressKey, "{깨진 값");
    const view2 = await open({ deps: { storage: other, now: () => NOW, random: randomFor(sample) } });
    expect(view2.container.querySelector('[data-storage-notice="invalid"]')?.textContent).toBe(V40_COPY.storageNotice.invalid);
  });

  it("하던 답 카드의 처음부터 다시 하기는 저장된 답을 지우고 바로 시작하며 지난번 비교 기록은 남긴다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(sample, 5), NOW - DAY);
    appendHistory(storage, historyEntryOf(buildResult(bank, sample.formBit, sample.responses), NOW - DAY), NOW);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.resume.restartButton);
    expect(screenName(view.container)).toBe("questions");
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
    expect(eventsNamed("wedding_code_started")).toHaveLength(1);
    expect(eventsNamed("wedding_code_restarted")).toEqual([["wedding_code_restarted", { version: WEDDING_CODE_V40_VERSION }]]);
  });

  it("같은 결과를 다시 끝내면 지난번 비교에 앞선 시도의 결과가 나온다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    appendHistory(storage, historyEntryOf(buildResult(bank, sample.formBit, sample.responses), NOW - 3 * DAY), NOW);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await driveToEnd(view.container, sample);
    expect(view.container.querySelector('[data-result-section="history"]')).not.toBeNull();
    expect(readHistory(storage, NOW).entries).toHaveLength(2);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 저장이 안 될 때", () => {
  it("저장소가 가득 차서 쓰기가 던져도 계속 답할 수 있고, 저장됐다는 말 대신 저장 불가 안내를 보인다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    storage.failSet = true;
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(screenName(view.container)).toBe("questions");
    expect(textOf(view.container)).not.toContain(V40_COPY.leave.autosaveOnNote);
    expect(view.container.querySelector('[data-storage-notice="unavailable"]')).not.toBeNull();
    // 저장이 안 되니 나가면 잃는다는 경고를 건다.
    await answerScreenLikeFixture(view.container, sample);
    expect(beforeUnloadPrevented()).toBe(true);
  });

  it("저장소를 못 쓰는 브라우저에서는 시작 화면에 저장 불가 안내가 있고 자동 저장 단추가 없다", async () => {
    const view = await open({ deps: { storage: null, now: () => NOW } });
    expect(view.container.querySelector('[data-storage-notice="unavailable"]')).not.toBeNull();
    expect(view.container.querySelector("[data-autosave-toggle]")).toBeNull();
    expect(hasButtonWithText(view.container, V40_COPY.intro.startButton)).toBe(true);
  });

  it("자동 저장을 끄면 저장된 답과 기록을 지우고, 끈 채로 답하면 아무것도 쓰지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(sample, 5), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    expect(textOf(view.container)).toContain(V40_COPY.autosave.turnedOffNote);
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
    // 하던 답 카드는 사라졌고 시작할 수 있다.
    await pressText(view.container, V40_COPY.intro.startButton);
    const writesBefore = storage.writes().length;
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(storage.writes().length).toBe(writesBefore);
    expect(textOf(view.container)).toContain(V40_COPY.leave.autosaveOffNote);
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
  });

  it("다른 창이 저장을 바꾸면 이 창의 저장을 멈추고, 저장된 답 불러오기로 그쪽 답을 이어 한다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    // 다른 창이 진행을 더 나가서 저장했다.
    overwriteProgress(storage, partialSnapshotOf(sample, 6), NOW);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(view.container.querySelector('[data-storage-notice="conflict"]')).not.toBeNull();
    const otherWindowsRaw = [...storage.data.entries()].join("|");
    await pressText(view.container, V40_COPY.storageNotice.loadSavedButton);
    // 불러오기는 아무것도 쓰지 않고, 그쪽 답 위치에서 이어진다.
    expect([...storage.data.entries()].join("|")).toBe(otherWindowsRaw);
    expect(view.container.querySelector('[data-storage-notice="conflict"]')).toBeNull();
    expect(screenName(view.container)).toBe("questions");
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(`q:${bank.screens[6][0]}`);
  });

  it("다른 창이 저장을 바꿨을 때 이 창의 답으로 저장하기는 그 저장을 덮어쓴다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    overwriteProgress(storage, partialSnapshotOf(sample, 6), NOW + 1000);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    await pressText(view.container, V40_COPY.storageNotice.keepThisButton);
    expect(view.container.querySelector('[data-storage-notice="conflict"]')).toBeNull();
    const saved = readProgress(storage, bank, NOW + 2000);
    expect(saved.status === "ready" ? saved.snapshot.cursor : -1).toBe(bank.codeIndexById.get(bank.screens[2][0]));
  });
});

describe("웨딩코드 4.0 클라이언트: 결과 화면의 경로", () => {
  it("rhythm-gate 표본은 결과 대신 관문 안내를 보이고 링크 보내기와 코드 복사가 없다", async () => {
    const sample = fixture("rhythm-gate");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(view.container)).toBe("result");
    expect(view.container.querySelector("[data-code-letter]")).toBeNull();
    expect(hasButtonWithText(view.container, V40_COPY.copyCode.button)).toBe(false);
    expect(textOf(view.container)).not.toContain(V40_COPY.send.title);
    expect(textOf(view.container)).toContain(V40_COPY.gate.rhythmBody);
  });

  it("rhythm-hint 표본은 힌트 한 줄을 보이고 코드와 링크 보내기가 있다", async () => {
    const sample = fixture("rhythm-hint");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    const text = textOf(view.container);
    expect(text.split(V40_COPY.quality.rhythmHint).length - 1).toBe(1);
    expect(shownCode(view.container)).toHaveLength(4);
    expect(text).toContain(V40_COPY.send.title);
  });

  it("swua-example 표본의 결과는 주제 블록마다 마지막에 직접 고른 쪽 한 줄을 보인다(대비가 없어서 대비 구역은 없다)", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(view.container)).toBe("result");
    const lines = [...view.container.querySelectorAll("[data-self-line]")];
    expect(lines.map((node) => node.getAttribute("data-self-line"))).toEqual(["money", "process", "scope", "support"]);
    expect(lines.map((node) => node.textContent)).toEqual([
      "내가 마지막에 직접 고른 쪽: 「S 장면 먼저」 · 꽤 가까워요",
      "내가 마지막에 직접 고른 쪽: 「W 같이 하기」 · 아주 가까워요",
      "내가 마지막에 직접 고른 쪽: 「U 둘이 정하기」 · 꽤 가까워요",
      "내가 마지막에 직접 고른 쪽: 「A 할 일 먼저」 · 조금 가까워요",
    ]);
    // 줄은 주제 블록 안에 있다.
    for (const line of lines) expect(line.closest("[data-axis-block]")?.getAttribute("data-axis-block")).toBe(line.getAttribute("data-self-line"));
    expect(view.container.querySelector('[data-result-section="contrast"]')).toBeNull();
    // 줄이 답이나 코드에 영향을 주지 않는다: 코드는 표본의 코드 그대로다.
    expect(shownCode(view.container)).toBe("SWUA");
  });

  it("self-contrast 표본은 대비가 있는 주제에는 줄 대신 대비 문장이 있고, 대비가 없는 주제에만 줄이 있다", async () => {
    const sample = fixture("self-contrast");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    const contrastAxes = [...view.container.querySelectorAll("[data-contrast-axis]")].map((node) => node.getAttribute("data-contrast-axis"));
    const lineAxes = [...view.container.querySelectorAll("[data-self-line]")].map((node) => node.getAttribute("data-self-line"));
    expect(contrastAxes.length).toBeGreaterThan(0);
    expect(lineAxes.length).toBeGreaterThan(0);
    // 같은 주제가 두 곳에 나오지 않고, 네 주제가 모두 어느 한쪽에서 말해진다.
    expect(lineAxes.filter((axis) => contrastAxes.includes(axis!))).toEqual([]);
    expect([...contrastAxes, ...lineAxes].sort()).toEqual(["money", "process", "scope", "support"]);
  });

  it("이 주제 답 다시 보기는 그 주제 문항을 필터로 열고, 결과로 돌아가기로 돌아온다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    const reviewButtons = [...view.container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => textOf(button) === V40_COPY.block.reviewAxisButton);
    expect(reviewButtons).toHaveLength(4);
    await click(reviewButtons[0]);
    expect(screenName(view.container)).toBe("questions");
    expect(view.container.querySelector('[data-edit-mode="axis"]')).not.toBeNull();
    expect(eventsNamed("wedding_code_scene_reached").pop()?.[1]).toMatchObject({ placement: "edit" });
    await pressText(view.container, V40_COPY.edit.backToResultButton);
    expect(screenName(view.container)).toBe("result");
    expect(shownCode(view.container)).toBe("SWUA");
    // 답을 고치지 않고 돌아왔다: 처음 끝낸 것이 아니므로 끝냈다는 통계도, 지난번 비교 기록도 새로 생기지 않는다.
    expect(eventsNamed("wedding_code_completed")).toHaveLength(0);
    expect(readHistory(storage, NOW).entries).toHaveLength(0);
  });

  it("잘 모르겠어요가 많은 주제는 결과 전에 넘어간 질문을 한 번 다시 보여 주고 그대로 결과 보기로 넘어간다", async () => {
    const sample = fixture("unusable-axis");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    const log = await driveToEnd(view.container, sample);
    // 마지막 질문을 넘기면 결과 전에 넘어간 질문 다시 보기가 열리고, 넘기면 결과가 나온다.
    expect(log.screens.slice(-2)).toEqual(["skipped-review", "result"]);
    expect(textOf(view.container)).toContain(V40_COPY.block.unusableNote);
    // 이 시도는 처음 끝낸 것으로 한 번만 센다.
    expect(eventsNamed("wedding_code_completed")).toHaveLength(1);
  }, 60_000);

  it("넘어간 질문 다시 보기에서 그대로 결과 보기를 눌러도 결과로 가고 한 번만 센다", async () => {
    const sample = fixture("unusable-axis");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    for (let step = 0; step < 220 && view.container.querySelector('[data-edit-mode="skipped"]') === null; step += 1) {
      if (screenName(view.container) === "questions") {
        await answerScreenLikeFixture(view.container, sample);
        await nextPage(view.container);
      } else {
        await pressText(view.container, V40_COPY.rest.continueButton);
      }
    }
    expect(view.container.querySelector('[data-edit-mode="skipped"]')).not.toBeNull();
    await pressText(view.container, V40_COPY.edit.skippedReviewSkipButton);
    expect(screenName(view.container)).toBe("result");
    expect(eventsNamed("wedding_code_completed")).toHaveLength(1);
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 이전 단추와 나가기", () => {
  it("첫 질문 화면에는 이전 단추가 없고, 다음 화면부터 있으며 눌러도 답이 남는다", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(view.container.querySelector('[data-nav="previous"]')).toBeNull();
    const firstKey = view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).not.toBe(firstKey);
    await click(view.container.querySelector('[data-nav="previous"]'));
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(firstKey);
    expect(view.container.querySelectorAll('[role="radio"][aria-checked="true"], input[type="radio"]:checked').length).toBeGreaterThan(0);
  });

  it("덜 답하고 다음을 누르면 넘어가지 않고 첫 덜 답한 문항으로 안내한다", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.startButton);
    const firstKey = view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    await nextPage(view.container);
    await settle(200);
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(firstKey);
    expect(textOf(view.container)).toContain(V40_COPY.question.incomplete);
  });

  it("아무것도 안 답했으면 나가기 경고가 없고, 자동 저장이 꺼져 있으면 답한 뒤에 경고가 있다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(beforeUnloadPrevented()).toBe(false);
    await answerScreenLikeFixture(view.container, sample);
    expect(beforeUnloadPrevented()).toBe(true);
  });

  it("자동 저장이 켜져 있고 넘긴 답까지 저장돼 있으면 나가기 경고가 없고, 넘기지 않은 답이 생기면 경고한다", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(beforeUnloadPrevented()).toBe(false);
    await answerScreenLikeFixture(view.container, sample);
    expect(beforeUnloadPrevented()).toBe(true);
  });

  it("결과 화면에서는 나가기 경고가 없다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(beforeUnloadPrevented()).toBe(false);
  });
});

describe("웨딩코드 4.0 클라이언트: 다시 하기와 지우기", () => {
  it("결과의 처음부터 다시 하기는 확인 뒤에 진행 저장을 지우고 입구에 알리며 지난번 비교 기록은 남긴다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const onRestart = vi.fn();
    const view = await open({ onRestart, deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await driveToEnd(view.container, sample);
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
    await pressText(view.container, V40_COPY.manage.restart.button);
    expect(onRestart).not.toHaveBeenCalled();
    await confirmDialog(V40_COPY.manage.restart.confirmButton);
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith(undefined);
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
    expect(eventsNamed("wedding_code_restarted")).toEqual([["wedding_code_restarted", { version: WEDDING_CODE_V40_VERSION }]]);
  }, 60_000);

  it("다시 하기를 확인 창에서 그대로 두면 아무것도 지우지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const onRestart = vi.fn();
    const view = await open({ onRestart, deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    await pressText(view.container, V40_COPY.manage.restart.button);
    await confirmDialog(V40_COPY.manage.restart.cancelButton);
    expect(onRestart).not.toHaveBeenCalled();
    expect(readProgress(storage, bank, NOW).status).toBe("ready");
  });

  it("진행 저장을 지우지 못한 채 다시 하기를 하면 입구에 그 사실을 알린다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const onRestart = vi.fn();
    const view = await open({ onRestart, deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    storage.failRemove = true;
    await pressText(view.container, V40_COPY.manage.restart.button);
    await confirmDialog(V40_COPY.manage.restart.confirmButton);
    expect(onRestart).toHaveBeenCalledWith(V40_COPY.manage.clear.failed);
  });

  it("입구의 도움(onRestart)이 없으면 이 화면 안에서 시작 화면으로 돌아간다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    await pressText(view.container, V40_COPY.manage.restart.button);
    await confirmDialog(V40_COPY.manage.restart.confirmButton);
    expect(screenName(view.container)).toBe("intro");
    expect(hasButtonWithText(view.container, V40_COPY.intro.startButton)).toBe(true);
  });

  it("이 기기의 저장 지우기는 진행 저장과 기록을 지우고 실제로 지웠을 때만 지웠다고 말한다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    // 지난번 비교 기록도 하나 심어 둔다: 기록이 비어 있는 채로는 「기록을 지운다」를 시험할 수 없다.
    appendHistory(storage, historyEntryOf(buildResult(bank, sample.formBit, sample.responses), NOW - DAY), NOW - DAY);
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    await pressText(view.container, V40_COPY.manage.clear.button);
    await confirmDialog(V40_COPY.manage.clear.confirmButton);
    await settle(0);
    expect(textOf(view.container)).toContain(V40_COPY.manage.clear.done);
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
    expect(readHistory(storage, NOW).status).toBe("empty");
    expect(readHistory(storage, NOW).entries).toHaveLength(0);
  });

  it("지우기가 실패하면 지웠다고 말하지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    storage.failRemove = true;
    await pressText(view.container, V40_COPY.manage.clear.button);
    await confirmDialog(V40_COPY.manage.clear.confirmButton);
    await settle(0);
    expect(textOf(view.container)).toContain(V40_COPY.manage.clear.failed);
    expect(textOf(view.container)).not.toContain(V40_COPY.manage.clear.done);
  });
});

describe("웨딩코드 4.0 클라이언트: 라운지 안과 작은 화면", () => {
  it("embedded 이면 바깥 틀이 div 이고 로그인해도 계정에 저장되지 않는다는 한 줄과 하단 탭 위로 올라간 단추 줄이 있다", async () => {
    const sample = fixture("swua-example");
    const view = await open({ embedded: true, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    expect(view.container.firstElementChild?.tagName).toBe("DIV");
    expect(view.container.firstElementChild?.getAttribute("data-embedded")).toBe("true");
    const embeddedNote = view.container.querySelector("[data-embedded-note]");
    expect(embeddedNote).not.toBeNull();
    // 한 줄이 있다는 것만이 아니라 그 한 줄이 약속한 말을 한다: 로그인해도 이 답은 계정에 저장되지 않는다.
    expect(embeddedNote === null ? "" : textOf(embeddedNote)).toBe(V40_COPY.intro.embeddedNote);
    expect(V40_COPY.intro.embeddedNote).toContain("계정에 저장되지 않");
    const tabOffset = "max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]";
    expect(view.container.querySelector("[data-action-bar]")?.className ?? "").toContain(tabOffset);
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(view.container.querySelector("[data-action-bar]")?.className ?? "").toContain(tabOffset);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(view.container.querySelector("[data-action-bar]")?.className ?? "").toContain(tabOffset);
  });

  it("embedded 의 결과 화면은 아래에 하단 탭이 가리지 않게 여백을 남긴다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ embedded: true, deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(view.container.querySelector("[data-wedding-code-result]")?.className ?? "").toContain("pb-[calc(6rem+env(safe-area-inset-bottom))]");
  });

  it("embedded 가 아니면 바깥 틀이 main 이다", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(view.container.firstElementChild?.tagName).toBe("MAIN");
  });

  it("세로가 짧은 화면이면 두 문항 화면을 문항 하나씩 나눈다", async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("max-height"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    try {
      const sample = fixture("swua-example");
      const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
      await pressText(view.container, V40_COPY.intro.startButton);
      let twoItemScreens = 0;
      for (let step = 0; step < 8; step += 1) {
        if (itemsOnScreen(view.container).length > 1) twoItemScreens += 1;
        await answerScreenLikeFixture(view.container, sample);
        await nextPage(view.container);
      }
      expect(twoItemScreens).toBe(0);
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
    }
  });

  it("세로가 긴 화면이면 배치표대로 한 화면에 두 문항이 나오는 화면이 있다", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    let twoItemScreens = 0;
    for (let step = 0; step < 8; step += 1) {
      if (itemsOnScreen(view.container).length > 1) twoItemScreens += 1;
      await answerScreenLikeFixture(view.container, sample);
      await nextPage(view.container);
    }
    expect(twoItemScreens).toBeGreaterThan(0);
  });
});
