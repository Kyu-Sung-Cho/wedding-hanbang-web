import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCandidate6Journey } from "../candidate6";
import { CANDIDATE6_SCENE_TEXT, deriveCardCandidates } from "../candidate6SceneText";
import { Candidate6Prototype } from "../Candidate6Prototype";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const JOURNEY = buildCandidate6Journey("A", "not_applicable", "ES_FIRST");
const EXPECTED_CANDIDATES = deriveCardCandidates(JOURNEY.map((item) => item.id));

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

function radioInsideLabel(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  const input = label?.querySelector("input[type=radio]");
  if (!(input instanceof HTMLInputElement)) throw new Error(`Radio not found: ${text}`);
  return input;
}

function candidateRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-card-candidate]")];
}

function candidateIds(container: HTMLElement): (string | undefined)[] {
  return candidateRows(container).map((row) => row.dataset.cardCandidate);
}

describe("카드 고르기 단계", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
    for (let index = 0; index < JOURNEY.length; index += 1) {
      const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
      await act(async () => (choice as HTMLInputElement).click());
      await act(async () =>
        buttonByText(container, index === JOURNEY.length - 1 ? "지나온 장면 보기" : "다음").click());
      if (container.querySelector("[data-interlude]")) {
        await act(async () => buttonByText(container, "넘기기").click());
      }
    }
    await act(async () => buttonByText(container, "오늘 꺼낼 한 마디 고르기").click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("후보는 투여된 장면에서 리뷰 플래그만 뺀 것이고 journey 순서를 지킨다", () => {
    expect(container.textContent).toContain("오늘 꺼낼 한 마디를 골라주세요");
    expect(candidateIds(container)).toEqual([...EXPECTED_CANDIDATES]);
  });

  // 답을 보고 골라줬다는 오해 경로를 카피가 아니라 화면에 적어서 닫는다.
  it("후보의 출처를 화면에 그대로 적는다", () => {
    expect(container.textContent)
      .toContain("지나온 장면 전부에서 고를 수 있어요. 라벨은 후보를 바꾸지 않아요.");
  });

  // 21문항 답한 직후 일부가 빠진 목록을 보면 "내 답을 보고 걸렀다"고 믿는 사용자가
  // 생긴다. 빠진 이유를 그대로 적는다.
  it("문장이 아직 없는 장면은 그 사실을 적는다", () => {
    const missing = JOURNEY.filter((item) => CANDIDATE6_SCENE_TEXT[item.id].card === null);
    expect(missing.length, "이 검사가 성립하려면 플래그 항목이 journey에 있어야 한다")
      .toBeGreaterThan(0);
    for (const item of missing) {
      expect(candidateIds(container)).not.toContain(item.id);
    }
    expect(container.textContent).toContain("문장을 아직 다듬는 중이라 카드가 없어요");
  });

  it("고르기 전에는 확정할 수 없다", () => {
    expect(buttonByText(container, "이 카드로 정하기").disabled).toBe(true);
  });

  // 화면이 「라벨은 후보를 바꾸지 않아요」라고 **주장**한다. 주장만 하고 검증하지
  // 않으면 그 문장이 거짓이 되는 순간을 아무도 모른다. (2026-07-28 변이 검증:
  // 라벨로 후보를 거르는 변이가 13/13 통과했다 — 라벨이 하나도 없는 상태에서만
  // 후보를 확인하고 있었기 때문이다.)
  it("라벨을 전부 붙여도 후보가 그대로다 — 화면의 주장이 참이다", async () => {
    const withoutLabels = candidateIds(container);

    for (const kind of ["ours", "not-ours"] as const) {
      // 같은 root에 다시 render하면 React가 컴포넌트 인스턴스를 유지해 상태가 남는다.
      // 라벨 상태만 다른 새 세션이 필요하므로 완전히 새로 마운트한다.
      const fresh = document.createElement("div");
      document.body.appendChild(fresh);
      const freshRoot = createRoot(fresh);
      await act(async () => freshRoot.render(<Candidate6Prototype form="A" />));
      await act(async () => radioInsideLabel(fresh, "둘이 정하기로 했어요").click());
      await act(async () => buttonByText(fresh, "장면 시작하기").click());
      for (let index = 0; index < JOURNEY.length; index += 1) {
        const choice = fresh.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
        await act(async () => (choice as HTMLInputElement).click());
        await act(async () =>
          buttonByText(fresh, index === JOURNEY.length - 1 ? "지나온 장면 보기" : "다음").click());
        if (fresh.querySelector("[data-interlude]")) {
          await act(async () => buttonByText(fresh, "넘기기").click());
        }
      }
      for (const pill of [...fresh.querySelectorAll<HTMLElement>(`[data-scene-label="${kind}"]`)]) {
        await act(async () => pill.click());
      }
      await act(async () => buttonByText(fresh, "오늘 꺼낼 한 마디 고르기").click());

      expect(candidateIds(fresh), `라벨 전부 ${kind}일 때 후보가 달라졌다`).toEqual(withoutLabels);
      await act(async () => freshRoot.unmount());
      fresh.remove();
    }
  });

  describe("두 번 고른다", () => {
    async function pickFirst() {
      await act(async () => candidateRows(container)[0].click());
      await act(async () => buttonByText(container, "이 카드로 정하기").click());
    }

    it("두 번째 화면은 상대가 나한테 물어줄 한 마디를 고르게 한다", async () => {
      await pickFirst();
      expect(container.textContent).toContain("이번엔 상대가 나한테 물어줄 한 마디를 골라주세요");
      expect(container.textContent).toContain("꺼내는 사람이 늘 나였다면, 이번 한 번은 상대에게 맡겨도 돼요.");
    });

    it("두 번째 후보에는 이미 고른 한 장이 없다", async () => {
      const firstId = candidateIds(container)[0];
      await pickFirst();
      expect(candidateIds(container)).toEqual(
        EXPECTED_CANDIDATES.filter((id) => id !== firstId));
    });

    // 건너뛰기가 작아지면 "골라야 한다"는 압박이 된다. 같은 크기여야 선택이 된다.
    it("건너뛰기와 확정 버튼의 크기 클래스가 같다", async () => {
      await pickFirst();
      const skip = buttonByText(container, "이번엔 안 고를게요");
      const confirm = buttonByText(container, "이 카드로 정하기");
      const sizeOf = (element: HTMLElement) =>
        element.className.split(/\s+/).filter((token) => /^min-h-|^flex-1$|^w-full$/.test(token))
          .sort().join(" ");
      expect(sizeOf(skip)).toBe(sizeOf(confirm));
      expect(sizeOf(skip)).not.toBe("");
    });

    it("건너뛰어도 내 카드로 넘어간다", async () => {
      await pickFirst();
      await act(async () => buttonByText(container, "이번엔 안 고를게요").click());
      expect(container.textContent).toContain("오늘은 이 한 문장만 꺼내도 충분해요");
    });
  });

  describe("내 카드와 초대", () => {
    async function reachCard() {
      await act(async () => candidateRows(container)[0].click());
      await act(async () => buttonByText(container, "이 카드로 정하기").click());
      await act(async () => buttonByText(container, "이번엔 안 고를게요").click());
    }

    it("카드에 질문·언제·행동과 provenance가 함께 있다", async () => {
      const firstId = candidateIds(container)[0] as keyof typeof CANDIDATE6_SCENE_TEXT;
      const card = CANDIDATE6_SCENE_TEXT[firstId].card;
      await reachCard();

      const face = container.querySelector<HTMLElement>("[data-card-face]");
      expect(face).not.toBeNull();
      expect(face?.textContent).toContain(card?.prompt);
      expect(face?.textContent).toContain(card?.when);
      expect(face?.textContent).toContain(card?.action);
      expect(face?.textContent).toContain("웨딩코드 로컬 미리보기 · 정식 검사 아님");
    });

    it("보관하지 않는다는 것을 사과가 아니라 약속으로 적는다", async () => {
      await reachCard();
      expect(container.textContent).toContain("우리는 이 카드를 보관하지 않았어요.");
    });

    // 완료에 고유 연출이 붙으면 "특정 응답을 보상하는 장치"가 된다.
    it("완료 전용 축하 연출이 없다", async () => {
      await reachCard();
      expect(container.innerHTML).not.toMatch(/confetti|celebrat|animate-bounce|animate-ping/i);
    });

    it("초대는 링크 없이 한 줄만 내보내고 그 전문을 화면에 보여준다", async () => {
      const firstId = candidateIds(container)[0] as keyof typeof CANDIDATE6_SCENE_TEXT;
      const card = CANDIDATE6_SCENE_TEXT[firstId].card;
      await reachCard();
      await act(async () => buttonByText(container, "한 마디 건네기").click());

      expect(container.textContent).toContain("답은 안 보내고, 한 마디만 건네요");
      expect(container.textContent).toContain("링크는 아직 열려 있지 않아요");
      expect(container.textContent).toContain("상대가 아무것도 안 해도 제 화면은 그대로예요.");

      const preview = container.querySelector<HTMLElement>("[data-invite-copy]");
      expect(preview?.dataset.inviteCopy).toBe(card?.prompt);
      expect(preview?.textContent).toContain(card?.prompt);
      expect(preview?.dataset.inviteCopy).not.toMatch(/http|hanbang|웨딩코드|한방/);
      // 장면 제목·라벨·답이 새어나가지 않는다.
      expect(preview?.dataset.inviteCopy)
        .not.toContain(CANDIDATE6_SCENE_TEXT[firstId].sceneTitle);
      expect(preview?.dataset.inviteCopy).not.toMatch(/우리 얘기|우리 얘긴 아니에요/);
    });

    it("안 보내고 끝내는 길이 같은 크기로 있다", async () => {
      await reachCard();
      await act(async () => buttonByText(container, "한 마디 건네기").click());
      const copy = buttonByText(container, "이 한 줄만 복사");
      const leave = buttonByText(container, "안 보내고 끝내기");
      const sizeOf = (element: HTMLElement) =>
        element.className.split(/\s+/).filter((token) => /^min-h-|^flex-1$|^w-full$/.test(token))
          .sort().join(" ");
      expect(sizeOf(leave)).toBe(sizeOf(copy));
      expect(sizeOf(leave)).not.toBe("");
    });
  });
});

/**
 * 후보가 **응답**과도 무관한지 본다.
 *
 * 2026-07-28 독립 감사가 이 자리의 구멍을 찾았다: 카드 화면에 도달하는 워크스루가
 * 전부 `input[value^="bipolar-"], input[value^="impact-"]`의 **첫 라디오만** 눌러서
 * escape가 한 번도 선택되지 않았고, `cardCandidates`에 `responses[id]?.kind !== "escape"`
 * 필터를 심은 변이가 통과했다. `deriveCardCandidates`의 arity 검사는 순수함수 내부만
 * 막고 호출 지점을 제약하지 못한다.
 *
 * 「넘긴 장면은 후보에서 빼주는 게 친절하다」는 자연스러운 오판이 들어오면 사용자는
 * 21문항 직후 짧아진 목록을 보며 「내 답을 보고 걸렀다」고 믿는다 — 기획서 위험 5가
 * 카피로 막으려던 오해를 코드가 만들어낸다.
 */
describe("카드 후보가 응답과도 무관하다", () => {
  let root: Root;
  let container: HTMLDivElement;

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  /** 전 문항을 주어진 방식으로 답하고 카드 고르기 화면까지 간다. */
  async function walkWith(mode: "escape" | "neutral") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());

    for (let index = 0; index < JOURNEY.length; index += 1) {
      if (mode === "escape") {
        const toggle = [...container.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("딱 맞는 답이 없어요"));
        if (toggle) await act(async () => toggle.click());
      }
      const picked = mode === "escape"
        ? container.querySelector('input[value^="escape-"]')
        : container.querySelector('input[value$="neutral_impact"], input[value="bipolar-0"]');
      const fallback = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
      await act(async () => ((picked ?? fallback) as HTMLInputElement).click());
      await act(async () =>
        buttonByText(container, index === JOURNEY.length - 1 ? "지나온 장면 보기" : "다음").click());
      if (container.querySelector("[data-interlude]")) {
        await act(async () => buttonByText(container, "넘기기").click());
      }
    }
    await act(async () => buttonByText(container, "오늘 꺼낼 한 마디 고르기").click());
  }

  it("전 항목을 「딱 맞는 답이 없어요」로 넘겨도 후보가 그대로다", async () => {
    await walkWith("escape");
    expect(candidateIds(container)).toEqual([...EXPECTED_CANDIDATES]);
  });

  it("전 항목을 중립으로 답해도 후보가 그대로다", async () => {
    await walkWith("neutral");
    expect(candidateIds(container)).toEqual([...EXPECTED_CANDIDATES]);
  });
});
