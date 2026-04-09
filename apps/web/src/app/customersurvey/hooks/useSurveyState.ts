'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { sections, type Question } from '../data/questions';
import { validateAnswer } from '../utils/validation';

const LOCAL_STORAGE_KEY = 'wedding_survey_draft';

export type SurveyStatus = 'intro' | 'in_progress' | 'screen_out' | 'completed';

export interface SurveyState {
  answers: Record<string, unknown>;
  otherTexts: Record<string, string>;
  currentSectionIndex: number;
  status: SurveyStatus;
  errors: Record<string, string>;
  startTime: number;
}

function loadDraft(): Partial<SurveyState> | null {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // localStorage 접근 불가 시 무시
  }
  return null;
}

function saveDraft(state: SurveyState) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 접근 불가 시 무시
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // localStorage 접근 불가 시 무시
  }
}

export function useSurveyState() {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [status, setStatus] = useState<SurveyStatus>('intro');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const startTimeRef = useRef(Date.now());
  const [hasDraft, setHasDraft] = useState(false);

  // 초기 로드: localStorage 확인
  useEffect(() => {
    const draft = loadDraft();
    if (draft && draft.answers && Object.keys(draft.answers).length > 0) {
      setHasDraft(true);
    }
  }, []);

  // 이어하기
  const resumeDraft = useCallback(() => {
    const draft = loadDraft();
    if (draft) {
      setAnswers(draft.answers ?? {});
      setOtherTexts(draft.otherTexts ?? {});
      setCurrentSectionIndex(draft.currentSectionIndex ?? 0);
      setStatus('in_progress');
      startTimeRef.current = draft.startTime ?? Date.now();
    }
    setHasDraft(false);
  }, []);

  const dismissDraft = useCallback(() => {
    clearDraft();
    setHasDraft(false);
  }, []);

  // 자동 저장
  useEffect(() => {
    if (status === 'in_progress') {
      saveDraft({
        answers,
        otherTexts,
        currentSectionIndex,
        status,
        errors: {},
        startTime: startTimeRef.current,
      });
    }
  }, [answers, otherTexts, currentSectionIndex, status]);

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
  }, []);

  // 총 진행률 계산
  const progress = status === 'in_progress'
    ? ((currentSectionIndex + 1) / sections.length) * 100
    : 0;

  // 완료 시간 (초)
  const completionTimeSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);

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
