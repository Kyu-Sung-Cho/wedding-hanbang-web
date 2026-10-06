"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { guideKeyOf, type GuideKey } from "@/constants/weddingCodeV40";
import { V40_LAYOUT } from "@/lib/weddingCode/v40/layout";
import { V40_COPY, formatGuideRepeatsStem } from "@/lib/weddingCode/v40/copy";
import type {
  FlowNotice,
  ItemId,
  ItemView,
  PageFilter,
  ProgressSegment,
  QuestionsPage,
  SectionIndex,
  ViewAnswer,
} from "@/lib/weddingCode/v40/types";
import { BestWorstInput } from "./BestWorstInput";
import { ChoiceInput } from "./ChoiceInput";
import { ItemFrame } from "./ItemFrame";
import { StorageNotice, type SaveState } from "./NoticeScreens";
import { PairInput } from "./PairInput";
import { ProgressBar } from "./ProgressBar";
import { ReactInput } from "./ReactInput";
import { ActionBar, screenRootClass } from "./SectionCard";
import { SplitInput } from "./SplitInput";
import { bodyText, cx, noteText, srOnly } from "./styles";
import { useScreenFocus } from "./useScreenFocus";

/**
 * 질문 화면(설계 6절 화면 묶음). 한 쪽에 문항 하나나 둘을 ItemFrame 과 형식별 입력으로 그리고, 위에 진행 막대, 아래에 이전과 다음 단추를 둔다.
 *
 * - 답을 골라도 자동으로 넘어가지 않는다. 다음 단추로만 넘어간다. 다음 단추는 꺼져 있지 않다(덜 채웠으면 누를 때 안내한다).
 * - 형식 안내 한 줄은 쪽 데이터(page.guides)가 말하는 형식에만 그 형식의 첫 문항에 한 번 붙는다. 정하는 사람 주제의 첫 문항 위에는 어른 안내가 한 번 붙는다.
 * - 문항마다 전체 흐름에서의 질문 번호를 보여 준다. 선택지 번호와 A/B 라벨은 쓰지 않는다.
 * - 데이터와 콜백을 props 로 받을 뿐 저장소, 통계, 주소를 만지지 않는다. 문구는 모두 copy.ts 에서 온다.
 *
 * 덜 채운 문항 안내(FlowNotice incomplete): 각 입력이 자기 안내를 aria-live 영역에 그린다. 안내 글이 같으면 낭독기가 다시 읽지 않으므로,
 * 다음 단추를 누를 때마다(같은 안내가 그대로여도) incomplete 를 잠시 거짓으로 되돌렸다가 참으로 다시 준다. 그리고 첫 덜 채운 문항으로 초점을 옮긴다.
 * 다음 단추를 누를 때마다 새 안내 객체가 오든 같은 객체가 오든 똑같이 동작한다.
 */

/** 안내를 다시 읽히려고 incomplete 를 거짓으로 되돌려 두는 시간(밀리초). 화면 한 프레임보다 길어야 낭독기가 바뀐 것을 알아챈다. */
const REANNOUNCE_DELAY_MS = 80;
/** 쪽이 바뀐 뒤 낭독 알림을 넣기까지의 시간(밀리초). 비어 있다가 채워져야 같은 말이 이어서 나와도 다시 읽힌다. */
const ANNOUNCE_DELAY_MS = 80;

export interface QuestionScreenProps {
  /** 지금 질문 화면 쪽(flow 의 Page 중 questions). */
  readonly page: QuestionsPage;
  /** 쪽의 문항 뷰(present 의 결과, 폼 비트 반영). 순서는 상관없고 view.id 로 page.itemIds 와 짝짓는다. */
  readonly views: readonly ItemView[];
  /** 문항 id -> 지금 화면 답(flow.viewAnswerOf, 중간 상태 포함). 없으면 null. */
  readonly answers: Readonly<Record<ItemId, ViewAnswer | null | undefined>>;
  /** reducer 의 notice. incomplete 만 이 화면이 다룬다. */
  readonly notice: FlowNotice | null;
  /** 진행 막대 다섯 칸(flow.progressSegments). */
  readonly segments: readonly ProgressSegment[];
  /** 결과 화면에서 다시 연 필터 흐름이면 그 필터(축 다시 보기 또는 넘어간 질문 다시 보기). 전체 흐름이면 null. */
  readonly filter?: PageFilter | null;
  /** 이전 단추를 그릴지. 첫 질문 화면에서는 소개로 되돌아가지 않으므로 false. */
  readonly canGoBack: boolean;
  /** 다음이 결과로 가는 쪽이면 true(단추 이름이 결과 보기). */
  readonly nextIsResult?: boolean;
  /** 라운지(앱 셸) 안이면 하단 탭 위로 단추 줄을 올린다. */
  readonly embedded?: boolean;
  /** 마지막 저장 결과. 사실대로만 말한다(saved 일 때만 저장돼 있다고 한다). null 이면 저장에 관한 말을 하지 않는다. */
  readonly saveState?: SaveState | null;
  /** 상대가 보낸 링크로 열어 답하는 중이면 true. 새로고침하면 상대 답이 사라진다는 한 줄을 위에 보인다(첫 질문 화면에서만 주는 것을 권한다). */
  readonly receivedNote?: boolean;
  readonly onAnswer: (itemId: ItemId, answer: ViewAnswer) => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
  /** 필터 흐름에서 결과로 돌아가기(축 다시 보기), 그대로 결과 보기(넘어간 질문 다시 보기). 없으면 그 단추를 그리지 않는다. */
  readonly onLeaveEdit?: () => void;
  /**
   * 넘어간 질문 다시 보기(filter 가 skipped)에서 결과로 나가는 단추의 이름. 안 주면 「그대로 결과 보기」(V40_COPY.edit.skippedReviewSkipButton).
   * 이 단추를 누른 뒤 결과 앞에 다른 화면(4.1 단계 2의 결과 전 글자 고르기 등)이 끼는 흐름에서는 부모가 결과를 약속하지 않는 이름
   * (V40_COPY.edit.skippedReviewFinishButton)을 준다. 아래 줄의 「다음」(다음 넘어간 질문)과 같은 이름을 주면 이름이 같은 단추 둘이 생기므로 주지 않는다.
   * 축 다시 보기의 「결과로 돌아가기」에는 쓰지 않는다.
   */
  readonly leaveEditLabel?: string;
  /** saveState 가 conflict 일 때 두 단추. */
  readonly onLoadSaved?: () => void;
  readonly onKeepThis?: () => void;
}

/** 정하는 사람 주제의 문항 id(채점 문항은 scope 로 시작하고 자기 선택은 self.scope). */
function isScopeItemId(id: ItemId): boolean {
  return id.startsWith("scope.") || id === "self.scope";
}

/** DOM id 접두어. 문항 id 의 점을 하이픈으로 바꾼다. */
function idPrefixOf(id: ItemId): string {
  return `q-${id.replace(/\./g, "-")}`;
}

const questionNumbers = new Map(V40_LAYOUT.map((slot, index) => [slot.id, index + 1]));

/**
 * 덜 채운 문항에서 처음 초점을 받을 요소. 라디오(탭 자리가 있는 칸)를 먼저, 그다음 눌러 쓸 수 있는 단추를 찾는다.
 * 넘기기 단추(aria-pressed 가 있다)와 지금은 누를 수 없는 단추(aria-disabled)는 건너뛴다. 없으면 문항 틀 자체.
 */
function focusFirstControl(container: HTMLElement | null | undefined): void {
  if (!container) return;
  const target =
    container.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ??
    container.querySelector<HTMLElement>('input[type="radio"]') ??
    container.querySelector<HTMLElement>('button:not([aria-pressed]):not([aria-disabled="true"])') ??
    container.querySelector<HTMLElement>("button:not([aria-pressed])") ??
    container;
  target.focus();
}

function renderInput(
  view: ItemView,
  value: ViewAnswer | null,
  idPrefix: string,
  incomplete: boolean,
  onAnswer: (answer: ViewAnswer) => void,
): ReactNode {
  const common = { value, onAnswer, idPrefix, incomplete } as const;
  switch (view.fmt) {
    case "pair":
    case "self":
      return <PairInput view={view} {...common} />;
    case "react":
      return <ReactInput view={view} {...common} />;
    case "recall":
    case "instant":
      return <ChoiceInput view={view} {...common} />;
    case "bestworst":
      return <BestWorstInput view={view} {...common} />;
    case "split":
      return <SplitInput view={view} {...common} />;
  }
}

export function QuestionScreen({
  page,
  views,
  answers,
  notice,
  segments,
  filter = null,
  canGoBack,
  nextIsResult = false,
  embedded = false,
  saveState = null,
  receivedNote = false,
  onAnswer,
  onNext,
  onBack,
  onLeaveEdit,
  leaveEditLabel,
  onLoadSaved,
  onKeepThis,
}: QuestionScreenProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef(new Map<ItemId, HTMLElement>());
  useScreenFocus(rootRef, page.key);

  const viewById = useMemo(() => new Map(views.map((view) => [view.id, view] as const)), [views]);

  // 덜 채운 문항 안내: 다음을 누를 때마다 거짓에서 참으로 다시 준다.
  const [pressCount, setPressCount] = useState(0);
  const [fired, setFired] = useState<{ readonly notice: FlowNotice | null; readonly press: number }>({ notice: null, press: -1 });
  const incompleteNotice = notice !== null && notice.kind === "incomplete" ? notice : null;
  const incompleteLive = incompleteNotice !== null && fired.notice === incompleteNotice && fired.press === pressCount;

  useEffect(() => {
    if (incompleteNotice === null) return;
    const firstId = page.itemIds.find((id) => incompleteNotice.itemIds.includes(id));
    focusFirstControl(firstId === undefined ? undefined : itemRefs.current.get(firstId));
    const timer = window.setTimeout(() => setFired({ notice: incompleteNotice, press: pressCount }), REANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [incompleteNotice, pressCount, page.itemIds]);

  // 쪽이 바뀌었을 때 낭독 알림: 구간이 바뀌었거나 처음이면 구간 알림, 같은 구간에서는 다음 질문, 이전 질문.
  const lastSeen = useRef<{ readonly screen: number; readonly section: SectionIndex } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const previous = lastSeen.current;
    let text = "";
    if (previous === null || previous.section !== page.section) text = V40_COPY.progress.sectionAnnouncements[page.section];
    else if (page.screen > previous.screen) text = V40_COPY.progress.nextQuestionAnnouncement;
    else if (page.screen < previous.screen) text = V40_COPY.progress.previousQuestionAnnouncement;
    const clear = window.setTimeout(() => setAnnouncement(""), 0);
    const show = window.setTimeout(() => {
      lastSeen.current = { screen: page.screen, section: page.section };
      setAnnouncement(text);
    }, ANNOUNCE_DELAY_MS);
    return () => {
      window.clearTimeout(clear);
      window.clearTimeout(show);
    };
  }, [page.key, page.screen, page.section]);

  const handleNext = () => {
    setPressCount((count) => count + 1);
    onNext();
  };

  // 형식 안내는 쪽 데이터가 말하는 형식의 첫 문항에만, 어른 안내는 정하는 사람 주제의 첫 문항 위에만.
  const usedGuides = new Set<GuideKey>();
  const elderId = page.elderHint ? (page.itemIds.find(isScopeItemId) ?? page.itemIds[0] ?? null) : null;
  const entries: { readonly id: ItemId; readonly view: ItemView; readonly hint: string | null }[] = [];
  for (const id of page.itemIds) {
    const view = viewById.get(id);
    if (!view) continue;
    const key = guideKeyOf(view.fmt);
    let hint: string | null = null;
    if (key !== null && page.guides.includes(key) && !usedGuides.has(key)) {
      usedGuides.add(key);
      // 앞말이 이미 같은 안내를 했으면(칸 나누기 앞말 다수) 같은 말을 두 번 읽히지 않는다.
      const guide = V40_COPY.question.guides[key];
      hint = formatGuideRepeatsStem(guide, view.stem) ? null : guide;
    }
    entries.push({ id, view, hint });
  }

  const scrollMargin = embedded
    ? "scroll-mt-24 scroll-mb-[calc(14rem+env(safe-area-inset-bottom))]"
    : "scroll-mt-24 scroll-mb-[calc(11rem+env(safe-area-inset-bottom))]";
  const editMode = filter === null ? null : filter.kind;
  const PageHeading = embedded ? "h2" : "h1";

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label={V40_COPY.progress.sectionAnnouncements[page.section]}
      data-screen="questions"
      data-page-key={page.key}
      className={screenRootClass(embedded)}
    >
      {/* 눈에는 보이지 않는 쪽 제목. 질문 화면에는 제목이 없어서 낭독기와 제목 이동으로는 어느 쪽인지 알 수 없었다.
          라운지 안(embedded)에서는 바깥 화면이 h1 을 가지므로 h2 다. */}
      <PageHeading className={srOnly}>{V40_COPY.intro.brandLabel}</PageHeading>
      <ProgressBar segments={segments} className="mb-8" />

      {/* 저장이 안 된다는 안내와 창끼리 어긋났다는 안내는 답이 사라질 수 있는 일이라 문항 위에 둔다(아래 끝에 두면 문항이 둘인 화면에서
          화면 밖이라 답하는 동안 보이지 않는다). 알림 영역은 저장 상태가 바뀌기 전에도 늘 문서에 두고 그 안의 글만 바꿔야 낭독기가 바뀐 글을 읽는다.
          창끼리 어긋난 안내는 자기 안내가 role=alert 라 바로 읽힌다. */}
      <div role="status" aria-live="polite" data-save-problem-region="">
        {saveState === "unavailable" ? <StorageNotice problem="unavailable" live={false} className="mb-5" /> : null}
      </div>
      {saveState === "conflict" ? <StorageNotice problem="conflict" onLoadSaved={onLoadSaved} onKeepThis={onKeepThis} className="mb-5" /> : null}

      {editMode === "axis" ? (
        <div data-edit-mode="axis" className="mb-7 space-y-3 border-l-2 border-[var(--hb-selected-line)] pl-4">
          <p className={bodyText}>{V40_COPY.edit.axisLead}</p>
          {onLeaveEdit ? (
            <Button variant="secondary" size="md" onClick={onLeaveEdit}>
              {V40_COPY.edit.backToResultButton}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editMode === "skipped" ? (
        <div data-edit-mode="skipped" className="mb-7 space-y-3 border-l-2 border-[var(--hb-selected-line)] pl-4">
          <h2 className="text-base font-semibold leading-snug text-[var(--hb-text-strong)]">{V40_COPY.edit.skippedReviewTitle}</h2>
          <p className={bodyText}>{V40_COPY.edit.skippedReviewLead}</p>
          {onLeaveEdit ? (
            <Button variant="secondary" size="md" onClick={onLeaveEdit}>
              {leaveEditLabel ?? V40_COPY.edit.skippedReviewSkipButton}
            </Button>
          ) : null}
        </div>
      ) : null}
      {receivedNote ? (
        <p data-received-note="" className={cx(noteText, "mb-7 border-l-2 border-[var(--hb-hairline)] pl-4")}>
          {V40_COPY.question.receivedNote}
        </p>
      ) : null}

      <div>
        {entries.map(({ id, view, hint }, index) => {
          const idPrefix = idPrefixOf(id);
          const value = answers[id] ?? null;
          const incomplete = incompleteLive && incompleteNotice !== null && incompleteNotice.itemIds.includes(id);
          return (
            <div
              key={id}
              ref={(element) => {
                if (element) itemRefs.current.set(id, element);
                else itemRefs.current.delete(id);
              }}
              tabIndex={-1}
              data-item={id}
              className={cx("outline-none", scrollMargin, index > 0 && "mt-12 border-t border-[var(--hb-hairline)] pt-10")}
            >
              {elderId === id ? (
                <p data-elder-hint="" className={cx(noteText, "mb-2")}>
                  {V40_COPY.question.elderHint}
                </p>
              ) : null}
              <ItemFrame view={view} questionNumber={questionNumbers.get(id)} totalQuestions={V40_LAYOUT.length} value={value} onAnswer={(answer) => onAnswer(id, answer)} idPrefix={idPrefix} hint={hint}>
                {renderInput(view, value, idPrefix, incomplete, (answer) => onAnswer(id, answer))}
              </ItemFrame>
            </div>
          );
        })}
      </div>

      {/* 저장 상태는 쪽을 넘긴 뒤에 바뀐다(저장됨이었다가 꺼짐이 되는 일). 알림 영역은 늘 문서에 두고 그 안의 글만 바꿔야
          낭독기가 바뀐 글을 읽는다. 새로 끼워 넣은 알림 영역은 읽히지 않는 일이 많다. 저장이 안 될 때의 안내는 위쪽 영역이 맡는다. */}
      <div role="status" aria-live="polite" data-save-region="">
        {saveState === "saved" ? (
          <p data-save-note="saved" className={cx(noteText, "mt-6")}>
            {V40_COPY.leave.autosaveOnNote}
          </p>
        ) : null}
        {saveState === "off" ? (
          <p data-save-note="off" className={cx(noteText, "mt-6")}>
            {V40_COPY.leave.autosaveOffNote}
          </p>
        ) : null}
      </div>

      <ActionBar embedded={embedded}>
        <div className="flex gap-3">
          {canGoBack ? (
            <Button variant="secondary" size="lg" onClick={onBack} data-nav="previous" className="min-h-14!">
              <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
              {V40_COPY.question.previousButton}
            </Button>
          ) : null}
          <Button variant="primary" size="lg" onClick={handleNext} data-nav="next" className="min-h-14! flex-1">
            {nextIsResult ? V40_COPY.question.resultButton : V40_COPY.question.nextButton}
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Button>
        </div>
      </ActionBar>

      <p role="status" aria-live="polite" aria-atomic="true" data-announcement="" className={srOnly}>
        {announcement}
      </p>
    </section>
  );
}

export default QuestionScreen;
