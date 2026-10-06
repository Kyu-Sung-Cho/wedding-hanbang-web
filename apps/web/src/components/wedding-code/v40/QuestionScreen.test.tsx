import { useMemo, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_LETTERS, guideKeyOf, type GuideKey } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { V40_COPY, formatGuideRepeatsStem, splitRemainingNotice } from "@/lib/weddingCode/v40/copy";
import {
  buildPages,
  createFlowReducer,
  initialFlowState,
  progressSegments,
  viewAnswerOf,
} from "@/lib/weddingCode/v40/flow";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { fromStored, present } from "@/lib/weddingCode/v40/present";
import type {
  FlowAction,
  FlowState,
  ItemView,
  Page,
  QuestionsPage,
  ViewAnswer,
} from "@/lib/weddingCode/v40/types";
import { click, createHarness, isBefore, labelProblemsIn, pressKey, radiosIn, type Harness } from "./inputTestKit";
import { QuestionScreen } from "./QuestionScreen";
import { RestCard } from "./RestCard";
import { SelfIntroCard } from "./SelfIntroCard";
import { hasDash, notValidatedCount, settle, visibleNumberProblems } from "./startFlowTestKit";

const bank = WEDDING_CODE_V40_BANK;
const reducer = createFlowReducer(bank);

function startedState(actions: readonly FlowAction[] = [], formBit: 0 | 1 = 0): FlowState {
  let state = reducer(initialFlowState(bank), { type: "start", formBit });
  for (const action of actions) state = reducer(state, action);
  return state;
}

function questionPages(): QuestionsPage[] {
  return buildPages(bank).filter((page): page is QuestionsPage => page.kind === "questions");
}

function viewsOf(page: QuestionsPage, formBit: 0 | 1 = 0): ItemView[] {
  return page.itemIds.map((id) => present(bank.byId.get(id)!, formBit));
}

/** 진짜 reducer 로 화면을 구동하는 부모. 질문 화면, 쉬는 카드, 마지막 정리 카드를 쪽 종류대로 그린다. */
function FlowHost({
  initialActions = [],
  embedded = false,
  saveState = null,
  receivedNote = false,
  onState,
  onLeaveEdit,
}: {
  readonly initialActions?: readonly FlowAction[];
  readonly embedded?: boolean;
  readonly saveState?: "saved" | "off" | "unavailable" | "conflict" | null;
  readonly receivedNote?: boolean;
  readonly onState?: (state: FlowState) => void;
  readonly onLeaveEdit?: () => void;
}) {
  const [state, dispatch] = useReducer(reducer, initialActions, (actions) => startedState(actions));
  onState?.(state);
  const page: Page = state.pages[state.pageIndex];
  const segments = useMemo(() => progressSegments(bank, state), [state]);
  if (page.kind === "rest") {
    return (
      <RestCard
        after={page.after}
        segments={segments}
        saveState="saved"
        embedded={embedded}
        onContinue={() => dispatch({ type: "next" })}
        onBack={() => dispatch({ type: "back" })}
      />
    );
  }
  if (page.kind === "selfIntro") {
    return (
      <SelfIntroCard
        segments={segments}
        embedded={embedded}
        onContinue={() => dispatch({ type: "next" })}
        onBack={() => dispatch({ type: "back" })}
      />
    );
  }
  if (page.kind !== "questions") return <p data-testid="not-a-question-page">{page.kind}</p>;
  const answers: Record<string, ViewAnswer | null> = {};
  for (const id of page.itemIds) answers[id] = viewAnswerOf(bank, state, id);
  const next = state.pages[state.pageIndex + 1];
  const canGoBack = state.filter !== null || state.pageIndex > 1;
  const nextIsResult = state.filter !== null ? state.pageIndex === state.pages.length - 1 : next?.kind === "result";
  return (
    <QuestionScreen
      page={page}
      views={viewsOf(page, state.formBit)}
      answers={answers}
      notice={state.notice}
      segments={segments}
      filter={state.filter}
      canGoBack={canGoBack}
      nextIsResult={nextIsResult}
      embedded={embedded}
      saveState={saveState}
      receivedNote={receivedNote}
      onAnswer={(itemId, answer) => dispatch({ type: "answer", itemId, answer })}
      onNext={() => dispatch({ type: "next" })}
      onBack={() => dispatch({ type: "back" })}
      onLeaveEdit={onLeaveEdit ?? (() => dispatch({ type: "closeFilter" }))}
    />
  );
}

describe("QuestionScreen", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  const text = () => harness.container.textContent ?? "";
  const buttons = () => [...harness.container.querySelectorAll<HTMLButtonElement>("button")];
  const buttonNamed = (name: string) => buttons().find((button) => button.textContent?.trim() === name);
  const nextButton = () => harness.container.querySelector<HTMLButtonElement>('[data-nav="next"]')!;
  const previousButton = () => harness.container.querySelector<HTMLButtonElement>('[data-nav="previous"]');
  const pageKey = () => harness.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
  const frames = () => [...harness.container.querySelectorAll<HTMLElement>('[data-item]')];
  const itemEl = (id: string) => harness.container.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
  /** 한 문항의 덜 채움 안내 자리(입력이 그리는 aria-live 영역). */
  const incompleteText = (id: string) =>
    itemEl(id).querySelector<HTMLElement>(`#q-${id.replace(/\./g, "-")}-incomplete`)?.textContent ?? "";

  const withoutQuestionNumbers = () => {
    const copy = harness.container.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-question-number]").forEach((node) => node.remove());
    return copy;
  };

  describe("쪽 그리기", () => {
    it("첫 화면은 두 문항이고 문항마다 틀(그룹)과 입력이 있다", async () => {
      const state = startedState();
      const page = state.pages[state.pageIndex] as QuestionsPage;
      expect(page.itemIds).toHaveLength(2);
      await harness.render(<FlowHost />);
      expect(frames().map((frame) => frame.getAttribute("data-item"))).toEqual([...page.itemIds]);
      expect(harness.container.querySelectorAll('[role="group"]').length).toBeGreaterThanOrEqual(2);
      for (const id of page.itemIds) {
        expect(itemEl(id).textContent).toContain(bank.byId.get(id)!.caption);
        expect(itemEl(id).textContent).toContain(V40_COPY.question.unsureButton);
        expect(itemEl(id).textContent).toContain(V40_COPY.question.notApplicableButton);
      }
    });

    it("문항 뷰가 빠진 id 는 그리지 않고 던지지 않는다", async () => {
      const [first] = questionPages();
      await harness.render(
        <QuestionScreen
          page={first}
          views={[viewsOf(first)[0]]}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack={false}
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(frames()).toHaveLength(1);
    });

    it("문항 뷰는 순서가 달라도 view.id 로 짝지어 쪽의 순서대로 그린다", async () => {
      const [first] = questionPages();
      const views = viewsOf(first).reverse();
      await harness.render(
        <QuestionScreen
          page={first}
          views={views}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack={false}
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(frames().map((frame) => frame.getAttribute("data-item"))).toEqual([...first.itemIds]);
    });

    it("진행 막대가 위에 있고 지금 구간 이름 하나만 보인다", async () => {
      await harness.render(<FlowHost />);
      const bar = harness.container.querySelector('[role="progressbar"]')!;
      expect(bar).not.toBeNull();
      expect(isBefore(bar, frames()[0])).toBe(true);
      expect(bar.getAttribute("aria-valuetext")).toBe(V40_COPY.progress.sectionAnnouncements[0]);
      expect(harness.container.querySelectorAll("[data-segment-name]")).toHaveLength(1);
    });

    it("화면 영역의 이름은 지금 구간 알림이다", async () => {
      await harness.render(<FlowHost />);
      expect(harness.container.querySelector("section")?.getAttribute("aria-label")).toBe(
        V40_COPY.progress.sectionAnnouncements[0],
      );
    });

    it("화면이 뜨면 화면 뿌리로 초점이 가고 쪽이 바뀔 때마다 다시 간다", async () => {
      await harness.render(<FlowHost />);
      const root = harness.container.querySelector("section")!;
      expect(document.activeElement).toBe(root);
      // 문항 하나에 답하고 다음으로 가기 전에 초점이 다른 곳(넘기기 단추)에 있게 한다.
      const [first] = questionPages();
      for (const id of first.itemIds) await click(itemEl(id).querySelector<HTMLButtonElement>("button[aria-pressed]"));
      nextButton().focus();
      const before = pageKey();
      await click(nextButton());
      expect(pageKey()).not.toBe(before);
      expect(document.activeElement).toBe(harness.container.querySelector("section"));
    });
  });

  describe("자동으로 넘어가지 않는다", () => {
    it("답을 골라도 같은 쪽에 머문다", async () => {
      await harness.render(<FlowHost />);
      const before = pageKey();
      const radios = radiosIn(harness.container);
      expect(radios.length).toBeGreaterThan(0);
      await click(radios[0]);
      expect(radios[0].getAttribute("aria-checked")).toBe("true");
      await settle();
      expect(pageKey()).toBe(before);
    });

    it("넘기기 단추(잘 모르겠어요)를 눌러도 같은 쪽에 머문다", async () => {
      await harness.render(<FlowHost />);
      const before = pageKey();
      await click(buttonNamed(V40_COPY.question.unsureButton));
      await settle();
      expect(pageKey()).toBe(before);
    });

    it("두 문항을 모두 채우고 다음을 눌러야 다음 쪽으로 간다", async () => {
      await harness.render(<FlowHost />);
      const before = pageKey();
      for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
      expect(pageKey()).toBe(before);
      await click(nextButton());
      expect(pageKey()).not.toBe(before);
    });
  });

  describe("이전과 다음 단추", () => {
    it("첫 질문 화면에는 이전 단추가 없고(소개로 돌아가지 않는다) 다음은 언제나 있다", async () => {
      await harness.render(<FlowHost />);
      expect(previousButton()).toBeNull();
      expect(nextButton().textContent?.trim()).toBe(V40_COPY.question.nextButton);
    });

    it("다음 단추는 꺼져 있지 않다: 아무것도 고르지 않아도 누를 수 있다", async () => {
      await harness.render(<FlowHost />);
      const next = nextButton();
      expect(next.type).toBe("button");
      expect(next.disabled).toBe(false);
      expect(next.getAttribute("aria-disabled")).toBeNull();
    });

    it("둘째 쪽에서는 이전이 나오고 눌러서 첫 쪽으로 돌아가며 답이 남아 있다", async () => {
      await harness.render(<FlowHost />);
      const firstKey = pageKey();
      for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
      await click(nextButton());
      expect(previousButton()).not.toBeNull();
      expect(previousButton()!.textContent?.trim()).toBe(V40_COPY.question.previousButton);
      await click(previousButton());
      expect(pageKey()).toBe(firstKey);
      const pressed = [...harness.container.querySelectorAll('button[aria-pressed="true"]')];
      expect(pressed).toHaveLength(2);
    });

    it("결과로 가는 쪽에서는 다음 단추 이름이 결과 보기다", async () => {
      const [first] = questionPages();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          nextIsResult
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(nextButton().textContent?.trim()).toBe(V40_COPY.question.resultButton);
    });

    it("콜백을 부른다: 답은 문항 id 와 함께, 다음과 이전은 인자 없이", async () => {
      const [first] = questionPages();
      const onAnswer = vi.fn();
      const onNext = vi.fn();
      const onBack = vi.fn();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          onAnswer={onAnswer}
          onNext={onNext}
          onBack={onBack}
        />,
      );
      await click(itemEl(first.itemIds[0]).querySelector<HTMLButtonElement>("button[aria-pressed]"));
      expect(onAnswer).toHaveBeenCalledWith(first.itemIds[0], { fmt: "escape", which: "unsure" });
      await click(nextButton());
      expect(onNext).toHaveBeenCalledTimes(1);
      await click(previousButton());
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("단추 줄은 문항 입력과 넘기기 단추 뒤에 있어서 키보드 순서가 문항, 이전, 다음이다", async () => {
      const [first] = questionPages();
      const fill = first.itemIds.map((itemId): FlowAction => ({ type: "answer", itemId, answer: { fmt: "escape", which: "unsure" } }));
      await harness.render(<FlowHost initialActions={[...fill, { type: "next" }]} />);
      const bar = harness.container.querySelector("[data-action-bar]")!;
      const lastItem = frames()[frames().length - 1];
      expect(isBefore(lastItem, bar)).toBe(true);
      expect(isBefore(previousButton()!, nextButton())).toBe(true);
    });
  });

  describe("형식 안내 한 줄과 어른 안내", () => {
    it("쪽 데이터가 말하는 형식에만, 그 형식의 첫 문항에 한 번 붙는다(모든 질문 화면)", async () => {
      const pages = questionPages();
      for (const page of pages) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        const shown = [...harness.container.querySelectorAll<HTMLElement>('[id$="-hint"]')].map((element) => element.textContent);
        const expected: string[] = [];
        const seen = new Set<GuideKey>();
        for (const id of page.itemIds) {
          const key = guideKeyOf(bank.byId.get(id)!.fmt);
          if (key !== null && page.guides.includes(key) && !seen.has(key)) {
            seen.add(key);
            // 앞말이 이미 같은 안내를 했으면 그 아래에 같은 말을 되풀이하지 않는다(칸 나누기 앞말 다수).
            if (!formatGuideRepeatsStem(V40_COPY.question.guides[key], bank.byId.get(id)!.stem)) expected.push(V40_COPY.question.guides[key]);
          }
        }
        expect(shown, page.key).toEqual(expected);
      }
    });

    it("전체 흐름에서 같은 형식 안내가 두 번 나오는 쪽이 없다", async () => {
      const seen = new Map<string, string>();
      for (const page of questionPages()) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        for (const element of harness.container.querySelectorAll<HTMLElement>('[id$="-hint"]')) {
          const line = element.textContent ?? "";
          expect(seen.has(line), `${page.key} / ${seen.get(line)}`).toBe(false);
          seen.set(line, page.key);
        }
      }
      // 안내가 나오지 않은 형식은 첫 문항의 앞말이 이미 같은 말을 한 형식뿐이다.
      const suppressed = Object.keys(V40_COPY.question.guides).length - seen.size;
      expect(suppressed).toBeGreaterThanOrEqual(0);
      for (const key of Object.keys(V40_COPY.question.guides) as GuideKey[]) {
        if (seen.has(V40_COPY.question.guides[key])) continue;
        const firstPage = questionPages().find((page) => page.guides.includes(key))!;
        const firstId = firstPage.itemIds.find((id) => guideKeyOf(bank.byId.get(id)!.fmt) === key)!;
        expect(formatGuideRepeatsStem(V40_COPY.question.guides[key], bank.byId.get(firstId)!.stem), key).toBe(true);
      }
    });

    it("앞말이 형식 안내와 같은 말을 이미 했으면(칸 나누기) 안내를 그리지 않고, 다른 말이면 그린다", async () => {
      const source = questionPages().find((page) => page.guides.includes("split"));
      expect(source, "칸 나누기가 처음 나오는 쪽이 배치에 있어야 한다").toBeDefined();
      const page: QuestionsPage = { ...source!, guides: ["split"] };
      const render = async (stem: string) => {
        const views = viewsOf(page).map((view) => (view.fmt === "split" ? { ...view, stem } : view));
        await harness.render(
          <QuestionScreen
            key={stem}
            page={page}
            views={views}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        return [...harness.container.querySelectorAll<HTMLElement>('[id$="-hint"]')].map((element) => element.textContent);
      };
      // 앞말이 「여섯 칸을 나눠 놓아 주세요. 한 곳에 몰아도 괜찮아요.」로 끝나면 같은 말을 두 번 읽히지 않는다.
      expect(await render("오늘 정말 힘든 하루였어요. 여섯 칸을 나눠 놓아 주세요. 한 곳에 몰아도 괜찮아요.")).toEqual([]);
      // 앞말이 그 말을 하지 않으면 안내가 나온다.
      expect(await render("오늘 정말 힘든 하루였어요. 어떤 반응이 반가운지 정해 주세요.")).toEqual([V40_COPY.question.guides.split]);
      // 일부만 겹치면(한 문장만) 그대로 안내가 나온다.
      expect(await render("여섯 칸을 나눠 놓아 주세요.")).toEqual([V40_COPY.question.guides.split]);
    });

    it("한 쪽에 같은 안내 형식의 문항이 둘이면 안내는 첫 문항에만 한 번 붙는다", async () => {
      // 고르기 형식(그때 나는, 지난 일 떠올리기)이 한 쪽에 둘인 쪽을, 그 형식이 처음 나오는 쪽인 것처럼 만든다.
      const source = questionPages().find(
        (page) => page.itemIds.length === 2 && page.itemIds.every((id) => guideKeyOf(bank.byId.get(id)!.fmt) === "choose"),
      );
      expect(source, "고르기 두 문항 쪽이 배치에 있어야 한다").toBeDefined();
      const page: QuestionsPage = { ...source!, guides: ["choose"] };
      await harness.render(
        <QuestionScreen
          page={page}
          views={viewsOf(page)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      const hints = [...harness.container.querySelectorAll<HTMLElement>('[id$="-hint"]')];
      expect(hints.map((hint) => hint.textContent)).toEqual([V40_COPY.question.guides.choose]);
      expect(itemEl(page.itemIds[0]).contains(hints[0])).toBe(true);
    });

    it("guides 가 비어 있는 쪽(다시 보기 필터)에는 안내가 없다", async () => {
      const [first] = questionPages();
      const page: QuestionsPage = { ...first, guides: [], elderHint: false };
      await harness.render(
        <QuestionScreen
          page={page}
          views={viewsOf(page)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(harness.container.querySelectorAll('[id$="-hint"]')).toHaveLength(0);
    });

    it("가까운 어른 안내는 정하는 사람 주제의 첫 문항 위에 한 번만 있다", async () => {
      const pages = questionPages();
      const withElder = pages.filter((page) => page.elderHint);
      expect(withElder).toHaveLength(1);
      for (const page of pages) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        const hints = harness.container.querySelectorAll<HTMLElement>("[data-elder-hint]");
        expect(hints.length, page.key).toBe(page.elderHint ? 1 : 0);
        if (page.elderHint) {
          const hint = hints[0];
          expect(hint.textContent).toBe(V40_COPY.question.elderHint);
          const owner = hint.closest<HTMLElement>("[data-item]")!;
          expect(owner.getAttribute("data-item")).toMatch(/^scope\./);
          expect(isBefore(hint, owner.querySelector('[role="group"]')!)).toBe(true);
        }
      }
    });
  });

  describe("어른 안내의 자리", () => {
    it("정하는 사람 문항이 쪽의 둘째이면 어른 안내는 둘째 문항 위에 붙는다", async () => {
      const [first] = questionPages();
      const page: QuestionsPage = { ...first, itemIds: ["money.limit.1", "scope.final.1"], guides: [], elderHint: true };
      await harness.render(
        <QuestionScreen
          page={page}
          views={viewsOf(page)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      const hint = harness.container.querySelector<HTMLElement>("[data-elder-hint]")!;
      expect(itemEl("scope.final.1").contains(hint)).toBe(true);
      expect(itemEl("money.limit.1").contains(hint)).toBe(false);
      expect(isBefore(hint, itemEl("scope.final.1").querySelector('[role="group"]')!)).toBe(true);
    });

    it("정하는 사람 문항이 없는 쪽이면 첫 문항 위에 붙는다", async () => {
      const [first] = questionPages();
      const page: QuestionsPage = { ...first, guides: [], elderHint: true };
      await harness.render(
        <QuestionScreen
          page={page}
          views={viewsOf(page)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(itemEl(page.itemIds[0]).querySelector("[data-elder-hint]")).not.toBeNull();
      expect(harness.container.querySelectorAll("[data-elder-hint]")).toHaveLength(1);
    });

    it("자기 선택 정하는 사람 문항도 정하는 사람 문항으로 본다", async () => {
      const [first] = questionPages();
      const page: QuestionsPage = { ...first, itemIds: ["self.process", "self.scope"], section: 4, guides: [], elderHint: true };
      await harness.render(
        <QuestionScreen
          page={page}
          views={viewsOf(page)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(itemEl("self.scope").querySelector("[data-elder-hint]")).not.toBeNull();
    });
  });

  describe("모든 질문 화면의 보이는 글자", () => {
    it("각 문항에는 고정 질문 번호가 있고 선택지 번호와 A/B 라벨은 없다", async () => {
      for (const page of questionPages()) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            receivedNote
            saveState="saved"
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        // 칸 나누기 안내(「6칸을 나눠 놓아 주세요」)의 6은 나눠 놓을 칸 수를 말하는 상수라서(V40_SPLIT_TOTAL) 그 한 줄만 뺀다.
        expect([...harness.container.querySelectorAll<HTMLElement>("[data-question-number]")].map((node) => Number(node.dataset.questionNumber))).toEqual(
          page.itemIds.map((id) => bank.items.findIndex((item) => item.id === id) + 1),
        );
        expect(visibleNumberProblems(withoutQuestionNumbers(), [V40_COPY.question.guides.split]), page.key).toEqual([]);
      }
    });

    it("글자 이름, 고지, 줄표가 없다(주장으로 쓰지 않는 말은 startFlowScreens.hygiene.test.tsx 가 본다)", async () => {
      for (const page of questionPages()) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        const shown = text();
        expect(notValidatedCount(harness.container), page.key).toBe(0);
        for (const letter of V40_LETTERS) expect(shown, `${page.key} ${letter.name}`).not.toContain(letter.name);
        expect(hasDash(shown), page.key).toBe(false);
      }
    });

  });

  describe("덜 채웠을 때", () => {
    it("아무것도 고르지 않고 다음을 누르면 쪽에 머물고 두 문항 모두 안내를 받는다", async () => {
      await harness.render(<FlowHost />);
      const [first] = questionPages();
      const before = pageKey();
      await click(nextButton());
      expect(pageKey()).toBe(before);
      // 안내는 잠깐 거짓이었다가 다시 참이 되며 나온다.
      for (const id of first.itemIds) expect(incompleteText(id)).toBe("");
      await settle();
      for (const id of first.itemIds) expect(incompleteText(id)).toBe(V40_COPY.question.incomplete);
    });

    it("첫 덜 채운 문항의 입력으로 초점을 옮긴다", async () => {
      await harness.render(<FlowHost />);
      const [first] = questionPages();
      // 첫 문항을 채우고 둘째만 비워 둔다.
      await click(itemEl(first.itemIds[0]).querySelector<HTMLButtonElement>("button[aria-pressed]"));
      await click(nextButton());
      await settle();
      const active = document.activeElement as HTMLElement;
      expect(itemEl(first.itemIds[1]).contains(active)).toBe(true);
      expect(active.getAttribute("aria-pressed")).toBeNull();
      expect(active.getAttribute("role") === "radio" || active.tagName === "INPUT" || active.tagName === "BUTTON").toBe(true);
      // 채운 문항은 안내를 받지 않는다.
      expect(incompleteText(first.itemIds[0])).toBe("");
      expect(incompleteText(first.itemIds[1])).toBe(V40_COPY.question.incomplete);
    });

    it("다음을 또 눌러도 같은 안내가 다시 읽히게 안내를 잠깐 비웠다가 다시 채운다", async () => {
      await harness.render(<FlowHost />);
      const [first] = questionPages();
      const id = first.itemIds[0];
      const region = () => itemEl(id).querySelector<HTMLElement>(`#q-${id.replace(/\./g, "-")}-incomplete`)!;
      const seen: string[] = [];
      const observer = new MutationObserver(() => seen.push(region().textContent ?? ""));
      await click(nextButton());
      await settle();
      expect(incompleteText(id)).toBe(V40_COPY.question.incomplete);
      observer.observe(region(), { childList: true, characterData: true, subtree: true });
      await click(nextButton());
      // 누르자마자 비워진다.
      expect(incompleteText(id)).toBe("");
      await settle();
      expect(incompleteText(id)).toBe(V40_COPY.question.incomplete);
      observer.disconnect();
      expect(seen).toContain("");
      expect(seen[seen.length - 1]).toBe(V40_COPY.question.incomplete);
    });

    it("부모가 같은 안내 객체를 그대로 넘겨도 다음을 누를 때마다 안내를 비웠다가 다시 채운다", async () => {
      const [first] = questionPages();
      const id = first.itemIds[0];
      const notice = { kind: "incomplete", itemIds: [id] } as const;
      const onNext = vi.fn();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={notice}
          segments={progressSegments(bank, startedState())}
          canGoBack={false}
          onAnswer={vi.fn()}
          onNext={onNext}
          onBack={vi.fn()}
        />,
      );
      await settle();
      expect(incompleteText(id)).toBe(V40_COPY.question.incomplete);
      // 안내가 이미 떠 있는 채로 다음을 다시 누른다(부모는 같은 객체를 돌려준다).
      await click(nextButton());
      expect(onNext).toHaveBeenCalledTimes(1);
      expect(incompleteText(id)).toBe("");
      await settle();
      expect(incompleteText(id)).toBe(V40_COPY.question.incomplete);
      await click(nextButton());
      expect(incompleteText(id)).toBe("");
      await settle();
      expect(incompleteText(id)).toBe(V40_COPY.question.incomplete);
    });

    it("안내 객체가 없으면 안내를 그리지 않고 초점도 옮기지 않는다", async () => {
      const [first] = questionPages();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack={false}
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      await click(nextButton());
      await settle();
      for (const id of first.itemIds) expect(incompleteText(id)).toBe("");
      expect(document.activeElement).toBe(harness.container.querySelector("section"));
    });

    it("넘어간 질문 다시 보기 안내(skippedReview)는 덜 채움 안내로 읽지 않는다", async () => {
      const [first] = questionPages();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={{ kind: "skippedReview", itemIds: [...first.itemIds] }}
          segments={progressSegments(bank, startedState())}
          canGoBack={false}
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      await settle();
      for (const id of first.itemIds) expect(incompleteText(id)).toBe("");
    });

    it("답을 고르면 안내가 사라진다", async () => {
      await harness.render(<FlowHost />);
      const [first] = questionPages();
      await click(nextButton());
      await settle();
      expect(incompleteText(first.itemIds[0])).toBe(V40_COPY.question.incomplete);
      await click(itemEl(first.itemIds[0]).querySelector<HTMLButtonElement>("button[aria-pressed]"));
      await settle();
      for (const id of first.itemIds) expect(incompleteText(id)).toBe("");
    });

    it("넘기기(잘 모르겠어요)도 답이라서 다음이 통과한다", async () => {
      await harness.render(<FlowHost />);
      const before = pageKey();
      for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
      await click(nextButton());
      expect(pageKey()).not.toBe(before);
    });

    it("칸 나누기를 다 놓기 전에 다음을 누르면 단추는 그대로 두고 남은 칸을 안내한다", async () => {
      // 지쳤을 때 주제를 다시 여는 필터 흐름의 첫 쪽이 칸 나누기다.
      await harness.render(<FlowHost initialActions={[{ type: "openFilter", filter: { kind: "axis", axis: "support" } }]} />);
      const splitFrame = frames()[0];
      expect(splitFrame.querySelector("[data-split]")).not.toBeNull();
      const add = splitFrame.querySelector<HTMLButtonElement>('[data-step="add"]')!;
      await click(add);
      await click(add);
      expect(nextButton().getAttribute("aria-disabled")).toBeNull();
      expect(nextButton().disabled).toBe(false);
      const before = pageKey();
      await click(nextButton());
      expect(pageKey()).toBe(before);
      await settle();
      const notice = splitFrame.querySelector<HTMLElement>("[data-split-notice]")!;
      expect(notice.textContent).toBe(splitRemainingNotice(4));
      // 초점은 그 문항 안으로 간다.
      expect(splitFrame.contains(document.activeElement)).toBe(true);
    });

    it("가장 나 같은 것만 하나 고르고 다음을 누르면 나머지 하나를 고르라고 안내한다", async () => {
      // 정하는 사람 주제를 다시 열면 둘째 쪽이 가장 나 같은 것 형식(scope.circle.1)이다. 첫 쪽은 넘기기로 채워 넘긴다.
      await harness.render(
        <FlowHost
          initialActions={[
            { type: "openFilter", filter: { kind: "axis", axis: "scope" } },
            { type: "answer", itemId: "scope.final.1", answer: { fmt: "escape", which: "unsure" } },
            { type: "next" },
          ]}
        />,
      );
      const frame = frames()[0];
      expect(frame.getAttribute("data-item")).toBe("scope.circle.1");
      await click(frame.querySelector<HTMLInputElement>('input[type="radio"]'));
      await click(nextButton());
      await settle();
      expect(frame.querySelector("[data-bestworst-live]")?.textContent).toBe(V40_COPY.question.incompleteBestWorst);
    });

    it("쪽이 바뀌면 이전 쪽의 안내는 남지 않는다", async () => {
      await harness.render(<FlowHost />);
      await click(nextButton());
      await settle();
      for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
      await click(nextButton());
      await settle();
      for (const element of harness.container.querySelectorAll('[id$="-incomplete"]')) expect(element.textContent).toBe("");
    });
  });

  describe("낭독 알림", () => {
    it("처음에는 지금 구간을, 같은 구간에서 다음으로 가면 다음 질문을, 이전으로 가면 이전 질문을 알린다", async () => {
      await harness.render(<FlowHost />);
      const announced = () => harness.container.querySelector("[data-announcement]")!.textContent;
      await settle();
      expect(announced()).toBe(V40_COPY.progress.sectionAnnouncements[0]);
      for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
      await click(nextButton());
      await settle();
      expect(announced()).toBe(V40_COPY.progress.nextQuestionAnnouncement);
      await click(previousButton());
      await settle();
      expect(announced()).toBe(V40_COPY.progress.previousQuestionAnnouncement);
    });

    it("낭독 알림 자리는 낭독기 전용이고 aria-live 이다", async () => {
      await harness.render(<FlowHost />);
      const region = harness.container.querySelector("[data-announcement]")!;
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.getAttribute("role")).toBe("status");
      expect(region.className).toContain("sr-only");
    });
  });

  describe("저장 상태 한 줄", () => {
    it("저장에 성공했을 때만 나가도 저장돼 있다고 말한다", async () => {
      await harness.render(<FlowHost saveState="saved" />);
      expect(text()).toContain(V40_COPY.leave.autosaveOnNote);
      await harness.render(<FlowHost saveState="off" />);
      expect(text()).toContain(V40_COPY.leave.autosaveOffNote);
      expect(text()).not.toContain(V40_COPY.leave.autosaveOnNote);
    });

    it("저장할 수 없거나 창끼리 어긋났을 때는 저장돼 있다고 하지 않는다", async () => {
      await harness.render(<FlowHost saveState="unavailable" />);
      expect(text()).toContain(V40_COPY.storageNotice.unavailable);
      expect(text()).not.toContain(V40_COPY.leave.autosaveOnNote);
      await harness.render(<FlowHost saveState="conflict" />);
      expect(text()).toContain(V40_COPY.storageNotice.conflict);
      expect(text()).not.toContain(V40_COPY.leave.autosaveOnNote);
    });

    it("저장 상태 알림 영역은 저장 상태가 바뀌기 전에도 문서에 있고, 저장 불가 안내는 문항 위의 알림 영역 안에 들어온다(새로 끼워 넣은 알림은 읽히지 않는 일이 많다)", async () => {
      await harness.render(<FlowHost saveState="saved" />);
      const region = harness.container.querySelector<HTMLElement>("[data-save-problem-region]")!;
      const savedRegion = harness.container.querySelector<HTMLElement>("[data-save-region]")!;
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.textContent).toBe("");
      await harness.render(<FlowHost saveState="unavailable" />);
      // 같은 영역이 그대로 있고(다시 만들어지지 않고) 안에 저장 불가 안내가 들어왔다. 안내 글 자신은 또 다른 알림 영역이 아니다.
      expect(harness.container.querySelector("[data-save-problem-region]")).toBe(region);
      expect(region.textContent).toContain(V40_COPY.storageNotice.unavailable);
      expect(region.querySelector("[role]")).toBeNull();
      // 저장됐다는 말을 하는 영역은 따로 늘 문서에 있고, 저장 불가일 때는 비어 있다.
      expect(harness.container.querySelector("[data-save-region]")).toBe(savedRegion);
      expect(savedRegion.textContent).toBe("");
      // 저장 불가 안내는 첫 문항 위(진행 막대 아래)에 있어서 답하는 동안 화면 밖에 있지 않다.
      const firstItem = harness.container.querySelector("[data-item]")!;
      expect(isBefore(region, firstItem)).toBe(true);
      expect(isBefore(harness.container.querySelector("[data-progress]")!, region)).toBe(true);
      // 창끼리 어긋난 안내는 답이 사라질 수 있는 일이라 영역 밖에서 alert 로 바로 읽히고, 이것도 문항 위에 있다.
      await harness.render(<FlowHost saveState="conflict" />);
      const alert = harness.container.querySelector('[role="alert"]')!;
      expect(alert.textContent).toBe(V40_COPY.storageNotice.conflict);
      expect(region.contains(alert)).toBe(false);
      expect(isBefore(alert, harness.container.querySelector("[data-item]")!)).toBe(true);
    });

    it("질문 화면에는 눈에 보이지 않는 쪽 제목이 있다(h1 하나, 라운지 안에서는 h2)", async () => {
      await harness.render(<FlowHost />);
      const headings = harness.container.querySelectorAll("h1");
      expect(headings).toHaveLength(1);
      expect(headings[0].className).toContain("sr-only");
      expect(headings[0].textContent).toBe(V40_COPY.intro.brandLabel);
      await harness.render(<FlowHost embedded />);
      expect(harness.container.querySelector("h1")).toBeNull();
      const inLounge = harness.container.querySelector("h2");
      expect(inLounge?.className).toContain("sr-only");
      expect(inLounge?.textContent).toBe(V40_COPY.intro.brandLabel);
    });

    it("창끼리 어긋난 안내의 두 단추가 콜백을 부른다", async () => {
      const [first] = questionPages();
      const onLoadSaved = vi.fn();
      const onKeepThis = vi.fn();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          canGoBack
          saveState="conflict"
          onLoadSaved={onLoadSaved}
          onKeepThis={onKeepThis}
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      await click(buttonNamed(V40_COPY.storageNotice.loadSavedButton));
      await click(buttonNamed(V40_COPY.storageNotice.keepThisButton));
      expect(onLoadSaved).toHaveBeenCalledTimes(1);
      expect(onKeepThis).toHaveBeenCalledTimes(1);
    });

    it("저장 상태를 모르면 저장에 관한 말이 없다", async () => {
      await harness.render(<FlowHost saveState={null} />);
      expect(harness.container.querySelector("[data-save-note]")).toBeNull();
      expect(harness.container.querySelector("[data-storage-notice]")).toBeNull();
    });
  });

  describe("받은 링크로 열었을 때", () => {
    it("새로고침하면 상대의 답이 화면에서 사라진다는 한 줄이 있다", async () => {
      await harness.render(<FlowHost receivedNote />);
      expect(harness.container.querySelector("[data-received-note]")?.textContent).toBe(V40_COPY.question.receivedNote);
      expect(notValidatedCount(harness.container)).toBe(0);
    });

    it("주지 않으면 없다", async () => {
      await harness.render(<FlowHost />);
      expect(harness.container.querySelector("[data-received-note]")).toBeNull();
    });
  });

  describe("다시 보기 필터", () => {
    it("주제 다시 보기: 안내 한 줄과 결과로 돌아가기 단추가 있다", async () => {
      const onLeaveEdit = vi.fn();
      await harness.render(
        <FlowHost initialActions={[{ type: "openFilter", filter: { kind: "axis", axis: "money" } }]} onLeaveEdit={onLeaveEdit} />,
      );
      expect(harness.container.querySelector("[data-edit-mode='axis']")?.textContent).toContain(V40_COPY.edit.axisLead);
      await click(buttonNamed(V40_COPY.edit.backToResultButton));
      expect(onLeaveEdit).toHaveBeenCalledTimes(1);
      // 필터 흐름에서는 첫 쪽에서도 이전이 있다(눌러서 결과로 돌아간다).
      expect(previousButton()).not.toBeNull();
    });

    it("주제 다시 보기의 문항은 처음 나왔던 순서대로 열리고 형식 안내가 없다", async () => {
      await harness.render(<FlowHost initialActions={[{ type: "openFilter", filter: { kind: "axis", axis: "money" } }]} />);
      expect(frames().map((frame) => frame.getAttribute("data-item"))).toEqual([bank.scoredByAxis.money[0].id]);
      expect(harness.container.querySelectorAll('[id$="-hint"]')).toHaveLength(0);
      expect(harness.container.querySelector("[data-elder-hint]")).toBeNull();
    });

    it("넘어간 질문 다시 보기: 제목, 안내, 그대로 결과 보기 단추가 있다", async () => {
      const ids = [bank.scored[0].id, bank.scored[1].id];
      const onLeaveEdit = vi.fn();
      await harness.render(
        <FlowHost initialActions={[{ type: "openFilter", filter: { kind: "skipped", itemIds: ids } }]} onLeaveEdit={onLeaveEdit} />,
      );
      const block = harness.container.querySelector("[data-edit-mode='skipped']")!;
      expect(block.querySelector("h2")?.textContent).toBe(V40_COPY.edit.skippedReviewTitle);
      expect(block.textContent).toContain(V40_COPY.edit.skippedReviewLead);
      await click(buttonNamed(V40_COPY.edit.skippedReviewSkipButton));
      expect(onLeaveEdit).toHaveBeenCalledTimes(1);
    });

    it("전체 흐름에는 필터 안내가 없다", async () => {
      await harness.render(<FlowHost />);
      expect(harness.container.querySelector("[data-edit-mode]")).toBeNull();
    });

    it("onLeaveEdit 를 주지 않으면 그 단추를 그리지 않는다", async () => {
      const [first] = questionPages();
      await harness.render(
        <QuestionScreen
          page={first}
          views={viewsOf(first)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, startedState())}
          filter={{ kind: "axis", axis: "money" }}
          canGoBack
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(buttonNamed(V40_COPY.edit.backToResultButton)).toBeUndefined();
    });
  });

  describe("라운지 안(embedded)", () => {
    it("모바일에서 단추 줄이 하단 탭 높이와 안전 영역만큼 위에 붙는다", async () => {
      await harness.render(<FlowHost embedded />);
      const bar = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
      expect(bar.className).toContain("max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]");
      expect(bar.hasAttribute("data-embedded")).toBe(true);
    });

    it("문항은 초점이 갈 때 단추 줄과 하단 탭에 가리지 않게 아래 여백을 더 둔다", async () => {
      await harness.render(<FlowHost embedded />);
      const item = frames()[0];
      expect(item.className).toContain("scroll-mb-[calc(14rem+env(safe-area-inset-bottom))]");
      await harness.render(<FlowHost />);
      expect(frames()[0].className).toContain("scroll-mb-[calc(11rem+env(safe-area-inset-bottom))]");
    });

    it("화면 뿌리의 아래 여백이 더 크다", async () => {
      await harness.render(<FlowHost embedded />);
      expect(harness.container.querySelector("section")!.className).toContain("pb-10");
      await harness.render(<FlowHost />);
      expect(harness.container.querySelector("section")!.className).not.toContain("pb-10");
    });
  });

  describe("접근성", () => {
    it("모든 라디오와 단추가 키보드로 닿는 요소이고 이름이 있다(형식 전체)", async () => {
      for (const page of questionPages()) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        for (const button of buttons()) {
          const name = button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
          expect(name, `${page.key} 단추 이름`).not.toBe("");
        }
        for (const radio of radiosIn(harness.container)) {
          const name = radio.getAttribute("aria-label") ?? radio.textContent?.trim() ?? "";
          expect(name, `${page.key} 라디오 이름`).not.toBe("");
        }
        // 낭독용 이름도 숫자와 A/B 는 쓰지 않는다(위치 낱말은 허용).
        expect(labelProblemsIn(harness.container).filter((problem) => problem.startsWith("aria-label")), page.key).toEqual([]);
      }
    });

    it("폼 비트 1 로 그려도 같은 구조다", async () => {
      const state = startedState([], 1);
      const page = state.pages[state.pageIndex] as QuestionsPage;
      await harness.render(
        <QuestionScreen
          page={page}
          views={viewsOf(page, 1)}
          answers={{}}
          notice={null}
          segments={progressSegments(bank, state)}
          canGoBack={false}
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      expect(frames()).toHaveLength(page.itemIds.length);
      expect(visibleNumberProblems(withoutQuestionNumbers())).toEqual([]);
    });
  });

  describe("고정 표본의 답을 그대로 그리기", () => {
    /** 한 문항 틀 안에서 답이 하나로 보이는가: 형식마다 고른 표시가 다르다. */
    function shownAnswer(frame: HTMLElement, fmt: string): string {
      if (frame.querySelector('button[aria-pressed="true"]')) return "escape";
      if (fmt === "bestworst") return frame.querySelectorAll("input[type='radio']:checked").length === 2 ? "chosen" : "none";
      if (fmt === "split") {
        const total = [...frame.querySelectorAll("[data-count]")].reduce((sum, element) => sum + parseInt(element.textContent ?? "0", 10), 0);
        return total === 6 ? "chosen" : "none";
      }
      return frame.querySelectorAll('[role="radio"][aria-checked="true"]').length === 1 ? "chosen" : "none";
    }

    it.each(["swua-example", "skip-hint", "unusable-axis", "mixed-bands"])(
      "%s: 모든 질문 화면에서 저장된 답이 문항마다 하나로 보이고 넘기기 답이면 그 단추가 눌린 모양이다",
      async (name) => {
        const fixture = fixtureByName(name)!;
        expect(fixture).toBeDefined();
        for (const page of questionPages()) {
          const answers: Record<string, ViewAnswer | null> = {};
          for (const id of page.itemIds) {
            const item = bank.byId.get(id)!;
            answers[id] = fromStored(item, fixture.formBit, fixture.responses[id]);
          }
          await harness.render(
            <QuestionScreen
              page={page}
              views={viewsOf(page, fixture.formBit)}
              answers={answers}
              notice={null}
              segments={progressSegments(bank, startedState())}
              canGoBack
              onAnswer={vi.fn()}
              onNext={vi.fn()}
              onBack={vi.fn()}
            />,
          );
          for (const id of page.itemIds) {
            const value = fixture.responses[id];
            const expected = value === "skip" || value === "na" ? "escape" : "chosen";
            expect(shownAnswer(itemEl(id), bank.byId.get(id)!.fmt), `${name} ${id}`).toBe(expected);
          }
        }
      },
    );

    it("답이 없는 화면은 어느 문항에도 고른 표시가 없다", async () => {
      for (const page of questionPages()) {
        await harness.render(
          <QuestionScreen
            page={page}
            views={viewsOf(page)}
            answers={{}}
            notice={null}
            segments={progressSegments(bank, startedState())}
            canGoBack
            onAnswer={vi.fn()}
            onNext={vi.fn()}
            onBack={vi.fn()}
          />,
        );
        for (const id of page.itemIds) expect(shownAnswer(itemEl(id), bank.byId.get(id)!.fmt), id).toBe("none");
      }
    });
  });

  describe("키보드", () => {
    it("방향키로 칸을 옮겨 고르면 답이 바뀌지만 쪽은 넘어가지 않는다", async () => {
      await harness.render(<FlowHost />);
      const before = pageKey();
      const pairFrame = itemEl("money.limit.1");
      const first = pairFrame.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')!;
      first.focus();
      await pressKey("ArrowRight");
      const checked = pairFrame.querySelectorAll('[role="radio"][aria-checked="true"]');
      expect(checked).toHaveLength(1);
      await pressKey("ArrowRight");
      expect(pairFrame.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
      expect(pageKey()).toBe(before);
    });

    it("모든 단추와 라디오가 진짜 단추 요소이거나 탭으로 닿는 요소다", async () => {
      await harness.render(<FlowHost />);
      for (const element of harness.container.querySelectorAll<HTMLElement>("button, input, a")) {
        expect(element.tabIndex, element.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(-1);
      }
      // 탭 순서의 마지막은 단추 줄(이전 다음)이고 그 뒤에 초점을 받는 것이 없다.
      const focusables = [...harness.container.querySelectorAll<HTMLElement>("button, input, a, [tabindex='0']")].filter(
        (element) => element.tabIndex >= 0 && !element.hasAttribute("hidden"),
      );
      expect(focusables[focusables.length - 1]).toBe(nextButton());
    });

    it("다음 단추에 초점이 있어도 넘기는 것은 누를 때뿐이다(초점만으로 쪽이 바뀌지 않는다)", async () => {
      await harness.render(<FlowHost />);
      const before = pageKey();
      nextButton().focus();
      await settle();
      expect(pageKey()).toBe(before);
    });
  });

  describe("쉬는 카드와 마지막 정리 카드를 잇는 흐름", () => {
    it("구간 끝에서 쉬는 카드가 나오고 이어서 하기로 다음 구간 첫 화면에 온다", async () => {
      // 구간 0의 마지막 쪽까지 넘기기로 채우며 간다.
      let last: FlowState = startedState();
      await harness.render(<FlowHost onState={(state) => (last = state)} />);
      for (let guard = 0; guard < 40 && last.pages[last.pageIndex].kind === "questions"; guard += 1) {
        for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
        await click(nextButton());
      }
      expect(last.pages[last.pageIndex].kind).toBe("rest");
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.rest.title);
      await click(buttonNamed(V40_COPY.rest.continueButton));
      const page = last.pages[last.pageIndex] as QuestionsPage;
      expect(page.kind).toBe("questions");
      expect(page.section).toBe(1);
      // 새 구간의 첫 화면이 뜨면 구간 알림이 낭독된다.
      await settle();
      expect(harness.container.querySelector("[data-announcement]")!.textContent).toBe(V40_COPY.progress.sectionAnnouncements[1]);
    });

    it("마지막 구간 끝에서 마지막 정리 카드가 나오고 이어서 하기로 자기 선택 화면에 온다", async () => {
      let last: FlowState = startedState();
      await harness.render(<FlowHost onState={(state) => (last = state)} />);
      for (let guard = 0; guard < 80 && last.pages[last.pageIndex].kind !== "selfIntro"; guard += 1) {
        const kind = last.pages[last.pageIndex].kind;
        if (kind === "rest") {
          await click(buttonNamed(V40_COPY.rest.continueButton));
          continue;
        }
        for (const button of buttons().filter((b) => b.textContent?.trim() === V40_COPY.question.unsureButton)) await click(button);
        await click(nextButton());
      }
      expect(last.pages[last.pageIndex].kind).toBe("selfIntro");
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.wrapUp.intro);
      await click(buttonNamed(V40_COPY.wrapUp.continueButton));
      const page = last.pages[last.pageIndex] as QuestionsPage;
      expect(page.section).toBe(4);
      expect(frames()[0].getAttribute("data-item")).toBe("self.money");
    });
  });
});

describe("QuestionScreen: 넘어간 질문 다시 보기에서 결과로 나가는 단추의 이름 leaveEditLabel(4.1 단계 2)", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  const buttonNamed = (name: string) => [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === name);

  async function renderFiltered(filter: "skipped" | "axis", leaveEditLabel?: string, onLeaveEdit: () => void = vi.fn()): Promise<void> {
    const [first] = questionPages();
    const ids = first.itemIds;
    await harness.render(
      <QuestionScreen
        page={first}
        views={viewsOf(first)}
        answers={{}}
        notice={null}
        segments={progressSegments(bank, startedState())}
        filter={filter === "skipped" ? { kind: "skipped", itemIds: ids } : { kind: "axis", axis: "money" }}
        canGoBack
        onAnswer={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onLeaveEdit={onLeaveEdit}
        leaveEditLabel={leaveEditLabel}
      />,
    );
  }

  it("이름을 주면 넘어간 질문 다시 보기의 나가기 단추가 그 이름이고 누르면 onLeaveEdit 를 부른다(원래 이름은 없다)", async () => {
    const onLeaveEdit = vi.fn();
    await renderFiltered("skipped", V40_COPY.question.nextButton, onLeaveEdit);
    const block = harness.container.querySelector("[data-edit-mode='skipped']")!;
    const leave = [...block.querySelectorAll<HTMLButtonElement>("button")];
    expect(leave).toHaveLength(1);
    expect(leave[0].textContent?.trim()).toBe(V40_COPY.question.nextButton);
    expect(buttonNamed(V40_COPY.edit.skippedReviewSkipButton)).toBeUndefined();
    await click(leave[0]);
    expect(onLeaveEdit).toHaveBeenCalledTimes(1);
  });

  it("이름을 주지 않으면 지금처럼 「그대로 결과 보기」다", async () => {
    await renderFiltered("skipped");
    const block = harness.container.querySelector("[data-edit-mode='skipped']")!;
    expect(block.querySelector("button")?.textContent?.trim()).toBe(V40_COPY.edit.skippedReviewSkipButton);
  });

  it("주제 다시 보기의 「결과로 돌아가기」는 이름을 줘도 바뀌지 않는다", async () => {
    await renderFiltered("axis", "다른 이름");
    const block = harness.container.querySelector("[data-edit-mode='axis']")!;
    expect(block.querySelector("button")?.textContent?.trim()).toBe(V40_COPY.edit.backToResultButton);
    expect(buttonNamed("다른 이름")).toBeUndefined();
  });

  it("이름은 나가기 단추에만 쓰이고 아래 줄의 다음 단추 이름은 nextIsResult 가 정한다", async () => {
    const [first] = questionPages();
    await harness.render(
      <QuestionScreen
        page={first}
        views={viewsOf(first)}
        answers={{}}
        notice={null}
        segments={progressSegments(bank, startedState())}
        filter={{ kind: "skipped", itemIds: first.itemIds }}
        canGoBack
        nextIsResult={false}
        onAnswer={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onLeaveEdit={vi.fn()}
        leaveEditLabel={V40_COPY.question.nextButton}
      />,
    );
    expect(harness.container.querySelector('[data-nav="next"]')?.textContent?.trim()).toBe(V40_COPY.question.nextButton);
    await harness.render(
      <QuestionScreen
        page={first}
        views={viewsOf(first)}
        answers={{}}
        notice={null}
        segments={progressSegments(bank, startedState())}
        filter={{ kind: "skipped", itemIds: first.itemIds }}
        canGoBack
        nextIsResult
        onAnswer={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onLeaveEdit={vi.fn()}
        leaveEditLabel={V40_COPY.question.nextButton}
      />,
    );
    expect(harness.container.querySelector('[data-nav="next"]')?.textContent?.trim()).toBe(V40_COPY.question.resultButton);
  });
});
