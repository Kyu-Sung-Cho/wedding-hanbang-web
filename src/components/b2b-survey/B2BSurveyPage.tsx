"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ShopConfig } from "./data/types";
import { useB2BSurvey } from "./hooks/useB2BSurvey";
import Logo from "@/components/ui/Logo";
import SurveyIntro from "./SurveyIntro";
import SurveyProgress from "./SurveyProgress";
import SectionHeader from "./SectionHeader";
import QuestionRenderer from "./QuestionRenderer";
import NavigationButtons from "./NavigationButtons";
import ThankYou from "./ThankYou";

interface Props {
  config: ShopConfig;
}

export default function B2BSurveyPage({ config }: Props) {
  const {
    status,
    currentSection,
    answers,
    otherTexts,
    errors,
    hasDraft,
    progress,
    isLastSection,
    getVisibleQuestions,
    setAnswer,
    setOtherText,
    startFresh,
    resumeDraft,
    goNext,
    goPrev,
    markCompleted,
    getCompletionTime,
  } = useB2BSurvey(config);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [direction, setDirection] = useState(1);
  const prevErrorsRef = useRef<Record<string, string>>({});

  // 페이지 이탈 경고
  useEffect(() => {
    if (status !== "in_progress") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  // 스크롤 to top on section/status change (instant로 확실하게)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentSection, status]);

  // Issue 4: 에러 발생 시 첫 번째 에러 항목으로 자동 스크롤
  useEffect(() => {
    const errorIds = Object.keys(errors);
    const prevErrorIds = Object.keys(prevErrorsRef.current);
    // 새 에러가 발생한 경우에만 스크롤
    if (errorIds.length > 0 && errorIds.length !== prevErrorIds.length) {
      const visibleQs = getVisibleQuestions(currentSection);
      for (const q of visibleQs) {
        if (errors[q.id]) {
          const el = document.getElementById(`question-${q.id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          break;
        }
      }
    }
    prevErrorsRef.current = errors;
  }, [errors, currentSection, getVisibleQuestions]);

  async function handleNext() {
    if (isLastSection) {
      const valid = goNext();
      if (!valid) return;

      setIsSubmitting(true);
      try {
        const res = await fetch("/api/b2b-survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopType: config.shopType,
            answers,
            otherTexts,
            completionTimeSeconds: getCompletionTime(),
          }),
        });

        if (res.ok) {
          markCompleted();
        } else {
          alert("제출 중 오류가 발생했습니다. 다시 시도해 주세요.");
        }
      } catch {
        alert("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setDirection(1);
      goNext();
    }
  }

  function handlePrev() {
    setDirection(-1);
    goPrev();
  }

  // 상태별 렌더링
  if (status === "intro") {
    return (
      <SurveyIntro
        config={config}
        hasDraft={hasDraft}
        onStart={startFresh}
        onResume={resumeDraft}
      />
    );
  }

  if (status === "completed") {
    return <ThankYou shopTypeName={config.shopTypeName} />;
  }

  const section = config.sections[currentSection];
  const visibleQuestions = getVisibleQuestions(currentSection);

  return (
    <div className="min-h-screen bg-gradient-to-b from-ivory-50 to-ivory-warm">
      <div className="max-w-[600px] mx-auto px-5 py-8 md:py-12">
        {/* 로고 */}
        <div className="flex items-center justify-center mb-6">
          <Link href="/business">
            <Logo size="sm" />
          </Link>
        </div>

        {/* 설문 참여 혜택 배너 */}
        <div className="bg-rose-500/[0.05] rounded-xl px-4 py-3 mb-6 border border-rose-500/10">
          <div className="flex items-center gap-2 text-[47px] text-rose-600 font-medium leading-relaxed">
            <span className="shrink-0">✦</span>
            <span>설문 참여 혜택: 정식 출시 우선 초대 · 베타 수수료 할인 · 맞춤 기능 우선 개발</span>
          </div>
        </div>

        <SurveyProgress current={progress.current} total={progress.total} />

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentSection}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.3 }}
          >
            <SectionHeader
              sectionIndex={currentSection}
              title={section.title}
              sectionNote={section.sectionNote}
              additionalNotes={section.additionalNotes}
              exampleBox={section.exampleBox}
            />

            <div className="flex flex-col gap-8">
              {visibleQuestions.map((question, qIdx) => (
                <motion.div
                  key={question.id}
                  id={`question-${question.id}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: qIdx * 0.06, duration: 0.3 }}
                >
                  <div className="mb-3">
                    <h3 className="text-[23px] font-medium text-noir-800 leading-relaxed">
                      {question.question}
                      {question.required && (
                        <span className="text-rose-500 ml-1">*</span>
                      )}
                    </h3>
                    {question.subtitle && (
                      <p className="text-[31px] text-taupe-500 mt-1">
                        {question.subtitle}
                      </p>
                    )}
                  </div>
                  <QuestionRenderer
                    question={question}
                    answer={answers[question.id]}
                    onChange={setAnswer}
                    otherText={otherTexts[question.id]}
                    onOtherTextChange={setOtherText}
                    error={errors[question.id]}
                  />
                </motion.div>
              ))}
            </div>

            <NavigationButtons
              onPrev={handlePrev}
              onNext={handleNext}
              isFirst={currentSection === 0}
              isLast={isLastSection}
              isSubmitting={isSubmitting}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
