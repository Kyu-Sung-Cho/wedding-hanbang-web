import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCandidate6Journey } from "../candidate6";
import { CANDIDATE6_SCENE_TEXT } from "../candidate6SceneText";
import { Candidate6Prototype } from "../Candidate6Prototype";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const JOURNEY = buildCandidate6Journey("A", "not_applicable", "ES_FIRST");

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

/** 회수 목록 행. 지문·카드가 아니라 목록의 구조만 본다. */
function recapRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-recap-row]")];
}

function sceneLabelPills(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-scene-label]")];
}

describe("회수 화면과 장면 라벨", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  /** 현재 문항에 답하고 다음으로. 마지막이면 회수 화면으로 넘어간다. */
  async function answerCurrent(isLast: boolean) {
    const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
    await act(async () => (choice as HTMLInputElement).click());
    await act(async () =>
      buttonByText(container, isLast ? "지나온 장면 보기" : "선택 확인하고 다음").click());
  }

  async function walkToRecap() {
    for (let index = 0; index < JOURNEY.length; index += 1) {
      await answerCurrent(index === JOURNEY.length - 1);
    }
  }

  // 이 설계의 최상위 불변식. 재미있는 지문이 M0 문항의 기준점을 옮기기 때문에
  // 측정 화면에는 우리 문장을 단 하나도 얹지 않는다 — 잘 쓸수록 더 위험하다.
  it("문항 화면에는 회수 문장도 장면 제목도 라벨도 없다", async () => {
    for (let index = 0; index < JOURNEY.length; index += 1) {
      const entry = CANDIDATE6_SCENE_TEXT[JOURNEY[index].id];
      const text = container.textContent ?? "";

      expect(sceneLabelPills(container), `문항 ${index + 1}에 라벨이 있다`).toHaveLength(0);
      expect(recapRows(container), `문항 ${index + 1}에 회수 행이 있다`).toHaveLength(0);
      for (const line of entry.recapLines ?? []) {
        expect(text, `문항 ${index + 1}에 회수 문장 "${line}"이 노출됐다`).not.toContain(line);
      }
      // 다른 문항의 문장도 미리 새면 안 된다.
      for (const other of Object.values(CANDIDATE6_SCENE_TEXT)) {
        for (const line of other.recapLines ?? []) {
          expect(text, `문항 ${index + 1}에 "${line}"이 노출됐다`).not.toContain(line);
        }
      }
      await answerCurrent(index === JOURNEY.length - 1);
    }
  });

  it("투여된 장면 전부가 journey 순서로 회수된다", async () => {
    await walkToRecap();

    expect(container.textContent).toContain("지나온 장면이에요");
    expect(container.textContent).toContain("저희가 해석한 게 아니라, 방금 지나오신 장면 그대로예요.");

    const rows = recapRows(container);
    expect(rows).toHaveLength(JOURNEY.length);
    expect(rows.map((row) => row.dataset.recapRow)).toEqual(JOURNEY.map((item) => item.id));
  });

  it("리뷰 플래그 항목은 우리 문장이 아니라 문항 원문을 그대로 쓴다", async () => {
    await walkToRecap();

    const flagged = JOURNEY.filter((item) => CANDIDATE6_SCENE_TEXT[item.id].recapLines === null);
    expect(flagged.length, "플래그 항목이 journey에 있어야 이 검사가 성립한다")
      .toBeGreaterThan(0);
    for (const item of flagged) {
      const row = recapRows(container).find((candidate) => candidate.dataset.recapRow === item.id);
      expect(row?.textContent, `${item.id} 원문 미출력`).toContain(item.scenario);
    }
  });

  // 라벨이 무언가를 바꾸면 그 순간 "특정 응답을 보상하는 장치"가 된다. 그래서 라벨은
  // 목록 길이·순서·본문·버튼을 1픽셀도 바꾸지 않는다. 표현일 뿐 잠그는 것이 없다.
  it("라벨을 하나도 안 붙였을 때와 전부 붙였을 때 목록이 완전히 같다", async () => {
    await walkToRecap();

    const snapshot = () => ({
      ids: recapRows(container).map((row) => row.dataset.recapRow),
      bodies: recapRows(container).map((row) => row.dataset.recapBody),
      buttons: [...container.querySelectorAll("button")].map((button) => button.textContent),
    });

    const none = snapshot();

    for (const pill of sceneLabelPills(container).filter((p) => p.dataset.sceneLabel === "ours")) {
      await act(async () => pill.click());
    }
    const allOurs = snapshot();

    for (const pill of sceneLabelPills(container).filter((p) => p.dataset.sceneLabel === "not-ours")) {
      await act(async () => pill.click());
    }
    const allNotOurs = snapshot();

    expect(allOurs).toEqual(none);
    expect(allNotOurs).toEqual(none);
  });

  it("두 라벨은 크기·전환 클래스가 완전히 같다 — 색 토큰만 다르다", async () => {
    await walkToRecap();

    const first = recapRows(container)[0];
    const ours = first.querySelector<HTMLElement>('[data-scene-label="ours"]');
    const notOurs = first.querySelector<HTMLElement>('[data-scene-label="not-ours"]');
    expect(ours).not.toBeNull();
    expect(notOurs).not.toBeNull();

    const withoutColors = (element: HTMLElement) =>
      element.className
        .split(/\s+/)
        .filter((token) => !/#[0-9A-Fa-f]{6}|text-white/.test(token))
        .sort()
        .join(" ");

    expect(withoutColors(notOurs!)).toBe(withoutColors(ours!));
  });

  it("라벨 두 종류가 같은 크기로 함께 있다 — 아니라고 말할 자리가 있다", async () => {
    await walkToRecap();

    expect(container.textContent).toContain("우리 얘기가 아닌 장면도 있어요");
    for (const row of recapRows(container)) {
      for (const kind of ["ours", "not-ours"] as const) {
        const pill = row.querySelector<HTMLElement>(`[data-scene-label="${kind}"]`);
        expect(pill, `${row.dataset.recapRow}에 ${kind} 라벨이 없다`).not.toBeNull();
        // 숨겨진 자리는 자리가 아니다. (2026-07-28 변이 검증: `hidden` 속성을 붙여도
        // querySelector는 찾으므로, 존재 검사만으로는 흡수 장치 제거를 못 잡았다.
        // 클래스로 숨기는 경로는 위의 대칭 검사가 잡는다.)
        expect(pill?.hidden, `${row.dataset.recapRow}의 ${kind} 라벨이 숨겨졌다`).toBe(false);
        expect(pill?.getAttribute("aria-hidden")).not.toBe("true");
      }
    }
  });

  it("회수 화면에 개수·퍼센트·해석 문구가 없다", async () => {
    await walkToRecap();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d+\s*개 표시|\d+\s*%|당신은|성향|점수|유형|궁합/);
  });
});

describe("지나온 장면 목차 시트", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("첫 장면에서는 아직 쌓인 것이 없다고 말한다", async () => {
    await act(async () => buttonByText(container, "지나온 장면").click());
    expect(container.textContent).toContain("아직 지나온 장면이 없어요");
    expect(sceneLabelPills(container)).toHaveLength(0);
  });

  // 중도이탈자는 회수 화면을 보지 못한다. 시트가 그 전에 만회 기회를 준다.
  it("지나온 장면만 쌓이고, 답 내용은 적지 않는다", async () => {
    for (let index = 0; index < 3; index += 1) {
      const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
      await act(async () => (choice as HTMLInputElement).click());
      await act(async () => buttonByText(container, "선택 확인하고 다음").click());
    }

    await act(async () => buttonByText(container, "지나온 장면").click());

    expect(container.textContent).toContain("답은 여기 적지 않아요. 장면 제목만 있어요.");
    const rows = recapRows(container);
    expect(rows.map((row) => row.dataset.recapRow)).toEqual(
      JOURNEY.slice(0, 3).map((item) => item.id));
    // 시트에는 회수 문장(Tier B)을 쓰지 않는다 — 아직 측정 중이다.
    for (const row of rows) {
      expect(row.dataset.recapBody ?? "").toBe("");
    }
  });
});
