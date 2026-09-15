// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import { WEDDING_CODE_RESEARCH_CONSENT_VERSION } from "@/lib/weddingCode/contribution/contract";
import WeddingCodeV06Client from "./WeddingCodeV06Client";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const RECEIPT = `wc_del_${"Q".repeat(43)}`;

/**
 * 보태기는 **선택**이고, 받는 쪽이 닫혀 있으면 화면에서도 말하지 않는다.
 * 명세(`docs/wedding-code/56` §8.1): 기본값이 꺼진 동의 체크, 성인 확인, 보내는 것·
 * 받지 않는 것·보관 기간, 삭제 코드는 브라우저 저장소에 두지 않는다.
 */
describe("WeddingCode research contribution card", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/wedding-code/research-contribution")) {
        return new Response(JSON.stringify({ receipt: RECEIPT }), { status: 201 });
      }
      if (url.endsWith("/api/wedding-code/research-contribution/delete")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ user: null }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/wedding-code");
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
  const clickText = async (text: string) => {
    const button = [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.includes(text));
    expect(button, text).toBeDefined();
    await act(async () => button!.click());
  };
  const answerAll = async (start = "시작하기", option = "B") => {
    await clickText(start);
    for (const [position, question] of config.questions.entries()) {
      if (position === 2) {
        await clickText("이 장면은 우리와 안 맞아요");
        continue;
      }
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-option="${option}"]`)!.click());
      await clickText(position === config.questions.length - 1 ? "결과 보기" : "다음 문항");
    }
  };

  it("닫혀 있으면 카드도, 삭제 폼도, 안내 문구도 없다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} />));
    expect(container.querySelector("[data-research-delete]")).toBeNull();
    expect(container.textContent).not.toContain("연구 자료로 보관해요");
    await answerAll();
    expect(container.querySelector("[data-research-contribution]")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("research-contribution"))).toBe(false);
  });

  it("두 사람 링크로 바로 열린 비교 화면에는 보태기 카드를 띄우지 않는다", async () => {
    const answers = Object.fromEntries(config.questions.map(question => [question.key, "A" as const]));
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={"A".repeat(config.questions.length)} bothCodes={{ first: answers, second: answers }} researchContributionOpen />));
    expect(container.querySelector('[data-result="couple"]')).not.toBeNull();
    expect(container.querySelector("[data-research-contribution]")).toBeNull();
  });

  it("상대 링크로 들어와 답했으면 상대 코드가 아니라 내가 고른 답만 보낸다", async () => {
    const partnerCode = "A".repeat(config.questions.length);
    const partnerAnswers = Object.fromEntries(config.questions.map(question => [question.key, "A" as const]));
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={partnerAnswers} partnerCode={partnerCode} bothCodes={null} researchContributionOpen />));
    await answerAll("나도 답해보기", "C");

    const card = container.querySelector('[data-research-contribution="form"]')!;
    expect(card).not.toBeNull();
    for (const box of card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await act(async () => box.click());
    }
    await clickText("내 답 보태기");

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/wedding-code/research-contribution"))!;
    const sent = JSON.parse(String((call[1] as RequestInit).body));
    expect(sent.answerCode).toBe(config.questions.map((_, position) => (position === 2 ? "-" : "C")).join(""));
    expect(sent.answerCode).not.toBe(partnerCode);
  });

  it("체크 두 개를 직접 켜야 보내고, 내가 고른 답만 보내며, 삭제 코드는 저장소에 두지 않는다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen />));
    expect(container.querySelector("[data-research-delete]")).not.toBeNull();
    await answerAll();

    const card = container.querySelector('[data-research-contribution="form"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("이름·연락처·계정·IP 주소·공유 링크·상대의 답");
    expect(card.textContent).toContain("60일이 지나면 자동으로 지워요");
    expect(card.textContent).toContain("보태지 않아도 웨딩코드를 쓰는 데 아무 차이가 없어요");

    const boxes = [...card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect(boxes.every(box => !box.checked)).toBe(true);
    const submit = [...card.querySelectorAll("button")].find(button => button.textContent?.includes("내 답 보태기"))!;
    expect(submit.disabled).toBe(true);
    await act(async () => boxes[0].click());
    expect(submit.disabled).toBe(true);
    await act(async () => boxes[1].click());
    expect(submit.disabled).toBe(false);

    await act(async () => submit.click());

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/wedding-code/research-contribution"))!;
    const expectedCode = config.questions.map((_, position) => (position === 2 ? "-" : "B")).join("");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      sceneVersion: config.version,
      answerCode: expectedCode,
      consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
      adultConfirmed: true,
      consented: true,
    });

    const sent = container.querySelector('[data-research-contribution="sent"]')!;
    expect(sent.querySelector<HTMLInputElement>('input[aria-label="삭제 코드"]')!.value).toBe(RECEIPT);
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(stored).not.toContain(RECEIPT);
    expect(window.location.href).not.toContain(RECEIPT);

    await clickText("지금 바로 지우기");
    const deleteCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/delete"))!;
    expect(JSON.parse(String((deleteCall[1] as RequestInit).body))).toEqual({ receipt: RECEIPT });
    expect(container.querySelector('[data-research-contribution="deleted"]')).not.toBeNull();
  });
});
