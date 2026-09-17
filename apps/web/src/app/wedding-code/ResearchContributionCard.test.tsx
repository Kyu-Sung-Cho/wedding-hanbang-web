// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import {
  WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  WEDDING_CODE_RESEARCH_RECEIPT_PATTERN,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
} from "@/lib/weddingCode/contribution/contract";
import { WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import WeddingCodeV06Client from "./WeddingCodeV06Client";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: analytics.capture }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CONTRIBUTE = "/api/wedding-code/research-contribution";
const DELETE = "/api/wedding-code/research-contribution/delete";

/**
 * 보태기는 **선택**이고, 받는 쪽이 닫혀 있으면 화면에서도 말하지 않는다.
 * 명세(`docs/wedding-code/56` §8.1): 기본값이 꺼진 동의 체크, 성인 확인, 보내는 것·
 * 함께 보관하지 않는 것·보관 기간, 삭제 코드는 브라우저 저장소에 두지 않는다.
 *
 * 2026-09-16 적대 검토 반영: 삭제 코드는 브라우저가 먼저 만들어 끊겨도 같은 코드로
 * 다시 보내고 지울 수 있다. 지우기 실패는 알린다. 보냈다는 분석 이벤트는 보내지 않는다.
 */
describe("WeddingCode research contribution card", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  let contributeOutcome: "ok" | "network" = "ok";
  let deleteOutcome: "ok" | "fail" | "hang" = "ok";
  let releaseDelete: (() => void) | null = null;

  beforeEach(() => {
    contributeOutcome = "ok";
    deleteOutcome = "ok";
    releaseDelete = null;
    analytics.capture.mockClear();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CONTRIBUTE)) {
        if (contributeOutcome === "network") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      if (url.endsWith(DELETE)) {
        if (deleteOutcome === "hang") {
          await new Promise<void>((resolve) => { releaseDelete = resolve; });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return deleteOutcome === "ok"
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(JSON.stringify({ error: "rate" }), { status: 429 });
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
    for (const [position] of config.questions.entries()) {
      if (position === 2) {
        await clickText("이 장면은 우리와 안 맞아요");
        continue;
      }
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-option="${option}"]`)!.click());
      await clickText(position === config.questions.length - 1 ? "결과 보기" : "다음 문항");
    }
  };
  const checkBoth = async () => {
    const card = container.querySelector('[data-research-contribution="form"]')!;
    for (const box of card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await act(async () => box.click());
    }
  };
  const bodiesTo = (path: string) => fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith(path))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it("닫혀 있으면 카드도, 삭제 폼도, 안내 문구도 없다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} />));
    expect(container.querySelector("[data-research-delete]")).toBeNull();
    expect(container.textContent).not.toContain("연구 자료로");
    await answerAll();
    expect(container.querySelector("[data-research-contribution]")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("research-contribution"))).toBe(false);
  });

  it("새 답 받기를 멈춰도 저장소를 지키는 동안에는 삭제 폼과 보관 안내가 남는다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen={false} researchStorageActive />));
    expect(container.querySelector("[data-research-delete]")).not.toBeNull();
    // 받지 않는 동안에는 없는 버튼을 설명하지 않는다 — 전에 보낸 답을 지우는 길만 알린다.
    expect(container.textContent).toContain("지금 이 질문으로는 답 보태기를 받지 않아요");
    expect(container.textContent).toContain("아래에 삭제 코드를 넣으면 돼요");
    expect(container.textContent).not.toContain("에 직접 동의한 경우에만 저장해요");
    await answerAll();
    expect(container.querySelector("[data-research-contribution]")).toBeNull();
  });

  it("두 사람 링크로 바로 열린 비교 화면에는 보태기 카드를 띄우지 않는다", async () => {
    const answers = Object.fromEntries(config.questions.map(question => [question.key, "A" as const]));
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={"A".repeat(config.questions.length)} bothCodes={{ first: answers, second: answers }} researchContributionOpen researchStorageActive />));
    expect(container.querySelector('[data-result="couple"]')).not.toBeNull();
    expect(container.querySelector("[data-research-contribution]")).toBeNull();
  });

  it("상대 링크로 들어와 답했으면 상대 코드가 아니라 내가 고른 답만 보낸다", async () => {
    const partnerCode = "A".repeat(config.questions.length);
    const partnerAnswers = Object.fromEntries(config.questions.map(question => [question.key, "A" as const]));
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={partnerAnswers} partnerCode={partnerCode} bothCodes={null} researchContributionOpen researchStorageActive />));
    await answerAll("나도 답해보기", "C");
    await checkBoth();
    await clickText("내 답 보태기");

    const [sent] = bodiesTo(CONTRIBUTE);
    expect(sent.answerCode).toBe(config.questions.map((_, position) => (position === 2 ? "-" : "C")).join(""));
    expect(sent.answerCode).not.toBe(partnerCode);
  });

  it("체크 두 개를 직접 켜야 보내고, 브라우저가 만든 삭제 코드를 함께 보내 보여주며 저장소·분석에 남기지 않는다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    expect(container.querySelector("[data-research-delete]")).not.toBeNull();
    // 받는 동안에는 현재 있는 동의 카드를 가리키고, 멈췄을 때의 문장은 쓰지 않는다.
    expect(container.textContent).toContain("에 직접 동의한 경우에만 저장해요");
    expect(container.textContent).not.toContain("답 보태기를 받지 않아요");
    await answerAll();

    const card = container.querySelector('[data-research-contribution="form"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("이름·연락처·계정·IP 주소·공유 링크·상대의 답");
    expect(card.textContent).toContain("보낸 날짜");
    expect(card.textContent).toContain("60일이 지나면 자동으로 지워요");
    expect(card.textContent).toContain("보태지 않아도 웨딩코드를 쓰는 데 아무 차이가 없어요");
    expect(card.textContent).not.toContain("익명");

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

    const [body] = bodiesTo(CONTRIBUTE);
    const expectedCode = config.questions.map((_, position) => (position === 2 ? "-" : "B")).join("");
    expect(body).toEqual({
      sceneVersion: config.version,
      answerCode: expectedCode,
      consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
      adultConfirmed: true,
      consented: true,
      receipt: expect.stringMatching(WEDDING_CODE_RESEARCH_RECEIPT_PATTERN),
    });

    const sent = container.querySelector('[data-research-contribution="sent"]')!;
    expect(sent.querySelector<HTMLInputElement>('input[aria-label="삭제 코드"]')!.value).toBe(body.receipt);
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(stored).not.toContain(body.receipt);
    expect(window.location.href).not.toContain(body.receipt);
    expect(JSON.stringify(analytics.capture.mock.calls)).not.toContain("research");
    expect(JSON.stringify(analytics.capture.mock.calls)).not.toContain(body.receipt);

    await clickText("지금 바로 지우기");
    expect(bodiesTo(DELETE)).toEqual([{ receipt: body.receipt }]);
    expect(container.querySelector('[data-research-contribution="deleted"]')).not.toBeNull();
  });

  it("응답이 끊기면 '보내지 못했다'고 하지 않고, 같은 삭제 코드로 다시 보내거나 지울 수 있다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    await answerAll();
    await checkBoth();
    contributeOutcome = "network";
    await clickText("내 답 보태기");

    const uncertain = container.querySelector('[data-research-contribution="uncertain"]')!;
    expect(uncertain).not.toBeNull();
    expect(uncertain.textContent).toContain("보냈는지 확인하지 못했어요");
    expect(uncertain.textContent).not.toContain("보내지 못했어요");
    const [first] = bodiesTo(CONTRIBUTE);
    expect(uncertain.querySelector<HTMLInputElement>('input[aria-label="삭제 코드"]')!.value).toBe(first.receipt);

    contributeOutcome = "ok";
    await clickText("다시 보내기");
    const bodies = bodiesTo(CONTRIBUTE);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].receipt).toBe(first.receipt);
    expect(container.querySelector('[data-research-contribution="sent"]')).not.toBeNull();
  });

  it("지우기가 실패하면 조용히 넘어가지 않고 알린 뒤 코드를 계속 보여준다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    await answerAll();
    await checkBoth();
    await clickText("내 답 보태기");
    deleteOutcome = "fail";
    await clickText("지금 바로 지우기");

    const sent = container.querySelector('[data-research-contribution="sent"]')!;
    expect(sent).not.toBeNull();
    expect(sent.querySelector('[role="alert"]')?.textContent).toContain("지금은 지우지 못했어요");
    expect(sent.querySelector<HTMLInputElement>('input[aria-label="삭제 코드"]')!.value).toMatch(WEDDING_CODE_RESEARCH_RECEIPT_PATTERN);
    expect(container.querySelector('[data-research-contribution="deleted"]')).toBeNull();
  });

  /**
   * 2026-09-17: 「보냈는지 확인하지 못했어요」에서 지우기를 누르면, 지우는 동안 제목이
   * 「답을 보탰어요」로 바뀌어 확인하지 못한 저장을 확인한 것처럼 말했다.
   */
  it("확인 못 한 상태에서 지우는 동안에도 '저장됐다'고 말하지 않는다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    await answerAll();
    await checkBoth();
    contributeOutcome = "network";
    await clickText("내 답 보태기");
    expect(container.querySelector('[data-research-contribution="uncertain"]')).not.toBeNull();

    deleteOutcome = "hang";
    await clickText("지금 바로 지우기");
    // 아직 서버 답을 못 받은 순간이다.
    expect(container.textContent).toContain("지우는 중...");
    expect(container.querySelector('[data-research-contribution="uncertain"]')).not.toBeNull();
    expect(container.querySelector('[data-research-contribution="sent"]')).toBeNull();
    expect(container.textContent).not.toContain("저장됐어요");

    // 콜백 안에서 채운 값이라 타입 좁히기가 null 로 본다 — 넓혀서 부른다.
    await act(async () => { (releaseDelete as (() => void) | null)?.(); });
    expect(container.querySelector('[data-research-contribution="deleted"]')).not.toBeNull();
  });

  /**
   * 연구 명세 §9.1.7: 이름·계정을 받지 않으니 삭제 코드를 잃으면 지울 수 없다 — 이 한계를
   * **동의하기 전에** 알려야 한다. 예전 카드는 보낸 뒤에만 말했다(2026-09-17 적대 검토).
   */
  it("삭제 코드를 잃으면 지울 수 없다는 한계와 처리방침 링크가 동의 체크보다 먼저 나온다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    await answerAll();
    const card = container.querySelector('[data-research-contribution="form"]')!;
    const firstBox = card.querySelector('input[type="checkbox"]')!;
    const warning = [...card.querySelectorAll("li")].find((item) => item.textContent?.includes("코드를 잃어버리면"));
    const privacyLink = card.querySelector('a[href="/privacy"]');
    expect(warning?.textContent).toContain("찾을 수 없고 지워 드릴 수도 없어요");
    expect(privacyLink).not.toBeNull();
    for (const before of [warning!, privacyLink!]) {
      expect(before.compareDocumentPosition(firstBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // 쉬운 말로 풀었으니 처리방침 용어를 카드에 남기지 않는다.
    for (const jargon of ["문항 판", "동의 문구 판", "답 기호"]) {
      expect(card.textContent, jargon).not.toContain(jargon);
    }
    // 삭제 코드 확인용 해시도 저장한다는 사실을 숨기지 않는다(처리방침 제1조).
    expect(card.textContent).toContain("해시");
  });

  it("보낸 뒤 안내에 자동 삭제 문장이 한 번만 나온다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={config.version} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    await answerAll();
    await checkBoth();
    await clickText("내 답 보태기");
    const sent = container.querySelector('[data-research-contribution="sent"]')!;
    const sentence = `${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워져요`;
    expect(sent.textContent!.split(sentence).length - 1).toBe(1);
  });

  /**
   * 옛 v0.6 링크로 들어온 사람에게는 카드가 뜨지 않는다(받는 판이 아니다). 예전 첫 화면은
   * 서버 스위치만 보고 「결과 화면에서 보탤 수 있다」고 말했다 — 없는 버튼을 설명했다.
   */
  it("받지 않는 판으로 들어오면 첫 화면이 보태기를 약속하지 않고 카드도 없다", async () => {
    await act(async () => root.render(<WeddingCodeV06Client shareOrigin="https://hanbang.ai" version={WEDDING_CODE_V06_VERSION} partnerAnswers={null} partnerCode={null} bothCodes={null} researchContributionOpen researchStorageActive />));
    expect(container.textContent).toContain("지금 이 질문으로는 답 보태기를 받지 않아요");
    expect(container.textContent).not.toContain("에 직접 동의한 경우에만 저장해요");
    expect(container.querySelector("[data-research-delete]")).not.toBeNull();
  });
});
