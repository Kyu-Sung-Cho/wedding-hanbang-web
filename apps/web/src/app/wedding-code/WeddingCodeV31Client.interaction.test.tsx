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
  async function rating(value: string | number) { await click(container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)); }
  async function next() { await button(container.querySelector('[data-question="spending"]') ? "결과 보기" : "다음 질문"); }
  async function expandPriorities() {
    const toggle = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "우선순위도 골라볼게요 (선택)");
    if (toggle) await click(toggle);
  }
  async function finishFromHere(skip = false) {
    while (container.querySelector("[data-question]")) {
      if (container.querySelector('[data-question="priorities"]')) await expandPriorities();
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

  it("34개 질문을 한 흐름으로 끝내고 취향·연결 설명·사용자가 고른 우선순위를 보여준다", async () => {
    await renderClient();
    expect(container.textContent).toContain("전체 34개 질문");
    await button("내 웨딩코드 시작하기");
    expect(container.querySelectorAll("[data-answer]")).toHaveLength(5);
    expect(container.querySelector('progress')?.getAttribute("max")).toBe("34");
    await finishFromHere();
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    expect(container.textContent).toContain("34개 질문 중 34개를 살펴봤어요");
    expect(container.textContent).toContain("동의 정도를 고른 문장은 25개");
    expect(container.querySelectorAll("[data-insight]").length).toBeGreaterThan(3);
    expect(container.textContent).toContain("어떤 답에서 나온 설명인가요?");
    expect(container.textContent).toContain("준비할 때 이렇게 해봐요");
    expect(linkValue()).toBeUndefined();
    await consent();
    const shared = decodedLink(linkValue()!);
    expect(shared?.priorities).toEqual({ status: "answered", values: ["V1"] });
    expect(shared?.spending).toEqual({ status: "answered", values: ["photo"] });
    expect(shared?.avoidances).toEqual({ status: "answered", values: ["heavy_decoration"] });
    expect(container.querySelectorAll("[data-priority-guides] [data-insight]")).toHaveLength(1);
    expect(container.querySelector('[data-insight="priority-V1"]')).not.toBeNull();
    expect(container.querySelector('[data-insight="single-V1"]')).toBeNull();
    for (const taste of WEDDING_CODE_V31_TASTES) expect(shared?.tastes[taste.key]?.status).toBe("answered");
    expect(captureWeddingCodeEvent).toHaveBeenCalledWith("wedding_code_completed", expect.objectContaining({ scene_total: 34, answered_count: 34, skipped_count: 0 }));
    expect(JSON.stringify(vi.mocked(captureWeddingCodeEvent).mock.calls)).not.toContain("V1");
  });

  it("앞의 답을 바꾸면 맞지 않는 우선순위를 지우고 다시 동의해야 새 링크를 만든다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기"); await finishFromHere();
    await consent(); const oldUrl = linkValue()!;
    expect(decodedLink(oldUrl)?.answers.V1).toBe(5);
    await button("내 답 수정하기");
    await rating(1); await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-result="solo-v31"]')).toBeNull();
    expect(container.textContent).toContain("지키고 싶은 것을 다시 고르거나");
    expect([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "수정한 결과 보기")?.disabled).toBe(true);
    await expandPriorities();
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
    await expandPriorities();
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
    expect(captureWeddingCodeEvent).toHaveBeenLastCalledWith("wedding_code_completed", expect.objectContaining({ answered_count: 0, skipped_count: 34 }));
  });

  it("중간·미정·비해당·건너뜀을 구분하고 이전 질문에서 고른 상태를 복원한다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    await rating(3); await next(); await rating("undecided"); await next();
    await rating("not_applicable"); await next(); await rating("skipped"); await next();
    await click(container.querySelector<HTMLButtonElement>('[aria-label="이전 질문"]'));
    expect(container.querySelector('input[value="skipped"]:checked')).not.toBeNull();
    await next(); await finishFromHere(true); await consent();
    expect(decodedLink(linkValue()!)?.answers).toMatchObject({ V1: 3, G1: "undecided", G2: "not_applicable", G3: "skipped" });
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
    for (const question of WEDDING_CODE_V31_QUESTIONS.filter(item => item.topic === "family")) expect(saved?.answers[question.id]).toBe("not_applicable");
  });

  it("상대 링크에서 모두 건너뛰어도 공통 취향을 만들거나 커플 공유를 열지 않는다", async () => {
    const partner: V31Draft = { ...createV31Draft(), answers: { V1: 5 } };
    await renderClient({ partnerDraft: partner }); await button("나도 답해보기"); await finishFromHere(true);
    expect(container.querySelector('[data-result="couple-v31"]')).not.toBeNull();
    expect(container.textContent).toContain("함께 원한다고 확인한 내용이 없어요");
    expect(container.textContent).toContain("두 사람이 모두 비교할 내용을 답해야 결과 링크");
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
    await button("내 답으로 새로 시작하기"); await button("내 웨딩코드 시작하기");
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
    expect(container.textContent).toContain("예식 자체를 하지 않을 계획이면");
    for (const question of WEDDING_CODE_V31_QUESTIONS) {
      expect(container.querySelector("[data-question]")?.getAttribute("data-question")).toBe(question.id);
      await rating(3); await next();
    }
    for (const taste of WEDDING_CODE_V31_TASTES) {
      if (taste.key === "attire" || taste.key === "ceremony") {
        expect(container.textContent).toContain("해당하는 것을 모두 골라 주세요");
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
    await expandPriorities();
    expect(container.textContent).toContain("1개만 골라도 괜찮아요");
    expect(container.querySelector('[data-choice="R1"]')).toBeNull();
    expect(container.querySelector('[data-choice="R2"]')).toBeNull();
    expect(container.querySelectorAll('[data-choice="taste.photo"]')).toHaveLength(1);
    await click(container.querySelector<HTMLButtonElement>('[data-choice="taste.photo"]'));
    await next(); await button("더 쓰고 싶은 곳은 지금 없어요"); await next(); await consent();
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
    await button("우선순위 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="avoid.heavy_decoration"]'));
    await button("수정한 결과 보기"); await consent();
    const oldUrl = linkValue()!;
    expect(decodedLink(oldUrl)?.priorities).toEqual({ status: "answered", values: ["V1", "avoid.heavy_decoration"] });
    await button("피하고 싶은 것 수정");
    await click(container.querySelector<HTMLButtonElement>('[data-choice="heavy_decoration"]'));
    await click(container.querySelector<HTMLButtonElement>('[data-choice="loud_music"]'));
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-choice="V1"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-choice="avoid.heavy_decoration"]')).toBeNull();
    expect(container.querySelector('[data-choice="avoid.loud_music"]')?.getAttribute("aria-pressed")).toBe("false");
    await button("수정한 결과 보기");
    expect(linkValue()).toBeUndefined();
    expect(container.textContent).not.toContain("이전 우선순위를 다시 확인해야 해요");
    await consent();
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "answered", values: ["V1"] });
    expect(decodedLink(linkValue()!)?.avoidances).toEqual({ status: "answered", values: ["loud_music"] });
    expect(decodedLink(oldUrl)?.avoidances).toEqual({ status: "answered", values: ["heavy_decoration"] });
  });

  it("특정 긍정 조합이 없는 사람도 직접 고른 우선순위에서 준비 행동을 얻는다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    for (const question of WEDDING_CODE_V31_QUESTIONS) { await rating(question.id === "B1" ? 5 : 2); await next(); }
    for (const taste of WEDDING_CODE_V31_TASTES) { await click(container.querySelector<HTMLButtonElement>(`[data-choice="${taste.options[0].value}"]`)); await next(); }
    await button("따로 피하고 싶은 것은 없어요"); await next();
    await expandPriorities();
    await click(container.querySelector<HTMLButtonElement>('[data-choice="B1"]')); await next();
    await button("더 쓰고 싶은 곳은 지금 없어요"); await next();
    const guide = container.querySelector("[data-priority-guides] [data-insight]");
    expect(guide).not.toBeNull();
    expect(guide?.textContent).toContain("준비할 때 이렇게 해봐요");
    expect(guide?.textContent).toContain("마음에 드는 것이 생겨도 처음 정한 전체 예산 안에서 준비하고 싶다.");
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
    expect(sectionTitle("taste.venue")).toBe("열어 두고 있는 취향");
    expect(sectionTitle("avoidances")).toBe("함께 피하고 싶은 것");
    expect(sectionTitle("spending")).toBe("먼저 이야기해 볼 차이");
    expect(container.querySelector('[data-comparison="spending"]')?.textContent).toContain("더 쓰고 싶은 곳은 지금 없어요");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("여러 보기를 고른 커플은 다른 선택뿐 아니라 함께 고른 보기도 확인한다", async () => {
    const first: V31Draft = { ...createV31Draft(), tastes: { attire: { status: "answered", values: ["simple", "flowing"] } } };
    const second: V31Draft = { ...createV31Draft(), tastes: { attire: { status: "answered", values: ["flowing", "traditional"] } } };
    await renderClient({ bothDrafts: { first, second } });
    expect(container.textContent).not.toContain("함께 원한다고 확인한 내용이 없어요");
    expect(container.textContent).toContain("일부 보기는 함께 골랐어요");
    const comparison = container.querySelector('[data-comparison="taste.attire"]');
    expect(comparison?.textContent).toContain("함께 고른 보기: 하늘하늘한 옷");
    expect(comparison?.textContent).toContain("깔끔하고 단순한 옷");
    expect(comparison?.textContent).toContain("한복 같은 전통 혼례복");
  });

  it("우선순위는 펼치지 않고 넘어갈 수 있고 더 쓸 곳 없음과 메모 선택이 먼저 명확하게 보인다", async () => {
    await renderClient(); await button("내 웨딩코드 시작하기");
    while (!container.querySelector('[data-question="priorities"]')) {
      if (container.querySelector('input[type="radio"]')) await rating(4);
      else await click(container.querySelector<HTMLButtonElement>("[data-choice]"));
      await next();
    }
    expect(container.querySelector("[data-choice]")).toBeNull();
    expect([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "우선순위도 골라볼게요 (선택)")?.getAttribute("aria-expanded")).toBe("false");
    await button("지금은 넘어갈게요");
    const spending = container.querySelector('[data-question="spending"]');
    expect(spending).not.toBeNull();
    const optionLabels = [...spending!.querySelectorAll("button")].map(item => item.textContent?.trim());
    expect(optionLabels.slice(0, 2)).toEqual(["더 쓰고 싶은 곳은 지금 없어요", "아직 모르겠어요"]);
    expect(optionLabels.filter(label => label === "더 쓰고 싶은 곳은 지금 없어요")).toHaveLength(1);
    expect(optionLabels.filter(label => label === "아직 모르겠어요")).toHaveLength(1);
    await button("더 쓰고 싶은 곳은 지금 없어요"); await next();
    const note = container.querySelector<HTMLDetailsElement>("[data-optional-personal-note]");
    expect(note?.open).toBe(false);
    expect(note?.querySelector("summary")?.textContent).toBe("내 메모 남기기 (선택)");
    expect(note?.textContent).toContain("자동 저장이나 공유 링크에는 포함되지 않아요");
    expect(container.querySelector("[data-priority-guides]")).toBeNull();
    const prioritySummary = [...container.querySelectorAll("h2")].find(item => item.textContent === "이번 결혼식에서 지키고 싶은 것")?.closest("section");
    expect(prioritySummary?.textContent).toContain("우선순위는 이번에 고르지 않았어요.");
    expect(prioritySummary?.textContent).not.toContain("지금 답하지 않을게요");
    expect(prioritySummary?.querySelector("ul")).toBeNull();
    await consent();
    expect(decodedLink(linkValue()!)?.priorities).toEqual({ status: "skipped" });
    expect(decodedLink(linkValue()!)?.spending).toEqual({ status: "no_preference" });
  });

  it("기존에 고른 우선순위는 펼쳐서 보여주고 접고 펼치는 동작만으로 답을 바꾸지 않는다", async () => {
    const onChange = vi.fn(); const onSkip = vi.fn();
    await act(async () => root.render(<V31PriorityInput value={{ status: "answered", values: ["B1"] }} options={[{ value: "B1", label: "전체 예산 지키기" }]} onChange={onChange} onSkip={onSkip} />));
    expect(container.querySelector('[data-choice="B1"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("넘어가면 이전에 고른 우선순위는 지워져요");
    await button("우선순위 고르기 접기");
    expect(container.querySelector("[data-choice]")).toBeNull();
    expect(container.textContent).toContain("우선순위 1개를 골랐어요");
    await button("우선순위도 골라볼게요 (선택)");
    expect(container.querySelector('[data-choice="B1"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(onChange).not.toHaveBeenCalled(); expect(onSkip).not.toHaveBeenCalled();
    await button("지금은 넘어갈게요");
    expect(onSkip).toHaveBeenCalledOnce(); expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["undecided", "아직 우선순위를 정하지 못했어요"],
    ["no_preference", "특히 지킬 것을 따로 고르지 않을게요"],
    ["skipped", "지금 답하지 않을게요"],
  ] as const)("기존 %s 답은 선택 후보를 펼쳐도 그대로 유지한다", async (status, label) => {
    const onChange = vi.fn(); const onSkip = vi.fn();
    await act(async () => root.render(<V31PriorityInput value={{ status }} options={[{ value: "B1", label: "전체 예산 지키기" }]} onChange={onChange} onSkip={onSkip} />));
    expect(container.querySelector("[data-choice]")).toBeNull();
    await button("우선순위도 골라볼게요 (선택)");
    expect([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-choice="B1"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(onChange).not.toHaveBeenCalled(); expect(onSkip).not.toHaveBeenCalled();
  });
});
