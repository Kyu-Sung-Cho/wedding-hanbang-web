import type { Question } from '../data/questions';

// 이메일 또는 전화번호 검증
export function validateEmailOrPhone(value: string): boolean {
  if (!value) return true; // 선택 항목이므로 빈값 허용
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^01[0-9]-?\d{3,4}-?\d{4}$/;
  return emailRegex.test(value) || phoneRegex.test(value);
}

// 질문별 응답 유효성 검사
export function validateAnswer(
  question: Question,
  answer: unknown,
  otherTexts: Record<string, string>
): string | null {
  if (!question.required) return null;

  switch (question.type) {
    case 'single_choice':
      if (answer === undefined || answer === null) return '항목을 선택해 주세요.';
      break;

    case 'multiple_choice':
      if (!Array.isArray(answer) || answer.length === 0) return '항목을 선택해 주세요.';
      break;

    case 'likert_5':
      if (answer === undefined || answer === null) return '항목을 선택해 주세요.';
      break;

    case 'ranking':
      if (!Array.isArray(answer) || answer.length < (question.maxRank ?? 3))
        return `${question.maxRank ?? 3}개를 순위대로 선택해 주세요.`;
      break;

    case 'nps':
      if (answer === undefined || answer === null) return '점수를 선택해 주세요.';
      break;

    case 'price_input': {
      if (!question.subQuestions) break;
      const prices = answer as Record<string, number | undefined> | undefined;
      for (const sq of question.subQuestions) {
        if (!prices || prices[sq.id] === undefined || prices[sq.id] === null)
          return '금액을 입력해 주세요.';
      }
      break;
    }

    case 'text_area':
      // 선택 항목이므로 별도 검증 불필요
      break;

    case 'text_input':
      if (typeof answer !== 'string' || !answer.trim()) return '내용을 입력해 주세요.';
      if (question.validation === 'email_or_phone') {
        if (!validateEmailOrPhone(answer))
          return '올바른 이메일 또는 전화번호를 입력해 주세요.';
      }
      break;

    case 'demographic': {
      if (!question.subQuestions) break;
      const demo = answer as Record<string, string | undefined> | undefined;
      for (const sq of question.subQuestions) {
        if (!demo || !demo[sq.id]) return '모든 항목을 선택해 주세요.';
      }
      break;
    }
  }

  // 기타 텍스트 필드 체크: 기타 선택했는데 텍스트 미입력
  if (question.options) {
    const otherOption = question.options.find((o) => o.hasTextInput);
    if (otherOption) {
      const isOtherSelected =
        question.type === 'multiple_choice'
          ? Array.isArray(answer) && answer.includes(otherOption.value)
          : answer === otherOption.value;
      if (isOtherSelected && !otherTexts[question.id]?.trim()) {
        return '기타 항목의 내용을 입력해 주세요.';
      }
    }
  }

  return null;
}
