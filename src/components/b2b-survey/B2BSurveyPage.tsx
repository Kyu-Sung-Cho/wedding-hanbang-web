"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShopConfig } from "./data/types";
import { useB2BSurvey } from "./hooks/useB2BSurvey";
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

  // 페이지 이탈 경고
  useEffect(() => {
    if (status !== "in_progress") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  // 스크롤 to top on section change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentSection]);

  async function handleNext() {
    if (isLastSection) {
      // 마지막 섹션: 유효성 검사 후 제출
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
              exampleBox={section.exampleBox}
            />

            <div className="flex flex-col gap-8">
              {visibleQuestions.map((question, qIdx) => (
                <motion.div
                  key={question.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: qIdx * 0.06, duration: 0.3 }}
                >
                  <div className="mb-3">
                    <h3 className="text-[15px] font-medium text-noir-800 leading-relaxed">
                      {question.question}
                      {question.required && (
                        <span className="text-rose-500 ml-1">*</span>
                      )}
                    </h3>
                    {question.subtitle && (
                      <p className="text-[13px] text-taupe-500 mt-1">
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
