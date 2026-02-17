'use client';

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSurveyState } from './hooks/useSurveyState';
import IntroScreen from './components/IntroScreen';
import ScreenOut from './components/ScreenOut';
import ThankYou from './components/ThankYou';
import SurveyProgress from './components/SurveyProgress';
import SectionHeader from './components/SectionHeader';
import QuestionRenderer from './components/QuestionRenderer';
import NavigationButtons from './components/NavigationButtons';

export default function CustomerSurveyPage() {
  const {
    answers,
    otherTexts,
    currentSectionIndex,
    currentSection,
    totalSections,
    status,
    errors,
    progress,
    completionTimeSeconds,
    hasDraft,
    setAnswer,
    setOtherText,
    getVisibleQuestions,
    goNext,
    goPrev,
    startSurvey,
    resumeDraft,
    dismissDraft,
    markCompleted,
  } = useSurveyState();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');

  const visibleQuestions = getVisibleQuestions(currentSectionIndex);

  // 설문 제출
  const submitSurvey = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          otherTexts,
          completionTimeSeconds,
        }),
      });

      if (!res.ok) throw new Error('Submit failed');
      markCompleted();
    } catch {
      alert('제출 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }, [answers, otherTexts, completionTimeSeconds, markCompleted]);

  // 다음 버튼 핸들러
  const handleNext = useCallback(() => {
    setDirection('next');
    const isLast = currentSectionIndex === totalSections - 1;
    if (isLast) {
      const valid = goNext();
      if (valid) submitSurvey();
    } else {
      goNext();
    }
  }, [currentSectionIndex, totalSections, goNext, submitSurvey]);

  // 이전 버튼 핸들러
  const handlePrev = useCallback(() => {
    setDirection('prev');
    goPrev();
  }, [goPrev]);

  // 키보드 Enter 지원
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && status === 'in_progress') {
        // textarea 내에서는 Enter 허용
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, status]);

  // 페이지 이탈 경고
  useEffect(() => {
    if (status !== 'in_progress') return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status]);

  // 상태별 렌더링
  if (status === 'intro') {
    return (
      <IntroScreen
        onStart={startSurvey}
        hasDraft={hasDraft}
        onResume={resumeDraft}
        onDismissDraft={dismissDraft}
      />
    );
  }

  if (status === 'screen_out') {
    return <ScreenOut />;
  }

  if (status === 'completed') {
    return <ThankYou />;
  }

  // 설문 진행 중
  return (
    <div className="min-h-screen bg-ivory-50">
      <div className="max-w-2xl mx-auto px-5 py-8 max-sm:py-6">
        {/* 진행률 */}
        <SurveyProgress
          current={currentSectionIndex + 1}
          total={totalSections}
          progress={progress}
        />

        {/* 섹션 내용 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSection.id}
            initial={{ opacity: 0, x: direction === 'next' ? 50 : -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction === 'next' ? -50 : 50 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            {/* 섹션 헤더 */}
            <SectionHeader
              title={currentSection.title}
              note={currentSection.note}
              sectionNumber={currentSectionIndex + 1}
            />

            {/* 질문 목록 */}
            {visibleQuestions.map((question, index) => (
              <QuestionRenderer
                key={question.id}
                question={question}
                value={answers[question.id]}
                onChange={setAnswer}
                otherText={otherTexts[question.id]}
                onOtherTextChange={setOtherText}
                error={errors[question.id]}
                index={index}
              />
            ))}
          </motion.div>
        </AnimatePresence>

        {/* 네비게이션 */}
        <NavigationButtons
          onPrev={handlePrev}
          onNext={handleNext}
          isFirst={currentSectionIndex === 0}
          isLast={currentSectionIndex === totalSections - 1}
          isSubmitting={isSubmitting}
        />

        {/* 하단 안내 */}
        <p className="text-center text-[12px] text-taupe-400 mt-6 mb-4">
          Enter 키로 다음 페이지로 이동할 수 있습니다
        </p>
      </div>
    </div>
  );
}
