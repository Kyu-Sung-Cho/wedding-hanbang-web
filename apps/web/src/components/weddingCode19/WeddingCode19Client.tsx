"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import {
  ALL_QUESTIONS_19,
  CHARACTER_PROFILES_19,
  ITEM_INTERPRETATIONS_19,
  PART1_MAIN_OPTIONS,
  PART1_SUB_OPTIONS,
  QUESTION_MAP_19,
  WEDDING_CODE_19_UI_COPY,
  type QuestionId,
  type WeddingCode19Answers,
  type WeddingCode19AnswerValue,
  type WeddingCode19Code,
} from "@/lib/weddingCode19/data";
import {
  buildCoupleComparison19,
  buildPersonalReport19,
  buildWeddingCode19AmoraPrefill,
  createVirtualPartnerAnswers19,
  decodePartnerPayload19,
  encodePartnerPayload19,
  getCeilingCandidates19,
  shouldTriggerCeilingModal19,
  type EncodedPartnerPayload19,
} from "@/lib/weddingCode19/engine";
import { rememberDemoAmoraPrefill } from "@/lib/chat/demoHandoff";

type FlowStep19 = "intro" | "part1" | "bridge" | "part2" | "result";
type ResultTab19 = "personal" | "couple";

const ALL_CHARACTER_CODES = Object.keys(
  CHARACTER_PROFILES_19,
) as WeddingCode19Code[];

export default function WeddingCode19Client({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const RootTag = embedded ? "div" : "main";
  const [step, setStep] = useState<FlowStep19>("intro");
  const [questionIndex, setQuestionIndex] = useState<number>(0); // 0..18 (Q1..Q19)
  const [answers, setAnswers] = useState<WeddingCode19Answers>({});
  const [topPriorityIds, setTopPriorityIds] = useState<QuestionId[]>([]);
  const [showCeilingModal, setShowCeilingModal] = useState<boolean>(false);
  const [ceilingDraftIds, setCeilingDraftIds] = useState<QuestionId[]>([]);
  const [activeTab, setActiveTab] = useState<ResultTab19>("personal");

  // 파트너 URL 데이터 (?partner=...) 및 가상 파트너 시뮬레이터 상태
  const [urlPartnerData] = useState<EncodedPartnerPayload19 | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return decodePartnerPayload19(params.get("partner"));
  });
  const [simulatedPartnerCode, setSimulatedPartnerCode] =
    useState<WeddingCode19Code | null>(null);
  const [showSimulatorPicker, setShowSimulatorPicker] =
    useState<boolean>(false);
  const [copiedNotice, setCopiedNotice] = useState<boolean>(false);
  const [fadeKey, setFadeKey] = useState<number>(0);

  const triggerFade = () => setFadeKey((prev) => prev + 1);

  const currentQuestion = ALL_QUESTIONS_19[questionIndex];
  const ceilingCandidates = useMemo(
    () => getCeilingCandidates19(answers),
    [answers],
  );

  const activePartnerPayload = useMemo<EncodedPartnerPayload19 | null>(() => {
    if (simulatedPartnerCode) {
      return createVirtualPartnerAnswers19(simulatedPartnerCode);
    }
    return urlPartnerData;
  }, [simulatedPartnerCode, urlPartnerData]);

  const personalReport = useMemo(
    () => buildPersonalReport19(answers, topPriorityIds),
    [answers, topPriorityIds],
  );

  const coupleReport = useMemo(() => {
    if (!activePartnerPayload) return null;
    return buildCoupleComparison19(
      answers,
      activePartnerPayload.answers,
      topPriorityIds,
      activePartnerPayload.topPriorityIds,
    );
  }, [answers, topPriorityIds, activePartnerPayload]);

  const amoraPrefillText = useMemo(
    () =>
      buildWeddingCode19AmoraPrefill(
        personalReport,
        activeTab === "couple" ? coupleReport : null,
      ),
    [personalReport, activeTab, coupleReport],
  );

  const handleAmoraHandoffClick = () => {
    if (typeof window === "undefined") return;
    try {
      rememberDemoAmoraPrefill(window.sessionStorage, amoraPrefillText);
      window.localStorage.setItem(
        "hanbang:wedding-code-19:latest",
        JSON.stringify({
          version: 1,
          code: personalReport.code,
          characterName: personalReport.character.characterName,
          encoded: encodePartnerPayload19(answers, topPriorityIds),
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // 브라우저 저장소가 막힌 환경에서도 링크 이동은 그대로 진행한다.
    }
  };

  const handleStartTest = () => {
    triggerFade();
    setQuestionIndex(0);
    setStep("part1");
  };

  const handleSelectAnswer = (
    qId: QuestionId,
    value: WeddingCode19AnswerValue,
  ) => {
    const nextAnswers: WeddingCode19Answers = { ...answers, [qId]: value };
    setAnswers(nextAnswers);

    // 기존에 topPriorityIds에 있던 문항이 5가 아니게 바뀌면 제거
    if (value !== 5 && topPriorityIds.includes(qId)) {
      setTopPriorityIds((prev) => prev.filter((id) => id !== qId));
    }

    triggerFade();

    // Q1 ~ Q11 -> 다음 문항
    if (questionIndex < 11) {
      setQuestionIndex(questionIndex + 1);
      return;
    }

    // Q12 응답 직후 -> [화면 3] 파트 전환 브릿지 화면 노출
    if (questionIndex === 11) {
      setStep("bridge");
      return;
    }

    // Q13 ~ Q18 -> 다음 문항
    if (questionIndex < 18) {
      setQuestionIndex(questionIndex + 1);
      return;
    }

    // Q19 응답 직후 -> 천장 효과 방지 모달 조건(Q5~Q10 중 5가 4개 이상) 검사
    if (shouldTriggerCeilingModal19(nextAnswers)) {
      const candidates = getCeilingCandidates19(nextAnswers);
      setCeilingDraftIds((prev) =>
        prev.filter((id) => candidates.includes(id)).slice(0, 2),
      );
      setShowCeilingModal(true);
      return;
    }

    setTopPriorityIds([]);
    setStep("result");
    if (urlPartnerData) {
      setActiveTab("couple");
    } else {
      setActiveTab("personal");
    }
  };

  const handlePrevQuestion = () => {
    triggerFade();
    if (step === "bridge") {
      setQuestionIndex(11);
      setStep("part1");
      return;
    }
    if (step === "part2") {
      if (questionIndex === 12) {
        setStep("bridge");
      } else {
        setQuestionIndex(questionIndex - 1);
      }
      return;
    }
    if (step === "part1") {
      if (questionIndex === 0) {
        setStep("intro");
      } else {
        setQuestionIndex(questionIndex - 1);
      }
    }
  };

  const handleContinueToPart2 = () => {
    triggerFade();
    setQuestionIndex(12);
    setStep("part2");
  };

  const handleToggleCeilingCandidate = (qId: QuestionId) => {
    setCeilingDraftIds((prev) => {
      if (prev.includes(qId)) {
        return prev.filter((id) => id !== qId);
      }
      if (prev.length >= 2) {
        return [prev[1], qId];
      }
      return [...prev, qId];
    });
  };

  const handleConfirmCeilingModal = () => {
    if (ceilingDraftIds.length !== 2) return;
    setTopPriorityIds(ceilingDraftIds);
    setShowCeilingModal(false);
    triggerFade();
    setStep("result");
    if (urlPartnerData) {
      setActiveTab("couple");
    } else {
      setActiveTab("personal");
    }
  };

  const handleCopyPartnerLink = async () => {
    if (typeof window === "undefined") return;
    const encoded = encodePartnerPayload19(answers, topPriorityIds);
    const shareUrl = `${window.location.origin}/wedding-code?partner=${encodeURIComponent(encoded)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 3000);
    } catch {
      window.prompt("아래 링크를 복사해 파트너에게 전달해 주세요:", shareUrl);
    }
  };

  const handleResetTest = () => {
    triggerFade();
    setAnswers({});
    setTopPriorityIds([]);
    setCeilingDraftIds([]);
    setShowCeilingModal(false);
    setSimulatedPartnerCode(null);
    setShowSimulatorPicker(false);
    setQuestionIndex(0);
    setActiveTab("personal");
    setStep("intro");
  };

  const progressNumber = questionIndex + 1;
  const progressPercent = Math.round((progressNumber / 19) * 100);

  return (
    <RootTag className="min-h-screen bg-[#FAF8F5] px-4 py-6 text-[#3A2A27] sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-[680px] lg:max-w-[760px]">
        {/* 상단 브랜드 헤더 */}
        <header className="mb-5 flex items-center justify-between">
          <Link
            href="/wedding-code"
            className="text-sm font-bold tracking-[0.18em] text-[#8F6662] sm:text-base"
          >
            WEDDING CODE
          </Link>
          {step === "result" && (
            <Button
              variant="ghost"
              type="button"
              onClick={handleResetTest}
              className="rounded-full border border-[#E6DCD2] bg-white px-4 py-1.5 text-xs font-semibold text-[#6E5A54] transition-colors hover:bg-[#F5EFEA] sm:text-sm"
            >
              다시 테스트하기
            </Button>
          )}
        </header>

        {/* 파트너 링크 진입 배너 (URL ?partner=... 존재 시) */}
        {urlPartnerData && (
          <div
            role="status"
            data-testid="wc19-partner-banner"
            className="mb-5 rounded-2xl border border-[#DFC5BE] bg-[#FBF2EF] p-4 text-sm font-medium leading-relaxed text-[#6E4742] shadow-xs sm:p-5 sm:text-base"
          >
            {WEDDING_CODE_19_UI_COPY.intro.partnerBanner}
          </div>
        )}

        {/* [화면 1] 시작 화면 (Intro) */}
        {step === "intro" && (
          <section
            key={`intro-${fadeKey}`}
            data-testid="wc19-screen-intro"
            className="animate-[fadeIn_0.28s_ease-out] rounded-3xl border border-[#EAE1D7] bg-white p-6 shadow-sm sm:p-9 lg:p-11"
          >
            <span className="inline-block rounded-full bg-[#F4EAE6] px-3.5 py-1.5 text-xs font-semibold text-[#8F6662] sm:text-sm">
              19문항 · 약 3분 소요
            </span>
            <h1 className="mt-4 text-2xl font-bold leading-snug text-[#3A2A27] sm:text-3xl lg:text-[32px]">
              {WEDDING_CODE_19_UI_COPY.intro.title}
            </h1>

            <div className="mt-6 space-y-4 rounded-2xl bg-[#FAF8F5] p-5 text-base leading-relaxed text-[#5A4742] sm:p-6 sm:text-[17px]">
              {WEDDING_CODE_19_UI_COPY.intro.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 text-sm text-[#6E5A54] sm:grid-cols-2">
              <div className="rounded-2xl border border-[#EFE7DEC0] bg-[#FDFBF9] p-4 sm:p-5">
                <p className="text-sm font-bold text-[#8F6662] sm:text-base">Track A · 16종 캐릭터</p>
                <p className="mt-1.5 leading-relaxed">
                  4대 축(S/I · D/P · M/E · H/R) 맞춤 성향 분석
                </p>
              </div>
              <div className="rounded-2xl border border-[#EFE7DEC0] bg-[#FDFBF9] p-4 sm:p-5">
                <p className="text-sm font-bold text-[#5F7D6B] sm:text-base">Track B · 커플 처방전</p>
                <p className="mt-1.5 leading-relaxed">
                  장바구니 분류 & 19문항 1:1 맞춤 조율 솔루션
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              type="button"
              data-testid="wc19-start-button"
              onClick={handleStartTest}
              className="mt-8 flex w-full items-center justify-center rounded-2xl bg-[#8F6662] px-6 py-4.5 text-lg font-bold text-white shadow-xs transition-all hover:bg-[#7D5753] active:scale-[0.99] sm:py-5 sm:text-xl"
            >
              [ {WEDDING_CODE_19_UI_COPY.intro.ctaButton} ]
            </Button>
          </section>
        )}

        {/* [화면 2] 파트 1 질문 화면 (1번 ~ 12번) */}
        {step === "part1" && currentQuestion.part === 1 && (
          <section
            key={`part1-${currentQuestion.id}-${fadeKey}`}
            data-testid="wc19-screen-part1"
            className="animate-[fadeIn_0.25s_ease-out] rounded-3xl border border-[#EAE1D7] bg-white p-6 shadow-sm sm:p-9 lg:p-11"
          >
            {/* 상단 진행률 프로그레스 바 & 이전 문항 버튼 */}
            <div className="flex items-center justify-between text-sm font-medium text-[#6E5A54] sm:text-base">
              <Button
                variant="ghost"
                type="button"
                data-testid="wc19-prev-button"
                onClick={handlePrevQuestion}
                className="rounded-xl px-3 py-1.5 text-sm font-semibold text-[#8F6662] transition-colors hover:bg-[#F5EFEA] sm:text-base"
              >
                {WEDDING_CODE_19_UI_COPY.part1.prevButton}
              </Button>
              <span data-testid="wc19-progress-text" className="text-sm font-bold text-[#3A2A27] sm:text-base">
                {progressNumber} / 19
              </span>
            </div>

            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#EFE8DF] sm:h-3">
              <div
                className="h-full rounded-full bg-[#8F6662] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* 섹션 안내 */}
            <p className="mt-5 rounded-xl bg-[#FAF8F5] px-4 py-3 text-sm leading-relaxed text-[#6E5A54] sm:text-[15px]">
              {WEDDING_CODE_19_UI_COPY.part1.sectionGuide}
            </p>

            {/* 카테고리 & 단축명 배지 */}
            <div className="mt-6 flex items-center gap-2.5">
              <span className="rounded-full bg-[#F4EAE6] px-3.5 py-1 text-xs font-bold text-[#8F6662] sm:text-sm">
                {currentQuestion.category}
              </span>
              <span className="text-sm font-semibold text-[#6E5A54] sm:text-base">
                {currentQuestion.shortTitle}
              </span>
            </div>

            {/* 질문 본문 */}
            <h2
              data-testid="wc19-question-title"
              className="mt-4 text-xl font-bold leading-[1.45] tracking-[-0.01em] text-[#3A2A27] sm:text-2xl lg:text-[26px]"
            >
              Q{currentQuestion.number}. {currentQuestion.question}
            </h2>

            {/* 중앙 메인 선택지 버튼 5개 (수직 카드 리스트) */}
            <div className="mt-6 space-y-3 sm:mt-7 sm:space-y-3.5">
              {PART1_MAIN_OPTIONS.map((opt) => {
                const isSelected = answers[currentQuestion.id] === opt.value;
                return (
                  <Button
                    key={opt.value}
                    variant="ghost"
                    type="button"
                    data-testid={`wc19-option-${opt.value}`}
                    onClick={() => handleSelectAnswer(currentQuestion.id, opt.value)}
                    className={`flex w-full !whitespace-normal flex-col items-start rounded-2xl border px-5 py-4 text-left transition-all sm:px-6 sm:py-5 ${
                      isSelected
                        ? "border-[#8F6662] bg-[#F9F0ED] shadow-xs"
                        : "border-[#E6DCD2] bg-white hover:border-[#C8B2A6] hover:bg-[#FAF8F5]"
                    }`}
                  >
                    <span className="text-base font-bold text-[#3A2A27] sm:text-lg">
                      {opt.title}
                    </span>
                    <span className="mt-1 text-sm text-[#6E5A54] sm:text-[15px]">
                      — {opt.description}
                    </span>
                  </Button>
                );
              })}
            </div>

            {/* 하단 구분선 아래 별도 보조 칩 버튼 2개 (작은 캡슐형 버튼 나란히 배치) */}
            <div className="mt-6 border-t border-[#EFE7DE] pt-5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                {PART1_SUB_OPTIONS.map((sub) => {
                  const isSelected = answers[currentQuestion.id] === sub.value;
                  return (
                    <Button
                      key={sub.value}
                      variant="ghost"
                      type="button"
                      data-testid={`wc19-option-${sub.value}`}
                      onClick={() => handleSelectAnswer(currentQuestion.id, sub.value)}
                      className={`flex !whitespace-normal flex-col items-center justify-center rounded-2xl border px-4 py-3 text-center transition-all sm:px-5 sm:py-3.5 ${
                        isSelected
                          ? "border-[#5F7D6B] bg-[#EEF4F0] text-[#355240]"
                          : "border-[#E6DCD2] bg-[#FAF8F5] text-[#6E5A54] hover:bg-[#F3ECE4]"
                      }`}
                    >
                      <span className="text-sm font-bold sm:text-base">{sub.label}</span>
                      <span className="mt-1 text-xs leading-snug opacity-90 sm:text-[13px]">
                        ({sub.description})
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* [화면 3] 파트 전환 브릿지 화면 (12번 응답 직후 노출) */}
        {step === "bridge" && (
          <section
            key={`bridge-${fadeKey}`}
            data-testid="wc19-screen-bridge"
            className="animate-[fadeIn_0.28s_ease-out] rounded-3xl border border-[#EAE1D7] bg-white p-6 text-center shadow-sm sm:p-10 lg:p-12"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF4F0] text-2xl sm:h-16 sm:w-16 sm:text-3xl">
              🌿
            </div>
            <h2 className="mt-5 text-2xl font-bold text-[#3A2A27] sm:text-3xl">
              {WEDDING_CODE_19_UI_COPY.bridge.title}
            </h2>
            <p className="mt-5 rounded-2xl bg-[#FAF8F5] p-5 text-base leading-relaxed text-[#5A4742] sm:p-6 sm:text-lg">
              {WEDDING_CODE_19_UI_COPY.bridge.description}
            </p>
            <div className="mt-7 flex flex-col gap-3">
              <Button
                variant="ghost"
                type="button"
                data-testid="wc19-bridge-continue"
                onClick={handleContinueToPart2}
                className="w-full rounded-2xl bg-[#8F6662] px-6 py-4.5 text-lg font-bold text-white transition-all hover:bg-[#7D5753] sm:py-5 sm:text-xl"
              >
                [ {WEDDING_CODE_19_UI_COPY.bridge.ctaButton} ]
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={handlePrevQuestion}
                className="w-full rounded-xl py-2.5 text-sm font-medium text-[#6E5A54] hover:underline sm:text-base"
              >
                {WEDDING_CODE_19_UI_COPY.part1.prevButton} (12번으로 돌아가기)
              </Button>
            </div>
          </section>
        )}

        {/* [화면 4] 파트 2 질문 화면 (13번 ~ 19번) */}
        {step === "part2" && currentQuestion.part === 2 && (
          <section
            key={`part2-${currentQuestion.id}-${fadeKey}`}
            data-testid="wc19-screen-part2"
            className="animate-[fadeIn_0.25s_ease-out] rounded-3xl border border-[#EAE1D7] bg-white p-6 shadow-sm sm:p-9 lg:p-11"
          >
            <div className="flex items-center justify-between text-sm font-medium text-[#6E5A54] sm:text-base">
              <Button
                variant="ghost"
                type="button"
                data-testid="wc19-prev-button"
                onClick={handlePrevQuestion}
                className="rounded-xl px-3 py-1.5 text-sm font-semibold text-[#8F6662] transition-colors hover:bg-[#F5EFEA] sm:text-base"
              >
                {WEDDING_CODE_19_UI_COPY.part1.prevButton}
              </Button>
              <span data-testid="wc19-progress-text" className="text-sm font-bold text-[#3A2A27] sm:text-base">
                {progressNumber} / 19
              </span>
            </div>

            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#EFE8DF] sm:h-3">
              <div
                className="h-full rounded-full bg-[#5F7D6B] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-6 flex items-center gap-2.5">
              <span className="rounded-full bg-[#EEF4F0] px-3.5 py-1 text-xs font-bold text-[#4A6856] sm:text-sm">
                {currentQuestion.category}
              </span>
              <span className="text-sm font-semibold text-[#6E5A54] sm:text-base">
                {currentQuestion.shortTitle}
              </span>
            </div>

            <h2
              data-testid="wc19-question-title"
              className="mt-4 text-xl font-bold leading-[1.45] tracking-[-0.01em] text-[#3A2A27] sm:text-2xl lg:text-[26px]"
            >
              Q{currentQuestion.number}. {currentQuestion.question}
            </h2>

            {/* 상단 A 보기와 B 보기 강조 테두리가 있는 큼직한 메인 카드 버튼 2개 */}
            <div className="mt-6 space-y-3.5 sm:mt-7 sm:space-y-4">
              {currentQuestion.options
                .filter((opt) => opt.isMain)
                .map((opt) => {
                  const isSelected = answers[currentQuestion.id] === opt.key;
                  return (
                    <Button
                      key={opt.key}
                      variant="ghost"
                      type="button"
                      data-testid={`wc19-option-${opt.key}`}
                      onClick={() => handleSelectAnswer(currentQuestion.id, opt.key)}
                      className={`flex w-full !whitespace-normal items-start gap-3.5 rounded-2xl border-2 p-5 text-left transition-all sm:gap-4 sm:p-6 ${
                        isSelected
                          ? "border-[#8F6662] bg-[#F9F0ED] shadow-xs"
                          : "border-[#D9C7BA] bg-[#FDFBF9] hover:border-[#8F6662] hover:bg-[#FAF4F0]"
                      }`}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#8F6662] text-sm font-bold text-white sm:h-9 sm:w-9 sm:text-base">
                        {opt.key}
                      </span>
                      <span className="text-base font-semibold leading-relaxed text-[#3A2A27] sm:text-lg">
                        {opt.label}
                      </span>
                    </Button>
                  );
                })}
            </div>

            {/* 하단 구분선 아래 C / D / E / (F) 보조 선택지 리스트 */}
            <div className="mt-6 border-t border-[#EFE7DE] pt-5">
              <p className="mb-3 text-xs font-medium text-[#7D6B65] sm:text-sm">
                두 보기 중 고르기 어렵다면 아래에서 선택해 주세요
              </p>
              <div className="space-y-2.5">
                {currentQuestion.options
                  .filter((opt) => !opt.isMain)
                  .map((opt) => {
                    const isSelected = answers[currentQuestion.id] === opt.key;
                    return (
                      <Button
                        key={opt.key}
                        variant="ghost"
                        type="button"
                        data-testid={`wc19-option-${opt.key}`}
                        onClick={() => handleSelectAnswer(currentQuestion.id, opt.key)}
                        className={`flex w-full !whitespace-normal items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm transition-all sm:px-5 sm:py-4 sm:text-[15px] ${
                          isSelected
                            ? "border-[#5F7D6B] bg-[#EEF4F0] font-semibold text-[#355240]"
                            : "border-[#E6DCD2] bg-[#FAF8F5] text-[#5A4742] hover:bg-[#F3ECE4]"
                        }`}
                      >
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#C8B8AC] bg-white text-xs font-bold text-[#6E5A54] sm:h-7 sm:w-7 sm:text-sm">
                          {opt.key}
                        </span>
                        <span className="leading-relaxed">{opt.label}</span>
                      </Button>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        {/* [화면 5] 천장 효과 방지 모달 (Q5~Q10 중 ⑤가 4개 이상일 때만 노출) */}
        {showCeilingModal && (
          <div
            role="dialog"
            aria-modal="true"
            data-testid="wc19-ceiling-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          >
            <div className="w-full max-w-[540px] animate-[fadeIn_0.22s_ease-out] rounded-3xl border border-[#E6DCD2] bg-white p-6 shadow-xl sm:p-8">
              <span className="inline-block rounded-full bg-[#F9F0ED] px-3.5 py-1.5 text-xs font-bold text-[#8F6662] sm:text-sm">
                ✨ 최우선 1순위 2가지 선택 ({ceilingDraftIds.length} / 2)
              </span>
              <p className="mt-4 text-base font-bold leading-relaxed text-[#3A2A27] sm:text-lg">
                {WEDDING_CODE_19_UI_COPY.ceilingModal.message}
              </p>

              <div className="mt-5 space-y-2.5">
                {ceilingCandidates.map((qId) => {
                  const qSpec = QUESTION_MAP_19[qId];
                  const selected = ceilingDraftIds.includes(qId);
                  return (
                    <Button
                      key={qId}
                      variant="ghost"
                      type="button"
                      data-testid={`wc19-ceiling-pick-${qId}`}
                      onClick={() => handleToggleCeilingCandidate(qId)}
                      className={`flex w-full !whitespace-normal items-center justify-between rounded-2xl border px-4 py-3.5 text-left text-sm transition-all sm:px-5 sm:py-4 sm:text-base ${
                        selected
                          ? "border-[#8F6662] bg-[#F9F0ED] font-bold text-[#3A2A27]"
                          : "border-[#E6DCD2] bg-[#FAF8F5] text-[#5A4742] hover:bg-[#F3ECE4]"
                      }`}
                    >
                      <span>
                        Q{qSpec.number}. {qSpec.shortTitle}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold sm:text-sm ${
                          selected
                            ? "bg-[#8F6662] text-white"
                            : "bg-white text-[#8F6662]"
                        }`}
                      >
                        {selected
                          ? WEDDING_CODE_19_UI_COPY.ceilingModal.badgeLabel
                          : "선택"}
                      </span>
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="ghost"
                type="button"
                data-testid="wc19-ceiling-confirm"
                disabled={ceilingDraftIds.length !== 2}
                onClick={handleConfirmCeilingModal}
                className="mt-6 w-full rounded-2xl bg-[#8F6662] px-5 py-4 text-base font-bold text-white transition-all hover:bg-[#7D5753] disabled:cursor-not-allowed disabled:opacity-40 sm:text-lg"
              >
                2가지 최우선 항목 확정하고 결과 보기
              </Button>
            </div>
          </div>
        )}

        {/* [화면 6] 결과 리포트 화면 ([개인 리포트 탭] & [커플 비교 리포트 탭]) */}
        {step === "result" && (
          <section
            key={`result-${fadeKey}`}
            data-testid="wc19-screen-result"
            className="animate-[fadeIn_0.28s_ease-out] space-y-6"
          >
            {/* 상단 탭 전환 바 */}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#E6DCD2] bg-white p-2 shadow-xs">
              <Button
                variant="ghost"
                type="button"
                data-testid="wc19-tab-personal"
                onClick={() => setActiveTab("personal")}
                className={`rounded-xl py-3 sm:py-3.5 text-sm sm:text-base font-bold transition-all ${
                  activeTab === "personal"
                    ? "bg-[#8F6662] text-white shadow-xs"
                    : "text-[#6E5A54] hover:bg-[#FAF8F5]"
                }`}
              >
                나의 웨딩코드 상세 리포트
              </Button>
              <Button
                variant="ghost"
                type="button"
                data-testid="wc19-tab-couple"
                onClick={() => setActiveTab("couple")}
                className={`rounded-xl py-3 sm:py-3.5 text-sm sm:text-base font-bold transition-all ${
                  activeTab === "couple"
                    ? "bg-[#5F7D6B] text-white shadow-xs"
                    : "text-[#6E5A54] hover:bg-[#FAF8F5]"
                }`}
              >
                커플 웨딩코드 비교 리포트
              </Button>
            </div>

            {/* ================= 탭 1: 나의 웨딩코드 상세 리포트 ================= */}
            {activeTab === "personal" && (
              <div className="space-y-6" data-testid="wc19-personal-report">
                {/* 1. 캐릭터 헤더 카드 */}
                <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                  {/* 천장 효과 방지 모달에서 선택된 타협 불가 1순위 배지 */}
                  {personalReport.topPriorityItems.length > 0 && (
                    <div
                      data-testid="wc19-top-priority-banner"
                      className="mb-5 rounded-2xl border border-[#DFC5BE] bg-[#FBF2EF] p-4"
                    >
                      <p className="text-xs sm:text-sm font-bold text-[#8F6662]">
                        🏅 [{WEDDING_CODE_19_UI_COPY.ceilingModal.badgeLabel}]
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {personalReport.topPriorityItems.map((item) => (
                          <span
                            key={item.questionId}
                            className="inline-flex items-center rounded-full bg-[#8F6662] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white"
                          >
                            Q{item.questionNumber}. {item.shortTitle}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-[#F4EAE6] px-3.5 py-1.5 text-xs sm:text-sm font-bold tracking-wider text-[#8F6662]">
                      {personalReport.code}
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-[#6E5A54]">
                      {personalReport.character.codeTag}
                    </span>
                  </div>

                  <div className="mt-5 flex items-center gap-4">
                    <span className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-2xl bg-[#FAF8F5] text-4xl sm:text-5xl">
                      {personalReport.character.emoji}
                    </span>
                    <div>
                      <h1
                        data-testid="wc19-character-name"
                        className="text-xl sm:text-2xl font-bold text-[#3A2A27]"
                      >
                        {personalReport.character.characterName}
                      </h1>
                      <p className="mt-1.5 text-sm sm:text-base font-medium leading-relaxed text-[#6E5A54]">
                        {personalReport.character.oneLineDef}
                      </p>
                    </div>
                  </div>

                  {/* 4개 축 점수 비율(%) 양방향 게이지 바 */}
                  <div className="mt-6 space-y-3.5 rounded-2xl bg-[#FAF8F5] p-5">
                    {(
                      [
                        personalReport.axes.axis1,
                        personalReport.axes.axis2,
                        personalReport.axes.axis3,
                        personalReport.axes.axis4,
                      ] as const
                    ).map((ax) => (
                      <div key={ax.axisNumber} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs sm:text-sm font-semibold">
                          <span
                            className={
                              ax.winner === ax.leftLetter
                                ? "text-[#8F6662]"
                                : "text-[#8A7972]"
                            }
                          >
                            {ax.leftLabel} {ax.leftPercent}%
                          </span>
                          <span
                            className={
                              ax.winner === ax.rightLetter
                                ? "text-[#5F7D6B]"
                                : "text-[#8A7972]"
                            }
                          >
                            {ax.rightPercent}% {ax.rightLabel}
                          </span>
                        </div>
                        <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#E6DCD2]">
                          <div
                            className="h-full bg-[#8F6662] transition-all"
                            style={{ width: `${ax.leftPercent}%` }}
                          />
                          <div
                            className="h-full bg-[#5F7D6B] transition-all"
                            style={{ width: `${ax.rightPercent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 상세 성향 해설 / 강점 / 주의할 함정과 팁 */}
                  <div className="mt-6 space-y-4 text-sm sm:text-base leading-relaxed text-[#4A3A36]">
                    <div className="rounded-2xl border border-[#EFE7DE] bg-[#FDFBF9] p-5">
                      <p className="text-sm sm:text-base font-bold text-[#8F6662]">상세 성향 해설</p>
                      <p className="mt-2 text-sm sm:text-[15px] leading-relaxed">
                        {personalReport.character.detailedAnalysis}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[#E2ECE5] bg-[#F5FAF7] p-5">
                      <p className="text-sm sm:text-base font-bold text-[#4A6856]">🌿 결혼 준비 강점</p>
                      <p className="mt-2 text-sm sm:text-[15px] leading-relaxed">
                        {personalReport.character.strengths}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[#F0DFDA] bg-[#FCF6F4] p-5">
                      <p className="text-sm sm:text-base font-bold text-[#8F6662]">💡 주의할 함정과 팁</p>
                      <p className="mt-2 text-sm sm:text-[15px] leading-relaxed">
                        {personalReport.character.cautionAndTip}
                      </p>
                    </div>
                  </div>

                  {/* 찰떡 웨딩 키워드 해시태그 */}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {personalReport.character.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-full bg-[#F4EAE6] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-[#8F6662]"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 2. 한눈에 보는 나의 웨딩 장바구니 */}
                <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                  <h2 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                    한눈에 보는 나의 웨딩 장바구니
                  </h2>
                  <p className="mt-1.5 text-sm text-[#6E5A54]">
                    내가 고른 응답을 바탕으로 우선순위·절약·양보·미정 항목을 분류했어요.
                  </p>

                  <div className="mt-5 space-y-4">
                    {/* 🌟 다른 걸 줄여서라도 꼭 살릴 1순위 (⑤ 정말 그렇다) */}
                    <div className="rounded-2xl border border-[#DFC5BE] bg-[#FCF7F5] p-5">
                      <h3 className="text-sm sm:text-base font-bold text-[#8F6662]">
                        🌟 다른 걸 줄여서라도 꼭 살릴 1순위 (⑤ 정말 그렇다)
                      </h3>
                      {personalReport.basket.mustHave5.length === 0 ? (
                        <p className="mt-2 text-sm text-[#7D6B65]">
                          해당하는 항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-3">
                          {personalReport.basket.mustHave5.map((item) => (
                            <li
                              key={item.questionId}
                              className="rounded-xl bg-white p-4 shadow-2xs"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                  Q{item.questionNumber}. {item.shortTitle}
                                </span>
                                {item.isTopPriority && (
                                  <span className="rounded-full bg-[#8F6662] px-2.5 py-0.5 text-xs font-bold text-white">
                                    [{WEDDING_CODE_19_UI_COPY.ceilingModal.badgeLabel}]
                                  </span>
                                )}
                              </div>
                              <p className="mt-1.5 text-sm leading-relaxed text-[#5A4742]">
                                {item.interpretation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* ✨ 여건 되면 챙길 관심 항목 (④ 대체로 그렇다) */}
                    <div className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-5">
                      <h3 className="text-sm sm:text-base font-bold text-[#5A4742]">
                        ✨ 여건 되면 챙길 관심 항목 (④ 대체로 그렇다)
                      </h3>
                      {personalReport.basket.niceToHave4.length === 0 ? (
                        <p className="mt-2 text-sm text-[#7D6B65]">
                          해당하는 항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-3">
                          {personalReport.basket.niceToHave4.map((item) => (
                            <li
                              key={item.questionId}
                              className="rounded-xl bg-white p-4 shadow-2xs"
                            >
                              <p className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                Q{item.questionNumber}. {item.shortTitle}
                              </p>
                              <p className="mt-1.5 text-sm leading-relaxed text-[#5A4742]">
                                {item.interpretation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* ✂️ 과감히 힘을 뺄 절약·간소화 포인트 (① 전혀 아니다 / ② 별로 아니다) */}
                    <div className="rounded-2xl border border-[#E2ECE5] bg-[#F5FAF7] p-5">
                      <h3 className="text-sm sm:text-base font-bold text-[#4A6856]">
                        ✂️ 과감히 힘을 뺄 절약·간소화 포인트 (① 전혀 아니다 / ② 별로 아니다)
                      </h3>
                      {personalReport.basket.saveSimplify12.length === 0 ? (
                        <p className="mt-2 text-sm text-[#7D6B65]">
                          해당하는 항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-3">
                          {personalReport.basket.saveSimplify12.map((item) => (
                            <li
                              key={item.questionId}
                              className="rounded-xl bg-white p-4 shadow-2xs"
                            >
                              <p className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                Q{item.questionNumber}. {item.shortTitle}
                              </p>
                              <p className="mt-1.5 text-sm leading-relaxed text-[#5A4742]">
                                {item.interpretation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 🎁 파트너에게 맞춰줄 양보 찬스 카드 (③ 어느 쪽이든 괜찮다 / D) */}
                    <div className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-5">
                      <h3 className="text-sm sm:text-base font-bold text-[#6E5A54]">
                        🎁 파트너에게 맞춰줄 양보 찬스 카드 (③ 어느 쪽이든 괜찮다 / D)
                      </h3>
                      {personalReport.basket.concession3D.length === 0 ? (
                        <p className="mt-2 text-sm text-[#7D6B65]">
                          해당하는 항목이 없습니다.
                        </p>
                      ) : (
                        <>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {personalReport.basket.concession3D.map((item) => (
                              <span
                                key={item.questionId}
                                className="rounded-full border border-[#D9C7BA] bg-white px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-[#6E5A54]"
                              >
                                #Q{item.questionNumber}_{item.shortTitle}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2.5 text-sm leading-relaxed text-[#6E5A54]">
                            이 항목들은 내가 크게 고집하지 않아 파트너의 희망에 기분 좋게 맞춰줄 수 있는 소중한 양보 카드입니다.
                          </p>
                        </>
                      )}
                    </div>

                    {/* ⚖️ 반반 균형·절충 선호 항목 (C) */}
                    <div className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-5">
                      <h3 className="text-sm sm:text-base font-bold text-[#6E5A54]">
                        ⚖️ 반반 균형·절충 선호 항목 (C)
                      </h3>
                      {personalReport.basket.balancedC.length === 0 ? (
                        <p className="mt-2 text-sm text-[#7D6B65]">
                          해당하는 항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="mt-2.5 space-y-2.5">
                          {personalReport.basket.balancedC.map((item) => (
                            <li
                              key={item.questionId}
                              className="rounded-xl bg-white p-4 text-sm"
                            >
                              <p className="font-bold text-[#3A2A27]">
                                Q{item.questionNumber}. {item.shortTitle}
                              </p>
                              <p className="mt-1.5 leading-relaxed text-[#5A4742]">
                                {item.interpretation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 🔍 함께 알아볼 미정 빈칸 (⚪ 아직 모르겠다 / E) */}
                    <div className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-5">
                      <h3 className="text-sm sm:text-base font-bold text-[#6E5A54]">
                        🔍 함께 알아볼 미정 빈칸 (⚪ 아직 모르겠다 / E)
                      </h3>
                      {personalReport.basket.undecidedUnknownE.length === 0 ? (
                        <p className="mt-2 text-sm text-[#7D6B65]">
                          해당하는 항목이 없습니다.
                        </p>
                      ) : (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {personalReport.basket.undecidedUnknownE.map((item) => (
                            <span
                              key={item.questionId}
                              className="rounded-full bg-white px-3.5 py-1.5 text-xs sm:text-sm font-medium text-[#6E5A54]"
                            >
                              Q{item.questionNumber}. {item.shortTitle}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. 나만의 준비 워크스타일 & 위기관리 매뉴얼 */}
                <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                  <h2 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                    나만의 준비 워크스타일 & 위기관리 매뉴얼
                  </h2>
                  <p className="mt-1.5 text-sm text-[#6E5A54]">
                    예식 무대부터 탐색·예산·협업·갈등 대화법까지 내 답변의 상세 해석입니다.
                  </p>

                  <div className="mt-5 space-y-5">
                    {personalReport.workstyleSections.map((sec) => {
                      if (sec.items.length === 0) return null;
                      return (
                        <div
                          key={sec.sectionId}
                          className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-5"
                        >
                          <h3 className="text-sm sm:text-base font-bold text-[#8F6662]">
                            {sec.title}
                          </h3>
                          <p className="mt-0.5 text-xs sm:text-sm text-[#7D6B65]">{sec.subtitle}</p>
                          <ul className="mt-3.5 space-y-3">
                            {sec.items.map((item) => (
                              <li
                                key={item.questionId}
                                className="rounded-xl bg-white p-4 shadow-2xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                    Q{item.questionNumber}. {item.shortTitle}
                                  </span>
                                  <span className="rounded-full bg-[#FAF8F5] px-3 py-1 text-xs font-semibold text-[#8F6662]">
                                    {item.answerBadge}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm leading-relaxed text-[#5A4742]">
                                  {item.interpretation}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 하단 커플 비교 리포트 유도 CTA */}
                <div className="rounded-3xl border border-[#DFC5BE] bg-[#FBF2EF] p-6 text-center">
                  <p className="text-sm sm:text-base font-bold text-[#6E4742]">
                    파트너와 내 웨딩코드를 맞춰보고 싶다면?
                  </p>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setActiveTab("couple")}
                    className="mt-3.5 w-full rounded-2xl bg-[#8F6662] px-6 py-4 text-sm sm:text-base font-semibold text-white transition-all hover:bg-[#7D5753]"
                  >
                    커플 웨딩코드 비교 리포트 열기 →
                  </Button>
                </div>
              </div>
            )}

            {/* ================= 탭 2: 커플 웨딩코드 비교 리포트 ================= */}
            {activeTab === "couple" && (
              <div className="space-y-6" data-testid="wc19-couple-tab">
                {/* 파트너 링크 공유 & 가상 파트너 시뮬레이터 컨트롤 */}
                <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                  <h2 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                    파트너와 웨딩코드 연결하기
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#6E5A54]">
                    내 결과 링크를 파트너에게 보내거나, 가상 파트너 캐릭터를 골라 커플 리포트를 바로 미리볼 수 있어요.
                  </p>

                  <div className="mt-5 space-y-3">
                    <Button
                      variant="ghost"
                      type="button"
                      data-testid="wc19-share-partner-button"
                      onClick={handleCopyPartnerLink}
                      className="flex w-full items-center justify-center rounded-2xl bg-[#8F6662] px-6 py-4 text-sm sm:text-base font-bold text-white transition-all hover:bg-[#7D5753]"
                    >
                      [ 카카오톡/링크로 파트너에게 내 결과 보내기 ]
                    </Button>
                    {copiedNotice && (
                      <p
                        role="status"
                        className="text-center text-sm font-semibold text-[#5F7D6B]"
                      >
                        ✓ 파트너 초대 링크가 복사되었어요! 카카오톡이나 메시지로 붙여넣어 보내주세요.
                      </p>
                    )}

                    <Button
                      variant="ghost"
                      type="button"
                      data-testid="wc19-simulator-toggle"
                      onClick={() => setShowSimulatorPicker((prev) => !prev)}
                      className="flex w-full items-center justify-center rounded-2xl border border-[#5F7D6B] bg-[#EEF4F0] px-6 py-4 text-sm sm:text-base font-bold text-[#355240] transition-all hover:bg-[#E1EDE5]"
                    >
                      [ 가상 파트너 선택해서 커플 리포트 미리보기 ]
                    </Button>
                  </div>

                  {showSimulatorPicker && (
                    <div
                      data-testid="wc19-simulator-grid"
                      className="mt-5 rounded-2xl bg-[#FAF8F5] p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-[#3A2A27]">
                          가상 파트너 캐릭터 선택 (16종)
                        </span>
                        {simulatedPartnerCode && (
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() => setSimulatedPartnerCode(null)}
                            className="text-xs font-semibold text-[#8F6662] underline"
                          >
                            시뮬레이터 해제
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {ALL_CHARACTER_CODES.map((code) => {
                          const profile = CHARACTER_PROFILES_19[code];
                          const isSelected = simulatedPartnerCode === code;
                          return (
                            <Button
                              key={code}
                              variant="ghost"
                              type="button"
                              data-testid={`wc19-sim-partner-${code}`}
                              onClick={() => setSimulatedPartnerCode(code)}
                              className={`flex !whitespace-normal items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                                isSelected
                                  ? "border-[#5F7D6B] bg-[#EEF4F0] font-bold text-[#355240]"
                                  : "border-[#E6DCD2] bg-white text-[#5A4742] hover:bg-[#F5EFEA]"
                              }`}
                            >
                              <span className="text-xl">{profile.emoji}</span>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[#8F6662]">
                                  {code}
                                </p>
                                <p className="truncate text-sm font-semibold text-[#3A2A27]">
                                  {profile.characterName}
                                </p>
                              </div>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* 파트너 데이터가 있을 때: 5대 섹션 전체 출력 */}
                {coupleReport && (
                  <div
                    className="space-y-6"
                    data-testid="wc19-couple-comparison-content"
                  >
                    {/* 1. 두 동물의 만남 헤더 */}
                    <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                      <p className="text-center text-sm sm:text-base font-bold text-[#8F6662]">
                        {simulatedPartnerCode
                          ? "✨ 가상 파트너 시뮬레이션 리포트"
                          : "💑 두 사람의 웨딩코드 케미 리포트"}
                      </p>
                      <div className="mt-5 grid grid-cols-2 gap-4">
                        <div className="rounded-2xl bg-[#FAF8F5] p-5 text-center">
                          <span className="text-3xl sm:text-4xl">
                            {coupleReport.myReport.character.emoji}
                          </span>
                          <p className="mt-2 text-xs sm:text-sm font-bold text-[#8F6662]">
                            나 · {coupleReport.myReport.code}
                          </p>
                          <p className="mt-1 text-sm sm:text-base font-bold text-[#3A2A27]">
                            {coupleReport.myReport.character.characterName}
                          </p>
                          <p className="mt-1 text-xs text-[#6E5A54]">
                            {coupleReport.myReport.character.codeTag}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#F5FAF7] p-5 text-center">
                          <span className="text-3xl sm:text-4xl">
                            {coupleReport.partnerReport.character.emoji}
                          </span>
                          <p className="mt-2 text-xs sm:text-sm font-bold text-[#4A6856]">
                            파트너 · {coupleReport.partnerReport.code}
                          </p>
                          <p className="mt-1 text-sm sm:text-base font-bold text-[#3A2A27]">
                            {coupleReport.partnerReport.character.characterName}
                          </p>
                          <p className="mt-1 text-xs text-[#6E5A54]">
                            {coupleReport.partnerReport.character.codeTag}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* 2. 4대 축 기준 우리의 강점(Synergy) & 주의할 점(Caution) + 번아웃·대화 시점 차이 경고(Q17·Q18) */}
                    <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                      <h3 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                        4대 축 기준 우리의 강점(Synergy) & 주의할 점(Caution)
                      </h3>
                      <div className="mt-5 space-y-4">
                        {coupleReport.axisSynergies.map((syn) => (
                          <div
                            key={syn.axisKey}
                            className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                {syn.axisTitle}
                              </span>
                              <span className="rounded-full bg-[#F4EAE6] px-3 py-1 text-xs sm:text-sm font-bold text-[#8F6662]">
                                {syn.pairLabel}
                              </span>
                            </div>
                            <div className="mt-3 space-y-2.5 text-sm leading-relaxed">
                              <p className="text-[#355240]">
                                <strong className="font-bold">🌿 강점: </strong>
                                {syn.strength}
                              </p>
                              <p className="text-[#7D4E47]">
                                <strong className="font-bold">⚠️ 주의할 점: </strong>
                                {syn.caution}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 번아웃·대화 시점 차이 경고 (Q17·Q18) */}
                      {coupleReport.crisisWarnings.length > 0 && (
                        <div className="mt-5 rounded-2xl border border-[#DFC5BE] bg-[#FCF6F4] p-5">
                          <p className="text-sm sm:text-base font-bold text-[#8F6662]">
                            🚨 번아웃·대화 시점 차이 주의보 (Q17·Q18)
                          </p>
                          <div className="mt-3 space-y-3">
                            {coupleReport.crisisWarnings.map((warn) => (
                              <div
                                key={warn.questionId}
                                className="rounded-xl bg-white p-4 text-sm leading-relaxed text-[#5A4742]"
                              >
                                <p className="font-bold text-[#3A2A27]">
                                  Q{warn.questionNumber}. {warn.shortTitle}
                                </p>
                                <p className="mt-1.5">{warn.conflictSolution}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 3. 고민 없이 바로 통과! 완벽히 통하는 기준 */}
                    <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                      <h3 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                        고민 없이 바로 통과! 완벽히 통하는 기준
                      </h3>
                      <p className="mt-1.5 text-sm text-[#6E5A54]">
                        두 사람의 방향이 일치해 긴 논의 없이 기분 좋게 진행할 수 있는 항목입니다.
                      </p>
                      {coupleReport.alignedItems.length === 0 ? (
                        <p className="mt-3 text-sm text-[#7D6B65]">
                          일치하는 항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="mt-4 space-y-3">
                          {coupleReport.alignedItems.map((item) => (
                            <li
                              key={item.questionId}
                              className="rounded-2xl border border-[#E2ECE5] bg-[#F5FAF7] p-4"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                  Q{item.questionNumber}. {item.shortTitle}
                                </span>
                                <span className="text-xs sm:text-sm font-semibold text-[#4A6856]">
                                  나: {item.myAnswerBadge} · 파트너: {item.partnerAnswerBadge}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-[#4A3A36]">
                                {item.sharedInterpretation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 4. 갈등 제로! 서로 기분 좋게 맞춰줄 찬스 카드 */}
                    <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                      <h3 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                        갈등 제로! 서로 기분 좋게 맞춰줄 찬스 카드
                      </h3>
                      <p className="mt-1.5 text-sm text-[#6E5A54]">
                        한 명은 확고한 선호가 있고, 다른 한 명은 ‘상대에게 맞출 수 있다(③/D)’를 골라 갈등 없이 해결되는 항목입니다.
                      </p>
                      {coupleReport.concessionMatches.length === 0 ? (
                        <p className="mt-3 text-sm text-[#7D6B65]">
                          해당하는 양보 매칭 항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="mt-4 space-y-3">
                          {coupleReport.concessionMatches.map((item) => (
                            <li
                              key={item.questionId}
                              className="rounded-2xl border border-[#EFE7DE] bg-[#FAF8F5] p-4"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm sm:text-base font-bold text-[#3A2A27]">
                                  Q{item.questionNumber}. {item.shortTitle}
                                </span>
                                <span className="rounded-full bg-[#F4EAE6] px-3 py-1 text-xs font-bold text-[#8F6662]">
                                  {item.preferredBy === "me"
                                    ? "파트너가 나에게 양보 🎁"
                                    : "내가 파트너에게 양보 🎁"}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-[#5A4742]">
                                {item.preferredInterpretation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 5. 시작 전에 꼭 맞춰봐야 할 조율 포인트 & 1:1 처방전 */}
                    <div className="rounded-3xl border border-[#EAE1D7] bg-white p-6 sm:p-9 lg:p-10 shadow-sm">
                      <h3 className="text-lg sm:text-xl font-bold text-[#3A2A27]">
                        시작 전에 꼭 맞춰봐야 할 조율 포인트 & 1:1 처방전
                      </h3>
                      <p className="mt-1.5 text-sm text-[#6E5A54]">
                        두 사람이 반대 방향을 고른 문항의 각자 입장과 커플 맞춤 조율 솔루션입니다.
                      </p>
                      {coupleReport.conflictItems.length === 0 ? (
                        <p className="mt-3 rounded-2xl bg-[#F5FAF7] p-4 text-sm font-semibold text-[#4A6856]">
                          🎉 두 사람이 정반대로 충돌한 문항이 하나도 없습니다!
                        </p>
                      ) : (
                        <ul className="mt-5 space-y-4">
                          {coupleReport.conflictItems.map((conf) => (
                            <li
                              key={conf.questionId}
                              data-testid={`wc19-conflict-${conf.questionId}`}
                              className="rounded-2xl border border-[#DFC5BE] bg-[#FCF7F5] p-5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-base font-bold text-[#3A2A27]">
                                  Q{conf.questionNumber}.{" "}
                                  {ITEM_INTERPRETATIONS_19[conf.questionId].shortTitle}
                                </span>
                                {(conf.myTopPriority || conf.partnerTopPriority) && (
                                  <span className="rounded-full bg-[#8F6662] px-3 py-1 text-xs font-bold text-white">
                                    [{WEDDING_CODE_19_UI_COPY.ceilingModal.badgeLabel}]
                                  </span>
                                )}
                              </div>

                              <div className="mt-3.5 space-y-2.5 rounded-xl bg-white p-4 text-sm leading-relaxed">
                                <p className="text-[#5A4742]">
                                  <strong className="font-bold text-[#8F6662]">
                                    나의 입장 ({conf.myAnswerBadge}):{" "}
                                  </strong>
                                  {conf.myStance}
                                </p>
                                <p className="text-[#5A4742]">
                                  <strong className="font-bold text-[#4A6856]">
                                    파트너 입장 ({conf.partnerAnswerBadge}):{" "}
                                  </strong>
                                  {conf.partnerStance}
                                </p>
                              </div>

                              <div className="mt-3.5 rounded-xl border border-[#DFC5BE] bg-white p-4 text-sm leading-relaxed text-[#3A2A27]">
                                <p className="font-bold text-[#8F6662]">
                                  💡 [커플 맞춤 조율 솔루션]
                                </p>
                                <p className="mt-1.5">{conf.conflictSolution}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 웨딩한방 AI 비서 아모라 & 워크스페이스 연동 카드 */}
            <div
              data-testid="wc19-amora-handoff-card"
              className="rounded-3xl border border-[#DFC5BE] bg-gradient-to-br from-[#FCF7F5] to-[#F5EFE6] p-6 sm:p-9 lg:p-10 shadow-sm"
            >
              <span className="inline-block rounded-full bg-[#8F6662]/15 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-[#8F6662]">
                AI 웨딩 비서 아모라 연동
              </span>
              <h3 className="mt-3 text-lg sm:text-xl font-bold text-[#3A2A27]">
                이 웨딩코드 결과를 바탕으로 결혼 준비 첫 순서를 잡아볼까요?
              </h3>
              <p className="mt-2 text-sm sm:text-base leading-relaxed text-[#5A4742]">
                나의 1순위·절약 항목과 커플 조율 포인트를 AI 웨딩 비서 아모라에게 그대로 전달해 맞춤형 예산 배분과 준비 체크리스트를 바로 시작할 수 있어요.
              </p>

              <div className="mt-4 rounded-2xl border border-[#EAE1D7] bg-white/90 p-4 text-sm leading-relaxed text-[#5A4742]">
                <p className="text-xs sm:text-sm font-bold text-[#8F6662]">
                  💬 아모라에게 전달될 첫 질문 미리보기
                </p>
                <p data-testid="wc19-amora-prefill-preview" className="mt-1.5">
                  {amoraPrefillText}
                </p>
              </div>

              <div className="mt-5 space-y-3">
                <Link
                  href={`/wedding/chat?prefill=${encodeURIComponent(amoraPrefillText)}`}
                  onClick={handleAmoraHandoffClick}
                  data-testid="wc19-start-amora-cta"
                  className="flex w-full items-center justify-center rounded-2xl bg-[#8F6662] px-6 py-4 text-center text-sm sm:text-base font-semibold text-white shadow-xs transition hover:bg-[#7A5450]"
                >
                  [ 이 웨딩코드로 아모라 AI 맞춤 결혼 준비 시작하기 ]
                </Link>

                <div className="grid grid-cols-2 gap-2.5">
                  <Link
                    href="/wedding/lounge"
                    onClick={handleAmoraHandoffClick}
                    className="flex items-center justify-center rounded-xl border border-[#D8C7B8] bg-white px-4 py-3 text-center text-xs sm:text-sm font-semibold text-[#3A2A27] transition hover:bg-[#FAF6F0]"
                  >
                    내 웨딩 라운지 열기
                  </Link>
                  <Link
                    href="/price"
                    className="flex items-center justify-center rounded-xl border border-[#D8C7B8] bg-white px-4 py-3 text-center text-xs sm:text-sm font-semibold text-[#3A2A27] transition hover:bg-[#FAF6F0]"
                  >
                    공시가격 탐색기 보기
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </RootTag>
  );
}
