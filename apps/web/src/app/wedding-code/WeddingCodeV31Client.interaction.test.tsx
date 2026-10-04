// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_AVOIDANCES, WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV31Draft, decodeV31 } from "@/lib/weddingCode/v31";
import WeddingCodeV31Client from "./WeddingCodeV31Client";
import WeddingCodeV31Sharing from "./WeddingCodeV31Sharing";
import { V31PriorityInput } from "./WeddingCodeV31Inputs";
import { V31_CORE_RATING_IDS, V31_EXTRA_RATING_IDS } from "@/lib/weddingCode/v31Flow";
import { readV31LocalProgress } from "@/lib/weddingCode/v31LocalProgress";
import { sanitizeWeddingCodeFunnelCapture } from "@/lib/analyticsPrivacy";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("WeddingCodeV31Client", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks(); window.localStorage.clear(); window.history.replaceState(null, "", "/wedding-code");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); window.localStorage.clear(); vi.restoreAllMocks(); });

  async function click(element: HTMLElement | null | undefined) {
    expect(element).toBeTruthy(); await act(async () => element!.click());
  }
  async function button(label: string) {
    await click([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label));
  }
  async function rating(value: string | number, id?: string) { await click(container.querySelector<HTMLInputElement>(`${id ? `[data-question="${id}"] ` : ""}input[type="radio"][value="${value}"]`)); }
  async function ratePage(value: string | number) {
    const ids = [...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question")!);
    for (const id of ids) await rating(value, id);
  }
  async function rateFlow(ids: readonly string[], value: number | ((id: string) => number)) {
    let answered = 0;
    while (answered < ids.length) {
      const pageIds = [...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question")!);
      expect(pageIds).toEqual(ids.slice(answered, answered + Math.min(3, ids.length - answered)));
      for (const id of pageIds) await rating(typeof value === "number" ? value : value(id), id);
      answered += pageIds.length;
      await next();
    }
  }
  async function next() { await button([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "다음 질문") ? "다음 질문" : "결과 보기"); }
  function actionButton() { return container.querySelector<HTMLButtonElement>("[data-question-actions] button"); }
  async function finishFromHere(skip = false) {
    while (container.querySelector("[data-question]")) {
      // 우선순위는 아무것도 고르지 않으면 아래 고정 버튼이 ‘고르지 않고 결과 보기’로 바뀌어 바로 결과로 간다.
      if (skip && container.querySelector('[data-question="priorities"]')) { await button("고르지 않고 결과 보기"); continue; }
      if (container.querySelector('input[type="radio"]')) await ratePage(skip ? "skipped" : 5);
      else if (skip) await button("지금 답하지 않을게요");
      else {
        const choice = container.querySelector<HTMLButtonElement>('[data-choice="G1"]')
          ?? container.querySelector<HTMLButtonElement>('[data-choice="photo"]')
          ?? container.querySelector<HTMLButtonElement>("[data-choice]");
        await click(choice);
      }
      await next();
    }
  }
  async function finishOptional() { await button("원하면 더 알아보기 (선택)"); await finishFromHere(); }
  async function renderClient(props: Partial<Parameters<typeof WeddingCodeV31Client>[0]> = {}) {
    await act(async () => root.render(<WeddingCodeV31Client shareOrigin="https://hanbang.ai" {...props} />));
  }
  function linkValue() {
    return container.querySelector<HTMLInputElement>('input[aria-label="답이 담긴 웨딩코드 공유 링크"]')?.value;
  }
  function decodedLink(value: string) {
    const url = new URL(value);
    return decodeV31(new URLSearchParams(url.hash.slice(1)).get("a"));
  }
  async function consent(index = 0) { await click(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]); }

  it("세 문장의 선택과 즉시 저장을 구분하고 모두 답한 뒤에만 다음 페이지로 간다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["G1", "G3", "R4"]);
    const nextButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === "다음 질문")!;
    // 2026-09-27: 막힌(disabled) 버튼은 키보드 Tab 에서 빠져 이유를 들을 수 없었다. 누를 수 있게 두고 막혔다는 상태만 알린다.
    expect(nextButton.disabled).toBe(false);
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");
    const pick = async (id: string, value: string) => click(container.querySelector<HTMLInputElement>(`[data-question="${id}"] input[value="${value}"]`));
    vi.mocked(window.scrollTo).mockClear();
    await pick("G1", "3");
    let saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.answers).toEqual({ G1: 3 });
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");
    await next();
    expect(container.querySelector('[data-question="B1"]')).toBeNull();
    // 누르면 비어 있는 첫 문장으로 초점을 옮기고, 이 페이지에 실제로 있는 보기 이름으로 이유를 알린다.
    expect(container.querySelector("[data-screen-notice]")?.textContent).toBe("아직 답을 고르지 않은 문장이 있어요. 모르겠거나 이번 계획에 없는 문장은 그 아래 ‘답하기 어려워요’를 열어서 골라 주세요.");
    expect(document.activeElement?.getAttribute("data-question")).toBe("G3");
    await pick("G3", "undecided");
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");
    await pick("R4", "skipped");
    expect(nextButton.getAttribute("aria-disabled")).toBe("false");
    expect(window.scrollTo).not.toHaveBeenCalled();
    saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.answers).toEqual({ G1: 3, G3: "undecided", R4: "skipped" });
    expect(container.querySelector('[data-question="B1"]')).toBeNull();
    await next();
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["B1", "B3", "D1"]);
    // 다 채우고 넘어가면 앞 페이지의 안내를 다음 페이지에 남기지 않는다.
    expect(container.textContent).not.toContain("아직 답을 고르지 않은 문장이 있어요");
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="이전 질문"]'));
    expect(container.querySelector<HTMLInputElement>('[data-question="G1"] input[value="3"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-question="G3"] input[value="undecided"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-question="R4"] input[value="skipped"]')?.checked).toBe(true);
  });

  it.each([false, true])("embedded=%s에서도 같은 질문을 쓰고 화면의 탐색·스크롤만 맞춘다", async (embedded) => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      await renderClient({ embedded });
      expect(container.querySelectorAll("main")).toHaveLength(embedded ? 0 : 1);
      expect(container.querySelectorAll('nav[aria-label="웨딩코드 탐색"]')).toHaveLength(embedded ? 0 : 1);
      expect(container.firstElementChild?.classList.contains("min-h-dvh")).toBe(!embedded);
      await button("내 웨딩코드 시작하기");
      const screen = container.querySelector('[aria-label="웨딩코드 기본 질문 1페이지"]');
      expect(document.activeElement).toBe(screen);
      expect(container.querySelector("progress")?.getAttribute("max")).toBe("14");
      if (embedded) {
        expect(window.scrollTo).not.toHaveBeenCalled();
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "instant" });
        expect(screen?.classList.contains("scroll-mt-20")).toBe(true);
        expect(screen?.classList.contains("md:scroll-mt-28")).toBe(true);
      } else expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
      scrollIntoView.mockClear(); vi.mocked(window.scrollTo).mockClear();
      await ratePage(5);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(window.scrollTo).not.toHaveBeenCalled();
      await next();
      expect(document.activeElement?.getAttribute("aria-label")).toBe("웨딩코드 기본 질문 2페이지");
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("기본 흐름은 23개 뒤에 우선순위를 마지막으로 묻고, 고르지 않아도 결과를 받으며 다른 답을 채우지 않는다", async () => {
    await renderClient();
    expect(container.textContent).toContain("기본 14페이지");
    expect(container.textContent).toContain("문장은 한 페이지에 최대 3개씩, 취향과 그 밖의 질문은 한 페이지에 하나씩 물어봐요");
    expect(container.textContent).toContain("결과에서 8개 문장을 이어서 볼 수 있어요");
    await button("내 웨딩코드 시작하기");
    expect(container.querySelectorAll("[data-answer]")).toHaveLength(15);
    expect(container.querySelector('progress')?.getAttribute("max")).toBe("14");
    while (!container.querySelector('[data-question="priorities"]')) {
      expect(container.querySelector('[data-result="solo-v31"]')).toBeNull();
      if (container.querySelector('input[type="radio"]')) await ratePage(5);
      else await click(container.querySelector<HTMLButtonElement>('[data-choice="photo"]') ?? container.querySelector<HTMLButtonElement>("[data-choice]"));
      await next();
    }
    // 23개를 다 답한 뒤 마지막 페이지에서 우선순위를 묻는다. 보기는 바로 보인다.
    expect(container.querySelector("[data-progress-text]")?.textContent).toBe("14 / 14 페이지");
    const priorities = container.querySelector('[data-question="priorities"]')!;
    expect(priorities.querySelector('[data-choice="G1"]')).not.toBeNull();
    // 2026-09-27: 아무것도 고르지 않았으면 아래 고정 버튼이 넘어가기를 맡는다. 막힌 ‘결과 보기’와 목록 맨 아래
    // 넘어가기 버튼을 겹쳐 두던 것을 하나로 합쳤다.
    expect(actionButton()?.textContent?.trim()).toBe("고르지 않고 결과 보기");
    expect(actionButton()?.disabled).toBe(false);
    expect(actionButton()?.hasAttribute("aria-disabled")).toBe(false);
    expect([...priorities.querySelectorAll("button")].some(item => /고르지 않/.test(item.textContent ?? ""))).toBe(false);
    // 맨 위 안내는 고르지 않아도 된다는 것을 먼저 말한다(하나는 골라야 하는 것처럼 읽히지 않게).
    expect(priorities.textContent).toContain("앞에서 고른 답 가운데 꼭 지키고 싶은 것을 골라 주세요. 고르지 않아도 결과를 볼 수 있어요.");
    expect(priorities.textContent).not.toContain("하나만 골라도 돼요");
    // 이 화면에서 ‘이번 계획에는 없어요’는 넘어가기와 뜻이 겹쳐 두지 않는다.
    expect([...priorities.querySelectorAll("button")].map(item => item.textContent?.trim())).not.toContain("이번 계획에는 없어요");
    await click(priorities.querySelector<HTMLButtonElement>('[data-choice="G1"]'));
    expect(actionButton()?.textContent?.trim()).toBe("결과 보기");
    await click(priorities.querySelector<HTMLButtonElement>('[data-choice="G1"]'));
    expect(actionButton()?.textContent?.trim()).toBe("고르지 않고 결과 보기");
    await click(actionButton());
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    expect(container.textContent).toContain("답을 남긴 질문은 24개예요");
    expect(container.textContent).toContain("동의 정도를 고른 문장은 15개");
    expect(container.textContent).toContain("원하면 더 알아보기 (선택)");
    expect(container.querySelectorAll("[data-insight]").length).toBeGreaterThan(3);
    expect(container.textContent).toContain("어떤 답에서 나온 설명인가요?");
    expect(container.textContent).toContain("준비할 때 이렇게 해 봐요");
    const prioritySummary = [...container.querySelectorAll("h2")].find(item => item.textContent === "이번 결혼식에서 지키고 싶은 것")?.closest("section");
    expect(prioritySummary?.textContent).toContain("우선순위는 이번에 고르지 않았어요.");
    expect(linkValue()).toBeUndefined();
    await consent();
    const shared = decodedLink(linkValue()!);
    expect(shared?.priorities).toEqual({ status: "skipped" });
    for (const id of [...V31_EXTRA_RATING_IDS, "B2", "D2"] as const) expect(shared?.answers[id]).toBeUndefined();
    expect(shared?.spending).toEqual({ status: "answered", values: ["photo"] });
    expect(shared?.avoidances).toEqual({ status: "answered", values: ["heavy_decoration"] });
    expect(container.querySelector("[data-priority-guides]")).toBeNull();
    expect(container.textContent).not.toContain(WEDDING_CODE_V31_QUESTIONS.find(item => item.id === "V1")!.statement);
    for (const taste of WEDDING_CODE_V31_TASTES) expect(shared?.tastes[taste.key]?.status).toBe("answered");
    expect(captureWeddingCodeEvent).toHaveBeenCalledWith("wedding_code_completed", expect.objectContaining({ scene_total: 24, answered_count: 23, skipped_count: 1 }));
    expect(JSON.stringify(vi.mocked(captureWeddingCodeEvent).mock.calls)).not.toContain("V1");
  });

  it("앞에서 고른 것이 없어 우선순위 보기가 0개면 마지막 화면을 건너뛰고 우선순위를 채우지 않는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    while (!container.querySelector('[data-question="spending"]')) {
      if (container.querySelector('input[type="radio"]')) await ratePage(2);
      else await button("아직 모르겠어요");
      await next();
    }
    await button("더 쓰고 싶은 곳은 지금 없어요");
    expect(actionButton()?.textContent?.trim()).toBe("결과 보기");
    await next();
    expect(container.querySelector('[data-question="priorities"]')).toBeNull();
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    expect(container.textContent).toContain("답을 남긴 질문은 23개예요");
    expect([...container.querySelectorAll("h2")].some(item => item.textContent === "이번 결혼식에서 지키고 싶은 것")).toBe(false);
  });

  it("앞의 답을 바꾸면 맞지 않는 우선순위를 지우고 다시 동의해야 새 링크를 만든다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await finishOptional();
    await consent(); const oldUrl = linkValue()!;
    expect(decodedLink(oldUrl)?.answers.G1).toBe(5);
    await button("내 답 수정하기");
    await rating(1); await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-result="solo-v31"]')).toBeNull();
    expect(container.textContent).toContain("지키고 싶은 것을 다시 고르거나");
    // 수정 화면에서도 비어 있으면 아래 고정 버튼이 넘어가기를 맡고, 고르면 ‘수정한 결과 보기’로 바뀐다.
    expect(actionButton()?.textContent?.trim()).toBe("고르지 않고 결과 보기");
    expect([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "수정한 결과 보기")).toBe(false);
    await button("아직 우선순위를 정하지 못했어요"); await button("수정한 결과 보기");
    expect(linkValue()).toBeUndefined();
    await consent();
    const revised = decodedLink(linkValue()!);
    expect(revised?.answers.G1).toBe(1);
    expect(revised?.priorities).toEqual({ status: "undecided" });
    expect(decodedLink(oldUrl)?.priorities).toEqual({ status: "answered", values: ["G1"] });
  });

  it("결과에서 취향의 마지막 선택을 지우면 새 답이나 명시적 상태를 고르기 전에는 수정 완료할 수 없다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await click(container.querySelector<HTMLButtonElement>('[aria-label="장소 취향 수정"]'));
    await click(container.querySelector<HTMLButtonElement>('[data-choice="indoor"]'));
    expect([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "수정한 결과 보기")?.disabled).toBe(true);
    await click(container.querySelector<HTMLButtonElement>('[aria-label="이전 질문"]'));
    expect(container.querySelector('[data-question="H4"]')).not.toBeNull();
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="taste.venue"]')).not.toBeNull();
    expect(container.textContent).toContain("답을 고르지 않은 질문으로 돌아왔어요");
    await button("이번 계획에는 없어요"); await button("수정한 결과 보기"); await consent();
    expect(container.textContent).not.toContain("답을 고르지 않은 질문으로 돌아왔어요");
    expect(decodedLink(linkValue()!)?.tastes.venue).toEqual({ status: "not_applicable" });
  });

  it("우선순위로 고른 취향이 다른 보기로 바뀌면 새로운 취향을 우선순위로 자동 승계하지 않는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await finishOptional();
    await button("우선순위 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="G1"]'));
    await click(container.querySelector<HTMLButtonElement>('[data-choice="taste.venue"]'));
    await button("수정한 결과 보기"); await consent();
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "answered", values: ["taste.venue"] });
    await click(container.querySelector<HTMLButtonElement>('[aria-label="장소 취향 수정"]'));
    await click(container.querySelector<HTMLButtonElement>('[data-choice="outdoor"]'));
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-choice="taste.venue"]')?.getAttribute("aria-pressed")).toBe("false");
    await button("맞는 보기가 없어요"); await button("수정한 결과 보기"); await consent();
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "no_match" });
    expect(decodedLink(linkValue()!)?.tastes.venue).toEqual({ status: "answered", values: ["outdoor"] });
    await button("더 쓰고 싶은 곳 수정"); await button("맞는 보기가 없어요"); await button("수정한 결과 보기"); await consent();
    expect(decodedLink(linkValue()!)?.spending).toEqual({ status: "no_match" });
  });

  it("재시작 콜백이 같은 컴포넌트를 유지해도 두 번째 응답에는 이전 답을 남기지 않는다", async () => {
    const onRestart = vi.fn();
    await renderClient({ onRestart }); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await button("처음부터 다시 답하기");
    expect(onRestart).toHaveBeenCalledOnce();
    await button("내 웨딩코드 시작하기");
    expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
    await finishFromHere(true);
    expect(container.querySelector('[data-result="solo-v31"]')?.getAttribute("data-empty")).toBe("true");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(linkValue()).toBeUndefined();
    expect(captureWeddingCodeEvent).toHaveBeenLastCalledWith("wedding_code_completed", expect.objectContaining({ answered_count: 0, skipped_count: 23 }));
  });

  it("중간·미정·비해당·건너뜀을 구분하고 이전 질문에서 고른 상태를 복원한다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    await rating(3, "G1"); await rating("undecided", "G3");
    await rating("not_applicable", "R4"); await next(); await ratePage("skipped"); await next();
    await click(container.querySelector<HTMLButtonElement>('[aria-label="이전 질문"]'));
    expect(container.querySelector('input[value="skipped"]:checked')).not.toBeNull();
    await next(); await finishFromHere(true); await consent();
    expect(decodedLink(linkValue()!)?.answers).toMatchObject({ G1: 3, G3: "undecided", R4: "not_applicable", B1: "skipped" });
  });

  it("가족 주제 전체를 비해당으로 표시하면 가족 답만 바꾸고 명시적으로 다음 페이지로 이동한다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    while (container.querySelector("[data-question]")?.getAttribute("data-question") !== "F1") { await ratePage(4); await next(); }
    await rating(5, "F1");
    expect(container.textContent).toContain("이미 고른 답은 지워지고");
    await button("이 주제는 계획에 없어요");
    expect(container.querySelector('[data-question="F1"]')).not.toBeNull();
    for (const id of ["F1", "F2", "F4"]) expect(container.querySelector<HTMLInputElement>(`[data-question="${id}"] input[value="not_applicable"]`)?.checked).toBe(true);
    await next();
    expect(container.querySelector('[data-question="H1"]')).not.toBeNull();
    await finishFromHere(); await consent();
    const saved = decodedLink(linkValue()!);
    for (const id of ["F1", "F2", "F4"] as const) expect(saved?.answers[id]).toBe("not_applicable");
    expect(saved?.answers.F3).toBeUndefined();
    expect(saved?.answers.T3).toBe(4);
    expect(saved?.answers.H1).toBe(5);
  });

  it("서로 다른 주제를 묶은 선택 페이지에서 계획 없음은 해당 주제만 바꾸고 기존 기본 답을 보존한다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await button("원하면 더 알아보기 (선택)");
    const scopeButton = (id: string) => [...container.querySelectorAll<HTMLButtonElement>(`[data-question="${id}"] button`)].find(item => item.textContent?.trim() === "이 주제는 계획에 없어요");
    await click(scopeButton("V1"));
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["V1", "G2", "R3"]);
    let saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.answers.V1).toBe("not_applicable");
    expect(saved.status === "ready" && saved.snapshot.draft.answers.G2).toBeUndefined();
    expect(saved.status === "ready" && saved.snapshot.draft.answers.R3).toBeUndefined();
    await rating(4, "G2");
    await click(scopeButton("R3"));
    saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.answers.R3).toBe("not_applicable");
    expect(saved.status === "ready" && saved.snapshot.draft.answers.R4).toBe(5);
    expect(saved.status === "ready" && saved.snapshot.draft.answers.G2).toBe(4);
    await next();
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["B4", "D3", "T4"]);
  });

  it("상대 링크에서 모두 건너뛰어도 공통 취향을 만들거나 커플 공유를 열지 않는다", async () => {
    const partner: V31Draft = { ...createV31Draft(), answers: { V1: 5 } };
    await renderClient({ partnerDraft: partner }); await button("나도 답해보기"); await finishFromHere(true);
    expect(container.querySelector('[data-result="couple-v31"]')).not.toBeNull();
    expect(container.textContent).toContain("이번에 고른 질문에서는 둘 다 같은 쪽으로 답한 내용이 없었어요");
    expect(container.textContent).toContain("두 사람 모두 직접 고른 답이 하나라도 있어야 결과 링크");
    expect(container.textContent).toContain("두 사람이 같은 항목에 답한 내용이 없어 아직 차이를 비교할 수 없어요");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(linkValue()).toBeUndefined();
  });

  it("받은 두 사람 결과를 내 것으로 편집하거나 동의 없이 다시 공유하지 않는다", async () => {
    const first = { ...createV31Draft(), answers: { V1: 4 as const } };
    const second = { ...createV31Draft(), answers: { V1: 5 as const } };
    await renderClient({ bothDrafts: { first, second } });
    expect(container.textContent).toContain("받은 링크에 담긴 답이에요");
    expect(container.textContent).not.toContain("내가 방금 답한 내용 수정");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(linkValue()).toBeUndefined();
    await button("나도 처음부터 답해 보기"); await button("내 웨딩코드 시작하기");
    expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
  });

  it("일반 초대는 답 없는 주소이며 답 포함 링크는 동의 철회 즉시 숨기고 복사 실패 시 직접 복사할 수 있다", async () => {
    const first = { ...createV31Draft(), answers: { V1: 5 as const } };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await act(async () => root.render(<WeddingCodeV31Sharing first={first} shareOrigin="https://hanbang.ai" />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="웨딩코드 일반 시작 링크"]')?.value).toBe("https://hanbang.ai/wedding-code");
    expect(linkValue()).toBeUndefined(); await consent(); expect(linkValue()).toContain("#");
    await button("비교 초대 링크 복사");
    expect(container.textContent).toContain("자동 복사가 안 됐어요");
    expect(container.querySelector('[aria-label="답이 담긴 웨딩코드 공유 링크"]')?.closest("details")?.open).toBe(true);
    expect(captureWeddingCodeEvent).not.toHaveBeenCalledWith("wedding_code_share_copied", expect.anything());
    await consent(); expect(linkValue()).toBeUndefined();
  });

  it("두 사람 링크는 내 답 공개와 첫 응답자 동의를 각각 확인한 뒤에만 만든다", async () => {
    const first = { ...createV31Draft(), answers: { V1: 5 as const } };
    const second = { ...createV31Draft(), answers: { V1: 1 as const } };
    await act(async () => root.render(<WeddingCodeV31Sharing first={first} second={second} shareOrigin="https://hanbang.ai" />));
    await consent(); expect(linkValue()).toBeUndefined();
    await consent(1); expect(new URLSearchParams(new URL(linkValue()!).hash.slice(1)).has("b")).toBe(true);
    await consent(1); expect(linkValue()).toBeUndefined();
  });

  it("옷과 식순과 피하고 싶은 것은 모두 고를 수 있고 우선순위는 하나만 골라도 완료된다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    expect(container.textContent).toContain("아직 모르겠거나 이번 계획에 없는 내용이면 문장 아래 ‘답하기 어려워요’를 눌러 골라 주세요");
    await rateFlow(V31_CORE_RATING_IDS, 3);
    for (const taste of WEDDING_CODE_V31_TASTES) {
      if (taste.key === "attire" || taste.key === "ceremony") {
        expect(container.textContent).toContain("해당하는 것을 골라 주세요. 여러 개 골라도 되고");
        for (const option of taste.options) {
          const choice = container.querySelector<HTMLButtonElement>(`[data-choice="${option.value}"]`);
          expect(choice?.disabled).toBe(false);
          expect(choice?.querySelector("svg")).not.toBeNull();
          await click(choice);
        }
        expect(container.querySelectorAll('[data-choice][aria-pressed="true"]')).toHaveLength(taste.options.length);
      } else await click(container.querySelector<HTMLButtonElement>("[data-choice]"));
      await next();
    }
    expect(container.querySelector('[data-question="avoidances"]')).not.toBeNull();
    for (const option of WEDDING_CODE_V31_AVOIDANCES) await click(container.querySelector<HTMLButtonElement>(`[data-choice="${option.value}"]`));
    expect(container.querySelectorAll('[data-choice][aria-pressed="true"]')).toHaveLength(5);
    await next();
    await button("더 쓰고 싶은 곳은 지금 없어요"); await next();
    // 기본 흐름의 마지막 화면에서 우선순위를 고르고, 선택 질문에서는 다시 묻지 않는다.
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.textContent).toContain("고르지 않아도 결과를 볼 수 있어요");
    expect(container.querySelector('[data-choice="R1"]')).toBeNull();
    expect(container.querySelector('[data-choice="R2"]')).toBeNull();
    expect(container.querySelectorAll('[data-choice="taste.photo"]')).toHaveLength(1);
    await click(container.querySelector<HTMLButtonElement>('[data-choice="taste.photo"]'));
    await next();
    await button("원하면 더 알아보기 (선택)");
    await rateFlow(V31_EXTRA_RATING_IDS, 3);
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    await consent();
    const shared = decodedLink(linkValue()!);
    expect(shared?.tastes.attire).toMatchObject({ status: "answered", values: ["simple", "flowing", "decorative", "traditional"] });
    expect(shared?.tastes.ceremony?.status).toBe("answered");
    if (shared?.tastes.ceremony?.status === "answered") expect(shared.tastes.ceremony.values).toHaveLength(6);
    expect(shared?.avoidances?.status).toBe("answered");
    if (shared?.avoidances?.status === "answered") expect(shared.avoidances.values).toHaveLength(5);
    expect(shared?.priorities).toEqual({ status: "answered", values: ["taste.photo"] });
  });

  it("피하고 싶은 기준을 바꾸면 사라진 우선순위만 빼고 남은 기준도 다시 확인받는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await finishOptional();
    await button("우선순위 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="avoid.heavy_decoration"]'));
    await button("수정한 결과 보기"); await consent();
    const oldUrl = linkValue()!;
    expect(decodedLink(oldUrl)?.priorities).toEqual({ status: "answered", values: ["G1", "avoid.heavy_decoration"] });
    await button("피하고 싶은 것 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="heavy_decoration"]'));
    await click(container.querySelector<HTMLButtonElement>('[data-choice="loud_music"]'));
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-choice="G1"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-choice="avoid.heavy_decoration"]')).toBeNull();
    expect(container.querySelector('[data-choice="avoid.loud_music"]')?.getAttribute("aria-pressed")).toBe("false");
    await button("수정한 결과 보기");
    expect(linkValue()).toBeUndefined();
    expect(container.textContent).not.toContain("이전 우선순위를 다시 확인해야 해요");
    await consent();
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "answered", values: ["G1"] });
    expect(decodedLink(linkValue()!)?.avoidances).toEqual({ status: "answered", values: ["loud_music"] });
    expect(decodedLink(oldUrl)?.avoidances).toEqual({ status: "answered", values: ["heavy_decoration"] });
  });

  it("특정 긍정 조합이 없는 사람도 직접 고른 우선순위에서 준비 행동을 얻는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    await rateFlow(V31_CORE_RATING_IDS, id => id === "B1" ? 5 : 2);
    for (const taste of WEDDING_CODE_V31_TASTES) { await click(container.querySelector<HTMLButtonElement>(`[data-choice="${taste.options[0].value}"]`)); await next(); }
    await button("따로 피하고 싶은 것은 없어요"); await next();
    await button("더 쓰고 싶은 곳은 지금 없어요"); await next();
    await click(container.querySelector<HTMLButtonElement>('[data-choice="B1"]')); await next();
    const guide = container.querySelector("[data-priority-guides] [data-insight]");
    expect(guide).not.toBeNull();
    expect(guide?.textContent).toContain("준비할 때 이렇게 해 봐요");
    expect(guide?.textContent).toContain("결혼식 전체 예산을 정해 두면, 마음에 드는 것이 예산을 조금 넘어도 그 안에서 준비하고 싶다.");
    expect(container.textContent).not.toContain("상태를 남겼어요");
    expect(container.textContent).not.toContain("비용 더 나누기");
  });

  it("커플의 열린 취향과 같은 회피를 구분하고 지출 희망 없음은 비교할 수 있는 답으로 보여준다", async () => {
    const first: V31Draft = {
      ...createV31Draft(), tastes: { venue: { status: "no_preference" } },
      avoidances: { status: "answered", values: ["loud_music"] }, spending: { status: "answered", values: ["photo"] },
    };
    const second: V31Draft = {
      ...createV31Draft(), tastes: { venue: { status: "answered", values: ["indoor"] } },
      avoidances: { status: "answered", values: ["loud_music"] }, spending: { status: "no_preference" },
    };
    await renderClient({ bothDrafts: { first, second } });
    const sectionTitle = (id: string) => container.querySelector(`[data-comparison="${id}"]`)?.closest("section")?.querySelector("h2")?.textContent;
    // 2026-09-27: 한쪽만 '더 쓰고 싶은 곳은 지금 없어요'면 취향의 '어느 쪽도 괜찮아요'와 같게 열린 답이다.
    // 예전에는 지출만 '먼저 이야기해 볼 차이'에 섰다. 섹션 이름도 취향에 한정하지 않는다.
    expect(sectionTitle("taste.venue")).toBe("열어 두고 있는 답");
    expect(sectionTitle("avoidances")).toBe("함께 피하고 싶은 것");
    expect(sectionTitle("spending")).toBe("열어 두고 있는 답");
    expect(container.querySelector('[data-pair-section="difference"] [data-comparison="spending"]')).toBeNull();
    expect(container.querySelector('[data-comparison="spending"]')?.textContent).toContain("더 쓰고 싶은 곳은 지금 없어요");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("여러 보기를 고른 커플은 다른 선택뿐 아니라 함께 고른 보기도 확인한다", async () => {
    const first: V31Draft = { ...createV31Draft(), tastes: { attire: { status: "answered", values: ["simple", "flowing"] } } };
    const second: V31Draft = { ...createV31Draft(), tastes: { attire: { status: "answered", values: ["flowing", "traditional"] } } };
    await renderClient({ bothDrafts: { first, second } });
    expect(container.textContent).not.toContain("이번에 고른 질문에서는 둘 다 같은 쪽으로 답한 내용이 없었어요");
    expect(container.textContent).toContain("일부 보기는 함께 골랐어요");
    const comparison = container.querySelector('[data-comparison="taste.attire"]');
    expect(comparison?.textContent).toContain("함께 고른 보기: 부드럽게 흐르는 옷");
    expect(comparison?.textContent).toContain("장식이 적고 선이 단순한 옷");
    expect(comparison?.textContent).toContain("한복 같은 전통 혼례복");
  });

  it("우선순위는 보기를 바로 보여주되 고르지 않고 넘어갈 수 있고 더 쓸 곳 없음과 메모 선택이 먼저 명확하게 보인다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    while (!container.querySelector('[data-question="spending"]')) {
      if (container.querySelector('input[type="radio"]')) await ratePage(4);
      else await click(container.querySelector<HTMLButtonElement>("[data-choice]"));
      await next();
    }
    const spending = container.querySelector('[data-question="spending"]');
    expect(spending).not.toBeNull();
    const optionLabels = [...spending!.querySelectorAll("button")].map(item => item.textContent?.trim());
    expect(optionLabels.slice(0, 2)).toEqual(["더 쓰고 싶은 곳은 지금 없어요", "아직 모르겠어요"]);
    expect(optionLabels.filter(label => label === "더 쓰고 싶은 곳은 지금 없어요")).toHaveLength(1);
    expect(optionLabels.filter(label => label === "아직 모르겠어요")).toHaveLength(1);
    await button("더 쓰고 싶은 곳은 지금 없어요"); await next();
    const priorities = container.querySelector('[data-question="priorities"]');
    expect(priorities?.querySelector("[data-choice]")).not.toBeNull();
    const priorityLabels = [...priorities!.querySelectorAll("button")].map(item => item.textContent?.trim());
    expect(priorityLabels).not.toContain("우선순위도 골라볼게요 (선택)");
    // 넘어가기와 같은 뜻의 보기를 두 번 두지 않는다. 넘어가기는 아래 고정 버튼 하나다.
    expect(priorityLabels).not.toContain("지금 답하지 않을게요");
    expect(priorityLabels.some(label => /고르지 않/.test(label ?? ""))).toBe(false);
    expect(actionButton()?.textContent?.trim()).toBe("고르지 않고 결과 보기");
    await button("고르지 않고 결과 보기");
    const note = container.querySelector<HTMLDetailsElement>("[data-optional-personal-note]");
    expect(note?.open).toBe(false);
    expect(note?.querySelector("summary")?.textContent).toBe("내 메모 남기기 (선택)");
    expect(note?.textContent).toContain("자동 저장이나 공유 링크에는 포함되지 않아요");
    expect(container.querySelector("[data-priority-guides]")).toBeNull();
    const prioritySummary = [...container.querySelectorAll("h2")].find(item => item.textContent === "이번 결혼식에서 지키고 싶은 것")?.closest("section");
    expect(prioritySummary?.textContent).toContain("우선순위는 이번에 고르지 않았어요.");
    expect(prioritySummary?.textContent).not.toContain("지금 답하지 않을게요");
    expect(prioritySummary?.querySelector("ul")).toBeNull();
    // 결과에서 나중에 고를 수 있다는 안내가 사실인지 본다.
    await button("우선순위 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="G1"]'));
    await button("수정한 결과 보기");
    await consent();
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "answered", values: ["G1"] });
    expect(decodedLink(linkValue()!)?.spending).toEqual({ status: "no_preference" });
  });

  it("추가 질문은 첫 질문에서도 끝낼 수 있고 본 질문만 결과에 더하며 숨긴 두 문항은 묻지 않는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await button("원하면 더 알아보기 (선택)");
    expect(container.querySelector('[data-question="V1"]')).not.toBeNull();
    expect(container.querySelector('progress')?.getAttribute("max")).toBe("3");
    // 진행 표기는 페이지 하나로 모으고, 선택 흐름인지는 숫자 없는 머리말로만 알린다.
    expect(container.querySelector("[data-progress-text]")?.textContent).toBe("1 / 3 페이지");
    expect(container.textContent).toContain("선택 질문");
    expect(container.textContent).not.toMatch(/선택 질문 \d/);
    await button("여기까지만 답하고 결과 보기"); await consent();
    expect(decodedLink(linkValue()!)?.answers.V1).toBeUndefined();
    // 기본 흐름 끝에서 고른 우선순위가 그대로 남고, 선택 흐름은 이를 다시 묻지 않는다.
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "answered", values: ["G1"] });
    await button("원하면 더 알아보기 (선택)");
    await rating(5, "V1");
    expect(container.querySelector('[data-question="G2"]')).not.toBeNull();
    await button("여기까지만 답하고 결과 보기");
    expect(container.textContent).toContain("답을 남긴 질문은 25개예요");
    await consent();
    expect(decodedLink(linkValue()!)?.answers).toMatchObject({ V1: 5 });
    expect(decodedLink(linkValue()!)?.answers.G2).toBeUndefined();
    expect(decodedLink(linkValue()!)?.answers.B2).toBeUndefined();
    expect(decodedLink(linkValue()!)?.answers.D2).toBeUndefined();
    const statement = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === "V1")!.statement;
    await click(container.querySelector<HTMLButtonElement>(`[aria-label="${statement} 답 수정"]`));
    await rating(2); await button("수정한 결과 보기"); await consent();
    expect(decodedLink(linkValue()!)?.answers.V1).toBe(2);
    expect(decodedLink(linkValue()!)?.answers.G2).toBeUndefined();
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
  });

  it("시작 버튼 바로 위, 접힌 안내 밖에서 다루는 범위를 보여주고 판정이 아니라는 말은 소개 첫 문단에서 한 번만 한다", async () => {
    await renderClient();
    const scope = container.querySelector<HTMLElement>("[data-intro-scope]");
    expect(scope?.closest("details")).toBeNull();
    expect(scope?.textContent).toContain("결혼식 모습과 둘이 준비하는 방식만 물어봐요");
    for (const word of ["신혼집", "예단", "예물", "양쪽 집안이 비용을 어떻게 나눌지는 묻지 않아요"]) expect(scope?.textContent).toContain(word);
    expect(scope?.nextElementSibling?.textContent?.trim()).toBe("내 웨딩코드 시작하기");
    // 판정이 아니라는 말은 제목 바로 아래 첫 문단에 있고(접힌 안내 밖), 범위 줄에는 두지 않는다.
    const lede = container.querySelector<HTMLElement>("h1 + p");
    expect(lede?.textContent).toContain("성격을 진단하는 검사가 아니고, 아직 여러 사람에게 확인해 보지 못한 질문이에요.");
    expect(lede?.closest("details")).toBeNull();
    expect(scope?.textContent).not.toContain("성격을 진단하는 검사");
    // 판정이 아니라는 말은 이 화면에서 한 번만 한다.
    expect(container.textContent?.match(/검사가 아니/g)).toHaveLength(1);
    expect(container.textContent?.match(/확인해 보지 못한/g)).toHaveLength(1);
    expect(container.textContent?.match(/성격|MBTI/g)).toHaveLength(1);
    const details = [...container.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent === "무엇을 물어보나요?");
    // 묻지 않는 것의 목록은 시작 버튼 위 범위 줄에 한 번만 둔다. 접힌 답은 실제 예산 금액을 묻지 않는다는 말만 한다.
    expect(details?.textContent).toContain("실제 예산 금액은 묻지 않아요.");
    expect(details?.textContent).not.toMatch(/신혼집|예단|예물|양쪽 집안/);
    expect(container.textContent?.match(/신혼집/g)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/양가|상견례|예식장/);
    // 2026-09-27 파운더 결정: 네 글자 요약에 ‘~스타일’ 이름을 두지 않으므로 시작 화면 소개도 같은 틀을 쓰지 않는다.
    expect([...container.querySelectorAll("h2")].map(item => item.textContent)).toContain("네 글자로 보는 준비 방식");
    expect(container.textContent).not.toContain("스타일");
  });

  it("세 상태 보기는 문장 아래 ‘답하기 어려워요’ 안에 접어 두고, 고른 문장은 펼친 채로 둔다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    const folds = [...container.querySelectorAll<HTMLDetailsElement>("[data-question] details[data-escape-options]")];
    expect(folds).toHaveLength(3);
    for (const fold of folds) {
      expect(fold.open).toBe(false);
      expect(fold.querySelector("summary")?.textContent).toBe("답하기 어려워요");
      expect([...fold.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(item => item.value)).toEqual(["undecided", "not_applicable", "skipped"]);
    }
    const fold = (id: string) => container.querySelector<HTMLDetailsElement>(`[data-question="${id}"] details[data-escape-options]`);
    const g3 = container.querySelector('[data-question="G3"]')!;
    const radios = () => [...g3.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    // 펼치지 않아도 보이는 칸은 다섯 단계뿐이다.
    expect(radios().filter(item => !item.closest("details"))).toHaveLength(5);
    // 2026-09-27: 접힌 세 보기는 다섯 칸과 다른 라디오 묶음이다. 같은 묶음이면 ‘답하기 어려워요’를 펼친 뒤 Tab 이
    // 세 보기를 건너뛰었다(Tab 은 묶음에서 고른 칸 하나에만 선다).
    const outside = new Set(radios().filter(item => !item.closest("details")).map(item => item.name));
    const inside = new Set(radios().filter(item => item.closest("details")).map(item => item.name));
    expect(outside.size).toBe(1);
    expect(inside.size).toBe(1);
    expect([...outside][0]).not.toBe([...inside][0]);
    await rating("undecided", "G3");
    expect(fold("G3")?.open).toBe(true);
    expect(fold("G1")?.open).toBe(false);
    await rating(4, "G3");
    expect(fold("G3")?.open).toBe(false);
    // 묶음이 달라도 답은 하나만 켜진다(고른 답을 value 로 제어한다).
    expect(g3.querySelector<HTMLInputElement>('input[value="undecided"]')?.checked).toBe(false);
    expect(radios().filter(item => item.checked).map(item => item.value)).toEqual(["4"]);
    await rating("skipped", "G3");
    expect(radios().filter(item => item.checked).map(item => item.value)).toEqual(["skipped"]);
    // 고른 채로 접어도 요약 줄이 고른 답을 알려 답이 사라진 것처럼 보이지 않는다.
    await act(async () => { fold("G3")!.open = false; });
    await rating(5, "G1");
    expect(fold("G3")?.open).toBe(false);
    expect(fold("G3")?.querySelector("summary")?.textContent).toBe("답하기 어려워요: 지금 답하지 않을게요");
    expect(fold("G1")?.querySelector("summary")?.textContent).toBe("답하기 어려워요");
    await rating(4, "G3");
    await rating(5, "G1"); await rating(5, "G3"); await rating("skipped", "R4");
    await next();
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="이전 질문"]'));
    // 돌아와도 상태 보기를 고른 문장만 펼쳐서 보여준다.
    expect(fold("R4")?.open).toBe(true);
    expect(fold("G1")?.open).toBe(false);
  });

  it("가운데 답 안내는 첫 페이지에만 한 번 보여주고 진행 표기는 페이지 하나로 모은다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    expect(container.querySelectorAll("[data-rating-guide]")).toHaveLength(1);
    expect(container.querySelector("[data-rating-guide]")?.textContent).toContain("‘답하기 어려워요’를 눌러");
    expect(container.querySelector("[data-progress-text]")?.textContent).toBe("1 / 14 페이지");
    expect(container.textContent).not.toMatch(/기본 질문 \d/);
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
    await ratePage(5); await next();
    expect(container.querySelector('[data-question="B1"]')).not.toBeNull();
    expect(container.querySelector("[data-rating-guide]")).toBeNull();
    expect(container.textContent).not.toContain("어느 쪽에도 가깝지 않을 때");
    expect(container.querySelector("[data-progress-text]")?.textContent).toBe("2 / 14 페이지");
    expect(container.textContent).not.toMatch(/기본 질문 \d/);
  });

  it("다음 질문 버튼은 입력 밖에서 화면 아래에 붙고, 앱 안에서는 하단 탭 위에 둔다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    const actions = container.querySelector<HTMLElement>("[data-question-actions]");
    expect(actions?.className.split(/\s+/)).toEqual(expect.arrayContaining([
      "sticky", "bottom-0", "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      "max-md:[.amora-workspace_&]:bottom-[calc(75px+env(safe-area-inset-bottom))]",
    ]));
    expect(actions?.querySelectorAll("button")).toHaveLength(1);
    expect(actionButton()?.textContent?.trim()).toBe("다음 질문");
    expect(actions?.closest("[data-question]")).toBeNull();
    expect(actions?.querySelector("input, details")).toBeNull();
    await finishFromHere();
    await button("내 답 수정하기");
    // 수정 화면의 완료 버튼도 같은 자리에 붙는다.
    expect(actionButton()?.textContent?.trim()).toBe("수정한 결과 보기");
    expect(container.querySelector("[data-question-actions]")?.className.split(/\s+/)).toContain("sticky");
  });

  it.each([false, true])("함께 보기 초대로 답하는지(%s)는 상대 링크 여부에 싣고, 결과 종류는 화면에 보이는 결과대로 싣는다", async pairInvite => {
    await renderClient({ pairInvite, embedded: pairInvite });
    await button("내 웨딩코드 시작하기");
    await finishFromHere();
    // 초대받은 사람도 상대 답은 동의 전까지 받지 않는다.
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    const calls = vi.mocked(captureWeddingCodeEvent).mock.calls;
    for (const event of ["wedding_code_intro_viewed", "wedding_code_started", "wedding_code_scene_reached"] as const) {
      expect(calls.filter(([name]) => name === event).length, event).toBeGreaterThan(0);
      for (const [, properties] of calls.filter(([name]) => name === event)) expect(properties?.has_partner_link, event).toBe(pairInvite);
    }
    // 처리방침은 result_kind 를 ‘혼자 결과인지 두 사람 비교인지’로 고지한다. 비교 화면을 보지 않았으면 solo 다.
    const completed = calls.filter(([name]) => name === "wedding_code_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0][1]).toMatchObject({ result_kind: "solo", placement: "core", scene_total: 24 });
    expect(calls.filter(([name]) => name === "wedding_code_comparison_viewed")).toHaveLength(0);
    // 보내기 직전 정제기가 두 값을 버리지 않는다. 새 이벤트나 새 속성도 만들지 않는다.
    for (const [event, properties = {}] of calls) {
      const safe = sanitizeWeddingCodeFunnelCapture({ event, properties }, Date.parse("2026-09-27T00:00:00+09:00"));
      expect(safe, event).not.toBeNull();
      expect(safe?.properties).toEqual(properties);
    }
  });

  it("상대 답이 담긴 링크로 답해 두 사람 비교를 본 사람만 결과 종류가 couple 이다", async () => {
    const partner: V31Draft = { ...createV31Draft(), answers: { G1: 5, B1: 4 } };
    await renderClient({ partnerDraft: partner });
    await button("나도 답해보기");
    await finishFromHere();
    expect(container.querySelector('[data-result="couple-v31"]')).not.toBeNull();
    const calls = vi.mocked(captureWeddingCodeEvent).mock.calls;
    expect(calls.filter(([name]) => name === "wedding_code_comparison_viewed")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "wedding_code_completed").map(([, properties]) => properties?.result_kind)).toEqual(["couple"]);
    for (const [, properties] of calls.filter(([name]) => name === "wedding_code_started")) expect(properties?.has_partner_link).toBe(true);
  });

  it("우선순위 입력은 보기를 바로 보여주고, 넘어가기 버튼을 목록 안에 따로 두지 않는다", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<V31PriorityInput value={{ status: "answered", values: ["B1"] }} options={[{ value: "B1", label: "전체 예산 지키기" }]} onChange={onChange} />));
    const choice = container.querySelector<HTMLButtonElement>('[data-choice="B1"]');
    expect(choice?.getAttribute("aria-pressed")).toBe("true");
    const labels = [...container.querySelectorAll("button")].map(item => item.textContent?.trim());
    expect(labels).not.toContain("우선순위도 골라볼게요 (선택)");
    expect(labels).not.toContain("지금 답하지 않을게요");
    // 넘어가기는 화면 아래 고정 버튼이 맡는다. 뜻이 겹치는 ‘이번 계획에는 없어요’도 두지 않는다.
    expect(labels.some(label => /고르지 않/.test(label ?? ""))).toBe(false);
    expect(labels).not.toContain("이번 계획에는 없어요");
    expect([...container.querySelectorAll("button")].some(item => item.className.includes("bg-[var(--hb-action)]"))).toBe(false);
    expect(container.textContent).not.toContain("이 버튼을 누르면");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["undecided", "아직 우선순위를 정하지 못했어요"],
    ["no_preference", "꼭 지키고 싶은 건 따로 없어요"],
    ["not_applicable", "이번 계획에는 없어요"],
  ] as const)("기존 %s 답은 다른 조작 없이 눌린 채로 보인다", async (status, label) => {
    const onChange = vi.fn();
    await act(async () => root.render(<V31PriorityInput value={{ status }} options={[{ value: "B1", label: "전체 예산 지키기" }]} onChange={onChange} />));
    // 이 화면에서 빼 둔 ‘이번 계획에는 없어요’도 전에 그렇게 답한 사람에게는 눌린 채로 보여준다.
    expect([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-choice="B1"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).not.toContain("넘어간 상태예요");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("기존 skipped 답은 넘어갔다는 사실만 알리고 다른 보기를 누른 것으로 바꾸지 않는다", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<V31PriorityInput value={{ status: "skipped" }} options={[{ value: "B1", label: "전체 예산 지키기" }]} onChange={onChange} />));
    expect(container.textContent).toContain("이 질문은 고르지 않고 넘어간 상태예요");
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("앞의 답이 바뀌어 고를 우선순위가 하나도 남지 않으면 빈 우선순위 화면으로 보내지 않고 결과로 간다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    // G1 만 ‘매우 그래요’, 나머지 문장은 낮게, 취향과 피하고 싶은 것은 ‘아직 모르겠어요’.
    while (!container.querySelector('[data-question="spending"]')) {
      if (container.querySelector('input[type="radio"]')) {
        for (const id of [...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question")!)) await rating(id === "G1" ? 5 : 2, id);
      } else await button("아직 모르겠어요");
      await next();
    }
    await button("더 쓰고 싶은 곳은 지금 없어요"); await next();
    expect([...container.querySelectorAll("[data-choice]")].map(item => item.getAttribute("data-choice"))).toEqual(["G1"]);
    await click(container.querySelector<HTMLButtonElement>('[data-choice="G1"]')); await next();
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    await button("내 답 수정하기");
    expect(container.querySelector('[data-question="G1"]')).not.toBeNull();
    await rating(1); await button("수정한 결과 보기");
    // 보기가 0개인 우선순위 화면(「하나만 골라도 돼요」와 「아직 없어요」가 함께 나오던 화면)으로 보내지 않는다.
    expect(container.querySelector('[data-question="priorities"]')).toBeNull();
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    // 결과에는 우선순위를 다시 고를 칸이 없으니 다시 확인하라고 하지 않고, 한 일만 알린다.
    expect(container.textContent).not.toContain("우선순위를 다시 확인");
    expect(container.querySelector("[data-screen-notice]")?.textContent).toBe("앞의 답이 바뀌어 전에 고른 우선순위를 뺐어요.");
    expect(container.querySelector("[data-priority-entry]")).toBeNull();
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status).toBe("ready");
    if (saved.status !== "ready") return;
    expect(saved.snapshot.needsPriorityReview).toBe(false);
    expect(saved.snapshot.draft.priorities).toBeUndefined();
    expect(saved.snapshot.screen).toBe("result");
  });

  it("시작 화면은 마지막 우선순위 질문이 나오는 조건을 사실대로 적는다", async () => {
    await renderClient();
    const intro = container.querySelector("[data-intro-priority]")?.textContent ?? "";
    expect(intro).toContain("마지막 ‘꼭 지키고 싶은 것’ 페이지에는 ‘그런 편이에요’나 ‘매우 그래요’로 답한 문장, 직접 고른 취향, 피하고 싶은 것이 보기로 나와요.");
    expect(intro).not.toContain("앞에서 고른 답 가운데");
  });

  it("보기를 고르는 페이지에서 비어 있을 때 누르면, 그 페이지에 없는 ‘답하기 어려워요’를 가리키지 않는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    await rateFlow(V31_CORE_RATING_IDS, 4);
    expect(container.querySelector('[data-question="taste.venue"]')).not.toBeNull();
    expect(actionButton()?.getAttribute("aria-disabled")).toBe("true");
    await click(actionButton());
    expect(container.querySelector('[data-question="taste.venue"]')).not.toBeNull();
    const status = container.querySelector("[data-screen-notice]")?.textContent ?? "";
    expect(status).toBe("보기에서 골라 주세요. ‘아직 모르겠어요’, ‘맞는 보기가 없어요’, ‘이번 계획에는 없어요’ 같은 칸을 골라도 돼요.");
    expect(status).not.toContain("답하기 어려워요");
    for (const label of status.match(/‘[^’]+’/g) ?? []) {
      expect([...container.querySelectorAll('[data-question="taste.venue"] button')].map(item => `‘${item.textContent?.trim()}’`)).toContain(label);
    }
    await click(container.querySelector<HTMLButtonElement>('[data-choice="indoor"]'));
    await click(actionButton());
    expect(container.querySelector('[data-question="taste.photo"]')).not.toBeNull();
    expect(container.querySelector("[data-screen-notice]")).toBeNull();
  });
});
