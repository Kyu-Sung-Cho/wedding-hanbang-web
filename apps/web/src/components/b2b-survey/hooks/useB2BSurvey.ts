"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ShopConfig, Question } from "../data/types";

type Status = "intro" | "in_progress" | "completed";
type Answers = Record<string, unknown>;
type OtherTexts = Record<string, string>;
type Errors = Record<string, string>;

const STORAGE_PREFIX = "b2b_survey_";

export function useB2BSurvey(config: ShopConfig) {
  const storageKey = `${STORAGE_PREFIX}${config.shopType}`;
  const startTimeRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>("intro");
  const [currentSection, setCurrentSection] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [otherTexts, setOtherTexts] = useState<OtherTexts>({});
  const [errors, setErrors] = useState<Errors>({});
  const [hasDraft, setHasDraft] = useState(false);

  // localStorage에서 임시 저장 확인 (실제 답변이 있는 경우만 draft로 인정)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const data = JSON.parse(saved);
          const hasAnswers = data.answers && Object.keys(data.answers).length > 0;
          setHasDraft(hasAnswers);
          if (!hasAnswers) {
            localStorage.removeItem(storageKey);
          }
        }
      } catch {
        // localStorage 접근 불가
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  // 자동 저장
  useEffect(() => {
    if (status !== "in_progress") return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ answers, otherTexts, currentSection })
      );
    } catch {
      // 저장 실패 무시
    }
  }, [answers, otherTexts, currentSection, status, storageKey]);

  // 현재 섹션의 보이는 질문 목록
  const getVisibleQuestions = useCallback(
    (sectionIdx: number): Question[] => {
      const section = config.sections[sectionIdx];
      if (!section) return [];
      return section.questions.filter((q) => {
        if (!q.conditionalDisplay) return true;
        const { questionId, valueIn } = q.conditionalDisplay;
        const parentAnswer = answers[questionId];
        return parentAnswer != null && valueIn.includes(parentAnswer as number);
      });
    },
    [config.sections, answers]
  );

  // 유효성 검사
  const validateSection = useCallback(
    (sectionIdx: number): boolean => {
      const visibleQuestions = getVisibleQuestions(sectionIdx);
      const newErrors: Errors = {};

      for (const q of visibleQuestions) {
        if (!q.required) continue;
        const answer = answers[q.id];

        switch (q.type) {
          case "single_choice":
          case "likert_5":
            if (answer == null) {
              newErrors[q.id] = "필수 항목입니다.";
            }
            break;
          case "multiple_choice":
            if (!Array.isArray(answer) || answer.length === 0) {
              newErrors[q.id] = "최소 1개를 선택해주세요.";
            }
            break;
          case "text_area":
            if (!answer || (answer as string).trim() === "") {
              newErrors[q.id] = "필수 항목입니다.";
            }
            break;
        }
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [answers, getVisibleQuestions]
  );

  // 답변 변경
  const setAnswer = useCallback((questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }, []);

  // 기타 텍스트 변경
  const setOtherText = useCallback((questionId: string, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [questionId]: text }));
  }, []);

  // 시작하기
  const startFresh = useCallback(() => {
    setAnswers({});
    setOtherTexts({});
    setCurrentSection(0);
    setErrors({});
    setStatus("in_progress");
    startTimeRef.current = Date.now();
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 무시
    }
  }, [storageKey]);

  // 이어서 하기
  const resumeDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        setAnswers(data.answers || {});
        setOtherTexts(data.otherTexts || {});
        setCurrentSection(data.currentSection || 0);
      }
    } catch {
      // 파싱 실패 시 처음부터
    }
    setStatus("in_progress");
    startTimeRef.current = Date.now();
  }, [storageKey]);

  // 다음 섹션
  const goNext = useCallback((): boolean => {
    if (!validateSection(currentSection)) return false;
    if (currentSection < config.sections.length - 1) {
      setCurrentSection((prev) => prev + 1);
      setErrors({});
      return true;
    }
    return true; // 마지막 섹션
  }, [currentSection, config.sections.length, validateSection]);

  // 이전 섹션
  const goPrev = useCallback(() => {
    if (currentSection > 0) {
      setCurrentSection((prev) => prev - 1);
      setErrors({});
    }
  }, [currentSection]);

  // 완료
  const markCompleted = useCallback(() => {
    setStatus("completed");
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 무시
    }
  }, [storageKey]);

  // 완료 시간 (초)
  const getCompletionTime = useCallback(() => {
    const startTime = startTimeRef.current;
    if (!startTime) return 0;
    return Math.round((Date.now() - startTime) / 1000);
  }, []);

  // 진행률
  const progress = {
    current: currentSection + 1,
    total: config.sections.length,
  };

  const isLastSection = currentSection === config.sections.length - 1;

  return {
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
  };
}
