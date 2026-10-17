import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WC64_BANK } from "@/lib/weddingCode/wc64/bank";
import { WC64_AUTOSAVE_KEY, WC64_STORAGE_KEY, type Wc64Plan } from "@/lib/weddingCode/wc64/types";
import { LOCAL_KEY as V31_LOCAL_KEY } from "@/lib/weddingCode/v31LocalProgress";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";
import WeddingCode64Client from "./WeddingCode64Client";
import { WC64_CLEAR_ANSWERS_LABEL, WC64_CLEAR_CONFIRM_TITLE, WC64_V31_PROGRESS_KEY } from "./Intro64";

// 결과 화면과 두 사람 비교는 다른 트랙의 화면이라 여기서는 받은 값만 잡아 둔다.
const captured = vi.hoisted(() => ({
  report: null as null | Record<string, unknown>,
  compare: null as null | Record<string, unknown>,
}));
vi.mock("./Report64", () => ({
  default: (props: Record<string, unknown> & { compareSlot?: ReactNode }) => {
    captured.report = props;
    return <div data-report-mock>{props.compareSlot}</div>;
  },
}));
// 36문항 저장 확인은 늦게 불러오는 storage36 이 한다. 시험은 그 대답만 바꿔 끼운다.
const wc36 = vi.hoisted(() => ({
  result: null as null | { id: string },
  draft: null as null | Record<string, unknown>,
  loaded: 0,
}));
vi.mock("@/app/wedding-code/storage36", () => {
  wc36.loaded += 1;
  return {
    readResult36: () => wc36.result,
    readDraft36: (context: string | null) => (context === null ? wc36.draft : null),
  };
});
vi.mock("./Compare64", () => ({
  default: (props: Record<string, unknown>) => {
    captured.compare = props;
    return <div data-compare-mock />;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------------- 문항 은행에서 직접 센 기대값(화면 코드의 함수를 쓰지 않는다) ---------------- */

const SECTIONS = WC64_BANK.order.map(sid => WC64_BANK.sections.find(s => s.id === sid)!);
const ALL_ITEMS = SECTIONS.flatMap(s => s.items.map(it => ({ ...it, sid: s.id })));
const KNOW_COUNT = SECTIONS.filter(s => s.kind === "knowledge").reduce((n, s) => n + s.items.length, 0);
const TENDENCY_COUNT = SECTIONS.filter(s => s.kind === "bipolar").reduce((n, s) => n + s.items.length, 0);
const CEREMONY_IDS = new Set(ALL_ITEMS.filter(it => it.skip_tag === "예식").map(it => it.id));
/** 식 없이 하면 남는 문장이 하나도 없는 묶음(안내 카드도 나오지 않는다) */
const ALL_CEREMONY_SECTIONS = SECTIONS.filter(s => s.items.every(it => it.skip_tag === "예식")).map(s => s.id);
/** 안내 카드 화면을 두는 묶음: 안내 문장이 있거나 묶음 넘기기가 있는 곳(UX-4). 나머지는 제목을 문장 화면 머리말로만 보인다. */
const CARD_SECTIONS = SECTIONS.filter(s => Boolean(s.intro) || Boolean(s.skip_all)).map(s => s.id);
/** 다른 판 웨딩코드 기록을 64문항 지우기가 남겨 둘 때 붙는 문장(M3) */
const OTHER_KEPT = "이전 판 웨딩코드(36문항·v3.1) 답은 이 버튼으로 지워지지 않고 그대로 남아요.";

/* ---------------- 그리기 ---------------- */

let container: HTMLDivElement;
let root: Root;

async function mount(props: { embedded?: boolean } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<WeddingCode64Client {...props} />); });
  await tick();
}
async function unmount() {
  await act(async () => root.unmount());
  container.remove();
}
async function tick(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function press(el: Element | null | undefined) {
  if (!el) throw new Error("누를 요소가 없어요");
  await act(async () => { (el as HTMLElement).click(); });
  await tick();
}
const $ = (sel: string) => container.querySelector(sel);
const screenKind = () => $("[data-wc64-screen]")?.getAttribute("data-wc64-screen") ?? null;
const buttonByText = (text: string) =>
  [...container.querySelectorAll("button")].find(b => b.textContent?.trim().startsWith(text));
/** 확인 창은 문서 맨 끝(body)에 그려진다. 처음 누를 때 모듈을 불러오므로 몇 번 기다린다. */
async function dialog(): Promise<HTMLElement | null> {
  for (let i = 0; i < 20; i++) {
    const found = document.querySelector<HTMLElement>('[role="alertdialog"]');
    if (found) return found;
    await tick();
  }
  return null;
}
const dialogButton = (box: HTMLElement, text: string) =>
  [...box.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const readStored = () => window.localStorage.getItem(WC64_STORAGE_KEY);

interface Seen { id: string; done: number; left: number }
interface WalkOptions {
  plan: Wc64Plan;
  /** 묶음 넘기기 버튼을 누를 묶음 */
  skipAll?: string[];
  /** 몇 문장 답하고 멈출지 */
  stopAfter?: number;
  /** 지나는 모든 묶음 카드·문장 화면에서 '답하던 곳으로 건너뛰기' 버튼이 없는지 본다 */
  expectNoJump?: boolean;
}

/** 시작 화면부터 결과(또는 stopAfter)까지 화면이 보여 주는 대로 답한다. */
async function walk(opts: WalkOptions): Promise<{ seen: Seen[]; sections: string[] }> {
  const seen: Seen[] = [];
  const sections: string[] = [];
  for (let guard = 0; guard < 400; guard++) {
    const kind = screenKind();
    if (kind === "result") return { seen, sections };
    if (kind === "intro") await press(buttonByText("시작하기") ?? buttonByText("새로 시작"));
    else if (kind === "plan") await press($(`[data-plan="${opts.plan}"]`));
    else if (kind === "section") {
      const sid = $("[data-wc64-section]")!.getAttribute("data-wc64-section")!;
      if (opts.expectNoJump) expect($("[data-wc64-jump]"), `카드 ${sid}`).toBeNull();
      sections.push(sid);
      if (opts.skipAll?.includes(sid)) await press($("[data-wc64-skip-all]"));
      else await press($("[data-wc64-begin]"));
    } else if (kind === "item") {
      if (opts.stopAfter !== undefined && seen.length >= opts.stopAfter) return { seen, sections };
      const id = $("[data-wc64-item]")!.getAttribute("data-wc64-item")!;
      if (opts.expectNoJump) expect($("[data-wc64-jump]"), `문장 ${id}`).toBeNull();
      const p = $("[data-wc64-progress]")!;
      const text = p.textContent ?? "";
      const done = Number(p.getAttribute("data-done"));
      const left = Number(p.getAttribute("data-left"));
      // 화면 글과 속성이 같은 숫자를 말한다
      expect(text).toContain(`답한 문장 ${done}`);
      expect(text).toContain(`남은 문장 ${left}`);
      seen.push({ id, done, left });
      await press($(`[data-v="${(seen.length % 5) + 1}"]`));
      // 고른 칸이 눌린 채로 잠깐 머문다
      if (screenKind() === "item" && $("[data-wc64-item]")!.getAttribute("data-wc64-item") === id) {
        expect($(`[data-v="${(seen.length % 5) + 1}"]`)!.getAttribute("aria-pressed")).toBe("true");
      }
      await tick(400);
    } else throw new Error(`알 수 없는 화면: ${kind}`);
  }
  throw new Error("결과까지 가지 못했어요");
}

const fetchSpy = vi.fn();
const beaconSpy = vi.fn();

// 확인 창 모듈은 화면이 누를 때 불러온다. 시험에서는 미리 한 번 불러 두어 가짜 시계 안에서도 바로 풀리게 한다.
beforeAll(async () => {
  await import("@/components/wedding-code/v40/RestartBlock");
});

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/wedding-code");
  captured.report = null;
  captured.compare = null;
  wc36.result = null;
  wc36.draft = null;
  window.sessionStorage.clear();
  fetchSpy.mockReset();
  beaconSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  Object.defineProperty(window.navigator, "sendBeacon", { value: beaconSpy, configurable: true, writable: true });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => window.setTimeout(() => cb(performance.now()), 0));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(h => window.clearTimeout(h));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(async () => {
  if (container?.isConnected) await unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("wc64 질문 흐름", () => {
  it("이해도 12 + 성향 52 문장을 모두 답하면 결과로 가고, 진행 숫자는 실제로 남은 문장 수와 같다", async () => {
    expect(KNOW_COUNT).toBe(12);
    expect(TENDENCY_COUNT).toBe(52);
    await mount();
    expect(screenKind()).toBe("intro");
    const { seen, sections } = await walk({ plan: "yes" });

    expect(screenKind()).toBe("result");
    expect(sections).toEqual(CARD_SECTIONS);
    expect(seen.map(s => s.id)).toEqual(ALL_ITEMS.map(it => it.id));
    expect(seen).toHaveLength(64);
    // k번째 문장 화면: 앞에서 답한 수 k, 남은 수 = 이 문장을 포함해 앞으로 실제로 나온 문장 수
    seen.forEach((s, k) => {
      expect(s.done).toBe(k);
      expect(s.left).toBe(seen.length - k);
    });

    const report = captured.report as { report: { answered: number; code: string; complete: boolean }; plan: string };
    expect(report.plan).toBe("yes");
    expect(report.report.answered).toBe(64);
    expect(report.report.code).toMatch(/^[DO][WL][CU][MR]$/);
    expect(Object.keys(captured.compare!.myAnswers as object)).toHaveLength(64);
    expect(captured.compare!.myPlan).toBe("yes");
    expect($("[data-compare-mock]")).not.toBeNull();
  });

  it("식 없이 한다고 고르면 예식 문장은 나오지 않고, 남는 문장이 없는 묶음은 카드도 없으며, 다른 자리 갈래도 없다", async () => {
    // 식 문장만 있는 묶음이 있어야 카드가 빠지는지 볼 수 있다(GUESTS 는 다른 자리 갈래가 있던 묶음)
    expect(ALL_CEREMONY_SECTIONS).toContain("GUESTS");
    await mount();
    const { seen, sections } = await walk({ plan: "none" });
    expect(screenKind()).toBe("result");

    const ids = seen.map(s => s.id);
    expect(ids.filter(id => CEREMONY_IDS.has(id))).toEqual([]);
    const expected = ALL_ITEMS.filter(it => it.skip_tag !== "예식").map(it => it.id);
    expect(ids).toEqual(expected);
    expect(sections).toEqual(CARD_SECTIONS.filter(sid => !ALL_CEREMONY_SECTIONS.includes(sid)));
    // 처음부터 남은 수가 실제 남은 문장 수와 같다(나중에 늘어나는 묶음이 없다)
    seen.forEach((s, k) => {
      expect(s.done).toBe(k);
      expect(s.left).toBe(seen.length - k);
    });

    const report = captured.report as { report: { answered: number }; answers: Record<string, number> };
    expect(Object.keys(report.answers).filter(id => CEREMONY_IDS.has(id))).toEqual([]);
    expect(report.report.answered).toBe(seen.length);
  });

  it("옛 기록에 남은 '다른 자리로 답하기'(skipped 가 false)도 식 없이 하면 예식 문장을 내지 않는다", async () => {
    await mount();
    await walk({ plan: "none", stopAfter: 1 });
    await unmount();
    const stored = JSON.parse(readStored()!);
    window.localStorage.setItem(WC64_STORAGE_KEY, JSON.stringify({ ...stored, skipped: { GUESTS: false } }));
    await mount();
    await press(buttonByText("이어 하기"));
    const { seen, sections } = await walk({ plan: "none" });
    expect(screenKind()).toBe("result");
    expect(sections).not.toContain("GUESTS");
    expect(seen.map(s => s.id).filter(id => CEREMONY_IDS.has(id))).toEqual([]);
    expect(container.textContent).not.toContain("그 자리로 답할게요");
  });

  it("처음 답해 나가는 동안에는 어느 카드·문장에서도 '답하던 곳으로' 버튼이 없다(묶음 마지막 문장 포함)", async () => {
    for (const opts of [
      { plan: "yes" as const },
      { plan: "maybe" as const, skipAll: ["FAMILY"] },
      { plan: "none" as const },
    ]) {
      await mount();
      const { seen } = await walk({ ...opts, expectNoJump: true });
      expect(screenKind()).toBe("result");
      expect(seen.length).toBeGreaterThan(30);
      await unmount();
      window.localStorage.clear();
    }
  });

  it("묶음 넘기기를 누르면 그 묶음 문장은 나오지 않고 남은 수에서도 빠진다", async () => {
    const skipSid = WC64_BANK.sections.find(s => s.skip_all)!.id;
    await mount();
    const { seen } = await walk({ plan: "yes", skipAll: [skipSid] });
    expect(seen.map(s => s.id).some(id => ALL_ITEMS.find(it => it.id === id)!.sid === skipSid)).toBe(false);
    expect(seen).toHaveLength(64 - WC64_BANK.sections.find(s => s.id === skipSid)!.items.length);
    const last = seen.at(-1)!;
    expect(last.left).toBe(1);
  });

  it("답하는 동안 주소의 # 뒤와 방문 기록을 바꾸지 않고, 밖으로 보내는 요청이 없다", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const hashChanges = vi.fn();
    window.addEventListener("hashchange", hashChanges);
    const before = window.location.href;
    try {
      await mount();
      await walk({ plan: "none" });
      expect(screenKind()).toBe("result");
      await press(buttonByText("마지막 문장으로"));
      expect(screenKind()).toBe("item");
    } finally {
      window.removeEventListener("hashchange", hashChanges);
    }
    expect(window.location.hash).toBe("");
    expect(window.location.href).toBe(before);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(hashChanges).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it("새로고침한 뒤 시작 화면에서 이어 하면 멈춘 문장으로 돌아간다", async () => {
    await mount();
    const { seen } = await walk({ plan: "yes", stopAfter: 5 });
    const here = $("[data-wc64-item]")!.getAttribute("data-wc64-item");
    expect(seen).toHaveLength(5);
    const stored = JSON.parse(window.localStorage.getItem(WC64_STORAGE_KEY)!);
    expect(Object.keys(stored.answers)).toEqual(seen.map(s => s.id));
    expect(stored.plan).toBe("yes");
    await unmount();

    await mount();
    expect(screenKind()).toBe("intro");
    const resume = buttonByText("이어 하기");
    expect(resume?.textContent).toContain("5/64");
    await press(resume);
    expect(screenKind()).toBe("item");
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(here);
    expect($("[data-wc64-progress]")!.getAttribute("data-done")).toBe("5");

    // 이어서 끝까지 답하면 결과로 간다
    await walk({ plan: "yes" });
    expect(screenKind()).toBe("result");
    expect((captured.report as { report: { answered: number } }).report.answered).toBe(64);
  });

  it("이어 하기만 누르면 마지막 저장 시각이 그대로이고(30일이 늘지 않는다), 답을 고르면 그때 새로 찍힌다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    await unmount();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const stored = JSON.parse(window.localStorage.getItem(WC64_STORAGE_KEY)!);
    window.localStorage.setItem(WC64_STORAGE_KEY, JSON.stringify({ ...stored, updatedAt: old }));

    await mount();
    await tick(1000);
    await press(buttonByText("이어 하기"));
    await tick(1000);
    expect(screenKind()).toBe("item");
    expect(JSON.parse(window.localStorage.getItem(WC64_STORAGE_KEY)!).updatedAt).toBe(old);
    // 답을 하나 고르면 그때부터 다시 30일이다
    await press($('[data-v="4"]'));
    await tick(400);
    expect(JSON.parse(window.localStorage.getItem(WC64_STORAGE_KEY)!).updatedAt).not.toBe(old);
  });

  it("이어 한 뒤 '이전'·'다음'처럼 자리만 옮기면 옮긴 자리는 저장해도 저장 시각은 그대로다(30일이 늘지 않는다, 2026-10-17 점검)", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 4 });
    await unmount();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const stored = JSON.parse(readStored()!);
    window.localStorage.setItem(WC64_STORAGE_KEY, JSON.stringify({ ...stored, updatedAt: old }));

    await mount();
    await press(buttonByText("이어 하기"));
    expect(screenKind()).toBe("item");
    const startCursor = JSON.parse(readStored()!).cursor;
    // 이전 두 번(내 답을 다시 읽기만 한다)
    await press(buttonByText("이전"));
    await press(buttonByText("이전"));
    await tick(1000);
    const moved = JSON.parse(readStored()!);
    expect(moved.cursor).not.toBe(startCursor);
    expect(moved.updatedAt).toBe(old);
    // 답하던 곳으로 이어 가기도 자리만 옮긴다
    await press($("[data-wc64-jump]"));
    await tick(1000);
    expect(JSON.parse(readStored()!).updatedAt).toBe(old);
    // 답을 고르면 그때 새로 찍힌다
    await press($('[data-v="2"]'));
    await tick(400);
    expect(JSON.parse(readStored()!).updatedAt).not.toBe(old);
  });

  it("안내 문장이 없는 묶음은 안내 카드 없이 첫 문장으로 가고, 묶음 제목은 문장 화면 머리말로 보인다(UX-4)", async () => {
    const cardless = SECTIONS.filter(s => !CARD_SECTIONS.includes(s.id));
    // 카드가 있는 묶음과 없는 묶음이 둘 다 있어야 이 검사가 뜻이 있다
    expect(cardless.length).toBeGreaterThan(0);
    expect(CARD_SECTIONS.length).toBeGreaterThan(0);
    expect(CARD_SECTIONS).toContain("FAMILY");
    await mount();
    await press(buttonByText("시작하기"));
    await press($('[data-plan="yes"]'));
    const firstShown = new Map<string, string>();
    for (let guard = 0; guard < 200 && screenKind() !== "result"; guard++) {
      if (screenKind() === "section") {
        const sid = $("[data-wc64-section]")!.getAttribute("data-wc64-section")!;
        const sec = SECTIONS.find(x => x.id === sid)!;
        // 카드가 나오면 안내 문장이나 넘기기 버튼이 있다(제목뿐인 카드가 없다)
        expect(Boolean(sec.intro) || Boolean($("[data-wc64-skip-all]")), sid).toBe(true);
        await press($("[data-wc64-begin]"));
        continue;
      }
      const id = $("[data-wc64-item]")!.getAttribute("data-wc64-item")!;
      const sid = ALL_ITEMS.find(it => it.id === id)!.sid;
      if (!firstShown.has(sid)) firstShown.set(sid, $('[data-wc64-screen="item"] p.text-sm.font-semibold')?.textContent ?? "");
      await press($('[data-v="3"]'));
      await tick(400);
    }
    expect(screenKind()).toBe("result");
    for (const sec of cardless) expect(firstShown.get(sec.id), sec.id).toBe(sec.title);
  });

  it("카드를 없앤 묶음의 자리에 멈춘 옛 기록은 그 묶음 첫 문장에서 이어 한다(저장한 자리가 밀리지 않는다)", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 1 });
    await unmount();
    const cardless = SECTIONS.find(s => !CARD_SECTIONS.includes(s.id))!;
    // 흐름 배열의 자리: 묶음마다 [카드, 문장…]
    let at = 0;
    for (const sec of SECTIONS) { if (sec.id === cardless.id) break; at += 1 + sec.items.length; }
    const stored = JSON.parse(readStored()!);
    window.localStorage.setItem(WC64_STORAGE_KEY, JSON.stringify({ ...stored, screen: "questions", cursor: at }));
    await mount();
    await press(buttonByText("이어 하기"));
    expect(screenKind()).toBe("item");
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(cardless.items[0].id);
    await unmount();
    // 그 묶음 둘째 문장 자리도 그대로 둘째 문장이다
    window.localStorage.setItem(WC64_STORAGE_KEY, JSON.stringify({ ...stored, screen: "questions", cursor: at + 2 }));
    await mount();
    await press(buttonByText("이어 하기"));
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(cardless.items[1].id);
  });

  it("시작 화면 소개는 식 계획과 이해도부터 묻는다고 하고, 칩 밑에 식 없이 할 때의 문장 수와 두 글자를 적는다(UX-2·UX-3)", async () => {
    const noCeremony = ALL_ITEMS.filter(it => it.skip_tag !== "예식").length;
    expect(noCeremony).toBe(37);
    await mount();
    const intro = $('[data-wc64-screen="intro"]')!;
    expect(intro.textContent).toContain("식 계획 한 가지와 결혼 준비를 얼마나 아는지부터 묻고");
    expect(intro.textContent).not.toContain("웨딩을 얼마나 아는지부터 묻고");
    // 이름 말은 위 소개 한 곳에만 둔다(2026-10-17 점검: 두 문단이 같은 말을 되풀이했다)
    expect($("[data-wc64-noceremony-facts]")!.textContent!.trim()).toBe(
      `식 없이 하면 결혼식을 전제한 문장은 빼고 ${noCeremony}문장만 물어요. 결과는 두 글자와 %로 나오고, 16가지 유형 설명은 없어요.`);
    // 칩 바로 다음 줄이다
    expect(intro.querySelector('[aria-label="이 판 한눈에"]')!.nextElementSibling).toBe($("[data-wc64-noceremony-facts]"));
  });

  it("시작 화면은 결과에 이름이 붙는다는 것을 말하되, 글자를 모두 정했을 때만 붙는다고 쓴다(2026-10-17 결과 이름 결정)", async () => {
    // 은행에 이름이 실제로 있어야 이 문장이 참이다: 16유형 모두, 식 없이 한 두 글자 결과 넷 모두(은행에서 직접 센다)
    const typeCodes = Object.keys(WC64_BANK.types);
    expect(typeCodes).toHaveLength(16);
    for (const code of typeCodes) {
      const n = WC64_BANK.types[code].name;
      expect(n?.adjective && n?.animal, code).toBeTruthy();
    }
    expect(Object.keys(WC64_BANK.no_ceremony_names).sort()).toEqual(["D··M", "D··R", "O··M", "O··R"]);
    await mount();
    const lead = $("[data-wc64-intro-lead]")!.textContent!.trim();
    // %는 고른 답의 비율이 아니라 동의 정도의 차이라 '비율'로 부르지 않는다(2026-10-17 점검)
    expect(lead).toBe(
      "식 계획 한 가지와 결혼 준비를 얼마나 아는지부터 묻고, 고른 답을 네 글자와 %로 모아 보여 드려요. 글자가 모두 정해지면 그 조합에 붙인 이름도 함께 나와요.");
    expect(lead).not.toContain("비율");
    const facts = $("[data-wc64-noceremony-facts]")!.textContent!;
    // 식 없이 줄은 이름 말을 되풀이하지 않는다. 위 소개의 '글자가 모두'가 식 없이 한 두 글자도 품는다.
    expect(facts).not.toContain("이름");
    // 이름이 늘 붙는다고 하지 않는다(정해지지 않은 글자가 있으면 이름이 없다)
    for (const text of [lead]) {
      expect(text).toMatch(/모두 정해지면[^.]*이름/);
      // 이름은 고른 답 묶음에 붙인 이름표라 성격을 풀이하지 않는다. 줄표와 금지어도 없다.
      expect(text).not.toMatch(/성격|습성|당신은|—|–|MBTI|정확|검증된|과학적|진단|궁합|예측|확률/);
    }
  });

  it("36문항 결과나 이어 할 답이 있으면 시작 화면에 돌아갈 링크를 하나 두고, 없으면 두지 않는다", async () => {
    // 저장 키가 없으면 36문항 모듈을 불러오지도 않는다
    await mount();
    await tick();
    expect($("[data-wc64-previous36]")).toBeNull();
    expect(wc36.loaded).toBe(0);
    await unmount();

    // 키는 있지만 읽을 수 있는 기록이 없으면 링크가 없다
    window.localStorage.setItem("wc36:latest", "not-a-uuid");
    await mount();
    await tick();
    await tick();
    expect($("[data-wc64-previous36]")).toBeNull();
    await unmount();

    // 이어 할 36문항 답
    window.localStorage.removeItem("wc36:latest");
    window.localStorage.setItem("wc36:draft:individual", "{}");
    wc36.draft = { step: "questions" };
    await mount();
    await tick();
    await tick();
    let link = $("[data-wc64-previous36]");
    expect(link?.getAttribute("data-wc64-previous36")).toBe("draft");
    expect(link?.getAttribute("href")).toBe("/wedding-code?v=36");
    expect(link?.textContent).toBe("36문항 이어 하기");
    await unmount();

    // 36문항 결과(탭 저장소만 있어도 찾는다)
    window.localStorage.clear();
    window.sessionStorage.setItem("wc36:latest", "11111111-1111-4111-8111-111111111111");
    wc36.result = { id: "11111111-1111-4111-8111-111111111111" };
    await mount();
    await tick();
    await tick();
    link = $("[data-wc64-previous36]");
    expect(link?.getAttribute("data-wc64-previous36")).toBe("result");
    expect(link?.getAttribute("href")).toBe("/wedding-code/result?v=36&rid=11111111-1111-4111-8111-111111111111");
    expect(link?.textContent).toBe("36문항 결과 다시 보기");
  });

  it("자동 저장을 끄면 저장한 답을 바로 지우고, 그 뒤로는 쓰지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 2 });
    expect(window.localStorage.getItem(WC64_STORAGE_KEY)).not.toBeNull();
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    await press(box);
    expect(window.localStorage.getItem(WC64_AUTOSAVE_KEY)).toBe("off");
    expect(window.localStorage.getItem(WC64_STORAGE_KEY)).toBeNull();
    await walk({ plan: "yes", stopAfter: 4 });
    expect(window.localStorage.getItem(WC64_STORAGE_KEY)).toBeNull();
    await unmount();
    await mount();
    expect(buttonByText("이어 하기")).toBeUndefined();
  });

  it("자동 저장이 꺼져 있으면 문단이 30일 이어 하기를 말하지 않고, 지우면 '지금 화면의 답을 지웠어요'라고 한다(2026-10-17 점검)", async () => {
    const note = () => container.querySelector('[aria-label="이 브라우저의 답 저장"] p')!;
    await mount();
    expect(note().getAttribute("data-wc64-autosave-note")).toBe("on");
    expect(note().textContent).toContain("마지막으로 답한 때부터 30일 동안 이어 할 수 있어요.");
    await press(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(note().getAttribute("data-wc64-autosave-note")).toBe("off");
    expect(note().textContent).toBe("자동 저장이 꺼져 있어 답을 이 브라우저에 남기지 않아요. 이 탭을 닫으면 지금 답은 사라져요.");
    expect(note().textContent).not.toContain("30일");
    // 꺼진 채로 답하다 지우면 저장된 답이 없었으므로 '저장한 답을 지웠어요'라고 하지 않는다
    await walk({ plan: "yes", stopAfter: 2 });
    expect(readStored()).toBeNull();
    await press($("[data-wc64-clear]"));
    const box = await dialog();
    await press(dialogButton(box!, "지우기"));
    expect($("[data-wc64-status]")!.textContent).toBe("지금 화면의 답을 지웠어요.");
  });

  it("시작 화면에 고지를 한 번 두고, 식 질문 화면은 질문·도움말·보기만 두며, 문장 전체 안내는 첫 성향 묶음 카드에 있다", async () => {
    const planIntro = WC64_BANK.sections.find(s => s.id === "PLAN")!.intro;
    const knowIntro = WC64_BANK.sections.find(s => s.id === "KNOW")!.intro;
    // 옮긴 안내가 맞는지(빈 문자열이면 아래 not.toContain 이 헛돈다)
    expect(planIntro).toContain("마음이 가는 쪽");
    expect(planIntro).toContain("아직 준비 전이어도");
    await mount();
    const notice = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";
    expect(container.textContent!.split(notice).length - 1).toBe(1);
    await press(buttonByText("시작하기"));
    expect(screenKind()).toBe("plan");
    const plan = $('[data-wc64-screen="plan"]')!;
    expect(plan.textContent).not.toContain(planIntro);
    expect(plan.textContent).not.toContain("마음이 가는 쪽");
    expect(plan.textContent).not.toContain("시작하기 전에");
    expect(plan.textContent).toContain(WC64_BANK.meta.plan_question.q);
    // 도움말은 질문 바로 아래 본문 글씨이고, 초점을 받는 질문 제목만 이 줄을 설명으로 읽는다(두 번 읽히지 않게)
    const help = plan.querySelector("[data-wc64-plan-help]")!;
    expect(help.textContent).toBe(WC64_BANK.meta.plan_question.help);
    expect(help.textContent).not.toContain("결과에 안 들어가요");
    expect(help.textContent).toContain("식을 올린다고 보고 물을게요");
    expect(plan.querySelector("h2")!.nextElementSibling).toBe(help);
    expect(plan.querySelector("h2")!.getAttribute("aria-describedby")).toBe(help.id);
    expect(plan.querySelectorAll(`[aria-describedby~="${help.id}"]`)).toHaveLength(1);
    expect(plan.querySelector('[role="group"]')!.hasAttribute("aria-describedby")).toBe(false);
    // 보기 셋은 파운더가 고른 상황 문구 그대로, 이 순서다(DEC-1)
    expect([...plan.querySelectorAll("[data-plan]")].map(b => [b.getAttribute("data-plan"), b.textContent!.trim()])).toEqual([
      ["yes", "올릴 거예요(작은 식·가족끼리 하는 식 포함)"],
      ["maybe", "아직 정하지 않았어요"],
      ["none", "식 없이 하려고 해요(혼인신고·사진만 등)"],
    ]);
    // 화면의 글은 질문·도움말·보기·이전 뿐이다
    const own = [WC64_BANK.meta.plan_question.q, WC64_BANK.meta.plan_question.help, ...WC64_BANK.meta.plan_question.options.map(o => o.label), "이전"];
    expect(own.reduce((t, s) => t.replace(s, ""), plan.textContent!).trim()).toBe("");

    await press($('[data-plan="yes"]'));
    expect($("[data-wc64-section]")!.getAttribute("data-wc64-section")).toBe("KNOW");
    expect(container.textContent).toContain(knowIntro);
    expect(container.textContent).not.toContain(planIntro);
    await press($("[data-wc64-begin]"));
    while (screenKind() === "item") { await press($('[data-v="3"]')); await tick(400); }
    expect($("[data-wc64-section]")!.getAttribute("data-wc64-section")).toBe("PLAN");
    expect($('[data-wc64-screen="section"]')!.textContent).toContain(planIntro);
  });

  it("'해당 없음'은 skip_tag 가 있는 성향 문장에만 나오고, 이해도 문장에는 나오지 않는다", async () => {
    const knowTagged = ALL_ITEMS.filter(it => it.sid === "KNOW" && it.skip_tag);
    // 태그가 달린 이해도 문장이 있어야 이 검사가 뜻이 있다
    expect(knowTagged.length).toBeGreaterThan(0);
    await mount();
    await press(buttonByText("시작하기"));
    await press($('[data-plan="yes"]'));
    let checked = 0, knowChecked = 0;
    for (let guard = 0; guard < 200 && screenKind() !== "result"; guard++) {
      if (screenKind() === "section") { await press($("[data-wc64-begin]")); continue; }
      const id = $("[data-wc64-item]")!.getAttribute("data-wc64-item")!;
      const it = ALL_ITEMS.find(x => x.id === id)!;
      const knowledge = SECTIONS.find(s => s.id === it.sid)!.kind === "knowledge";
      const offered = Boolean(it.skip_tag) && !knowledge;
      expect(Boolean($("[data-wc64-na]")), id).toBe(offered);
      if (knowledge && it.skip_tag) knowChecked++;
      checked++;
      if (offered) await press($("[data-wc64-na]"));
      else { await press($('[data-v="3"]')); await tick(400); }
    }
    expect(checked).toBe(64);
    expect(knowChecked).toBe(knowTagged.length);
  });

  it("문장·묶음 제목은 진행 숫자를 설명으로 잇고, 상태 줄은 처음부터 그려 둔다", async () => {
    await mount();
    const status = container.querySelector('[role="status"][data-wc64-status]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toBe("");
    await press(buttonByText("시작하기"));
    expect(container.querySelector("[data-wc64-status]")).toBe(status);
    await press($('[data-plan="yes"]'));
    for (const kind of ["section", "item"]) {
      if (kind === "item") await press($("[data-wc64-begin]"));
      expect(screenKind()).toBe(kind);
      const h2 = $(`[data-wc64-screen="${kind}"] h2`)!;
      const describedBy = h2.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const desc = document.getElementById(describedBy!)!;
      expect(desc.closest("[data-wc64-progress]")).not.toBeNull();
      expect(desc.textContent).toMatch(/답한 문장 \d+, 남은 문장 \d+/);
    }
  });

  it("라운지 안(embedded)의 시작 화면 제목은 h2 다(문서의 h1 은 앱 껍데기 것)", async () => {
    await mount({ embedded: true });
    expect(screenKind()).toBe("intro");
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect($('[data-wc64-screen="intro"] h2[data-wc64-focus]')?.textContent).toBe("웨딩코드");
    await unmount();
    await mount();
    expect($('[data-wc64-screen="intro"] h1[data-wc64-focus]')?.textContent).toBe("웨딩코드");
  });

  it("라운지 안(embedded)이면 결과 화면에도 embedded 를 넘겨 결과 제목이 h1 이 되지 않게 한다", async () => {
    await mount({ embedded: true });
    await walk({ plan: "yes" });
    expect(screenKind()).toBe("result");
    expect((captured.report as { embedded?: boolean }).embedded).toBe(true);
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    await unmount();
    window.localStorage.clear();
    await mount();
    await walk({ plan: "yes" });
    expect((captured.report as { embedded?: boolean }).embedded).toBe(false);
  });

  it("라운지 자동 저장 문단은 계정이 아니라 이 브라우저에 저장되고 로그아웃해도 남는다고 알린다(공개 화면에는 없다)", async () => {
    const note = () => container.querySelector('[aria-label="이 브라우저의 답 저장"] p')!.textContent!;
    await mount({ embedded: true });
    expect(note()).toContain("답은 이 브라우저에만 두고");
    expect(note()).toContain("로그인해 있어도 계정에는 저장하지 않고 아모라에도 넘기지 않아요.");
    expect(note()).toContain("로그아웃해도 이 브라우저에 남아서, 같은 브라우저에서 다른 계정으로 로그인한 사람도 볼 수 있어요.");
    // '이 브라우저'를 저장 장소로 두 번 말하지 않는다(2026-10-17 점검)
    expect(note()).not.toContain("계정이 아니라 이 브라우저에 저장되고");
    expect(note()).toContain("자세한 내용은 개인정보 처리방침에 있어요.");
    expect(container.querySelector("[data-wc64-privacy]")?.getAttribute("href")).toBe("/privacy");
    await unmount();
    await mount();
    expect(note()).not.toContain("로그아웃");
    expect(container.querySelector("[data-wc64-privacy]")).toBeNull();
  });

  it("앱 웹뷰 안에서는 자동 저장 문단의 처리방침을 새 창 링크로 두지 않고 이름만 적는다(M2)", async () => {
    const w = window as unknown as Record<string, unknown>;
    w.ReactNativeWebView = { postMessage: () => {} };
    w[MOBILE_WEB_API_NONCE_PROPERTY] = "test-nonce";
    try {
      await mount({ embedded: true });
      const note = container.querySelector('[aria-label="이 브라우저의 답 저장"] p')!;
      expect(note.textContent).toContain("자세한 내용은 개인정보 처리방침에 있어요.");
      expect(container.querySelector("[data-wc64-privacy]")).toBeNull();
      expect(note.querySelector("a")).toBeNull();
      expect(container.querySelector('a[target="_blank"]')).toBeNull();
    } finally {
      delete w.ReactNativeWebView;
      delete w[MOBILE_WEB_API_NONCE_PROPERTY];
    }
    // 브라우저에서는 그대로 새 창 링크다
    await unmount();
    await mount({ embedded: true });
    expect(container.querySelector("[data-wc64-privacy]")?.getAttribute("target")).toBe("_blank");
  });
});

describe("wc64 지우는 버튼과 이어 하기", () => {
  it("결과까지 간 기록이면 시작 화면 주 버튼은 '내 결과 다시 보기'이고 숫자 없이 결과를 연다", async () => {
    await mount();
    await walk({ plan: "yes" });
    expect(screenKind()).toBe("result");
    expect(JSON.parse(readStored()!).screen).toBe("result");
    await unmount();

    await mount();
    expect(buttonByText("이어 하기")).toBeUndefined();
    const again = buttonByText("내 결과 다시 보기")!;
    expect(again.textContent!.trim()).toBe("내 결과 다시 보기");
    expect(again.getAttribute("data-wc64-resume")).toBe("result");
    await press(again);
    expect(screenKind()).toBe("result");
  });

  it("'새로 시작'은 확인을 거치고, 취소하면 기록 그대로, 확인해도 식 계획을 고르기 전에는 저장소를 덮지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 5 });
    const before = readStored();
    expect(JSON.parse(before!).plan).toBe("yes");
    await unmount();

    await mount();
    const startBtn = buttonByText("새로 시작")!;
    expect(startBtn.getAttribute("aria-haspopup")).toBe("dialog");
    startBtn.focus();
    await press(startBtn);
    let box = await dialog();
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("지금까지 고른 답(5/64)이");
    await press(dialogButton(box!, "그대로 두기"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(screenKind()).toBe("intro");
    expect(document.activeElement).toBe(buttonByText("새로 시작"));
    expect(readStored()).toBe(before);

    await press(buttonByText("새로 시작"));
    box = await dialog();
    await press(dialogButton(box!, "새로 시작"));
    expect(screenKind()).toBe("plan");
    await tick(1000);
    expect(readStored()).toBe(before);
    // 식 계획을 고르기 전에 이전을 누르면 앞 기록이 그대로 이어 할 기록이다
    await press(buttonByText("이전"));
    expect(screenKind()).toBe("intro");
    expect(buttonByText("이어 하기")?.textContent).toContain("5/64");
    expect(readStored()).toBe(before);

    // 확인하고 식 계획을 고르면 그때 새 기록이 저장된다
    await press(buttonByText("새로 시작"));
    box = await dialog();
    await press(dialogButton(box!, "새로 시작"));
    await press($('[data-plan="maybe"]'));
    const after = JSON.parse(readStored()!);
    expect(after.plan).toBe("maybe");
    expect(Object.keys(after.answers)).toHaveLength(0);
  });

  it("풀던 중 시작 화면으로 돌아와 새로 시작해도, 식 계획을 고르기 전에 이전을 누르면 풀던 답으로 이어 할 수 있다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 2 });
    for (let guard = 0; guard < 10 && screenKind() !== "intro"; guard++) await press(buttonByText("이전"));
    expect(screenKind()).toBe("intro");
    expect(buttonByText("이어 하기")?.textContent).toContain("2/64");
    await press(buttonByText("새로 시작"));
    const box = await dialog();
    expect(box!.textContent).toContain("지금까지 고른 답(2/64)이");
    await press(dialogButton(box!, "새로 시작"));
    expect(screenKind()).toBe("plan");
    await press(buttonByText("이전"));
    expect(buttonByText("이어 하기")?.textContent).toContain("2/64");
    await press(buttonByText("이어 하기"));
    // 시작 화면까지 돌아온 기록은 아직 답하지 않은 첫 문장에서 잇는다
    expect(screenKind()).toBe("item");
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(ALL_ITEMS[2].id);
    expect($("[data-wc64-progress]")!.getAttribute("data-done")).toBe("2");
  });

  it("결과 화면의 다시 하기와 답 지우기는 확인을 거친다(취소하면 결과 그대로)", async () => {
    await mount();
    await walk({ plan: "yes" });
    const before = readStored();
    const report = () => captured.report as { onRestart: () => void; onClearAnswers: () => void };

    await act(async () => report().onRestart());
    let box = await dialog();
    expect(box!.textContent).toContain("처음부터 다시 할까요?");
    expect(box!.textContent).toContain("지금 결과와 고른 답(64/64)이");
    expect(box!.textContent).toContain("이미 보낸 답 코드는 받은 사람에게 남아 있어요");
    await press(dialogButton(box!, "그대로 두기"));
    expect(screenKind()).toBe("result");
    expect(readStored()).toBe(before);

    await act(async () => report().onClearAnswers());
    box = await dialog();
    expect(box!.textContent).toContain(WC64_CLEAR_CONFIRM_TITLE);
    await press(dialogButton(box!, "그대로 두기"));
    expect(screenKind()).toBe("result");
    expect(readStored()).toBe(before);

    await act(async () => report().onRestart());
    box = await dialog();
    await press(dialogButton(box!, "지우고 다시 하기"));
    expect(screenKind()).toBe("plan");
    expect(readStored()).toBeNull();
  });

  it("문장 화면의 '이 브라우저의 64문항 답 지우기'는 확인을 거치고, 확인하면 저장과 지금 답을 지운다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    const before = readStored();
    expect(buttonByText("답 지우기")).toBeUndefined();
    const clear = $("[data-wc64-clear]") as HTMLButtonElement;
    expect(clear.textContent!.trim()).toBe(WC64_CLEAR_ANSWERS_LABEL);
    await press(clear);
    let box = await dialog();
    expect(box!.textContent).toContain(WC64_CLEAR_CONFIRM_TITLE);
    expect(box!.textContent).toContain("지금까지 고른 답(3/64)이 이 브라우저에서 지워지고 첫 화면으로 돌아가요");
    await press(dialogButton(box!, "그대로 두기"));
    expect(screenKind()).toBe("item");
    expect(readStored()).toBe(before);

    expect(box!.textContent).not.toContain(OTHER_KEPT);
    await press($("[data-wc64-clear]"));
    box = await dialog();
    await press(dialogButton(box!, "지우기"));
    expect(readStored()).toBeNull();
    expect(screenKind()).toBe("intro");
    expect(buttonByText("이어 하기")).toBeUndefined();
    expect($("[data-wc64-status]")!.textContent).toBe("이 브라우저에 저장한 64문항 답을 지웠어요.");
  });

  it("지울 64문항 답이 없으면 묻지 않고 '저장한 64문항 답은 없어요'라고 하며, '지웠어요'라고 하지 않는다(M3)", async () => {
    await mount();
    await press($("[data-wc64-clear]"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect($("[data-wc64-status]")!.textContent).toBe("저장한 64문항 답은 없어요.");
    expect($("[data-wc64-status]")!.textContent).not.toContain("지웠어요");
  });

  it("다른 판 기록(v3.1·36문항)이 있으면 64문항 지우기는 그것을 남기고, 남았다고 말한다(M3)", async () => {
    // 화면이 글자로 둔 v3.1 키가 v3.1 저장 모듈의 키와 같다
    expect(WC64_V31_PROGRESS_KEY).toBe(V31_LOCAL_KEY);
    for (const [label, seed, read] of [
      ["v3.1", () => window.localStorage.setItem(V31_LOCAL_KEY, "{}"), () => window.localStorage.getItem(V31_LOCAL_KEY)],
      ["36문항", () => window.sessionStorage.setItem("wc36:latest", "x"), () => window.sessionStorage.getItem("wc36:latest")],
    ] as const) {
      seed();
      // 지울 64문항 답이 없을 때
      await mount();
      await press($("[data-wc64-clear]"));
      expect(document.querySelector('[role="alertdialog"]'), label).toBeNull();
      expect($("[data-wc64-status]")!.textContent, label).toBe(`저장한 64문항 답은 없어요. ${OTHER_KEPT}`);
      expect(read(), label).not.toBeNull();
      // 64문항 답이 있을 때: 확인 창과 상태 줄이 범위를 말한다
      await walk({ plan: "yes", stopAfter: 2 });
      await press($("[data-wc64-clear]"));
      const box = await dialog();
      expect(box!.textContent, label).toContain(WC64_CLEAR_CONFIRM_TITLE);
      expect(box!.textContent, label).toContain(OTHER_KEPT);
      await press(dialogButton(box!, "지우기"));
      expect(readStored(), label).toBeNull();
      expect(read(), label).not.toBeNull();
      expect($("[data-wc64-status]")!.textContent, label).toBe(`이 브라우저에 저장한 64문항 답을 지웠어요. ${OTHER_KEPT}`);
      await unmount();
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

  it("지우기 버튼은 시작·식 질문·묶음 카드·문장 화면에서 같은 이름이고, 그 이름은 확인 창 제목과 같은 말이다", async () => {
    // 결과 화면(Report64)도 같은 상수를 쓰도록 이름을 한 곳에 둔다
    // 이 버튼은 64문항 기록만 지운다. 이름도 '모두'가 아니라 '64문항 답'이다(M3)
    expect(WC64_CLEAR_ANSWERS_LABEL).toBe("이 브라우저의 64문항 답 지우기");
    expect(WC64_CLEAR_CONFIRM_TITLE).toBe("이 브라우저의 64문항 답을 지울까요?");
    const names: string[] = [];
    const clearName = () => {
      const all = [...container.querySelectorAll("[data-wc64-clear]")];
      expect(all).toHaveLength(1);
      return all[0].textContent!.trim();
    };
    await mount();
    names.push(clearName());
    await press(buttonByText("시작하기"));
    names.push(clearName());
    await press($('[data-plan="yes"]'));
    expect(screenKind()).toBe("section");
    names.push(clearName());
    await press($("[data-wc64-begin]"));
    expect(screenKind()).toBe("item");
    names.push(clearName());
    expect(names).toEqual(Array(4).fill(WC64_CLEAR_ANSWERS_LABEL));
    // 다른 이름의 지우기 버튼이 따로 있지 않다
    expect([...container.querySelectorAll("button")].filter(b => b.textContent!.includes("지우기")).map(b => b.textContent!.trim()))
      .toEqual([WC64_CLEAR_ANSWERS_LABEL]);
  });

  it("앞으로 돌아가 답을 고치면 답하던 곳으로 건너뛰는 버튼이 생기고, 그냥 답해 나갈 때는 없다", async () => {
    await mount();
    await press(buttonByText("시작하기"));
    await press($('[data-plan="yes"]'));
    expect($("[data-wc64-jump]")).toBeNull();
    await press($("[data-wc64-begin]"));
    const ids: string[] = [];
    for (let k = 0; k < 6; k++) {
      expect($("[data-wc64-jump]")).toBeNull();
      ids.push($("[data-wc64-item]")!.getAttribute("data-wc64-item")!);
      await press($('[data-v="2"]'));
      await tick(400);
    }
    const frontier = $("[data-wc64-item]")!.getAttribute("data-wc64-item");
    // 한 칸 뒤로: 다음 걸음이 곧 답하던 곳이라 버튼이 없다
    await press(buttonByText("이전"));
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(ids[5]);
    expect($("[data-wc64-jump]")).toBeNull();
    // 세 칸 뒤로: 버튼이 생기고 누르면 답하던 문장으로 간다
    await press(buttonByText("이전"));
    await press(buttonByText("이전"));
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(ids[3]);
    const jump = $("[data-wc64-jump]")!;
    expect(jump.textContent!.trim()).toBe("답하던 곳으로 이어 가기");
    await press(jump);
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(frontier);
    expect($("[data-wc64-progress]")!.getAttribute("data-done")).toBe("6");
  });

  it("답하던 곳이 다음 묶음의 첫 문장이면 건너뛰기는 그 묶음 안내 카드로 간다(넘기기를 고를 자리를 건너뛰지 않는다)", async () => {
    await mount();
    await press(buttonByText("시작하기"));
    await press($('[data-plan="yes"]'));
    await press($("[data-wc64-begin]"));
    while (screenKind() === "item") { await press($('[data-v="3"]')); await tick(400); }
    expect($("[data-wc64-section]")!.getAttribute("data-wc64-section")).toBe("PLAN");
    expect($("[data-wc64-jump]")).toBeNull();
    // 한 칸 뒤(K12): 다음 걸음이 곧 PLAN 카드라 버튼이 없다
    await press(buttonByText("이전"));
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe("K12");
    expect($("[data-wc64-jump]")).toBeNull();
    await press(buttonByText("이전"));
    await press(buttonByText("이전"));
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe("K10");
    await press($("[data-wc64-jump]"));
    expect(screenKind()).toBe("section");
    expect($("[data-wc64-section]")!.getAttribute("data-wc64-section")).toBe("PLAN");
  });

  it("결과에서 돌아가 앞 문장을 고치면 '결과로 돌아가기'로 결과에 바로 간다", async () => {
    await mount();
    await walk({ plan: "yes" });
    await press(buttonByText("마지막 문장으로"));
    expect(screenKind()).toBe("item");
    expect($("[data-wc64-jump]")).toBeNull();
    await press(buttonByText("이전"));
    const jump = $("[data-wc64-jump]")!;
    expect(jump.textContent!.trim()).toBe("결과로 돌아가기");
    await press(jump);
    expect(screenKind()).toBe("result");
  });
});

/* ---------------- 다른 탭과 같은 저장소를 쓸 때(재판정 blocker) ---------------- */

describe("wc64 다른 탭이 같은 기록을 바꿀 때", () => {
  /** 다른 탭이 저장소를 바꾼 것처럼: 값을 바꾸고 storage 이벤트를 이 창에 보낸다(이벤트는 바꾼 탭이 아닌 다른 탭에만 온다) */
  async function otherTab(key: string, value: string | null, { notify = true } = {}) {
    const oldValue = window.localStorage.getItem(key);
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    if (!notify) return;
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: value, storageArea: window.localStorage }));
    });
    await tick();
  }
  /** 다른 탭에서 문장을 더 답한 기록(지금 저장된 기록에 이해도 두 문장을 더하고, 지금 시각을 찍는다) */
  async function answeredMoreElsewhere(): Promise<string> {
    await tick(5000);
    const stored = JSON.parse(readStored()!);
    const more = { ...stored, answers: { ...stored.answers, K4: 4, K5: 2 }, screen: "intro", updatedAt: new Date(Date.now()).toISOString() };
    return JSON.stringify(more);
  }
  const status = () => $("[data-wc64-status]")!.textContent;
  const answeredCount = () => Object.keys(JSON.parse(readStored()!).answers).length;

  it("시작 화면에 있던 탭은 다른 탭이 더 답한 기록으로 이어 하기 수를 새로 읽고, 이어 하기가 그 기록을 옛 기록으로 덮지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    await unmount();
    await mount();
    expect(buttonByText("이어 하기")?.textContent).toContain("3/64");
    await otherTab(WC64_STORAGE_KEY, await answeredMoreElsewhere());
    expect(buttonByText("이어 하기")?.textContent).toContain("5/64");
    const newer = readStored();
    await press(buttonByText("이어 하기"));
    await tick(1000);
    expect(screenKind()).toBe("item");
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe("K6");
    expect(answeredCount()).toBe(5);
    expect(JSON.parse(readStored()!).updatedAt).toBe(JSON.parse(newer!).updatedAt);
  });

  it("이벤트를 놓쳐 이 탭이 옛 기록을 들고 있어도, 이어 하기는 저장소를 다시 읽어 더 답한 기록에서 잇는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    await unmount();
    await mount();
    expect(buttonByText("이어 하기")?.textContent).toContain("3/64");
    await otherTab(WC64_STORAGE_KEY, await answeredMoreElsewhere(), { notify: false });
    await press(buttonByText("이어 하기"));
    await tick(1000);
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe("K6");
    expect(answeredCount()).toBe(5);
  });

  it("풀던 탭은 다른 탭이 기록을 바꾸면 멈추고 첫 화면으로 돌아오며, 그 뒤로 이 탭의 옛 답을 쓰지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    expect(screenKind()).toBe("item");
    const newer = await answeredMoreElsewhere();
    await otherTab(WC64_STORAGE_KEY, newer);
    expect(screenKind()).toBe("intro");
    expect(status()).toBe("다른 탭이나 창에서 64문항 답이 바뀌어 첫 화면으로 돌아왔어요. ‘이어 하기’를 누르면 가장 최근 답을 불러와요.");
    expect(buttonByText("이어 하기")?.textContent).toContain("5/64");
    await tick(1000);
    expect(readStored()).toBe(newer);
  });

  it("다른 탭이 지우면 풀던 탭은 멈추고, '이전'을 누를 화면도 없이 지운 답을 되살리지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    await otherTab(WC64_STORAGE_KEY, null);
    expect(screenKind()).toBe("intro");
    expect(status()).toBe("다른 탭이나 창에서 64문항 답을 지워서 첫 화면으로 돌아왔어요.");
    expect(buttonByText("이어 하기")).toBeUndefined();
    await tick(1000);
    expect(readStored()).toBeNull();
  });

  it("시작 화면에 있던 탭이 다른 탭의 지우기를 놓쳤어도, 이어 하기를 누르면 지운 답을 되살리지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    await unmount();
    await mount();
    const resume = buttonByText("이어 하기");
    expect(resume).toBeDefined();
    await otherTab(WC64_STORAGE_KEY, null, { notify: false });
    await press(resume);
    await tick(1000);
    expect(screenKind()).toBe("intro");
    expect(readStored()).toBeNull();
    expect(status()).toBe("이 브라우저에 이어 할 64문항 답이 없어요.");
  });

  it("다른 탭이 자동 저장을 끄면 풀던 탭은 지금 화면의 답을 그대로 두고, 그 뒤로 저장하지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    const here = $("[data-wc64-item]")!.getAttribute("data-wc64-item");
    // 다른 탭의 setWc64Autosave(false): 꺼짐을 먼저 남기고 답을 지운다
    await otherTab(WC64_AUTOSAVE_KEY, "off");
    await otherTab(WC64_STORAGE_KEY, null);
    expect(screenKind()).toBe("item");
    expect($("[data-wc64-item]")!.getAttribute("data-wc64-item")).toBe(here);
    expect(status()).toBe("다른 탭이나 창에서 자동 저장을 꺼서 저장한 답을 지웠어요. 지금 화면의 답은 남아 있어요.");
    expect(($('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    await press($('[data-v="4"]'));
    await tick(400);
    expect(readStored()).toBeNull();
  });

  it("다른 저장소(sessionStorage)나 다른 키의 이벤트는 풀던 탭을 멈추지 않는다", async () => {
    await mount();
    await walk({ plan: "yes", stopAfter: 3 });
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: WC64_STORAGE_KEY, newValue: null, storageArea: window.sessionStorage }));
      window.dispatchEvent(new StorageEvent("storage", { key: "hanbang:other", newValue: "x", storageArea: window.localStorage }));
    });
    await tick();
    expect(screenKind()).toBe("item");
    expect(status()).toBe("");
  });
});

/* ---------------- 소스 검사: 주석을 걷어낸 코드만 본다 ---------------- */

const OWN_FILES = ["WeddingCode64Client.tsx", "Intro64.tsx", "Question64.tsx", "styles.ts"];
const ALLOWED_IMPORTS = new Set([
  "react", "@/components/ui/Button", "@/app/wedding-code/storage36", "@/components/wedding-code/v40/RestartBlock",
  "@/hooks/useInsideMobileApp",
  "@/lib/weddingCode/wc64/bank", "@/lib/weddingCode/wc64/io", "@/lib/weddingCode/wc64/model", "@/lib/weddingCode/wc64/types",
  "./Intro64", "./Question64", "./Report64", "./Compare64", "./styles",
]);

function codeOf(file: string): string {
  const raw = readFileSync(resolve(process.cwd(), "src/components/weddingCode64", file), "utf8");
  // 블록 주석과 줄 주석을 걷어낸다(문자열 안의 // 는 이 파일들에 없다는 것도 함께 본다).
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("wc64 화면 소스", () => {
  it.each(OWN_FILES)("%s 는 허용한 모듈만 가져온다(이용 통계·관측 모듈 없음)", (file) => {
    const code = codeOf(file);
    const specs = [
      ...code.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g),
      ...code.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...code.matchAll(/(?:import|require)\(\s*["']([^"']+)["']\s*\)/g),
    ].map(m => m[1]);
    // 가져오기를 읽는 정규식이 실제로 잡는지(화면 파일은 모두 공용 버튼을 가져온다)
    if (file.endsWith(".tsx")) expect(specs).toContain("@/components/ui/Button");
    for (const s of specs) expect(ALLOWED_IMPORTS.has(s), `${file}: ${s}`).toBe(true);
    expect(code).not.toMatch(/analytics|posthog|sentry|captureWeddingCode/i);
  });

  it.each(OWN_FILES)("%s 는 v4 확인 창 모듈을 처음부터 싣지 않는다(누를 때 불러온다)", (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/^\s*import\s[^;]*?from\s+["']@\/components\/wedding-code\/v40\//m);
    if (file === "WeddingCode64Client.tsx") expect(code).toMatch(/\bimport\(\s*["']@\/components\/wedding-code\/v40\/RestartBlock["']\s*\)/);
  });

  it.each(OWN_FILES)("%s 에는 없앤 '다른 자리로 답하기' 갈래(noceremony_alt)가 남아 있지 않다(DEC-1)", (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/noceremony_alt|showAlt|그 자리로 답할게요|그런 자리도 없어요/);
  });

  it("흐름은 묻는 문장 규칙을 은행 함수 하나로 정하고, 쓰지 않는 셋째 인자(skipped)를 넘기지 않는다(CQ-4·CQ-5)", () => {
    const code = codeOf("WeddingCode64Client.tsx");
    expect(code).toMatch(/\bisWc64ItemAsked\(/);
    expect(code).toMatch(/\bwc64SectionAskedCount\(/);
    // 화면이 따로 세는 예식 규칙이 없다
    expect(code).not.toMatch(/skip_tag|"예식"|isWc64CeremonyOff/);
    expect(code).not.toMatch(/wc64ConsideredAnswers\([^()]*,[^()]*,/);
  });

  it.each(OWN_FILES)("%s 는 주소 해시·방문 기록·서버 요청을 쓰지 않는다", (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/location\s*\.\s*hash|\.hash\s*=|pushState|replaceState|hashchange/);
    expect(code).not.toMatch(/\bfetch\s*\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource/);
  });
});
