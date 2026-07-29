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
      .toContain("지나온 장면에서 고르는 거예요. 답이나 라벨로 걸러내지 않았어요.");
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
      expect(container.textContent).toContain("저희는 이 카드를 보관하지 않았어요.");
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
      expect(container.textContent).toContain("상대가 아무것도 안 해도 이 화면은 그대로예요.");

      const preview = container.querySelector<HTMLElement>("[data-invite-copy]");
      expect(preview?.dataset.inviteCopy).toBe(card?.prompt);
      expect(preview?.textContent).toContain(card?.prompt);
      expect(preview?.dataset.inviteCopy).not.toMatch(/http|hanbang|웨딩코드|한방/);
      // 장면 제목·라벨·답이 새어나가지 않는다.
      expect(preview?.dataset.inviteCopy)
        .not.toContain(CANDIDATE6_SCENE_TEXT[firstId].sceneTitle);
      expect(preview?.dataset.inviteCopy).not.toMatch(/우리 얘기|우리 얘긴 아니에요/);
    });

    // `58_candidate6_product_research_contract`:163이 clipboard를 평문 금지하고 그 문서는
    // README 권위 순서 2순위다. 화면이 이미 「말로 건네는 초대만 있어요」라고 말하므로
    // 제거가 더 일관된다. 없는 기능을 찾아 헤매지 않도록 **없다는 사실을 화면이 말하는지**
    // 함께 본다.
    it("복사 경로가 없고, 없다는 사실을 화면이 말한다", async () => {
      await reachCard();
      await act(async () => buttonByText(container, "한 마디 건네기").click());

      expect(container.textContent)
        .toContain("이 화면은 아무것도 복사하지 않아요. 위 한 줄을 보고 그대로 말해주세요.");
      const labels = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
      expect(
        labels.some((text) => text.includes("복사")),
        `복사 버튼이 남아 있다: ${labels.join(" / ")}`,
      ).toBe(false);
      expect(buttonByText(container, "카드로 돌아가기")).toBeTruthy();
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

/**
 * 파운더가 승인한 결정 2: **넘겨주기(S8)는 R4(독립 동의 커플 3쌍) 통과 뒤로 미루되
 * 코드에는 넣고 dev 플래그로 잠근다.**
 *
 * 2026-07-29 확인: 이 결정이 승인됐는데 **코드에 아예 없었다.** 나는 「미구현(의도적)」으로
 * 보고했지만 승인된 것은 「미구현」이 아니라 「구현 후 잠금」이었다. 잠금은 prop 기본값
 * `false`로 건다 — 상수로 잠그면 잠긴 화면 자체를 검증할 수 없어 또 다른 미검증 코드가 된다.
 */
describe("넘겨주기는 기본으로 잠겨 있다", () => {
  let root: Root;
  let container: HTMLDivElement;

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function reachCardFace(handoffPreview: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(<Candidate6Prototype form="A" handoffPreview={handoffPreview} />));
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
    await act(async () => candidateRows(container)[0].click());
    await act(async () => buttonByText(container, "이 카드로 정하기").click());
    await act(async () => buttonByText(container, "이번엔 안 고를게요").click());
  }

  it("기본값에서는 넘겨주기 경로가 화면에 없다", async () => {
    await reachCardFace(false);
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.some((t) => t.includes("넘겨주기")), labels.join(" / ")).toBe(false);
  });

  it("켜면 진입 전 확인을 먼저 거친다 — 제2인 투여는 명시적이어야 한다", async () => {
    await reachCardFace(true);
    await act(async () => buttonByText(container, "휴대폰 넘겨주기").click());
    expect(container.textContent)
      .toContain("이 화면을 상대에게 보여줄까요? 상대가 고른 건 저장되지 않아요.");
  });

  // 거절 경로가 순응 버튼보다 작으면 그건 선택지가 아니라 압박이다.
  it("켜면 거절 3경로가 같은 크기로 있고, 어느 쪽이든 내 화면이 같다", async () => {
    await reachCardFace(true);
    await act(async () => buttonByText(container, "휴대폰 넘겨주기").click());
    await act(async () => buttonByText(container, "보여줄게요").click());

    expect(container.querySelectorAll("input"), "넘겨준 화면에 입력 필드가 있다").toHaveLength(0);
    const sizeOf = (t: string) =>
      buttonByText(container, t).className.split(/\s+/)
        .filter((k) => /^min-h-|^flex-1$/.test(k)).sort().join(" ");
    expect(sizeOf("나중에 할래요")).toBe(sizeOf("읽었어요"));
    expect(sizeOf("안 할래요")).toBe(sizeOf("읽었어요"));

    // 세 경로 모두 같은 곳으로, 같은 문구로 돌아온다 — 파트너 행동이 내 상태를 바꾸지 않는다.
    const returns: string[] = [];
    for (const path of ["읽었어요", "나중에 할래요", "안 할래요"]) {
      if (!container.textContent?.includes("지금 이 폰을 준 사람이")) {
        await act(async () => buttonByText(container, "휴대폰 넘겨주기").click());
        await act(async () => buttonByText(container, "보여줄게요").click());
      }
      await act(async () => buttonByText(container, path).click());
      returns.push(container.textContent ?? "");
    }
    for (const text of returns) {
      expect(text).toContain("어땠는지는 묻지 않을게요. 저장할 곳이 없어서요.");
    }
  });
});
