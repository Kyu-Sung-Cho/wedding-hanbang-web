'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { sections, type Question } from '../data/questions';
import { validateAnswer } from '../utils/validation';

const LEGACY_DRAFT_STORAGE_KEY = 'wedding_survey_draft';

export type SurveyStatus = 'intro' | 'in_progress' | 'screen_out' | 'completed';

export interface SurveyState {
  answers: Record<string, unknown>;
  otherTexts: Record<string, string>;
  currentSectionIndex: number;
  status: SurveyStatus;
  errors: Record<string, string>;
  startTime: number;
}

export function clearDraft() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
    } catch {
      // 저장소 접근이 차단된 브라우저에서도 설문은 메모리에서 계속 진행한다.
    }
  }
}

export function useSurveyState() {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [status, setStatus] = useState<SurveyStatus>('intro');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const startTimeRef = useRef<number | null>(null);
  const [completionTimeSeconds, setCompletionTimeSeconds] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);

  // 과거 버전이 연락처와 자유서술 응답을 남겼을 수 있어 복원하지 않고 즉시 삭제한다.
  useEffect(() => {
    clearDraft();
  }, []);

  // 민감 설문 응답은 브라우저 영구 저장소에서 복원하지 않는다.
  const resumeDraft = useCallback(() => {
    clearDraft();
    setHasDraft(false);
  }, []);

  const dismissDraft = useCallback(() => {
    clearDraft();
    setHasDraft(false);
  }, []);

  useEffect(() => {
    if (status !== 'in_progress') return;
    const timer = window.setInterval(() => {
      const startTime = startTimeRef.current;
      if (startTime) {
        setCompletionTimeSeconds(Math.round((Date.now() - startTime) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  // 질문이 표시되어야 하는지 체크 (skip logic)
  const isQuestionVisible = useCallback(
    (question: Question): boolean => {
      if (!question.conditionalDisplay) return true;

      const { questionId, value, valueNot, valueIn } = question.conditionalDisplay;
      const parentAnswer = answers[questionId];

      if (value !== undefined) return parentAnswer === value;
      if (valueNot !== undefined) return parentAnswer !== valueNot && parentAnswer !== undefined;
      if (valueIn !== undefined) return Array.isArray(valueIn) && valueIn.includes(parentAnswer as number);

      return true;
    },
    [answers]
  );

  // 현재 섹션의 표시할 질문 목록
  const getVisibleQuestions = useCallback(
    (sectionIndex: number): Question[] => {
      const section = sections[sectionIndex];
      if (!section) return [];

      return section.questions.filter((q) => {
        // 조건부 표시 체크
        if (!isQuestionVisible(q)) return false;

        // q11에서 ⑧ 선택 시 → q11_1, q12 숨김
        if ((q.id === 'q11_1' || q.id === 'q12') && answers['q11'] === 8) return false;

        // q11_1에서 4~5점 선택 시 → q12 숨김
        if (q.id === 'q12') {
          const q11_1Answer = answers['q11_1'] as number | undefined;
          if (q11_1Answer !== undefined && q11_1Answer >= 4) return false;
        }

        return true;
      });
    },
    [answers, isQuestionVisible]
  );

  // 응답 설정
  const setAnswer = useCallback(
    (questionId: string, value: unknown) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value };

        // Screen out 체크
        const question = sections
          .flatMap((s) => s.questions)
          .find((q) => q.id === questionId);

        if (question?.options) {
          const selectedOption = question.options.find((o) => o.value === value);
          if (selectedOption?.screenOut) {
            setTimeout(() => {
              setStatus('screen_out');
              clearDraft();
            }, 300);
          }
        }

        // 조건부 질문 초기화: 부모 값이 바뀌면 자식 답변 제거
        const childQuestions = sections
          .flatMap((s) => s.questions)
          .filter((q) => q.conditionalDisplay?.questionId === questionId);

        for (const child of childQuestions) {
          delete next[child.id];
        }

        return next;
      });

      // 에러 클리어
      setErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    },
    []
  );

  // 기타 텍스트 설정
  const setOtherText = useCallback((questionId: string, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [questionId]: text }));
  }, []);

  // 현재 섹션 검증
  const validateCurrentSection = useCallback((): boolean => {
    const visibleQuestions = getVisibleQuestions(currentSectionIndex);
    const newErrors: Record<string, string> = {};

    for (const q of visibleQuestions) {
      const error = validateAnswer(q, answers[q.id], otherTexts);
      if (error) newErrors[q.id] = error;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [currentSectionIndex, getVisibleQuestions, answers, otherTexts]);

  // 다음 섹션으로 (마지막 섹션에서는 검증만, 완료 처리는 submitSurvey에서)
  const goNext = useCallback((): boolean => {
    if (!validateCurrentSection()) return false;

    if (currentSectionIndex < sections.length - 1) {
      setCurrentSectionIndex((prev) => prev + 1);
      setErrors({});
    }
    return true;
  }, [currentSectionIndex, validateCurrentSection]);

  // 제출 완료 처리
  const markCompleted = useCallback(() => {
    const startTime = startTimeRef.current;
    if (startTime) {
      setCompletionTimeSeconds(Math.round((Date.now() - startTime) / 1000));
    }
    setStatus('completed');
    clearDraft();
  }, []);

  // 이전 섹션으로
  const goPrev = useCallback(() => {
    if (currentSectionIndex > 0) {
      setCurrentSectionIndex((prev) => prev - 1);
      setErrors({});
    }
  }, [currentSectionIndex]);

  // 설문 시작
  const startSurvey = useCallback(() => {
    setStatus('in_progress');
    startTimeRef.current = Date.now();
    setCompletionTimeSeconds(0);
  }, []);

  // 총 진행률 계산
  const progress = status === 'in_progress'
    ? ((currentSectionIndex + 1) / sections.length) * 100
    : 0;

  return {
    answers,
    otherTexts,
    currentSectionIndex,
    currentSection: sections[currentSectionIndex],
    totalSections: sections.length,
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
    setStatus,
    markCompleted,
  };
}
