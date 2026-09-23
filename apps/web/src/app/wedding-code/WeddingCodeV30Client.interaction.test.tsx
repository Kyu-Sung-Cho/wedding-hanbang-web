// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_TASTES, type V30Draft } from "@/constants/weddingCodeV30";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV30Draft, decodeV30 } from "@/lib/weddingCode/v30";
import WeddingCodeV30Client from "./WeddingCodeV30Client";
import WeddingCodeV30Sharing from "./WeddingCodeV30Sharing";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("WeddingCodeV30Client", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks(); window.history.replaceState(null, "", "/wedding-code");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });

  async function click(element: HTMLElement | null | undefined) {
    expect(element).toBeTruthy(); await act(async () => element!.click());
  }
  async function button(label: string) {
    await click([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label));
  }
  async function rating(value: string | number) { await click(container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)); }
  async function next() { await button(container.querySelector('[data-question="spending"]') ? "결과 보기" : "다음 질문"); }
  async function finishFromHere(skip = false) {
    while (container.querySelector("[data-question]")) {
      if (container.querySelector('input[type="radio"]')) await rating(skip ? "skipped" : 5);
      else if (skip) await button("지금 답하지 않을게요");
      else {
        const choice = container.querySelector<HTMLButtonElement>('[data-choice="V1"]')
          ?? container.querySelector<HTMLButtonElement>('[data-choice="photo"]')
          ?? container.querySelector<HTMLButtonElement>("[data-choice]");
        await click(choice);
      }
      await next();
    }
  }
  async function renderClient(props: Partial<Parameters<typeof WeddingCodeV30Client>[0]> = {}) {
    await act(async () => root.render(<WeddingCodeV30Client shareOrigin="https://hanbang.ai" {...props} />));
  }
  function linkValue() {
    return container.querySelector<HTMLInputElement>('input[aria-label="답이 담긴 웨딩코드 공유 링크"]')?.value;
  }
  function decodedLink(value: string) {
    const url = new URL(value);
    return decodeV30(new URLSearchParams(url.hash.slice(1)).get("a"));
  }
  async function consent(index = 0) { await click(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]); }

  it("라운지에서는 기존 40문항을 유지하고 중복 main·탐색 없이 질문으로 이동한다", async () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      await renderClient({ embedded: true });
      expect(container.querySelector("main")).toBeNull();
      expect(container.querySelector('nav[aria-label="웨딩코드 탐색"]')).toBeNull();
      await button("내 웨딩코드 시작하기");
      expect(container.querySelector("progress")?.getAttribute("max")).toBe("40");
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.activeElement);
      expect(document.activeElement?.getAttribute("aria-label")).toBe("웨딩코드 1번째 질문");
      expect(document.activeElement?.classList.contains("md:scroll-mt-28")).toBe(true);
      expect(window.scrollTo).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("40개 질문을 한 흐름으로 끝내고 취향·연결 설명·사용자가 고른 우선순위를 보여준다", async () => {
    await renderClient();
    expect(container.textContent).toContain("전체 40개 질문");
    await button("내 웨딩코드 시작하기");
    expect(container.querySelectorAll("[data-answer]")).toHaveLength(5);
    expect(container.querySelector('progress')?.getAttribute("max")).toBe("40");
    await finishFromHere();
    expect(container.querySelector('[data-result="solo-v30"]')).not.toBeNull();
    expect(container.textContent).toContain("전체 40개 질문 중 40개에 상태를 남겼어요");
    expect(container.textContent).toContain("동의 정도를 고른 문장은 32개");
    expect(container.querySelectorAll("[data-insight]").length).toBeGreaterThan(3);
    expect(container.textContent).toContain("어떤 답에서 나온 설명인가요?");
    expect(container.textContent).toContain("준비할 때 이렇게 해봐요");
    expect(linkValue()).toBeUndefined();
    await consent();
    const shared = decodedLink(linkValue()!);
    expect(shared?.priorities).toEqual({ status: "answered", values: ["V1"] });
    expect(shared?.spending).toEqual({ status: "answered", values: ["photo"] });
    for (const taste of WEDDING_CODE_V30_TASTES) expect(shared?.tastes[taste.key]?.status).toBe("answered");
    expect(captureWeddingCodeEvent).toHaveBeenCalledWith("wedding_code_completed", expect.objectContaining({ scene_total: 40, answered_count: 40, skipped_count: 0 }));
    expect(JSON.stringify(vi.mocked(captureWeddingCodeEvent).mock.calls)).not.toContain("V1");
  });

  it("앞의 답을 바꾸면 맞지 않는 우선순위를 지우고 다시 동의해야 새 링크를 만든다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await consent(); const oldUrl = linkValue()!;
    expect(decodedLink(oldUrl)?.answers.V1).toBe(5);
    await button("내 답 수정하기");
    await rating(1); await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-result="solo-v30"]')).toBeNull();
    expect(container.textContent).toContain("지키고 싶은 것을 다시 고르거나");
    expect([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "수정한 결과 보기")?.disabled).toBe(true);
    await button("아직 우선순위를 정하지 못했어요"); await button("수정한 결과 보기");
    expect(linkValue()).toBeUndefined();
    await consent();
    const revised = decodedLink(linkValue()!);
    expect(revised?.answers.V1).toBe(1);
    expect(revised?.priorities).toEqual({ status: "undecided" });
    expect(decodedLink(oldUrl)?.priorities).toEqual({ status: "answered", values: ["V1"] });
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
    expect(container.textContent).toContain("선택이 비어 있는 질문으로 돌아왔어요");
    await button("이번 계획에는 없어요"); await button("수정한 결과 보기"); await consent();
    expect(container.textContent).not.toContain("선택이 비어 있는 질문으로 돌아왔어요");
    expect(decodedLink(linkValue()!)?.tastes.venue).toEqual({ status: "not_applicable" });
  });

  it("우선순위로 고른 취향이 다른 보기로 바뀌면 새로운 취향을 우선순위로 자동 승계하지 않는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await button("우선순위 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="V1"]'));
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
    expect(container.querySelector('[data-result="solo-v30"]')?.getAttribute("data-empty")).toBe("true");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(linkValue()).toBeUndefined();
    expect(captureWeddingCodeEvent).toHaveBeenLastCalledWith("wedding_code_completed", expect.objectContaining({ answered_count: 0, skipped_count: 40 }));
  });

  it("중간·미정·비해당·건너뜀을 구분하고 이전 질문에서 고른 상태를 복원한다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    await rating(3); await next(); await rating("undecided"); await next();
    await rating("not_applicable"); await next(); await rating("skipped"); await next();
    await click(container.querySelector<HTMLButtonElement>('[aria-label="이전 질문"]'));
    expect(container.querySelector('input[value="skipped"]:checked')).not.toBeNull();
    await next(); await finishFromHere(true); await consent();
    expect(decodedLink(linkValue()!)?.answers).toMatchObject({ V1: 3, V2: "undecided", V3: "not_applicable", V4: "skipped" });
  });

  it("가족 주제 전체를 비해당으로 표시하면 이미 고른 답도 명시적으로 바꾸고 다음 주제로 이동한다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    while (container.querySelector("[data-question]")?.getAttribute("data-question") !== "F1") { await rating(4); await next(); }
    await rating(5); await next();
    expect(container.textContent).toContain("이미 고른 답도 바뀌며");
    await button("이 주제는 계획에 없어요");
    expect(container.querySelector('[data-question="H1"]')).not.toBeNull();
    await finishFromHere(); await consent();
    const saved = decodedLink(linkValue()!);
    for (const question of WEDDING_CODE_V30_QUESTIONS.filter(item => item.topic === "family")) expect(saved?.answers[question.id]).toBe("not_applicable");
  });

  it("상대 링크에서 모두 건너뛰어도 공통 취향을 만들거나 커플 공유를 열지 않는다", async () => {
    const partner: V30Draft = { ...createV30Draft(), answers: { V1: 5 } };
    await renderClient({ partnerDraft: partner }); await button("나도 답해보기"); await finishFromHere(true);
    expect(container.querySelector('[data-result="couple-v30"]')).not.toBeNull();
    expect(container.textContent).toContain("함께 원한다고 확인한 내용이 없어요");
    expect(container.textContent).toContain("두 사람이 모두 비교할 내용을 답해야 결과 링크");
    expect(container.textContent).toContain("두 사람이 같은 항목에 답한 내용이 없어 아직 차이를 비교할 수 없어요");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(linkValue()).toBeUndefined();
  });

  it("받은 두 사람 결과를 내 것으로 편집하거나 동의 없이 다시 공유하지 않는다", async () => {
    const first = { ...createV30Draft(), answers: { V1: 4 as const } };
    const second = { ...createV30Draft(), answers: { V1: 5 as const } };
    await renderClient({ bothDrafts: { first, second } });
    expect(container.textContent).toContain("받은 링크에 담긴 답이에요");
    expect(container.textContent).not.toContain("내가 방금 답한 내용 수정");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(linkValue()).toBeUndefined();
    await button("내 답으로 새로 시작하기"); await button("내 웨딩코드 시작하기");
    expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
  });

  it("일반 초대는 답 없는 주소이며 답 포함 링크는 동의 철회 즉시 숨기고 복사 실패 시 직접 복사할 수 있다", async () => {
    const first = { ...createV30Draft(), answers: { V1: 5 as const } };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await act(async () => root.render(<WeddingCodeV30Sharing first={first} shareOrigin="https://hanbang.ai" />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="웨딩코드 일반 시작 링크"]')?.value).toBe("https://hanbang.ai/wedding-code");
    expect(linkValue()).toBeUndefined(); await consent(); expect(linkValue()).toContain("#");
    await button("비교 초대 링크 복사");
    expect(container.textContent).toContain("자동 복사가 안 됐어요");
    expect(container.querySelector('[aria-label="답이 담긴 웨딩코드 공유 링크"]')?.closest("details")?.open).toBe(true);
    expect(captureWeddingCodeEvent).not.toHaveBeenCalledWith("wedding_code_share_copied", expect.anything());
    await consent(); expect(linkValue()).toBeUndefined();
  });

  it("두 사람 링크는 내 답 공개와 첫 응답자 동의를 각각 확인한 뒤에만 만든다", async () => {
    const first = { ...createV30Draft(), answers: { V1: 5 as const } };
    const second = { ...createV30Draft(), answers: { V1: 1 as const } };
    await act(async () => root.render(<WeddingCodeV30Sharing first={first} second={second} shareOrigin="https://hanbang.ai" />));
    await consent(); expect(linkValue()).toBeUndefined();
    await consent(1); expect(new URLSearchParams(new URL(linkValue()!).hash.slice(1)).has("b")).toBe(true);
    await consent(1); expect(linkValue()).toBeUndefined();
  });
});
