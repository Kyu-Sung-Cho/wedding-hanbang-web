"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, ShieldCheck } from "lucide-react";
import {
  buildCandidate6Journey,
  CANDIDATE6_BIPOLAR_DIRECTIONS,
  CANDIDATE6_ESCAPE_RESPONSES,
  CANDIDATE6_IMPACT_LEVELS,
  CANDIDATE6_RESEARCH_EXACT_VERSION,
  isCandidate6BipolarVisuallyReversed,
  normalizeCandidate6BipolarVisualChoice,
  type Candidate6BipolarDirection,
  type Candidate6EscapeResponse,
  type Candidate6Form,
  type Candidate6ImpactLevel,
  type Candidate6ItemId,
  type Candidate6ResearchResponse,
  type Candidate6StakeholderApplicability,
  type Candidate6SupportPairOrder,
} from "./candidate6";
import {
  buildInviteCopyLine,
  CANDIDATE6_INTERLUDE_SENTENCES,
  CANDIDATE6_SCENE_TEXT,
  deriveCardCandidates,
  interludeIndexes,
  sceneRhythmLabel,
} from "./candidate6SceneText";

/**
 * 마지막 세 장에서 배경이 깊어진다. 끝이 텍스트가 아니라 몸으로 온다.
 * **위치 기반이라 넘기기·비해당을 골라도 똑같이 발생한다** — 응답과 무관하므로
 * 보상 장치가 아니다.
 */
function duskTone(index: number, total: number): string {
  const remaining = total - 1 - index;
  if (remaining === 0) return "#EFE4D7";
  if (remaining === 1) return "#F7F1E8";
  return "#FBF8F2";
}

type PrototypeStep =
  | "intro"
  | "questions"
  | "interlude"
  | "recap"
  | "card-pick"
  | "card-give"
  | "card-face"
  | "invite";

/**
 * 장면 라벨. **측정 응답과 완전히 분리된 별도 필드다.**
 *
 * 라벨은 아무것도 잠그지 않는다 — 회수 목록의 길이·순서·본문·버튼과 카드 후보가
 * 라벨 상태와 무관하다. 그래서 이것은 보상 장치가 아니라 **불일치를 말할 자리**다.
 * 업체를 안 쓰기로 한 커플, 기록을 안 남기는 커플이 소외되지 않고 "이건 우리 얘기
 * 아님"이라고 말할 수 있는 유일한 채널이고, 그 표시는 어디에도 저장되지 않는다.
 */
type SceneLabel = "ours" | "not-ours";

/** 두 라벨의 구조·촉감 클래스는 완전히 같다. 색만 다르다(테스트로 고정). */
const sceneLabelBase =
  "inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 text-[12px]"
  + " font-semibold transition-colors duration-150 ease-out active:-translate-y-[4px]"
  + " active:scale-[1.015] motion-reduce:transform-none";
const sceneLabelIdle = "bg-white text-[#36534E] border-[#C7D1C2]";

/** 트리거의 `aria-controls`와 시트의 `id`가 가리키는 같은 값. */
const CONTENTS_SHEET_ID = "candidate6-contents-sheet";

const IMPACT_LABELS: Record<Candidate6ImpactLevel, string> = {
  strongly_hinders: "오히려 많이 방해돼요",
  slightly_hinders: "조금 방해돼요",
  neutral_impact: "도움도 방해도 거의 없어요",
  slightly_helps: "조금 도움이 돼요",
  strongly_helps: "많이 도움이 돼요",
};

const IMPACT_SHORT_LABELS: Record<Candidate6ImpactLevel, string> = {
  strongly_hinders: "많이 방해",
  slightly_hinders: "조금 방해",
  neutral_impact: "거의 없음",
  slightly_helps: "조금 도움",
  strongly_helps: "많이 도움",
};

const VISUAL_BIPOLAR_LABELS: Record<Candidate6BipolarDirection, string> = {
  [-2]: "첫 번째 이야기부터 시작하고 싶어요",
  [-1]: "첫 번째 이야기를 조금 먼저 꺼내고 싶어요",
  0: "두 이야기를 나란히 시작하고 싶어요",
  1: "두 번째 이야기를 조금 먼저 꺼내고 싶어요",
  2: "두 번째 이야기부터 시작하고 싶어요",
};

const VISUAL_BIPOLAR_SHORT_LABELS: Record<Candidate6BipolarDirection, string> = {
  [-2]: "첫째부터",
  [-1]: "첫째 먼저",
  0: "같이 시작",
  1: "둘째 먼저",
  2: "둘째부터",
};

const surface =
  "rounded-[24px] border border-[#EFE4D7] bg-white shadow-[0_18px_50px_rgba(36,56,50,0.07)]";
const primaryButton =
  "no-min-tap inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 ease-out active:-translate-y-[4px] active:scale-[1.015] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "no-min-tap inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[#36534E] transition-colors hover:bg-[#F7F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 ease-out active:-translate-y-[4px] active:scale-[1.015] motion-reduce:transform-none";

export function Candidate6Prototype({
  form,
  supportPairOrder = "ES_FIRST",
}: {
  form: Candidate6Form;
  supportPairOrder?: Candidate6SupportPairOrder;
}) {
  const [step, setStep] = useState<PrototypeStep>("intro");
  const [stakeholderApplicability, setStakeholderApplicability] =
    useState<Candidate6StakeholderApplicability | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<
    Partial<Record<Candidate6ItemId, Candidate6ResearchResponse>>
  >({});
  /** 내가 물어볼 한 장. */
  const [myCardId, setMyCardId] = useState<Candidate6ItemId | null>(null);
  /** 상대가 나한테 물어줄 한 장. 고르지 않는 것도 선택이다. */
  const [givenCardId, setGivenCardId] = useState<Candidate6ItemId | null>(null);
  /** 확정 전 현재 화면의 선택. */
  const [draftCardId, setDraftCardId] = useState<Candidate6ItemId | null>(null);
  const [sceneLabels, setSceneLabels] = useState<Partial<Record<Candidate6ItemId, SceneLabel>>>({});
  const [contentsOpen, setContentsOpen] = useState(false);
  /** 막간을 이미 보여준 문항 인덱스. 되돌아가도 같은 막간을 다시 띄우지 않는다. */
  const [shownInterludes, setShownInterludes] = useState<readonly number[]>([]);
  const [pendingInterlude, setPendingInterlude] = useState<number | null>(null);
  const screenHeadingRef = useRef<HTMLHeadingElement>(null);
  const questionScrollRef = useRef<HTMLDivElement>(null);
  /** 시트를 닫을 때 포커스를 돌려줄 자리. 없으면 포커스가 body로 유실된다. */
  const contentsTriggerRef = useRef<HTMLButtonElement>(null);
  const [focusRevision, setFocusRevision] = useState(0);

  const journey = useMemo(
    () =>
      stakeholderApplicability
        ? buildCandidate6Journey(form, stakeholderApplicability, supportPairOrder)
        : [],
    [form, stakeholderApplicability, supportPairOrder]
  );
  const currentItem = journey[questionIndex];
  const currentResponse = currentItem ? responses[currentItem.id] : undefined;

  useEffect(() => {
    questionScrollRef.current?.scrollTo?.({ top: 0 });
    if (focusRevision > 0) screenHeadingRef.current?.focus();
  }, [focusRevision, questionIndex]);

  useEffect(() => {
    document.documentElement.dataset.weddingCodeResearchHydrated = "true";
    return () => {
      delete document.documentElement.dataset.weddingCodeResearchHydrated;
    };
  }, []);

  // 시트는 화면을 덮으므로 Escape로 닫히고 포커스가 트리거로 돌아와야 한다.
  // 이 시트가 중도이탈자의 유일한 만회 경로라 키보드 사용자에게 닫혀 있으면 안 된다.
  useEffect(() => {
    if (!contentsOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setContentsOpen(false);
      contentsTriggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [contentsOpen]);

  function closeContents() {
    setContentsOpen(false);
    contentsTriggerRef.current?.focus();
  }

  function moveToStep(nextStep: PrototypeStep) {
    setStep(nextStep);
    setFocusRevision((revision) => revision + 1);
  }

  function start() {
    if (!stakeholderApplicability) return;
    setQuestionIndex(0);
    moveToStep("questions");
  }

  function setResponse(itemId: Candidate6ItemId, response: Candidate6ResearchResponse) {
    setResponses((previous) => ({ ...previous, [itemId]: response }));
  }

  function nextQuestion() {
    if (!currentItem || !currentResponse) return;
    const next = questionIndex + 1;
    if (next < journey.length) {
      // 막간은 **위치만의 함수**다. 응답 종류를 보지 않으므로 특정 응답을 보상하지 않는다.
      if (interludes.includes(next) && !shownInterludes.includes(next)) {
        setPendingInterlude(next);
        moveToStep("interlude");
        return;
      }
      setQuestionIndex(next);
      return;
    }
    moveToStep("recap");
  }

  function leaveInterlude() {
    if (pendingInterlude === null) return;
    setShownInterludes((previous) => [...previous, pendingInterlude]);
    setQuestionIndex(pendingInterlude);
    setPendingInterlude(null);
    moveToStep("questions");
  }

  /** 같은 라벨을 다시 누르면 지운다. 어느 쪽도 기본값이 아니다. */
  function toggleSceneLabel(itemId: Candidate6ItemId, label: SceneLabel) {
    setSceneLabels((previous) => {
      const next = { ...previous };
      if (next[itemId] === label) delete next[itemId];
      else next[itemId] = label;
      return next;
    });
  }

  function previousQuestion() {
    if (questionIndex === 0) {
      moveToStep("intro");
      return;
    }
    setQuestionIndex((value) => value - 1);
  }

  function restart() {
    moveToStep("intro");
    setStakeholderApplicability(null);
    setQuestionIndex(0);
    setResponses({});
    setMyCardId(null);
    setGivenCardId(null);
    setDraftCardId(null);
    setSceneLabels({});
    setContentsOpen(false);
    setShownInterludes([]);
    setPendingInterlude(null);
  }

  /**
   * 카드 후보. **응답도 라벨도 보지 않는다** — `deriveCardCandidates`가 투여된 항목에서
   * 리뷰 플래그만 빼고 journey 순서를 보존한다.
   */
  const cardCandidates = useMemo(
    () => deriveCardCandidates(journey.map((item) => item.id)),
    [journey]
  );
  // 길이만의 순수 함수라 memo가 필요 없다(React Compiler가 memo 보존을 거부한다).
  const interludes = interludeIndexes(journey.length);

  if (step === "interlude" && pendingInterlude !== null) {
    const sentence =
      CANDIDATE6_INTERLUDE_SENTENCES[interludes.indexOf(pendingInterlude)]
      ?? CANDIDATE6_INTERLUDE_SENTENCES[0];
    return (
      <main
        data-interlude={sentence}
        className="ph-no-capture flex min-h-dvh flex-col items-center justify-center bg-[#F7F1E8] px-6"
      >
        <h1
          ref={screenHeadingRef}
          tabIndex={-1}
          className="c6-fade-up max-w-[420px] rounded text-center text-[24px] font-semibold leading-[1.5] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74]"
        >
          {sentence}
        </h1>
        <button type="button" onClick={leaveInterlude} className={`${secondaryButton} c6-fade-up c6-delay-80 mt-8`}>
          넘기기
        </button>
      </main>
    );
  }

  if (step === "intro") {
    return (
      <PrototypeShell>
        <section className={`${surface} overflow-hidden`}>
          <div className="bg-[#243832] px-5 py-4 text-white sm:px-8 sm:py-10">
            <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">
              웨딩코드 · 로컬 연구 미리보기
            </p>
            <h1
              ref={screenHeadingRef}
              tabIndex={-1}
              className="mt-3 rounded text-[24px] font-semibold leading-[1.3] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D7B1A9] sm:text-[30px]"
            >
              우리 얘기, 어디서부터 꺼낼까요
            </h1>
            <p className="mt-3 max-w-[520px] text-[15px] font-medium leading-[1.6] text-[#F7F1E8] sm:text-[16px]">
              장면을 하나씩 보고, 마지막에 오늘 꺼낼 한 마디를 직접 고릅니다.
            </p>
          </div>

          <div className="px-4 py-3 sm:px-8 sm:py-8">
            {/*
              시작 전에 재미가 한 번 터지는 자리. 어떤 문항도 "누가 먼저 꺼내는가"를
              묻지 않고 어떤 anchor도 배정하지 않으므로 측정 오염 경로가 없다.
              동시에 마지막 「주는 카드」가 회수하는 씨앗이다 — 이 문장이 없으면
              S6의 「꺼내는 사람이 늘 나였다면」이 근거 없이 나온다.
            */}
            <p
              data-intro-hook=""
              className="mb-5 border-l-2 border-[#C7D1C2] pl-3 text-[16px] font-semibold leading-[1.55] text-[#243832]"
            >
              결혼 준비 얘기를 꺼내는 사람이,
              <br />
              늘 같은 사람이다.
            </p>

            <fieldset>
              <legend className="text-[16px] font-semibold leading-relaxed text-[#243832]">
                가족이나 주변 의견도 들을 예정인가요?
              </legend>
              <p className="mt-1 text-[14px] font-medium leading-relaxed text-[#36534E]">
                해당할 때만 같은 사람을 떠올리는 장면 2개가 더 나와요.
              </p>
              <div className="mt-3 grid gap-2">
                <IntroChoice
                  label="네, 의견을 들을 사람이 있어요"
                  selected={stakeholderApplicability === "applicable"}
                  onSelect={() => setStakeholderApplicability("applicable")}
                />
                <IntroChoice
                  label="아니요, 둘이 정하기로 했어요"
                  selected={stakeholderApplicability === "not_applicable"}
                  onSelect={() => setStakeholderApplicability("not_applicable")}
                />
                <IntroChoice
                  label="아직 정하지 않았어요"
                  selected={stakeholderApplicability === "unsure"}
                  onSelect={() => setStakeholderApplicability("unsure")}
                />
              </div>
            </fieldset>

            <button
              type="button"
              onClick={start}
              disabled={!stakeholderApplicability}
              className={`${primaryButton} mt-2 w-full`}
            >
              장면 시작하기
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-[12px] font-medium leading-relaxed text-[#8F6662]">
              걸리는 시간은 실제 사용성 검증 뒤 정확하게 안내할게요.
            </p>

            <div className="mt-6 grid gap-3 border-t border-[#EFE4D7] pt-5 sm:grid-cols-3">
              <TrustPoint title="저장하지 않아요" body="새로고침하면 답이 사라져요." />
              <TrustPoint title="정답을 강요하지 않아요" body="중간·비해당·모름·넘기기를 구분해요." />
              <TrustPoint title="결과를 단정하지 않아요" body="점수·유형·궁합이 없어요." />
            </div>

            {/*
              예전에는 여기서 중립 카드 한 장을 미리 보여줬다. 사이클 3에서 카드 후보를
              21장면 파생으로 바꾸면서 그 카드는 흐름에서 빠졌는데 미리보기만 남아,
              첫 화면이 **끝까지 가도 만날 수 없는 카드**를 약속하고 있었다.
              구체적인 카드 대신 절차만 알린다.
            */}
            <p className="mt-6 rounded-[18px] bg-[#F7F1E8] px-5 py-4 text-[14px] font-medium leading-[1.7] text-[#36534E]">
              지나온 장면은 마지막에 다시 모아 보여드려요.
            </p>
          </div>
        </section>
      </PrototypeShell>
    );
  }

  if (step === "questions" && currentItem) {
    return (
      <PrototypeShell viewportLocked showFooter={false} tone={duskTone(questionIndex, journey.length)}>
        <div
          data-dusk={duskTone(questionIndex, journey.length)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <header className="mb-4 shrink-0">
            <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-[#36534E]">
              {/*
                진행률 바 대신 이야기 리듬. 마지막 세 장에서 숫자가 문장으로 바뀌는
                순간 자체가 "끝이 온다"는 신호가 된다. 퍼센트·분수를 만들지 않는다.
              */}
              <span
                data-scene-rhythm=""
                className="transition-opacity duration-[220ms] motion-reduce:transition-none"
              >
                {sceneRhythmLabel(questionIndex, journey.length)}
              </span>
              <button
                ref={contentsTriggerRef}
                type="button"
                aria-expanded={contentsOpen}
                aria-controls={CONTENTS_SHEET_ID}
                onClick={() => setContentsOpen(true)}
                className="min-h-[44px] rounded text-[12px] font-semibold text-[#8F6662] underline underline-offset-4"
              >
                지나온 장면
              </button>
            </div>
            {/* 보이는 사람과 안 보이는 사람이 같은 수를 받는다. */}
            <span data-scene-total={journey.length} className="sr-only">
              전체 {journey.length}장 중 {questionIndex + 1}번째 장면
            </span>
          </header>

          {/* champagne는 전 경험에서 마지막 한 장에만 쓴다. */}
          <section
            {...(questionIndex === journey.length - 1 ? { "data-dusk-edge": "" } : {})}
            className={`${surface} flex min-h-0 flex-1 flex-col overflow-hidden transition-colors duration-[220ms] motion-reduce:transition-none ${
              questionIndex === journey.length - 1 ? "border-[#E2D3C8]" : ""
            }`}
          >
            <div
              ref={questionScrollRef}
              role="region"
              aria-label={`장면 ${questionIndex + 1} 질문과 응답`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-8 sm:py-8"
            >
              <p className="text-[12px] font-semibold tracking-[0.12em] text-[#8F6662]">
                {currentItem.chapter}
              </p>
              <p className="mt-2 inline-flex rounded-[12px] bg-[#F7F1E8] px-3 py-1.5 text-[13px] font-semibold leading-relaxed text-[#36534E]">
                {currentItem.scenario}
              </p>
              <h1
                id={`candidate6-question-${currentItem.id}`}
                ref={screenHeadingRef}
                tabIndex={-1}
                className="mt-3 rounded text-[22px] font-semibold leading-[1.35] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74] sm:text-[28px]"
              >
                {currentItem.prompt}
              </h1>
              <div className="mt-3 flex gap-3 rounded-[16px] border border-[#C7D1C2] bg-[#F7F1E8] px-3 py-2.5 sm:px-4 sm:py-3.5">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#6D806E]" />
                <p className="text-[13px] font-medium leading-[1.55] text-[#36534E] sm:text-[14px] sm:leading-[1.65]">
                  <span className="font-semibold">이 장면의 약속:</span> {currentItem.premise}
                </p>
              </div>

              <fieldset className="mt-4" aria-labelledby={`candidate6-question-${currentItem.id}`}>
                <legend className="sr-only">응답 선택</legend>
                {currentItem.responseMode === "bipolar-order" ? (
                  <BipolarChoices
                    form={form}
                    item={currentItem}
                    response={currentResponse}
                    onChange={(response) => setResponse(currentItem.id, response)}
                  />
                ) : (
                  <ImpactChoices
                    itemId={currentItem.id}
                    behavior={currentItem.behavior}
                    response={currentResponse}
                    onChange={(response) => setResponse(currentItem.id, response)}
                  />
                )}

                <EscapeChoices
                  key={currentItem.id}
                  itemId={currentItem.id}
                  response={currentResponse}
                  onChange={(value) => setResponse(currentItem.id, { kind: "escape", value })}
                />
              </fieldset>
            </div>

            <div className="shrink-0 border-t border-[#EFE4D7] bg-white px-4 pb-3 pt-2 sm:px-8">
              <p className="mb-2 text-center text-[12px] font-semibold text-[#8F6662]">
                <span className="sm:hidden">5개 답을 비교한 뒤 하나를 골라주세요.</span>
                <span className="hidden sm:inline">
                  다섯 답을 한눈에 비교하고, 딱 맞지 않으면 ‘다른 답’을 열어보세요.
                </span>
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={previousQuestion} className={secondaryButton}>
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  이전
                </button>
                <button
                  type="button"
                  onClick={nextQuestion}
                  disabled={!currentResponse}
                  className={`${primaryButton} flex-1`}
                >
                  {questionIndex + 1 === journey.length ? (
                    "지나온 장면 보기"
                  ) : (
                    <>
                      <span className="sr-only">선택 확인하고 </span>다음
                    </>
                  )}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          {contentsOpen ? (
            <ContentsSheet
              items={journey.slice(0, questionIndex)}
              labels={sceneLabels}
              onToggle={toggleSceneLabel}
              onClose={closeContents}
            />
          ) : null}
        </div>
      </PrototypeShell>
    );
  }

  if (step === "recap") {
    return (
      <PrototypeShell>
        <section className={`${surface} px-4 py-6 sm:px-8 sm:py-9`}>
          <h1
            ref={screenHeadingRef}
            tabIndex={-1}
            className="rounded text-[28px] font-semibold leading-[1.35] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74]"
          >
            지나온 장면이에요
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.7] text-[#36534E]">
            저희가 해석한 게 아니라, 방금 지나오신 장면 그대로예요.
          </p>
          <p className="mt-2 text-[14px] font-medium leading-[1.7] text-[#36534E]">
            마음에 걸리는 장면에 라벨을 붙여도 되고, 안 붙여도 돼요.
          </p>
          <p className="mt-1 text-[14px] font-medium leading-[1.7] text-[#8F6662]">
            우리 얘기가 아닌 장면도 있어요. 그렇게 표시해두면 목록이 정직해져요.
          </p>

          <div className="mt-6 divide-y divide-[#EFE4D7] rounded-[20px] border border-[#EFE4D7]">
            {journey.map((item) => (
              <RecapRow
                key={item.id}
                itemId={item.id}
                title={CANDIDATE6_SCENE_TEXT[item.id].sceneTitle}
                bodyLines={CANDIDATE6_SCENE_TEXT[item.id].recapLines ?? [item.scenario]}
                label={sceneLabels[item.id]}
                onToggle={toggleSceneLabel}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setDraftCardId(null);
              moveToStep("card-pick");
            }}
            className={`${primaryButton} mt-6 w-full`}
          >
            오늘 꺼낼 한 마디 고르기
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </section>
      </PrototypeShell>
    );
  }

  if (step === "card-pick" || step === "card-give") {
    const giving = step === "card-give";
    const candidates = cardCandidates.filter((id) => id !== (giving ? myCardId : null));
    const chosenSoFar = myCardId ? CANDIDATE6_SCENE_TEXT[myCardId] : null;
    const missingCount = journey.filter(
      (item) => CANDIDATE6_SCENE_TEXT[item.id].card === null
    ).length;

    return (
      <PrototypeShell>
        <section className={`${surface} px-4 py-6 sm:px-8 sm:py-9`}>
          <h1
            ref={screenHeadingRef}
            tabIndex={-1}
            className="rounded text-[24px] font-semibold leading-[1.35] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74] sm:text-[28px]"
          >
            {giving
              ? "이번엔 상대가 나한테 물어줄 한 마디를 골라주세요"
              : "오늘 꺼낼 한 마디를 골라주세요"}
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.7] text-[#36534E]">
            {giving
              ? "꺼내는 사람이 늘 나였다면, 이번 한 번은 상대에게 맡겨도 돼요."
              : "지나온 장면에서 고르는 거예요. 답이나 라벨로 걸러내지 않았어요."}
          </p>

          {giving && chosenSoFar ? (
            <div className="mt-4 rounded-[16px] bg-[#F7F1E8] px-4 py-3">
              <p className="text-[12px] font-semibold text-[#8F6662]">내가 물어볼 한 마디</p>
              <p className="mt-1 truncate text-[14px] font-semibold text-[#243832]">
                {chosenSoFar.card?.prompt}
              </p>
            </div>
          ) : null}

          <div className="mt-5 divide-y divide-[#EFE4D7] rounded-[20px] border border-[#EFE4D7]">
            {candidates.map((id) => {
              const entry = CANDIDATE6_SCENE_TEXT[id];
              const selected = draftCardId === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-card-candidate={id}
                  aria-pressed={selected}
                  onClick={() => setDraftCardId(id)}
                  className={`no-min-tap flex min-h-[76px] w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors duration-150 ease-out active:-translate-y-[4px] active:scale-[1.015] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] motion-reduce:transform-none ${
                    selected ? "bg-[#F7F1E8]" : "bg-white"
                  }`}
                >
                  <span>
                    <span className="block text-[12px] font-semibold text-[#8F6662]">
                      {entry.sceneTitle}
                    </span>
                    <span className="mt-1 block text-[16px] font-semibold leading-[1.5] text-[#243832]">
                      {entry.card?.prompt}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-[#36534E] bg-[#36534E] text-white" : "border-[#C7D1C2]"
                    }`}
                  >
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                </button>
              );
            })}
          </div>

          {missingCount > 0 ? (
            <p className="mt-3 text-[13px] font-medium leading-[1.6] text-[#8F6662]">
              {missingCount}개 장면은 문장을 아직 다듬는 중이라 카드가 없어요.
            </p>
          ) : null}

          <div className="mt-6 flex gap-3">
            {/*
              되돌아갈 길. 예전에는 회수 이후 전 구간에 뒤로가 없어서, 카드를 잘못
              확정하면 19~21개 답을 전부 날리는 전면 재시작뿐이었다(2026-07-28 감사).
              답은 보존한 채 한 걸음씩 되돌린다.
            */}
            <button
              type="button"
              onClick={() => {
                if (giving) {
                  setDraftCardId(myCardId);
                  moveToStep("card-pick");
                  return;
                }
                setDraftCardId(null);
                moveToStep("recap");
              }}
              className={secondaryButton}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              이전
            </button>
            {giving ? (
              <button
                type="button"
                onClick={() => {
                  setGivenCardId(null);
                  setDraftCardId(null);
                  moveToStep("card-face");
                }}
                className={`${secondaryButton} min-h-[48px] flex-1`}
              >
                이번엔 안 고를게요
              </button>
            ) : null}
            <button
              type="button"
              disabled={!draftCardId}
              onClick={() => {
                if (!draftCardId) return;
                if (giving) {
                  setGivenCardId(draftCardId);
                  setDraftCardId(null);
                  moveToStep("card-face");
                  return;
                }
                setMyCardId(draftCardId);
                setDraftCardId(null);
                moveToStep("card-give");
              }}
              className={`${primaryButton} min-h-[48px] flex-1`}
            >
              이 카드로 정하기
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </section>
      </PrototypeShell>
    );
  }

  const myCard = myCardId ? CANDIDATE6_SCENE_TEXT[myCardId] : null;
  const givenCard = givenCardId ? CANDIDATE6_SCENE_TEXT[givenCardId] : null;
  const copyLine = myCard?.card ? buildInviteCopyLine(myCard.card.prompt) : "";

  if (step === "invite") {
    return (
      <PrototypeShell>
        <section className={`${surface} px-4 py-6 sm:px-8 sm:py-9`}>
          <h1
            ref={screenHeadingRef}
            tabIndex={-1}
            className="rounded text-[24px] font-semibold leading-[1.35] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74] sm:text-[28px]"
          >
            답은 안 보내고, 한 마디만 건네요
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.7] text-[#36534E]">
            링크는 아직 열려 있지 않아요. 지금은 말로 건네는 초대만 있어요.
          </p>

          <p className="mt-5 text-[12px] font-semibold text-[#8F6662]">
            건네는 건 이 한 줄뿐이에요
          </p>
          <p
            data-invite-copy={copyLine}
            className="mt-2 border-y border-[#EFE4D7] py-3 text-[14px] font-medium leading-[1.6] text-[#243832]"
          >
            {copyLine}
          </p>
          <p className="mt-3 text-[13px] font-medium leading-[1.6] text-[#8F6662]">
            상대가 아무것도 안 해도 이 화면은 그대로예요.
          </p>

          {/*
            복사 버튼을 두지 않는다. `58_candidate6_product_research_contract`:163이
            「clipboard/native share/OG answer metadata 금지」로 평문 금지하고, 그 문서는
            README 권위 순서 2순위다(이 기능의 기획서는 권위 순서에 없다). 클립보드는
            zero-I/O 프로토타입에서 유일하게 남는 실제 유출 경로이기도 하다 — iOS
            유니버설 클립보드·Windows 클라우드 클립보드는 기기 밖으로 동기화된다.
            화면이 이미 「말로 건네는 초대만 있어요」라고 말하므로 제거가 더 일관된다.
          */}
          <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[#36534E]">
            이 화면은 아무것도 복사하지 않아요. 위 한 줄을 보고 그대로 말해주세요.
          </p>

          <button
            type="button"
            onClick={() => moveToStep("card-face")}
            className={`${secondaryButton} mt-6 w-full`}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            카드로 돌아가기
          </button>
        </section>
      </PrototypeShell>
    );
  }

  return (
    <PrototypeShell>
      <section
        data-card-face=""
        className={`${surface} mx-auto aspect-[5/8] w-full max-w-[320px] px-5 py-6`}
      >
        <p className="text-[12px] font-semibold text-[#8F6662]">{myCard?.sceneTitle}</p>
        <h1
          ref={screenHeadingRef}
          tabIndex={-1}
          className="mt-3 rounded text-[24px] font-semibold leading-[1.4] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74]"
        >
          {myCard?.card?.prompt}
        </h1>

        <div className="mt-5 border-t border-[#EFE4D7] pt-4">
          <p className="text-[12px] font-semibold text-[#8F6662]">언제</p>
          <p className="mt-1 text-[14px] font-medium leading-[1.6] text-[#243832]">
            {myCard?.card?.when}
          </p>
          <p className="mt-3 text-[12px] font-semibold text-[#8F6662]">10분 안에</p>
          <p className="mt-1 text-[14px] font-medium leading-[1.6] text-[#243832]">
            {myCard?.card?.action}
          </p>
        </div>

        {givenCard ? (
          <div className="mt-4 border-t border-[#EFE4D7] pt-4">
            <p className="text-[12px] font-semibold text-[#8F6662]">상대가 물어줄 한 마디</p>
            <p className="mt-1 text-[14px] font-medium leading-[1.6] text-[#243832]">
              {givenCard.card?.prompt}
            </p>
          </div>
        ) : null}

        <p className="mt-5 text-[12px] font-medium text-[#8F6662]">
          웨딩코드 로컬 미리보기 · 정식 검사 아님
        </p>
      </section>

      <div className="mx-auto mt-5 w-full max-w-[320px]">
        <p className="text-[14px] font-medium leading-[1.7] text-[#36534E]">
          그대로 말해도 되고, 두 분 말투로 바꿔도 돼요.
        </p>
        <p className="mt-2 text-[16px] font-semibold leading-[1.7] text-[#243832]">
          오늘은 이 한 문장만 꺼내도 충분해요.
        </p>
        <p className="mt-3 text-[13px] font-medium leading-[1.7] text-[#8F6662]">
          저희는 이 카드를 보관하지 않았어요. 새로고침하면 사라져요.
        </p>

        <button
          type="button"
          onClick={() => {
            moveToStep("invite");
          }}
          className={`${primaryButton} mt-5 w-full`}
        >
          한 마디 건네기
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" onClick={restart} className={`${secondaryButton} mt-3 w-full`}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          처음부터 다시 보기
        </button>
      </div>
    </PrototypeShell>
  );
}

function PrototypeShell({
  children,
  viewportLocked = false,
  showFooter = true,
  tone = "#FBF8F2",
}: {
  children: React.ReactNode;
  viewportLocked?: boolean;
  showFooter?: boolean;
  /**
   * 황혼 색. **페이지 최상위에 칠해야 한다** — 안쪽 div에 주면 그 아래 `bg-white`
   * surface가 세로를 전부 덮어 헤더 60px 띠만 물든다(2026-07-29 감사 M5 실측).
   * §6 메커니즘 6은 「끝이 텍스트가 아니라 몸으로 온다」이므로 화면 전체가 깊어져야 한다.
   */
  tone?: string;
}) {
  const toneClass =
    tone === "#EFE4D7" ? "bg-[#EFE4D7]" : tone === "#F7F1E8" ? "bg-[#F7F1E8]" : "bg-[#FBF8F2]";
  return (
    <main
      className={`ph-no-capture ${toneClass} px-2 py-4 transition-colors duration-[450ms] motion-reduce:transition-none sm:px-4 sm:py-10 ${
        viewportLocked ? "flex h-dvh overflow-hidden" : "min-h-dvh"
      }`}
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingRight: "max(0.5rem, env(safe-area-inset-right))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
      }}
    >
      <div
        className={`mx-auto w-full max-w-[640px] ${
          viewportLocked ? "flex min-h-0 flex-1 flex-col" : ""
        }`}
      >
        {children}
        {showFooter && (
          <p className="mt-4 text-center text-[12px] font-medium leading-relaxed text-[#8F6662]">
            {CANDIDATE6_RESEARCH_EXACT_VERSION} · 로컬 연구 미리보기 · 정식 검사 아님
          </p>
        )}
      </div>
    </main>
  );
}

function TrustPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-b border-[#EFE4D7] pb-3 last:border-b-0 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3 sm:last:border-r-0">
      <p className="text-[14px] font-semibold text-[#243832]">{title}</p>
      <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#36534E]">{body}</p>
    </div>
  );
}

function IntroChoice({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[14px] border px-4 py-3 text-[15px] font-semibold transition-colors ${
        selected ? "border-[#36534E] bg-[#F7F1E8] text-[#243832]" : "border-[#EFE4D7] text-[#36534E]"
      }`}
    >
      <input type="radio" name="stakeholder-applicability" checked={selected} onChange={onSelect} />
      {label}
    </label>
  );
}

function BipolarChoices({
  form,
  item,
  response,
  onChange,
}: {
  form: Candidate6Form;
  item: Extract<ReturnType<typeof buildCandidate6Journey>[number], { responseMode: "bipolar-order" }>;
  response: Candidate6ResearchResponse | undefined;
  onChange: (response: Candidate6ResearchResponse) => void;
}) {
  const reversed = isCandidate6BipolarVisuallyReversed(form, item.id);
  const leftAnchor = reversed ? item.rightAnchor : item.leftAnchor;
  const rightAnchor = reversed ? item.leftAnchor : item.rightAnchor;

  return (
    <div>
      <p className="text-[15px] font-semibold text-[#243832]">지금 더 편한 시작점을 골라주세요</p>
      <div className="mt-3 grid grid-cols-2 divide-x divide-[#C7D1C2] overflow-hidden rounded-[16px] border border-[#C7D1C2] bg-[#FBF8F2]">
        <AnchorCard label="첫 번째 이야기" text={leftAnchor} />
        <AnchorCard label="두 번째 이야기" text={rightAnchor} />
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" aria-label="시작 순서 다섯 답">
        {CANDIDATE6_BIPOLAR_DIRECTIONS.map((visualDirection) => {
          const normalized = normalizeCandidate6BipolarVisualChoice(form, item.id, visualDirection);
          const selected =
            response?.kind === "bipolar" &&
            normalized.kind === "bipolar" &&
            response.direction === normalized.direction;
          return (
            <ScaleChoice
              key={visualDirection}
              name={`candidate6-${item.id}`}
              value={`bipolar-${visualDirection}`}
              ariaLabel={VISUAL_BIPOLAR_LABELS[visualDirection]}
              shortLabel={VISUAL_BIPOLAR_SHORT_LABELS[visualDirection]}
              selected={selected}
              onChange={() => onChange(normalized)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ImpactChoices({
  itemId,
  behavior,
  response,
  onChange,
}: {
  itemId: Candidate6ItemId;
  behavior: string;
  response: Candidate6ResearchResponse | undefined;
  onChange: (response: Candidate6ResearchResponse) => void;
}) {
  return (
    <div>
      <p className="w-full rounded-[16px] bg-[#F7F1E8] px-4 py-3 text-[16px] font-semibold leading-[1.55] text-[#243832] sm:px-5 sm:py-5 sm:text-[17px] sm:leading-[1.65]">
        {behavior}
      </p>
      <div className="mt-2 grid grid-cols-5 gap-1.5" aria-label="영향 정도 다섯 답">
        {CANDIDATE6_IMPACT_LEVELS.map((level) => (
          <ScaleChoice
            key={level}
            name={`candidate6-${itemId}`}
            value={`impact-${level}`}
            ariaLabel={IMPACT_LABELS[level]}
            shortLabel={IMPACT_SHORT_LABELS[level]}
            selected={response?.kind === "impact" && response.level === level}
            onChange={() => onChange({ kind: "impact", level })}
          />
        ))}
      </div>
    </div>
  );
}

function EscapeChoices({
  itemId,
  response,
  onChange,
}: {
  itemId: Candidate6ItemId;
  response: Candidate6ResearchResponse | undefined;
  onChange: (value: Candidate6EscapeResponse) => void;
}) {
  const [open, setOpen] = useState(response?.kind === "escape");

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-4 overflow-hidden rounded-[14px] border border-[#EFE4D7] bg-[#FBF8F2]"
    >
      <summary className="no-min-tap flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[#36534E] marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#36534E]">
        <span>
          <span className="block text-[14px] font-semibold">딱 맞는 답이 없어요</span>
          <span className="mt-0.5 block text-[11px] font-medium text-[#8F6662] sm:text-[12px]">
            상황 차이 · 비해당 · 경험 없음 · 넘기기
          </span>
        </span>
        <span aria-hidden="true" className="text-[18px] font-semibold">
          {open ? "−" : "+"}
        </span>
      </summary>
      <div className="grid gap-2 border-t border-[#EFE4D7] p-3">
        {CANDIDATE6_ESCAPE_RESPONSES.map((escape) => (
          <ChoiceRow
            key={escape.value}
            name={`candidate6-${itemId}`}
            value={`escape-${escape.value}`}
            label={escape.label}
            selected={response?.kind === "escape" && response.value === escape.value}
            onChange={() => onChange(escape.value)}
            quiet
          />
        ))}
      </div>
    </details>
  );
}

function ScaleChoice({
  name,
  value,
  ariaLabel,
  shortLabel,
  selected,
  onChange,
}: {
  name: string;
  value: string;
  ariaLabel: string;
  shortLabel: string;
  selected: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`no-min-tap flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[12px] border px-1 py-2 text-center text-[12px] font-semibold leading-[1.25] transition duration-150 ease-out active:-translate-y-[4px] active:scale-[1.015] motion-reduce:transform-none focus-within:outline-none focus-within:ring-2 focus-within:ring-[#36534E] focus-within:ring-offset-1 ${
        selected
          ? "border-[#36534E] bg-[#F7F1E8] text-[#243832]"
          : "border-[#EFE4D7] bg-white text-[#36534E] hover:border-[#C7D1C2]"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        aria-label={ariaLabel}
        checked={selected}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 items-center justify-center rounded-full border ${
          selected ? "border-[#36534E] bg-[#36534E] text-white" : "border-[#8C9A8D] bg-white"
        }`}
      >
        {selected && <Check className="h-3.5 w-3.5" />}
      </span>
      <span>{shortLabel}</span>
    </label>
  );
}

function ChoiceRow({
  name,
  value,
  label,
  selected,
  onChange,
  quiet = false,
}: {
  name: string;
  value: string;
  label: string;
  selected: boolean;
  onChange: () => void;
  quiet?: boolean;
}) {
  return (
    <label
      className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[14px] border px-4 py-3 text-[15px] font-semibold leading-relaxed transition duration-150 ease-out active:-translate-y-[4px] active:scale-[1.015] motion-reduce:transform-none ${
        selected
          ? "border-[#36534E] bg-[#F7F1E8] text-[#243832]"
          : quiet
            ? "border-[#EFE4D7] bg-[#FBF8F2] text-[#36534E] hover:border-[#C7D1C2]"
            : "border-[#EFE4D7] bg-white text-[#36534E] hover:border-[#C7D1C2]"
      }`}
    >
      <input type="radio" name={name} value={value} checked={selected} onChange={onChange} />
      {label}
    </label>
  );
}

function AnchorCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="px-3 py-3 sm:px-4 sm:py-4">
      <p className="text-[12px] font-semibold tracking-wide text-[#8F6662]">{label}</p>
      <p className="mt-1.5 text-[13px] font-semibold leading-[1.5] text-[#243832] sm:text-[15px] sm:leading-[1.6]">{text}</p>
    </div>
  );
}

/**
 * 두 라벨. 구조·촉감 클래스가 완전히 같고 색만 다르다 — 어느 쪽도 기본값이 아니고,
 * 어느 쪽을 눌러도 다음 화면이 바뀌지 않는다.
 */
function SceneLabelPills({
  itemId,
  label,
  onToggle,
}: {
  itemId: Candidate6ItemId;
  label: SceneLabel | undefined;
  onToggle: (itemId: Candidate6ItemId, label: SceneLabel) => void;
}) {
  return (
    <div className="mt-2 flex gap-2">
      <button
        type="button"
        data-scene-label="ours"
        aria-pressed={label === "ours"}
        onClick={() => onToggle(itemId, "ours")}
        className={`${sceneLabelBase} ${
          label === "ours" ? "bg-[#36534E] text-white border-[#36534E]" : sceneLabelIdle
        }`}
      >
        우리 얘기
      </button>
      <button
        type="button"
        data-scene-label="not-ours"
        aria-pressed={label === "not-ours"}
        onClick={() => onToggle(itemId, "not-ours")}
        className={`${sceneLabelBase} ${
          label === "not-ours" ? "bg-[#8F6662] text-white border-[#8F6662]" : sceneLabelIdle
        }`}
      >
        우리 얘긴 아니에요
      </button>
    </div>
  );
}

/**
 * 회수 목록의 한 행. `data-recap-body`는 라벨이 본문을 바꾸지 않는다는 것을 테스트가
 * 스냅샷으로 고정하는 데 쓴다.
 */
function RecapRow({
  itemId,
  title,
  bodyLines,
  label,
  onToggle,
}: {
  itemId: Candidate6ItemId;
  title: string;
  bodyLines: readonly string[];
  label: SceneLabel | undefined;
  onToggle: (itemId: Candidate6ItemId, label: SceneLabel) => void;
}) {
  return (
    <div data-recap-row={itemId} data-recap-body={bodyLines.join(" ")} className="px-4 py-4">
      <p className="text-[12px] font-semibold text-[#8F6662]">{title}</p>
      {bodyLines.map((line) => (
        <p key={line} className="mt-1 text-[16px] font-semibold leading-[1.5] text-[#243832]">
          {line}
        </p>
      ))}
      <SceneLabelPills itemId={itemId} label={label} onToggle={onToggle} />
    </div>
  );
}

/**
 * 지나온 장면 목차. 회수 화면까지 가지 못하는 사람에게도 만회 기회를 준다.
 * **답 내용과 답 여부를 적지 않는다** — 아직 측정 중이므로 회수 문장(Tier B)도 쓰지 않고
 * 장면 제목만 둔다.
 */
function ContentsSheet({
  items,
  labels,
  onToggle,
  onClose,
}: {
  items: readonly { id: Candidate6ItemId }[];
  labels: Partial<Record<Candidate6ItemId, SceneLabel>>;
  onToggle: (itemId: Candidate6ItemId, label: SceneLabel) => void;
  onClose: () => void;
}) {
  /**
   * 열 때 **한 번만** 제목으로 포커스를 옮긴다.
   *
   * 예전에는 인라인 콜백 ref(`ref={(node) => node?.focus()}`)를 썼는데, 렌더마다 ref
   * 정체성이 바뀌어 React가 detach/attach를 반복하며 `focus()`를 다시 호출했다. 시트
   * 안에서 라벨을 누르면 부모 `sceneLabels`가 바뀌어 시트가 리렌더되므로, **라벨을 누를
   * 때마다 포커스가 제목으로 되돌아갔다** — 이 시트가 중도이탈자의 유일한 만회 경로인데
   * 키보드·스크린리더 사용자에게는 매 토글마다 처음부터 다시 Tab하게 만들었다.
   * 시트는 닫힐 때 언마운트되므로 마운트 스코프 effect면 다시 열 때 정상 재포커스된다.
   */
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <>
      {/* 시트가 화면을 덮는다는 것을 시각으로도 알린다(기획서 §3 S1b). */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="c6-fade-in fixed inset-0 z-10 bg-[#243832]/20"
      />
      <div
        id={CONTENTS_SHEET_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${CONTENTS_SHEET_ID}-title`}
        className="c6-sheet-in fixed inset-x-0 bottom-0 z-20 rounded-t-[20px] border-t border-[#EFE4D7] bg-white px-4 py-5 shadow-[0_-18px_50px_rgba(36,56,50,0.12)]"
      >
        <p
          id={`${CONTENTS_SHEET_ID}-title`}
          ref={titleRef}
          tabIndex={-1}
          className="rounded text-[16px] font-semibold text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74]"
        >
          지나온 장면
        </p>
      <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[#36534E]">
        답은 여기 적지 않아요. 장면 제목만 있어요.
      </p>

      {items.length === 0 ? (
        <p className="mt-4 text-[14px] font-medium leading-[1.6] text-[#8F6662]">
          아직 지나온 장면이 없어요. 첫 장면을 넘기면 여기에 쌓여요.
        </p>
      ) : (
        <div className="mt-3 max-h-[46vh] divide-y divide-[#EFE4D7] overflow-y-auto">
          {items.map((item) => (
            <div key={item.id} data-recap-row={item.id} data-recap-body="" className="py-3">
              <p className="text-[14px] font-semibold text-[#243832]">
                {CANDIDATE6_SCENE_TEXT[item.id].sceneTitle}
              </p>
              <SceneLabelPills itemId={item.id} label={labels[item.id]} onToggle={onToggle} />
            </div>
          ))}
        </div>
      )}

        <button type="button" onClick={onClose} className={`${secondaryButton} mt-4 w-full`}>
          닫기
        </button>
      </div>
    </>
  );
}
