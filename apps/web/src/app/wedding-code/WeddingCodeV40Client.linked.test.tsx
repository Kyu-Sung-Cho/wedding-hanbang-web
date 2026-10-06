import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareEnv } from "@/components/wedding-code/v40";
import { click } from "@/components/wedding-code/v40/inputTestKit";
import { V40_COUNTS, V40_STORAGE, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { encodeCode, parseShareHash } from "@/lib/weddingCode/v40/codec";
import { V40_CLIENT_COPY, V40_COPY, V40_COUPLE_SEND_EXTRA_COPY, V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { compareCouple } from "@/lib/weddingCode/v40/couple";
import { pickQuotes } from "@/lib/weddingCode/v40/quote";
import { buildResult } from "@/lib/weddingCode/v40/score";
import { encodeProgressAnswers, readProgress } from "@/lib/weddingCode/v40/storage";
import type { DecodedCode } from "@/lib/weddingCode/v40/types";
import { readLinkOpened } from "./WeddingCodeV40Client.model";
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
const ORIGIN = "https://hanbang.ai";

async function open(overrides: Parameters<typeof mountClient>[0] = {}): Promise<Mounted> {
  const view = await mountClient({ shareOrigin: ORIGIN, ...overrides });
  mounted.push(view);
  return view;
}

function eventsNamed(name: string) {
  return capture.mock.calls.filter(([event]) => event === name);
}

/**
 * 사람이 상대의 링크를 연 것처럼 주소에 # 뒤를 둔다. 링크를 만드는 공식 길(buildGatedShareUrl)은 관문이 닫힌 응답에 링크를 내지 않지만,
 * 받는 쪽은 누가 만든 링크든 열 수 있어야 하므로 여기서는 코드를 직접 이어 붙인다(관문이 닫힌 사람의 링크도 시험할 수 있게).
 */
function placeLinkInAddress(first: DecodedCode, second?: DecodedCode): string {
  const a = encodeCode(bank, first.formBit, first.responses);
  const b = second === undefined ? null : encodeCode(bank, second.formBit, second.responses);
  if (a === null || (second !== undefined && b === null)) throw new Error("링크를 만들지 못했어요");
  const hash = `#v=${WEDDING_CODE_V40_VERSION}&a=${a}${b === null ? "" : `&b=${b}`}`;
  window.history.replaceState(null, "", `/wedding-code${hash}`);
  return hash;
}

function checkboxes(container: ParentNode): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

interface FakeShare {
  readonly env: ShareEnv;
  readonly shared: ShareData[];
  readonly written: string[];
}

/** kind: sheet = 공유 창이 열림, clipboard = 클립보드만, none = 둘 다 없음. */
function fakeShare(kind: "sheet" | "clipboard" | "none"): FakeShare {
  const shared: ShareData[] = [];
  const written: string[] = [];
  const env: ShareEnv = {
    share: kind === "sheet" ? async (data) => void shared.push(data) : undefined,
    canShare: kind === "sheet" ? () => true : undefined,
    writeText: kind === "none" ? undefined : async (text) => void written.push(text),
  };
  return { env, shared, written };
}

const sender = decodedOf(fixture("couple-partner"));
const receiver = decodedOf(fixture("swua-example"));

beforeEach(() => {
  capture.mockClear();
  window.history.replaceState(null, "", "/wedding-code");
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.unmount();
});

describe("웨딩코드 4.0 클라이언트: 받은 링크로 열기", () => {
  it("상대의 답을 메모리로 옮기고 즉시 주소의 # 뒤를 지운다(판 이름만 남긴다). 받는 사람 화면에는 상대의 것이 없다", async () => {
    const hash = placeLinkInAddress(sender);
    expect(window.location.hash).toBe(hash);
    const spy = vi.spyOn(window.history, "replaceState");
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${WEDDING_CODE_V40_VERSION}`);
    expect(spy.mock.calls.filter(([, , url]) => String(url).includes("#"))).toEqual([]);
    spy.mockRestore();

    expect(screenName(view.container)).toBe("receiver");
    const text = textOf(view.container);
    expect(text).toContain(V40_COPY.receive.title);
    expect(text).toContain(V40_COPY.receive.reloadNote);
    expect(text.split(V40_NOT_VALIDATED_PHRASE).length - 1).toBe(1);
    // 상대의 글자, 코드, 답이 화면과 문서 어디에도 없다.
    const senderCode = encodeCode(bank, sender.formBit, sender.responses) ?? "";
    expect(senderCode).toHaveLength(V40_COUNTS.codeLength);
    expect(view.container.innerHTML).not.toContain(senderCode);
    expect(document.documentElement.outerHTML).not.toContain(senderCode);
    expect(view.container.querySelector("[data-code-letter]")).toBeNull();
    expect(text).not.toContain(V40_COPY.couple.title);
    expect(eventsNamed("wedding_code_intro_viewed")).toEqual([
      ["wedding_code_intro_viewed", { version: WEDDING_CODE_V40_VERSION, scene_total: V40_COUNTS.screens, has_partner_link: true, placement: "intro" }],
    ]);
  });

  it("주소를 지울 때 이 탭의 기록 칸에 링크를 열었다는 표시만 남긴다(답도 글자도 없다). 링크 없이 열면 표시를 만들지 않는다", async () => {
    placeLinkInAddress(sender);
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(readLinkOpened(window.history.state)).toBe("partner");
    const senderCode = encodeCode(bank, sender.formBit, sender.responses) ?? "";
    expect(JSON.stringify(window.history.state)).not.toContain(senderCode);
    expect(JSON.stringify(window.history.state)).not.toContain(senderCode.slice(0, 20));
    await view.unmount();
    mounted.pop();

    window.history.replaceState(null, "", "/wedding-code");
    const solo = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(readLinkOpened(window.history.state)).toBeNull();
    expect(solo.container.querySelector("[data-intro-notice]")).toBeNull();

    const pair = decodedOf(fixture("couple-partner"));
    window.history.replaceState(null, "", "/wedding-code");
    placeLinkInAddress(sender, pair);
    await solo.unmount();
    mounted.pop();
    await open({ initial: { partner: null, both: { first: sender, second: pair } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(readLinkOpened(window.history.state)).toBe("both");
  });

  it("받은 링크를 열었다가 새로고침하면(링크 없이 다시 열림) 시작 화면이 상대의 답이 사라졌다고 말하고, 혼자 본 결과 위에도 한 줄 남는다", async () => {
    placeLinkInAddress(sender);
    const first = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(screenName(first.container)).toBe("receiver");
    await first.unmount();
    mounted.pop();

    // 새로고침: 주소에 # 뒤가 없고(지웠다) 브라우저 기록 칸의 표시만 남아 있다.
    expect(window.location.hash).toBe("");
    expect(readLinkOpened(window.history.state)).toBe("partner");
    const own = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    expect(screenName(view.container)).toBe("intro");
    expect(view.container.querySelector("[data-intro-notice]")?.textContent).toBe(V40_CLIENT_COPY.linkLost.intro.partner);
    // 시작 화면의 고지는 그대로 한 번이다(새 안내가 고지를 늘리지 않는다).
    expect(textOf(view.container).split(V40_NOT_VALIDATED_PHRASE).length - 1).toBe(1);

    const log = await driveToEnd(view.container, own);
    expect(log.last).toBe("result");
    const note = view.container.querySelector('[data-result-section="link-lost"]');
    expect(note?.textContent).toBe(V40_CLIENT_COPY.linkLost.result.partner);
    expect(note?.getAttribute("role")).toBe("note");
    // 두 사람 결과가 아니라 혼자 보는 결과다. 안내는 제목과 고지 바로 아래에 있다.
    expect(view.container.querySelector("[data-wedding-code-result]")).not.toBeNull();
    const sections = [...view.container.querySelectorAll("[data-result-section]")].map((node) => node.getAttribute("data-result-section"));
    expect(sections.slice(0, 2)).toEqual(["header", "link-lost"]);
    expect(textOf(view.container).split(V40_NOT_VALIDATED_PHRASE).length - 1).toBe(1);
  }, 60_000);

  it("두 사람 결과 링크를 열었다가 새로고침해도 시작 화면이 결과가 사라졌다고 말한다", async () => {
    const pair = decodedOf(fixture("couple-partner"));
    placeLinkInAddress(sender, pair);
    const first = await open({ initial: { partner: null, both: { first: sender, second: pair } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(screenName(first.container)).toBe("couple");
    await first.unmount();
    mounted.pop();
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(view.container.querySelector("[data-intro-notice]")?.textContent).toBe(V40_CLIENT_COPY.linkLost.intro.both);
  });

  it("두 사람 결과가 열리면 초점이 이름 없는 덩어리가 아니라 화면 제목으로 간다(낭독기가 화면 이름을 읽는다)", async () => {
    const pair = decodedOf(fixture("couple-partner"));
    const view = await open({ initial: { partner: null, both: { first: sender, second: pair } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(screenName(view.container)).toBe("couple");
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("H1");
    expect(active.textContent).toBe(V40_COPY.couple.title);
    // 내 답을 마쳐서 두 사람 결과가 열릴 때도 같다
    const own = fixture("swua-example");
    await view.unmount();
    mounted.pop();
    placeLinkInAddress(sender);
    const received = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await driveToEnd(received.container, own);
    expect(screenName(received.container)).toBe("couple");
    expect((document.activeElement as HTMLElement).tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe(V40_COPY.couple.title);
    // 내 답을 마쳐 열린 화면에는 상대에게 다시 보내야 한다는 말과 보내는 곳으로 가는 단추가 위쪽에 있다.
    expect(received.container.querySelector("[data-couple-return-step]")?.textContent).toContain(V40_COPY.couple.returnStepNote);
  }, 60_000);

  it("새로 시작하면 표시가 지워져서 안내가 다시 나오지 않는다", async () => {
    window.history.replaceState({ wcV40LinkOpened: "partner" }, "", "/wedding-code");
    const own = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    expect(view.container.querySelector("[data-intro-notice]")).not.toBeNull();
    await driveToEnd(view.container, own);
    expect(view.container.querySelector('[data-result-section="link-lost"]')).not.toBeNull();
    // 처음부터 다시 하기(입구의 도움이 없는 화면은 스스로 처음으로 돌아간다)
    await pressText(view.container, V40_COPY.manage.restart.button);
    await pressText(document.body, V40_COPY.manage.restart.confirmButton);
    await settle(0);
    expect(screenName(view.container)).toBe("intro");
    expect(view.container.querySelector("[data-intro-notice]")).toBeNull();
    expect(readLinkOpened(window.history.state)).toBeNull();
  }, 60_000);

  it("내 답을 하는 동안에도 상대의 것이 나오지 않고, 첫 질문 화면에만 새로고침하면 사라진다는 한 줄이 있다", async () => {
    const own = fixture("swua-example");
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.receive.answerButton);
    expect(view.container.querySelector("[data-received-note]")).not.toBeNull();
    expect(eventsNamed("wedding_code_started")[0][1]).toMatchObject({ has_partner_link: true });
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(view.container.querySelector("[data-received-note]")).toBeNull();
    expect(view.container.querySelector("[data-code-letter]")).toBeNull();
    expect(textOf(view.container)).not.toContain(V40_COPY.couple.title);
  });

  it("끝까지 답하면 두 사람 결과가 열리고, 상대의 답은 이 기기에 저장되지 않는다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage, now: () => NOW, random: randomFor(own) } });
    const senderCode = encodeCode(bank, sender.formBit, sender.responses) ?? "";
    // 내 답을 마치기 전에는 어느 화면에도 상대의 결과가 없다: 나란히 보기 줄도, 제목도, 코드 글자도.
    const leaks: string[] = [];
    const log = await driveToEnd(view.container, own, {
      onScreen: (name) => {
        if (name === "couple") return;
        if (view.container.querySelector("[data-axis][data-tag]") !== null) leaks.push(`${name}: 나란히 보기 줄`);
        if (view.container.querySelector("[data-code-letter]") !== null) leaks.push(`${name}: 코드 글자`);
        if (textOf(view.container).includes(V40_COPY.couple.title)) leaks.push(`${name}: 두 사람 결과 제목`);
        if (view.container.innerHTML.includes(senderCode)) leaks.push(`${name}: 상대의 코드`);
      },
    });
    expect(leaks).toEqual([]);
    expect(log.last).toBe("couple");

    const text = textOf(view.container);
    expect(text).toContain(V40_COPY.couple.title);
    expect(text).toContain(V40_COPY.receive.reloadNote);
    expect(text.split(V40_NOT_VALIDATED_PHRASE).length - 1).toBe(1);
    // 혼자 결과가 아니다.
    expect(view.container.querySelector("[data-wedding-code-result]")).toBeNull();
    // 나란히 보기의 결과는 코어의 비교와 같다: 이야기해 볼 질문과 비슷한 질문의 제목이 그대로 나온다.
    const expected = compareCouple(bank, sender, receiver);
    for (const pair of [...expected.talk, ...expected.similar]) expect(text).toContain(pair.caption);
    expect(view.container.querySelectorAll("[data-axis][data-tag]")).toHaveLength(4);
    // 이 시도는 둘이 나란히 보는 결과로 끝났다고 알린다.
    expect(eventsNamed("wedding_code_completed")[0][1]).toMatchObject({ result_kind: "couple" });
    expect(eventsNamed("wedding_code_comparison_viewed")).toEqual([
      ["wedding_code_comparison_viewed", { version: WEDDING_CODE_V40_VERSION, scene_total: V40_COUNTS.screens }],
    ]);
    // 저장된 것은 내 답뿐이다.
    const senderProgress = encodeProgressAnswers(bank, sender.responses) ?? "";
    const ownProgress = encodeProgressAnswers(bank, receiver.responses) ?? "";
    const saved = readProgress(storage, bank, NOW);
    expect(saved.status === "ready" ? encodeProgressAnswers(bank, saved.snapshot.responses) : null).toBe(ownProgress);
    const everything = JSON.stringify([...storage.data.values()]);
    expect(everything).not.toContain(senderProgress);
    expect(everything).not.toContain(encodeCode(bank, sender.formBit, sender.responses) ?? "unreachable");
  }, 60_000);

  it("방금 답을 마친 사람은 나중에 답한 사람이라 나 기준이 이미 골라져 있고, 누가 나인지 묻지 않는다", async () => {
    const own = fixture("swua-example");
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    expect(textOf(view.container)).not.toContain(V40_COPY.couple.perspective.askNote);
    // 이 기기에 저장된 답과 같다는 말도 하지 않는다(저장이 꺼져 있을 수도 있어서 알 수 없는 말이다).
    expect(textOf(view.container)).not.toContain(V40_COPY.couple.perspective.autoNote);
    expect(view.container.querySelector<HTMLInputElement>('input[type="radio"][value="second"]')?.checked).toBe(true);
    expect(view.container.querySelector<HTMLInputElement>('input[type="radio"][value="first"]')?.checked).toBe(false);
  }, 60_000);

  it("내 글자를 정하지 못하면(관문) 두 사람 결과 대신 비교 불가 안내를 보이고, 다시 하기는 받은 링크를 그대로 둔다", async () => {
    const own = fixture("rhythm-gate");
    const storage = new FakeStorage();
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage, now: () => NOW, random: randomFor(own) } });
    const log = await driveToEnd(view.container, own);
    expect(log.last).toBe("no-compare");
    expect(textOf(view.container)).toContain(V40_COPY.receive.noCompareNote);
    expect(eventsNamed("wedding_code_comparison_viewed")).toHaveLength(0);
    await pressText(view.container, V40_COPY.receive.noCompareRestartButton);
    // 받는 사람 화면으로 돌아왔고, 내 진행 저장은 지워졌다. 상대의 링크는 그대로다.
    expect(screenName(view.container)).toBe("receiver");
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
    expect(eventsNamed("wedding_code_restarted")).toHaveLength(1);
  }, 60_000);

  it("이 기기에 하던 답이 있으면 어느 쪽을 이어 할지 한 번 묻고, 하던 답을 이어 해도 상대의 링크는 그대로 쓰인다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, 30), NOW - DAY);
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage, now: () => NOW, random: randomFor(own) } });
    expect(view.container.querySelector('[data-section-card="invite-conflict"]')).not.toBeNull();
    expect(hasButtonWithText(view.container, V40_COPY.receive.answerButton)).toBe(false);
    await pressText(view.container, V40_COPY.intro.inviteConflict.keepMineButton);
    expect(screenName(view.container)).toBe("questions");
    const log = await driveToEnd(view.container, own, { start: false });
    expect(log.last).toBe("couple");
  }, 60_000);

  it("받은 링크로 처음부터 하기는 하던 답을 지우고 시작한다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, 30), NOW - DAY);
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.intro.inviteConflict.useLinkButton);
    expect(screenName(view.container)).toBe("questions");
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
  });

  it("받은 링크의 흐름에서는 저장돼 있어도 나가기 경고를 건다(상대의 답은 메모리에만 있다)", async () => {
    const own = fixture("swua-example");
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.receive.answerButton);
    await answerScreenLikeFixture(view.container, own);
    await click(view.container.querySelector('[data-nav="next"]'));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("두 사람 결과에서 이 결과를 상대에게도 보내기는 체크 둘을 모두 켜야 열리고, 내 답이 뒤에 든 a 와 b 링크를 만든다", async () => {
    const own = fixture("swua-example");
    const share = fakeShare("clipboard");
    const view = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own), shareEnv: share.env } });
    await driveToEnd(view.container, own);
    const boxes = checkboxes(view.container);
    expect(boxes).toHaveLength(2);
    await pressText(view.container, V40_COPY.coupleSend.sendButton);
    expect(share.written).toEqual([]);
    await click(boxes[0]);
    await pressText(view.container, V40_COPY.coupleSend.sendButton);
    expect(share.written).toEqual([]);
    await click(boxes[1]);
    await pressText(view.container, V40_COPY.coupleSend.sendButton);
    await settle(0);

    expect(share.written).toHaveLength(1);
    const url = share.written[0].split("\n").pop() ?? "";
    const parsed = parseShareHash(bank, new URL(url).hash);
    expect(parsed.kind).toBe("both");
    if (parsed.kind === "both") {
      expect(parsed.first).toEqual(sender);
      expect(parsed.second).toEqual(receiver);
    }
    expect(eventsNamed("wedding_code_share_copied")).toEqual([["wedding_code_share_copied", { version: WEDDING_CODE_V40_VERSION, placement: "link" }]]);
  }, 60_000);
});

describe("웨딩코드 4.0 클라이언트: 두 사람 결과 링크로 열기", () => {
  it("주소의 # 뒤를 지우고 바로 두 사람 결과를 보이며, 시작 화면과 보내기 블록과 다시 하기는 없다", async () => {
    placeLinkInAddress(sender, receiver);
    const view = await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(window.location.hash).toBe("");
    expect(screenName(view.container)).toBe("couple");
    const text = textOf(view.container);
    expect(text).toContain(V40_COPY.couple.title);
    expect(text).toContain(V40_CLIENT_COPY.coupleReloadNote);
    expect(text.split(V40_NOT_VALIDATED_PHRASE).length - 1).toBe(1);
    expect(text).not.toContain(V40_COPY.coupleSend.title);
    expect(text).not.toContain(V40_COPY.manage.restart.button);
    expect(hasButtonWithText(view.container, V40_COPY.couple.startOwnButton)).toBe(true);
    // 이 결과 화면이 닫힌다는 것을 단추 이름이 숨기지 않는다.
    expect(text).toContain(V40_COPY.couple.startOwnNote);
    // 새로고침 안내는 제목과 고지 뒤에 붙는다(경고가 제목보다 먼저 읽히지 않는다).
    expect(text.indexOf(V40_COPY.couple.title)).toBeLessThan(text.indexOf(V40_CLIENT_COPY.coupleReloadNote));
    expect(text.indexOf(V40_COPY.couple.notice)).toBeLessThan(text.indexOf(V40_CLIENT_COPY.coupleReloadNote));
    // 제목은 h1 하나이고 같은 이름의 구역(landmark)이 둘이 아니다.
    expect(view.container.querySelectorAll("h1")).toHaveLength(1);
    expect(view.container.querySelectorAll(`[aria-label="${V40_COPY.couple.title}"]`)).toHaveLength(0);
    expect(eventsNamed("wedding_code_intro_viewed")).toHaveLength(0);
    expect(eventsNamed("wedding_code_comparison_viewed")).toEqual([
      ["wedding_code_comparison_viewed", { version: WEDDING_CODE_V40_VERSION, scene_total: V40_COUNTS.screens }],
    ]);
  });

  it("이 기기의 저장에는 아무것도 쓰지 않고, 지난번 비교 기록은 읽지도 않으며, 기한이 지난 값도 지우지 않는다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(fixture("swua-example")), NOW - 40 * DAY);
    const beforeWrites = storage.writes().length;
    const snapshotBefore = JSON.stringify([...storage.data.entries()]);
    await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage, now: () => NOW } });
    await settle(50);
    expect(storage.writes().length).toBe(beforeWrites);
    expect(JSON.stringify([...storage.data.entries()])).toBe(snapshotBefore);
    expect(storage.log.some((entry) => entry.includes(V40_STORAGE.historyKey))).toBe(false);
  });

  it("이 기기에 저장된 내 답이 링크의 b 와 같으면 자동으로 나로 표시하고, 없으면 누가 나인지 고르게 한다", async () => {
    const withSaved = new FakeStorage();
    seedProgress(withSaved, resultSnapshotOf(fixture("swua-example")), NOW - DAY);
    const auto = await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage: withSaved, now: () => NOW } });
    expect(textOf(auto.container)).toContain(V40_COPY.couple.perspective.autoNote);
    expect(textOf(auto.container)).not.toContain(V40_COPY.couple.perspective.askNote);

    const empty = await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(textOf(empty.container)).toContain(V40_COPY.couple.perspective.askNote);
    expect(textOf(empty.container)).not.toContain(V40_COPY.couple.perspective.autoNote);
  });

  it("자동 저장이 꺼져 있으면 저장된 답을 읽지도 않고 누가 나인지 고르게 한다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(fixture("swua-example")), NOW - DAY);
    storage.data.set(V40_STORAGE.autosaveKey, "off");
    storage.log.length = 0;
    const view = await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage, now: () => NOW } });
    expect(storage.log.some((entry) => entry.includes(V40_STORAGE.progressKey))).toBe(false);
    expect(textOf(view.container)).toContain(V40_COPY.couple.perspective.askNote);
  });

  it("주소를 열어 본 사람의 화면과 링크를 받은 사람이 답을 마친 화면이 같은 나란히 보기를 낸다", async () => {
    const own = fixture("swua-example");
    const finishing = await open({ initial: { partner: sender, both: null }, deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await driveToEnd(finishing.container, own);
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    const opened = await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage, now: () => NOW } });
    // useId 가 만든 번호(_r_23_, _r_3g_ 처럼 숫자와 영문 소문자)만 다르다.
    const plain = (html: string | undefined) => (html ?? "").replace(/_r_[0-9a-z]+_/gu, "_r_");
    for (const part of ['[data-part="axes"]', '[data-part="legend"]']) {
      const seen = opened.container.querySelector(part)?.innerHTML;
      expect(seen).toBeDefined();
      expect(plain(seen)).toBe(plain(finishing.container.querySelector(part)?.innerHTML));
    }
  }, 60_000);

  it("내 웨딩코드 처음부터 해 보기는 입구에 알리고, 입구가 없으면 이 화면 안에서 시작 화면으로 간다", async () => {
    const onRestart = vi.fn();
    const withEntry = await open({ onRestart, initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    await pressText(withEntry.container, V40_COPY.couple.startOwnButton);
    expect(onRestart).toHaveBeenCalledTimes(1);

    const alone = await open({ initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    await pressText(alone.container, V40_COPY.couple.startOwnButton);
    expect(screenName(alone.container)).toBe("intro");
    expect(textOf(alone.container)).not.toContain(V40_COPY.couple.title);
  });

  it("embedded 이면 아래에 하단 탭 여백이 있고 바깥 틀이 div 이다", async () => {
    const view = await open({ embedded: true, initial: { partner: null, both: { first: sender, second: receiver } }, deps: { storage: new FakeStorage(), now: () => NOW } });
    expect(view.container.firstElementChild?.tagName).toBe("DIV");
    expect(view.container.querySelector('[data-embedded="true"]')).not.toBeNull();
  });
});

describe("웨딩코드 4.0 클라이언트: 결과에서 상대에게 보내기", () => {
  async function openResult(share: FakeShare, code: "swua-example" | "rhythm-gate" = "swua-example") {
    const sample = fixture(code);
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(sample), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW, shareEnv: share.env } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    return { view, sample };
  }

  it("내 답과 함께 보내기는 체크를 켜기 전에는 보내지 않고, 켜면 공유 창에 내 답이 든 링크만 보낸다(통계는 없다)", async () => {
    const share = fakeShare("sheet");
    const { view, sample } = await openResult(share);
    await pressText(view.container, V40_COPY.send.sendButton);
    expect(share.shared).toEqual([]);
    expect(textOf(view.container)).toContain(V40_COPY.send.disabledReason);
    await click(checkboxes(view.container)[0]);
    await pressText(view.container, V40_COPY.send.sendButton);
    await settle(0);

    expect(share.shared).toHaveLength(1);
    const [payload] = share.shared;
    expect(payload.text).toBe(V40_COPY.send.messageWithAnswers);
    const parsed = parseShareHash(bank, new URL(payload.url ?? "").hash);
    expect(parsed.kind).toBe("partner");
    if (parsed.kind === "partner") expect(parsed.first).toEqual(decodedOf(sample));
    // 링크에 글자와 결과 문장이 없고, 공유 창 완료는 통계를 보내지 않는다.
    expect(payload.url).not.toMatch(/SWUA/u);
    expect(eventsNamed("wedding_code_share_copied")).toEqual([]);
    expect(textOf(view.container)).toContain(V40_COUPLE_SEND_EXTRA_COPY.sharedSheet);
  });

  it("클립보드에 실제로 복사했을 때만 share_copied 를 한 번 보내고, 속성에 답이나 링크가 없다", async () => {
    const share = fakeShare("clipboard");
    const { view } = await openResult(share);
    await click(checkboxes(view.container)[0]);
    await pressText(view.container, V40_COPY.send.sendButton);
    await settle(0);
    expect(share.written).toHaveLength(1);
    expect(share.written[0].startsWith(V40_COPY.send.messageWithAnswers)).toBe(true);
    expect(textOf(view.container)).toContain(V40_COPY.send.copied);
    expect(eventsNamed("wedding_code_share_copied")).toEqual([["wedding_code_share_copied", { version: WEDDING_CODE_V40_VERSION, placement: "link" }]]);
  });

  it("공유 창도 클립보드도 안 되면 주소 칸이 열리고 통계는 보내지 않는다", async () => {
    const share = fakeShare("none");
    const { view } = await openResult(share);
    await click(checkboxes(view.container)[0]);
    await pressText(view.container, V40_COPY.send.sendButton);
    await settle(0);
    expect(textOf(view.container)).toContain(V40_COPY.send.manualCopy);
    const address = view.container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[readonly][id$="-address"]');
    expect(address?.value ?? "").toContain("#v=");
    expect(eventsNamed("wedding_code_share_copied")).toEqual([]);
  });

  it("질문만 보내기는 답이 없는 주소(판 이름만)를 보내고 체크가 필요 없다", async () => {
    const share = fakeShare("clipboard");
    const { view } = await openResult(share);
    const radios = [...view.container.querySelectorAll<HTMLInputElement>('input[type="radio"][name$="-option"]')];
    await click(radios[1]);
    await pressText(view.container, V40_COPY.send.questionsOnlyButton);
    await settle(0);
    expect(share.written).toHaveLength(1);
    const url = share.written[0].split("\n").pop() ?? "";
    expect(url).toBe(`${ORIGIN}/wedding-code?v=${WEDDING_CODE_V40_VERSION}`);
    expect(new URL(url).hash).toBe("");
  });

  it("코드 복사는 글자와 뜻만 복사하고 통계를 보내지 않는다", async () => {
    const share = fakeShare("clipboard");
    const { view } = await openResult(share);
    await pressText(view.container, V40_COPY.copyCode.button);
    await settle(0);
    expect(share.written).toHaveLength(1);
    expect(share.written[0].startsWith("웨딩코드 SWUA")).toBe(true);
    expect(share.written[0]).not.toContain("#v=");
    expect(share.written[0]).not.toContain(encodeCode(bank, receiver.formBit, receiver.responses) ?? "unreachable");
    expect(textOf(view.container)).toContain(V40_COPY.copyCode.copied);
    expect(eventsNamed("wedding_code_share_copied")).toEqual([]);
  });

  it("클립보드가 막히면 복사하지 못했다고 말하고 복사할 글을 보여 준다", async () => {
    const share = fakeShare("none");
    const { view } = await openResult(share);
    await pressText(view.container, V40_COPY.copyCode.button);
    await settle(0);
    expect(textOf(view.container)).toContain(V40_COPY.copyCode.failed);
    expect(textOf(view.container)).not.toContain(V40_COPY.copyCode.copied);
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea[readonly]")?.value ?? "").toContain("SWUA");
  });

  it("취향 카드는 코드와 분리된 주소로 잇고 누르면 taste_clicked 를 보낸다", async () => {
    const { view } = await openResult(fakeShare("clipboard"));
    const link = [...view.container.querySelectorAll<HTMLAnchorElement>("a")].find((entry) => entry.getAttribute("href") === "/wedding-code/taste");
    expect(link).toBeDefined();
    link?.addEventListener("click", (event) => event.preventDefault());
    await click(link);
    expect(eventsNamed("wedding_code_taste_clicked")).toEqual([["wedding_code_taste_clicked", { version: WEDDING_CODE_V40_VERSION, placement: "result" }]]);
  });

  it("관문으로 코드가 없는 결과에서는 보내기 블록과 코드 복사가 없다", async () => {
    const { view } = await openResult(fakeShare("clipboard"), "rhythm-gate");
    expect(textOf(view.container)).not.toContain(V40_COPY.send.title);
    expect(hasButtonWithText(view.container, V40_COPY.copyCode.button)).toBe(false);
  });

  it("결과의 코드는 보내는 링크로 만든 코드와 같은 답에서 나온다", async () => {
    const { view, sample } = await openResult(fakeShare("clipboard"));
    const result = buildResult(bank, sample.formBit, sample.responses);
    expect(shownCode(view.container)).toBe(result.code);
    expect(pickQuotes(bank, sample.responses, result.axes[0]).kind).toBe("settled");
  });
});
