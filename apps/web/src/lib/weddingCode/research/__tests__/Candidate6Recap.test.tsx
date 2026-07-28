import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCandidate6Journey, CANDIDATE6_RESEARCH_ITEMS } from "../candidate6";
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

  /**
   * 현재 문항에 답하고 다음으로. 마지막이면 회수 화면으로 넘어간다.
   * 사이에 막간이 끼면 넘긴다(자동 넘김이 없으므로 명시적으로 눌러야 한다).
   */
  async function answerCurrent(isLast: boolean) {
    const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
    await act(async () => (choice as HTMLInputElement).click());
    await act(async () =>
      buttonByText(container, isLast ? "지나온 장면 보기" : "선택 확인하고 다음").click());
    if (container.querySelector("[data-interlude]")) {
      await act(async () => buttonByText(container, "넘기기").click());
    }
  }

  async function walkToRecap() {
    for (let index = 0; index < JOURNEY.length; index += 1) {
      await answerCurrent(index === JOURNEY.length - 1);
    }
  }

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

  // 2026-07-28 감사: 이 검사가 **미선택 상태에서만** 돌아서 사실상 자기 자신과의
  // 비교였다. 그 상태에서 두 pill은 같은 상수(`sceneLabelBase + sceneLabelIdle`)로
  // 조립되므로 바이트 동일하다. 비대칭이 발생할 수 있는 유일한 상태(선택됨)를 함께 본다.
  it("두 라벨은 선택 전후 모두 크기·전환 클래스가 같다 — 색 토큰만 다르다", async () => {
    await walkToRecap();

    // 색 유틸만 정확히 걷어낸다. `#hex`만 거르면 `bg-white`가 남아 선택/미선택 비교에서
    // 거짓 비대칭이 생긴다(2026-07-28 실측). 크기 유틸 `text-[12px]`는 남겨야 한다.
    const isColorToken = (token: string) =>
      /^bg-/.test(token)
      || /^text-white$/.test(token)
      || /^text-\[#/.test(token)
      || /^border-\[#/.test(token);
    const withoutColors = (element: HTMLElement) =>
      element.className.split(/\s+/).filter((token) => !isColorToken(token)).sort().join(" ");

    const pillsOf = (row: HTMLElement) => ({
      ours: row.querySelector<HTMLElement>('[data-scene-label="ours"]')!,
      notOurs: row.querySelector<HTMLElement>('[data-scene-label="not-ours"]')!,
    });

    const first = recapRows(container)[0];
    const idle = pillsOf(first);
    expect(idle.ours).not.toBeNull();
    expect(idle.notOurs).not.toBeNull();
    expect(withoutColors(idle.notOurs), "미선택 상태 비대칭").toBe(withoutColors(idle.ours));

    // 각 라벨을 실제로 선택한 상태에서도 구조 클래스가 같아야 한다.
    for (const kind of ["ours", "not-ours"] as const) {
      const row = recapRows(container)[0];
      await act(async () => row.querySelector<HTMLElement>(`[data-scene-label="${kind}"]`)!.click());
      const selected = pillsOf(recapRows(container)[0]);
      expect(selected.ours.getAttribute("aria-pressed") === "true"
        || selected.notOurs.getAttribute("aria-pressed") === "true",
      `${kind} 선택이 반영되지 않았다`).toBe(true);
      expect(withoutColors(selected.notOurs), `${kind} 선택 상태 비대칭`)
        .toBe(withoutColors(selected.ours));
      // 다시 눌러 원상복구(같은 라벨 재클릭 = 해제).
      await act(async () =>
        recapRows(container)[0].querySelector<HTMLElement>(`[data-scene-label="${kind}"]`)!.click());
    }
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

/**
 * 이 설계의 **최상위 불변식**: 재미있는 지문이 M0 문항의 기준점을 옮기기 때문에
 * 측정 화면에는 우리가 저작한 문장을 단 하나도 얹지 않는다 — 잘 쓸수록 더 위험하다.
 *
 * 2026-07-28 독립 감사가 이 자리의 구멍을 찾았다: 이전 버전은 이름이 「장면 제목도
 * 없다」인데 `recapLines`만 검사해서, 문항 화면에 `sceneTitle`을 직접 렌더하는 변이가
 * 168/168 통과했다. 이제 저작 텍스트 **전부**(제목·회수문장·카드 3필드)를 검사하고
 * 기획서 §10 RED 1이 요구한 **4조합**(Form A/B × ES_FIRST/AS_FIRST)으로 돈다.
 */
describe("측정 화면 오염 차단 (4조합)", () => {
  /**
   * 저작 제목 중 일부는 문항 **원문**의 부분 문자열이다(예: SI1의 sceneTitle 「첫 초안」은
   * 그 문항 scenario 「축하 방식의 첫 초안을 만드는 장면」 안에 있다). 원문은 원래 문항
   * 화면에 나오는 것이므로 그것까지 금지하면 거짓 실패가 된다. 그래서 **원문에 없는
   * 제목만** 검사 대상으로 삼는다 — 나머지 제목·회수문장·카드는 전부 검사한다.
   */
  const ORIGINAL_CORPUS = CANDIDATE6_RESEARCH_ITEMS.map((item) => {
    const bag = item as unknown as Record<string, string | undefined>;
    return [bag.premise, bag.scenario, bag.prompt, bag.behavior, bag.leftAnchor, bag.rightAnchor, bag.chapter]
      .filter(Boolean)
      .join(" ");
  }).join(" ");

  const AUTHORED_STRINGS = Object.values(CANDIDATE6_SCENE_TEXT).flatMap((entry) => [
    ...(ORIGINAL_CORPUS.includes(entry.sceneTitle) ? [] : [entry.sceneTitle]),
    ...(entry.recapLines ?? []),
    ...(entry.card ? [entry.card.prompt, entry.card.when, entry.card.action] : []),
  ]);

  it("검사 대상이 충분히 남아 있다 — 전부 제외되면 이 검사는 공허하다", () => {
    expect(AUTHORED_STRINGS.length).toBeGreaterThan(60);
  });

  for (const form of ["A", "B"] as const) {
    for (const order of ["ES_FIRST", "AS_FIRST"] as const) {
      it(`Form ${form} · ${order} — 문항 화면에 저작 텍스트가 하나도 없다`, async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const hostRoot = createRoot(host);
        await act(async () =>
          hostRoot.render(<Candidate6Prototype form={form} supportPairOrder={order} />));
        await act(async () => radioInsideLabel(host, "둘이 정하기로 했어요").click());
        await act(async () => buttonByText(host, "장면 시작하기").click());

        const journey = buildCandidate6Journey(form, "not_applicable", order);
        for (let index = 0; index < journey.length; index += 1) {
          const text = host.textContent ?? "";
          expect(sceneLabelPills(host), `문항 ${index + 1}에 라벨이 있다`).toHaveLength(0);
          expect(recapRows(host), `문항 ${index + 1}에 회수 행이 있다`).toHaveLength(0);
          for (const authored of AUTHORED_STRINGS) {
            expect(text, `문항 ${index + 1}에 저작 텍스트 "${authored}"가 노출됐다`)
              .not.toContain(authored);
          }

          const choice = host.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
          await act(async () => (choice as HTMLInputElement).click());
          await act(async () =>
            buttonByText(host, index === journey.length - 1 ? "지나온 장면 보기" : "선택 확인하고 다음")
              .click());
          if (host.querySelector("[data-interlude]")) {
            await act(async () => buttonByText(host, "넘기기").click());
          }
        }

        await act(async () => hostRoot.unmount());
        host.remove();
      });
    }
  }
});

/**
 * 회수 화면이 **저작한 문장을 실제로 렌더하는지** 본다. 이전에는 행 id와 라벨 불변만
 * 검사해서, `bodyLines`를 문항 원문으로 되돌려 저작 카피 17항목×3줄을 통째로 폐기하는
 * 변이가 통과했다(2026-07-28 감사). 스냅샷 비교는 `data-recap-body`가 같은 prop에서
 * 파생돼 양변이 함께 움직이므로 이 소실을 못 잡는다.
 */
describe("회수 화면이 저작 문장을 실제로 보여준다", () => {
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
        buttonByText(container, index === JOURNEY.length - 1 ? "지나온 장면 보기" : "선택 확인하고 다음")
          .click());
      if (container.querySelector("[data-interlude]")) {
        await act(async () => buttonByText(container, "넘기기").click());
      }
    }
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("비플래그 항목의 회수 문장과 제목이 화면에 그대로 있다", () => {
    const text = container.textContent ?? "";
    const authored = JOURNEY.filter((item) => CANDIDATE6_SCENE_TEXT[item.id].recapLines !== null);
    expect(authored.length, "검사 대상이 없으면 공허하다").toBeGreaterThan(10);

    for (const item of authored) {
      const entry = CANDIDATE6_SCENE_TEXT[item.id];
      expect(text, `${item.id} 제목 누락`).toContain(entry.sceneTitle);
      for (const line of entry.recapLines ?? []) {
        expect(text, `${item.id} 회수 문장 "${line}" 누락`).toContain(line);
      }
    }
  });
});

/**
 * 목차 시트 접근성. 이 시트는 기획서 §6-7이 「중도이탈자에게 회수 전 만회 기회를
 * 준다」고 못 박은, 알아봄 각도의 최대 약점을 메우는 장치다. 키보드·스크린리더
 * 사용자에게 그 기회가 닫혀 있으면 장치가 없는 것과 같다. (2026-07-28 감사 지적)
 */
describe("목차 시트 접근성", () => {
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

  const trigger = () => buttonByText(container, "지나온 장면");

  it("트리거가 열림 상태를 보조기술에 알린다", async () => {
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    const controls = trigger().getAttribute("aria-controls");
    expect(controls, "aria-controls가 없다").toBeTruthy();
    expect(container.querySelector(`#${controls}`), "가리키는 시트가 없다").not.toBeNull();
  });

  it("시트가 dialog로 선언되고 이름을 가진다", async () => {
    await act(async () => trigger().click());
    const sheet = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute("aria-modal")).toBe("true");
    const labelledBy = sheet?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toContain("지나온 장면");
  });

  it("Escape로 닫히고 포커스가 트리거로 돌아온다", async () => {
    await act(async () => trigger().click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]'), "Escape로 안 닫힌다").toBeNull();
    expect(document.activeElement, "포커스가 트리거로 안 돌아왔다").toBe(trigger());
  });
});

/**
 * 회수 이후 되돌아갈 길. 카드를 잘못 확정하면 19~21개 답을 전부 날리는 전면 재시작밖에
 * 없었다(2026-07-28 감사 지적). 답을 보존한 채 한 걸음씩 되돌아갈 수 있어야 한다.
 */
describe("회수 이후 뒤로 가기", () => {
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
        buttonByText(container, index === JOURNEY.length - 1 ? "지나온 장면 보기" : "선택 확인하고 다음")
          .click());
      if (container.querySelector("[data-interlude]")) {
        await act(async () => buttonByText(container, "넘기기").click());
      }
    }
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("카드 고르기에서 회수로 돌아온다 — 답은 그대로다", async () => {
    await act(async () => buttonByText(container, "오늘 꺼낼 한 마디 고르기").click());
    expect(container.textContent).toContain("오늘 꺼낼 한 마디를 골라주세요");

    await act(async () => buttonByText(container, "이전").click());
    expect(container.textContent, "회수 화면으로 안 돌아왔다").toContain("지나온 장면이에요");
    expect(recapRows(container), "답이 날아갔다").toHaveLength(JOURNEY.length);
  });

  it("주는 카드에서 내 카드 고르기로 돌아온다", async () => {
    await act(async () => buttonByText(container, "오늘 꺼낼 한 마디 고르기").click());
    await act(async () =>
      container.querySelector<HTMLElement>("[data-card-candidate]")!.click());
    await act(async () => buttonByText(container, "이 카드로 정하기").click());
    expect(container.textContent).toContain("이번엔 상대가 나한테 물어줄 한 마디를 골라주세요");

    await act(async () => buttonByText(container, "이전").click());
    expect(container.textContent, "내 카드 고르기로 안 돌아왔다")
      .toContain("오늘 꺼낼 한 마디를 골라주세요");
  });
});

/**
 * 2차 감사 M3: 시트 제목의 **인라인 콜백 ref**가 리렌더마다 재실행돼, 시트 안에서
 * 라벨을 누를 때마다 포커스를 제목으로 되빼앗았다. 라벨 토글이 부모 `sceneLabels`를
 * 바꿔 시트를 리렌더하므로 매 클릭 재현된다. 1차 접근성 수정이 스스로 만든 회귀다.
 *
 * 기존 접근성 3건(열림 상태·dialog 이름·Escape 복귀)은 토글 **이후** 포커스를 보지
 * 않아 전부 통과했다.
 */
describe("목차 시트에서 라벨을 눌러도 포커스를 뺏기지 않는다", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Candidate6Prototype form="A" />));
    await act(async () => radioInsideLabel(container, "둘이 정하기로 했어요").click());
    await act(async () => buttonByText(container, "장면 시작하기").click());
    for (let index = 0; index < 3; index += 1) {
      const choice = container.querySelector('input[value^="bipolar-"], input[value^="impact-"]');
      await act(async () => (choice as HTMLInputElement).click());
      await act(async () => buttonByText(container, "선택 확인하고 다음").click());
      if (container.querySelector("[data-interlude]")) {
        await act(async () => buttonByText(container, "넘기기").click());
      }
    }
    await act(async () => buttonByText(container, "지나온 장면").click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("열 때는 제목으로 포커스가 간다", () => {
    expect(document.activeElement?.id).toBe("candidate6-contents-sheet-title");
  });

  it("라벨을 연속으로 눌러도 포커스가 그 라벨에 남는다", async () => {
    const pills = [...container.querySelectorAll<HTMLElement>('[data-scene-label="ours"]')];
    expect(pills.length, "시트에 라벨이 없으면 이 검사는 공허하다").toBeGreaterThan(1);

    for (const pill of pills) {
      pill.focus();
      await act(async () => pill.click());
      expect(document.activeElement, "포커스가 제목으로 튀었다").toBe(pill);
      expect(pill.getAttribute("aria-pressed"), "토글이 반영되지 않았다").toBe("true");
    }
  });
});
