"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, HeartHandshake, RotateCcw, ShieldCheck } from "lucide-react";
import {
  buildCandidate6Journey,
  CANDIDATE6_BIPOLAR_DIRECTIONS,
  CANDIDATE6_ESCAPE_RESPONSES,
  CANDIDATE6_IMPACT_LEVELS,
  CANDIDATE6_NEUTRAL_CONVERSATION_CARDS,
  CANDIDATE6_RESEARCH_EXACT_VERSION,
  isCandidate6BipolarVisuallyReversed,
  normalizeCandidate6BipolarVisualChoice,
  type Candidate6BipolarDirection,
  type Candidate6EscapeResponse,
  type Candidate6Form,
  type Candidate6ImpactLevel,
  type Candidate6ItemId,
  type Candidate6NeutralConversationCardId,
  type Candidate6ResearchResponse,
  type Candidate6StakeholderApplicability,
  type Candidate6SupportPairOrder,
} from "./candidate6";

type PrototypeStep = "intro" | "questions" | "conversation-card" | "complete";

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
  "no-min-tap inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "no-min-tap inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[#36534E] transition-colors hover:bg-[#F7F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2";

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
  const [selectedCardId, setSelectedCardId] =
    useState<Candidate6NeutralConversationCardId | null>(null);
  const screenHeadingRef = useRef<HTMLHeadingElement>(null);
  const questionScrollRef = useRef<HTMLDivElement>(null);
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
    if (questionIndex + 1 < journey.length) {
      setQuestionIndex((value) => value + 1);
      return;
    }
    moveToStep("conversation-card");
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
    setSelectedCardId(null);
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
              className="mt-3 rounded text-[28px] font-semibold leading-[1.25] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D7B1A9] sm:text-[38px]"
            >
              우리 대화는 어디서부터 시작하면 편할까?
            </h1>
            <p className="mt-3 max-w-[520px] text-[15px] font-medium leading-[1.6] text-[#F7F1E8] sm:text-[16px]">
              장면을 보며 편한 시작점을 골라보세요. 끝에는 오늘 꺼낼 대화 한 장을 직접 고릅니다.
            </p>
          </div>

          <div className="px-4 py-3 sm:px-8 sm:py-8">
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

            <div className="mt-6 rounded-[18px] bg-[#F7F1E8] px-5 py-5">
              <p className="text-[12px] font-semibold tracking-wide text-[#8F6662]">마지막에 직접 고를 것</p>
              <p className="mt-2 text-[18px] font-semibold leading-relaxed text-[#243832]">
                “이번 선택은 조건부터 맞춰볼까, 원하는 장면부터 이야기해볼까?”
              </p>
              <p className="mt-2 text-[14px] font-medium leading-relaxed text-[#36534E]">
                답에서 성향을 추론한 문장이 아니라, 지금 필요한 중립 대화 카드예요.
              </p>
            </div>
          </div>
        </section>
      </PrototypeShell>
    );
  }

  if (step === "questions" && currentItem) {
    const progress = Math.round(((questionIndex + 1) / journey.length) * 100);
    return (
      <PrototypeShell viewportLocked showFooter={false}>
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="mb-4 shrink-0">
            <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-[#36534E]">
              <span>장면 {questionIndex + 1}</span>
              <span>{journey.length}개 중</span>
            </div>
            <div
              role="progressbar"
              aria-label="웨딩코드 장면 진행률"
              aria-valuemin={1}
              aria-valuemax={journey.length}
              aria-valuenow={questionIndex + 1}
              className="mt-2 h-2 overflow-hidden rounded-full bg-[#EFE4D7]"
            >
              <div
                className="h-full rounded-full bg-[#A77B74] transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
          </header>

          <section className={`${surface} flex min-h-0 flex-1 flex-col overflow-hidden`}>
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
                    "대화 카드 고르기"
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
        </div>
      </PrototypeShell>
    );
  }

  if (step === "conversation-card") {
    return (
      <PrototypeShell>
        <section className={`${surface} px-4 py-6 sm:px-8 sm:py-9`}>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-[#8F6662]">마지막 한 장</p>
          <h1
            ref={screenHeadingRef}
            tabIndex={-1}
            className="mt-3 rounded text-[28px] font-semibold leading-[1.35] text-[#243832] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A77B74]"
          >
            오늘 실제로 꺼내고 싶은 대화를 골라주세요
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.7] text-[#36534E]">
            앞선 답을 점수로 바꾸지 않습니다. 지금 도움이 될 카드를 내가 직접 고릅니다.
          </p>

          <div className="mt-6 grid gap-3">
            {CANDIDATE6_NEUTRAL_CONVERSATION_CARDS.map((card) => {
              const selected = selectedCardId === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setSelectedCardId(card.id)}
                  aria-pressed={selected}
                  className={`no-min-tap min-h-[48px] rounded-[18px] border px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 ${
                    selected
                      ? "border-[#36534E] bg-[#F7F1E8]"
                      : "border-[#EFE4D7] bg-white hover:border-[#C7D1C2]"
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block text-[12px] font-semibold text-[#8F6662]">{card.title}</span>
                      <span className="mt-1.5 block text-[16px] font-semibold leading-[1.55] text-[#243832]">
                        {card.prompt}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        selected ? "border-[#36534E] bg-[#36534E] text-white" : "border-[#C7D1C2]"
                      }`}
                    >
                      {selected && <Check className="h-4 w-4" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-7 flex gap-3 border-t border-[#EFE4D7] pt-4">
            <button
              type="button"
              onClick={() => moveToStep("questions")}
              className={secondaryButton}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              이전
            </button>
            <button
              type="button"
              onClick={() => selectedCardId && moveToStep("complete")}
              disabled={!selectedCardId}
              className={`${primaryButton} flex-1`}
            >
              내 카드 보기
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </section>
      </PrototypeShell>
    );
  }

  const selectedCard = CANDIDATE6_NEUTRAL_CONVERSATION_CARDS.find(
    (card) => card.id === selectedCardId
  );
  return (
    <PrototypeShell>
      <section className={`${surface} overflow-hidden`}>
        <div className="bg-[#243832] px-5 py-8 text-white sm:px-8 sm:py-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
            <HeartHandshake aria-hidden="true" className="h-6 w-6 text-[#F7F1E8]" />
          </div>
          <p className="mt-5 text-[12px] font-semibold tracking-[0.14em] text-[#C7D1C2]">오늘의 대화 카드</p>
          <h1
            ref={screenHeadingRef}
            tabIndex={-1}
            className="mt-3 rounded text-[28px] font-semibold leading-[1.4] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D7B1A9] sm:text-[34px]"
          >
            {selectedCard?.prompt}
          </h1>
        </div>
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <p className="text-[12px] font-semibold tracking-wide text-[#8F6662]">10분 안에 해보기</p>
          <p className="mt-2 text-[17px] font-semibold leading-[1.7] text-[#243832]">
            {selectedCard?.action}
          </p>

          <p className="mt-6 border-y border-[#EFE4D7] py-5 text-[16px] font-semibold leading-[1.7] text-[#36534E]">
            오늘은 이 한 문장만 꺼내도 충분해요.
          </p>

          <div className="mt-5 rounded-[16px] bg-[#F7F1E8] px-4 py-4 text-[14px] font-medium leading-[1.7] text-[#36534E]">
            이 카드는 성향 결과가 아니라 내가 직접 고른 대화 주제예요. 답은 이 화면 밖으로
            보내지지 않으며, 새로고침하면 사라집니다.
          </div>

          <button type="button" onClick={restart} className={`${secondaryButton} mt-6 w-full`}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            처음부터 다시 보기
          </button>
        </div>
      </section>
    </PrototypeShell>
  );
}

function PrototypeShell({
  children,
  viewportLocked = false,
  showFooter = true,
}: {
  children: React.ReactNode;
  viewportLocked?: boolean;
  showFooter?: boolean;
}) {
  return (
    <main
      className={`ph-no-capture bg-[#FBF8F2] px-2 py-4 sm:px-4 sm:py-10 ${
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
      className={`no-min-tap flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[12px] border px-1 py-2 text-center text-[12px] font-semibold leading-[1.25] transition duration-150 active:scale-[0.98] motion-reduce:transform-none focus-within:outline-none focus-within:ring-2 focus-within:ring-[#36534E] focus-within:ring-offset-1 ${
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
      className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[14px] border px-4 py-3 text-[15px] font-semibold leading-relaxed transition duration-150 active:scale-[0.99] motion-reduce:transform-none ${
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
