// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV31Draft } from "@/lib/weddingCode/v31";
import { V31_CORE_INDEXES } from "@/lib/weddingCode/v31Flow";
import { LOCAL_KEY, writeV31LocalProgress, type V31LocalProgressSnapshot } from "@/lib/weddingCode/v31LocalProgress";
import { defaultWeddingCodeEntry } from "./entry";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import WeddingCodeV31Client from "./WeddingCodeV31Client";

/**
 * 서버가 그린 시작 버튼은 자바스크립트가 붙기 전에는 눌러도 아무 일이 없고, 누른 것은 어디에도 남지 않는다.
 * 느린 폰에서는 버튼이 보인 뒤 몇 초 동안 첫 탭이 사라졌고 30초가 지나도 열리지 않았다(운영 실측).
 *
 * 고친 방식: 서버 HTML 에서부터 누를 수 없는 버튼(disabled + aria-busy)으로 내보내고, 이 브라우저의 저장 상태를 읽은 뒤에만 풀린다.
 * 이 시험은 서버가 그린 HTML 을 그대로 받아 hydrateRoot 로 이어받아서 (1) 서버 HTML 과 첫 클라이언트 그림이 어긋나지 않는지,
 * (2) 풀리기 전의 탭이 아무 일도 일으키지 않는지, (3) 풀린 뒤에는 한 번에 열리는지, (4) 저장된 답이 있는 브라우저에서는 버튼이
 * 「저장된 답 지우고 새로 시작」으로 바뀐 뒤에야 풀리는지(저장된 답을 조용히 덮어쓰는 길이 없는지), (5) 하이드레이션이 읽던 위치와
 * 초점을 옮기지 않는지 본다.
 */
vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = "내 웨딩코드 시작하기";
const RESET_AND_START = "저장된 답 지우고 새로 시작";
const WAIT_LINE = "잠깐만요, 저장 상태를 확인하고 있어요. 곧 시작할 수 있어요.";
const IDLE_LINE = "답하면 이 브라우저에 자동으로 저장돼요. 공용 기기라면 아래 ‘자동 저장 설정’에서 꺼 주세요.";

function snapshot(draft: V31Draft): V31LocalProgressSnapshot {
  return { draft, index: V31_CORE_INDEXES[0], flow: "core", screen: "questions", editing: false, needsPriorityReview: false };
}
function received(): V31Draft {
  const draft = createV31Draft();
  for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = 5;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "skipped" };
  draft.avoidances = { status: "no_preference" }; draft.priorities = { status: "skipped" }; draft.spending = { status: "no_preference" };
  return draft;
}

describe("웨딩코드 v3.1 소개: 서버가 그린 버튼은 눌러도 되는 때에만 눌린다", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let onRecoverableError: Mock<(error: unknown) => void>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); scrollIntoView.mockClear();
    window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/wedding-code");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    onRecoverableError = vi.fn<(error: unknown) => void>();
    container = document.createElement("div"); document.body.appendChild(container); root = null;
  });
  afterEach(async () => {
    if (root) { const mounted = root; await act(async () => mounted.unmount()); }
    document.body.replaceChildren(); window.localStorage.clear();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    vi.restoreAllMocks();
  });

  const buttons = () => [...container.querySelectorAll("button")];
  const startButton = () => buttons().find(item => item.textContent?.trim() === START || item.textContent?.trim() === RESET_AND_START || item.textContent?.trim() === "나도 답해보기");
  const toggle = () => buttons().find(item => item.hasAttribute("aria-pressed"));
  const storageLine = () => container.querySelector('aside[aria-label="이 브라우저의 답 저장"] [role="status"]')?.textContent;
  /** 서버가 그린 HTML 을 DOM 에 놓는다. 이 상태가 자바스크립트가 붙기 전에 사람이 보는 화면이다. */
  function paintServerHtml(element: ReactElement) {
    container.innerHTML = renderToString(element);
  }
  async function hydrate(element: ReactElement) {
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError }); });
  }
  async function click(element: Element | null | undefined) {
    if (!(element instanceof HTMLElement)) throw new Error("클릭할 HTML 요소가 없어요.");
    await act(async () => element.click());
  }

  it("서버 HTML: 시작 버튼과 자동 저장 토글은 누를 수 없고(disabled, aria-busy), 글과 안내는 그대로 나온다", () => {
    const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" />;
    paintServerHtml(element);
    const start = startButton();
    expect(start?.textContent?.trim()).toBe(START);
    expect(start?.disabled).toBe(true);
    expect(start?.getAttribute("aria-busy")).toBe("true");
    expect(toggle()?.disabled).toBe(true);
    expect(toggle()?.textContent).toBe("자동 저장 끄기");
    expect(storageLine()).toBe(WAIT_LINE);
    // 서버 HTML 의 글(검색·미리보기에 쓰이는 제목과 첫 문단)과 링크는 그대로 있다.
    expect(container.querySelector("h1")?.textContent).toContain("나는 어떤 결혼식을");
    expect(container.querySelector("h1 + p")?.textContent).toContain("성격을 진단하는 검사가 아니에요.");
    expect(container.querySelectorAll('a[href="/privacy"]')).toHaveLength(1);
    // 서버가 그리지 못하는 것(이어 하기 카드, 지우기 버튼)은 서버 HTML 에 없다.
    expect(container.querySelector('[aria-label="저장된 내 답 이어하기"]')).toBeNull();
    expect(buttons().map(item => item.textContent?.trim())).not.toContain("이 브라우저의 답 지우기");
  });

  it("이어받기: 서버 HTML 과 첫 클라이언트 그림이 어긋나지 않고, 풀리기 전 탭은 아무 일도 일으키지 않으며, 풀리면 한 번에 열린다", async () => {
    const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" />;
    paintServerHtml(element);
    // 자바스크립트가 붙기 전의 탭: disabled 버튼은 클릭을 받지 않는다. 눌린 것을 모았다가 나중에 되살리지도 않는다.
    startButton()!.click();
    toggle()!.click();
    expect(captureWeddingCodeEvent).not.toHaveBeenCalled();
    await hydrate(element);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    // 풀린 뒤: 위에서 누른 탭은 남아 있지 않고(질문 화면이 아니다), 버튼은 눌러지는 상태다.
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(captureWeddingCodeEvent).not.toHaveBeenCalledWith("wedding_code_started", expect.anything());
    const start = startButton()!;
    expect(start.disabled).toBe(false);
    expect(start.hasAttribute("aria-busy")).toBe(false);
    expect(toggle()?.disabled).toBe(false);
    expect(storageLine()).toBe(IDLE_LINE);
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    // 한 번 누르면 바로 질문 화면이다.
    await click(start);
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["G1", "G3", "R4"]);
    expect(captureWeddingCodeEvent).toHaveBeenCalledWith("wedding_code_started", expect.objectContaining({ has_partner_link: false }));
  });

  it("이어받는 동안은 읽던 위치도 초점도 옮기지 않고, 시작한 뒤와 소개로 돌아올 때는 평소처럼 맨 위·화면으로 간다", async () => {
    const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" />;
    paintServerHtml(element);
    // 하이드레이션 전에 사람이 이미 다른 칸(처리방침 링크)에 초점을 두었다.
    const link = container.querySelector<HTMLAnchorElement>('a[href="/privacy"]')!;
    link.focus();
    expect(document.activeElement).toBe(link);
    await hydrate(element);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement, "하이드레이션이 초점을 빼앗지 않는다").toBe(link);
    await click(startButton());
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    const questions = container.querySelector('[aria-label="웨딩코드 기본 질문 1페이지"]');
    expect(questions).not.toBeNull();
    expect(document.activeElement).toBe(questions);
    // 소개로 돌아오면 이어받은 화면이 아니라 새로 바뀐 화면이라 초점이 소개로 간다.
    vi.mocked(window.scrollTo).mockClear();
    await click(container.querySelector('button[aria-label="이전 질문"]'));
    expect(document.activeElement).toBe(container.querySelector('[aria-label="웨딩코드 소개"]'));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("앱 안(embedded)에서 서버가 그린 소개를 이어받을 때도 scrollIntoView 를 부르지 않는다", async () => {
    const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" embedded />;
    paintServerHtml(element);
    await hydrate(element);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    await click(startButton());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  });

  it("브라우저에서 새로 그린 소개(서버 HTML 없음)는 예전처럼 마운트할 때 맨 위로 가고 초점을 소개로 옮긴다", async () => {
    const fresh = createRoot(container); root = fresh;
    await act(async () => fresh.render(<WeddingCodeV31Client shareOrigin="https://hanbang.ai" />));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    expect(document.activeElement).toBe(container.querySelector('[aria-label="웨딩코드 소개"]'));
    expect(startButton()?.disabled).toBe(false);
  });

  it("저장된 답이 있는 브라우저: 버튼은 「저장된 답 지우고 새로 시작」으로 바뀐 뒤에야 풀린다(저장된 답을 조용히 덮어쓰는 길이 없다)", async () => {
    const draft = createV31Draft(); draft.answers.G1 = 4;
    expect(writeV31LocalProgress(window.localStorage, snapshot(draft), null).status).toBe("saved");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    // 입구를 거치면 저장소는 하이드레이션 뒤 주소(#)를 읽고 나서야 켜진다. 서버는 그 전 모습을 그린다.
    const element = <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={defaultWeddingCodeEntry()} />;
    paintServerHtml(element);
    expect(startButton()?.textContent?.trim()).toBe(START);
    expect(startButton()?.disabled).toBe(true);
    // disabled 가 풀리는 순간마다 그때의 버튼 글을 적는다. 글이 「내 웨딩코드 시작하기」인 채로 풀린 적이 한 번이라도 있으면 안 된다.
    const releasedWhile: string[] = [];
    const removeAttribute = Element.prototype.removeAttribute;
    vi.spyOn(Element.prototype, "removeAttribute").mockImplementation(function (this: Element, name: string) {
      if (name === "disabled" && this instanceof HTMLButtonElement) releasedWhile.push(this.textContent?.trim() ?? "");
      return removeAttribute.call(this, name);
    });
    await hydrate(element);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(releasedWhile).toContain(RESET_AND_START);
    expect(releasedWhile).not.toContain(START);
    expect(startButton()?.textContent?.trim()).toBe(RESET_AND_START);
    expect(startButton()?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="저장된 내 답 이어하기"]')).not.toBeNull();
    // 읽기만으로 저장된 답을 바꾸지 않는다.
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
  });

  it("받은 링크 소개(나도 답해보기)도 서버 HTML 에서는 누를 수 없고, 이어받은 뒤에는 한 번에 열린다", async () => {
    const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" partnerDraft={received()} />;
    paintServerHtml(element);
    expect(startButton()?.textContent?.trim()).toBe("나도 답해보기");
    expect(startButton()?.disabled).toBe(true);
    // 상대의 답이 담긴 링크(첫 응답)로 열어도 내 답은 이 브라우저에 저장하니 저장 상태를 읽기 전에는 마찬가지로 누를 수 없다.
    expect(storageLine()).toBe(WAIT_LINE);
    await hydrate(element);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(startButton()?.disabled).toBe(false);
    await click(startButton());
    expect(container.querySelector("[data-question]")).not.toBeNull();
    expect(captureWeddingCodeEvent).toHaveBeenCalledWith("wedding_code_started", expect.objectContaining({ has_partner_link: true }));
  });
});
