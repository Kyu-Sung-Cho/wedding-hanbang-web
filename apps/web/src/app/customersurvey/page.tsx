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
import TurnstileWidget from '@/components/auth/TurnstileWidget';

const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
const TURNSTILE_ACTION_AVAILABLE =
  TURNSTILE_ENABLED || process.env.NODE_ENV !== 'production';
const TURNSTILE_WIDGET_ERROR =
  '보안 확인을 불러오지 못했습니다. 다시 시도 버튼을 눌러주세요.';

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
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);
  const [submitError, setSubmitError] = useState('');

  const visibleQuestions = getVisibleQuestions(currentSectionIndex);

  // 섹션 전환 시 스크롤 상단으로 이동
  useEffect(() => {
    if (status === 'in_progress') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentSectionIndex, status]);

  // 검증 에러 발생 시 첫 번째 에러 항목으로 스크롤
  useEffect(() => {
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const firstErrorEl = document.getElementById(`question-${errorKeys[0]}`);
      if (firstErrorEl) {
        firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [errors]);

  // 설문 제출
  const submitSurvey = useCallback(async () => {
    if (!TURNSTILE_ACTION_AVAILABLE) {
      setSubmitError('보안 확인을 점검 중이라 지금은 설문을 제출할 수 없습니다.');
      return;
    }
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setSubmitError('봇 확인을 완료해주세요.');
      return;
    }
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          otherTexts,
          completionTimeSeconds,
          turnstileToken,
        }),
      });

      if (!res.ok) throw new Error('Submit failed');
      markCompleted();
    } catch {
      setSubmitError('제출 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
      if (TURNSTILE_ENABLED) {
        // The provider token may already have been consumed even when the
        // response fails later. Always make the next attempt obtain a new one.
        setTurnstileToken('');
        setTurnstileAttempt((attempt) => attempt + 1);
      }
    }
  }, [answers, otherTexts, completionTimeSeconds, markCompleted, turnstileToken]);

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

  // 섹션 전환 시 스크롤 최상단 이동
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentSectionIndex]);

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
            <AnimatePresence mode="popLayout">
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
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>

        {/* 네비게이션 */}
        {TURNSTILE_ENABLED && (
          <div className="mt-6">
            <TurnstileWidget
              key={`survey-${turnstileAttempt}`}
              action="survey"
              onVerify={(token) => {
                setTurnstileToken(token);
                if (token) {
                  setSubmitError((current) =>
                    current === TURNSTILE_WIDGET_ERROR ? '' : current
                  );
                }
              }}
              onError={() => setSubmitError(TURNSTILE_WIDGET_ERROR)}
            />
          </div>
        )}

        {!TURNSTILE_ACTION_AVAILABLE && (
          <p className="mt-6 text-center text-[13px] leading-relaxed text-[#9A6B62]" role="alert">
            보안 확인을 점검 중이라 지금은 설문을 제출할 수 없습니다. 잠시 후 다시 시도해주세요.
          </p>
        )}

        {submitError && (
          <p className="mt-4 text-center text-[13px] leading-relaxed text-[#9A6B62]" role="alert" aria-live="assertive">
            {submitError}
          </p>
        )}

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
