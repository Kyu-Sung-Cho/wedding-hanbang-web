import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WC64_BANK } from "@/lib/weddingCode/wc64/bank";
import { WC64_AUTOSAVE_KEY, WC64_STORAGE_KEY, type Wc64Plan } from "@/lib/weddingCode/wc64/types";
import WeddingCode64Client from "./WeddingCode64Client";

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
const ALT_SECTIONS = SECTIONS.filter(s => s.noceremony_alt).map(s => s.id);

/* ---------------- 그리기 ---------------- */

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<WeddingCode64Client />); });
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

interface Seen { id: string; done: number; left: number }
interface WalkOptions {
  plan: Wc64Plan;
  /** 다른 자리 안내가 나온 묶음에서 그 자리로 답할지(true) 그런 자리도 없다고 할지(false) */
  altAnswer?: boolean;
  /** 묶음 넘기기 버튼을 누를 묶음 */
  skipAll?: string[];
  /** 몇 문장 답하고 멈출지 */
  stopAfter?: number;
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
      sections.push(sid);
      const alt = ALT_SECTIONS.includes(sid) && opts.plan === "none";
      if (opts.skipAll?.includes(sid) || (alt && opts.altAnswer === false)) await press($("[data-wc64-skip-all]"));
      else await press($("[data-wc64-begin]"));
    } else if (kind === "item") {
      if (opts.stopAfter !== undefined && seen.length >= opts.stopAfter) return { seen, sections };
      const id = $("[data-wc64-item]")!.getAttribute("data-wc64-item")!;
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
    expect(sections).toEqual(WC64_BANK.order);
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

  it("식을 안 올린다고 고르면 예식 문장은 나오지 않는다(다른 자리도 없다고 한 경우)", async () => {
    await mount();
    const { seen } = await walk({ plan: "none", altAnswer: false });
    expect(screenKind()).toBe("result");

    const ids = seen.map(s => s.id);
    expect(ids.filter(id => CEREMONY_IDS.has(id))).toEqual([]);
    const expected = ALL_ITEMS.filter(it => it.skip_tag !== "예식" && !ALT_SECTIONS.includes(it.sid)).map(it => it.id);
    expect(ids).toEqual(expected);

    // 다른 자리 묶음을 정한 뒤부터는 남은 수가 실제 남은 문장 수와 같다
    const firstAfter = seen.findIndex(s => ALL_ITEMS.findIndex(it => it.id === s.id) > ALL_ITEMS.findIndex(it => it.sid === ALT_SECTIONS.at(-1)));
    expect(firstAfter).toBeGreaterThan(0);
    seen.slice(firstAfter).forEach((s, k) => expect(s.left).toBe(seen.length - firstAfter - k));

    const report = captured.report as { report: { answered: number }; answers: Record<string, number> };
    expect(Object.keys(report.answers).filter(id => CEREMONY_IDS.has(id))).toEqual([]);
    expect(report.report.answered).toBe(seen.length);
  });

  it("식을 안 올려도 '그 자리로 답할게요'를 고른 묶음의 문장만 다시 나온다", async () => {
    await mount();
    const { seen } = await walk({ plan: "none", altAnswer: true });
    const ids = seen.map(s => s.id);
    const expected = ALL_ITEMS.filter(it => it.skip_tag !== "예식" || ALT_SECTIONS.includes(it.sid)).map(it => it.id);
    expect(ids).toEqual(expected);
    expect(ids.filter(id => CEREMONY_IDS.has(id)).every(id => ALL_ITEMS.find(it => it.id === id)!.sid === "GUESTS")).toBe(true);
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
      await walk({ plan: "none", altAnswer: true });
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

  it("시작 화면에 고지를 한 번 두고, 식 질문 화면에 시작 안내와 도움말을 그대로 보여 준다", async () => {
    await mount();
    const notice = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";
    expect(container.textContent!.split(notice).length - 1).toBe(1);
    await press(buttonByText("시작하기"));
    expect(screenKind()).toBe("plan");
    expect(container.textContent).toContain(WC64_BANK.meta.start_note);
    expect(container.textContent).toContain(WC64_BANK.meta.plan_question.q);
    expect(container.textContent).toContain(WC64_BANK.meta.plan_question.help);
    for (const o of WC64_BANK.meta.plan_question.options) expect(container.textContent).toContain(o.label);
  });

  it("'해당 없음'은 skip_tag 가 있는 문장에만 나온다", async () => {
    await mount();
    await press(buttonByText("시작하기"));
    await press($('[data-plan="yes"]'));
    let checked = 0;
    for (let guard = 0; guard < 200 && screenKind() !== "result"; guard++) {
      if (screenKind() === "section") { await press($("[data-wc64-begin]")); continue; }
      const id = $("[data-wc64-item]")!.getAttribute("data-wc64-item")!;
      const tagged = Boolean(ALL_ITEMS.find(it => it.id === id)!.skip_tag);
      expect(Boolean($("[data-wc64-na]"))).toBe(tagged);
      checked++;
      if (tagged) await press($("[data-wc64-na]"));
      else { await press($('[data-v="3"]')); await tick(400); }
    }
    expect(checked).toBe(64);
  });
});

/* ---------------- 소스 검사: 주석을 걷어낸 코드만 본다 ---------------- */

const OWN_FILES = ["WeddingCode64Client.tsx", "Intro64.tsx", "Question64.tsx", "styles.ts"];
const ALLOWED_IMPORTS = new Set([
  "react", "@/components/ui/Button", "@/app/wedding-code/storage36",
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

  it.each(OWN_FILES)("%s 는 주소 해시·방문 기록·서버 요청을 쓰지 않는다", (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/location\s*\.\s*hash|\.hash\s*=|pushState|replaceState|hashchange/);
    expect(code).not.toMatch(/\bfetch\s*\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource/);
  });
});
