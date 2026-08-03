// 설문 질문 데이터 정의

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'likert_5'
  | 'ranking'
  | 'nps'
  | 'price_input'
  | 'text_area'
  | 'text_input'
  | 'demographic';

export interface Option {
  value: number | string;
  label: string;
  screenOut?: boolean;
  showNext?: string;
  skipTo?: string;
  hasTextInput?: boolean;
}

export interface SubQuestion {
  id: string;
  label: string;
  unit?: string;
  options?: string[];
}

export interface ConditionalDisplay {
  questionId: string;
  value?: number | string;
  valueNot?: number | string;
  valueIn?: number[];
}

export interface Question {
  id: string;
  type: QuestionType;
  required: boolean;
  question: string;
  options?: Option[];
  scale?: string[];
  npsScale?: { min: number; max: number; minLabel: string; maxLabel: string };
  subQuestions?: SubQuestion[];
  maxSelect?: number;
  maxRank?: number;
  maxLength?: number;
  placeholder?: string;
  validation?: string;
  conditionalDisplay?: ConditionalDisplay;
}

export interface Section {
  id: string;
  title: string;
  note?: string;
  questions: Question[];
}

export const sections: Section[] = [
  {
    id: 'section1',
    title: '응답자 확인',
    questions: [
      {
        id: 'q1',
        type: 'single_choice',
        required: true,
        question: '귀하의 현재 상태를 선택해 주십시오.',
        options: [
          { value: 1, label: '결혼 준비 중 (예식장/스드메 탐색~계약 단계)' },
          { value: 2, label: '본식 준비 마무리 단계 (D-60 이내)' },
          { value: 3, label: '결혼 완료 (1년 미만)' },
          { value: 4, label: '해당 없음', screenOut: true },
        ],
      },
      {
        id: 'q2',
        type: 'single_choice',
        required: true,
        question: '거주지 또는 예식 지역이 수도권(서울/경기/인천)입니까?',
        options: [
          { value: 1, label: '예' },
          { value: 2, label: '아니오', screenOut: true },
        ],
      },
    ],
  },
  {
    id: 'section2',
    title: '결혼 준비 경험',
    note: '※ 스드메(스튜디오, 드레스, 메이크업) 관련 경험에 대해 응답해 주십시오.',
    questions: [
      {
        id: 'q3',
        type: 'likert_5',
        required: true,
        question: '스드메 업체 정보(가격, 포트폴리오, 후기)를 온라인에서 충분히 비교할 수 있었다.',
        scale: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'],
      },
      {
        id: 'q4',
        type: 'likert_5',
        required: true,
        question: "계약 전에 추가금 포함 '실제 총 비용'을 파악할 수 있었다.",
        scale: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'],
      },
      {
        id: 'q5',
        type: 'likert_5',
        required: true,
        question: '원하는 날짜/시간에 예약 가능 여부를 쉽게 확인할 수 있었다.',
        scale: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'],
      },
      {
        id: 'q6',
        type: 'single_choice',
        required: true,
        question: "스드메 패키지 '기본가'와 '최종 지불 금액' 사이에 차이가 있었습니까?",
        options: [
          { value: 1, label: '차이 없음 (기본가 = 최종가)' },
          { value: 2, label: '기본가 대비 10% 미만 추가' },
          { value: 3, label: '기본가 대비 10~30% 추가' },
          { value: 4, label: '기본가 대비 30~50% 추가' },
          { value: 5, label: '기본가 대비 50% 이상 추가' },
          { value: 6, label: '아직 계약 전 / 해당 없음' },
        ],
      },
      {
        id: 'q7',
        type: 'multiple_choice',
        required: true,
        maxSelect: 2,
        question: '결혼 준비 중 가장 불편했거나 스트레스를 받은 부분은 무엇입니까? (최대 2개)',
        options: [
          { value: 1, label: '업체 정보 탐색 및 비교의 어려움' },
          { value: 2, label: '실제 총 비용(추가금) 파악의 어려움' },
          { value: 3, label: '예약 일정 조율 및 대기' },
          { value: 4, label: '플래너/업체와의 소통' },
          { value: 5, label: '예산 초과' },
          { value: 6, label: '수수료 구조의 불투명함' },
          { value: 7, label: '기타' },
        ],
      },
    ],
  },
  {
    id: 'section3',
    title: '웨딩 플래너 이용 경험',
    questions: [
      {
        id: 'q8',
        type: 'single_choice',
        required: true,
        question: '웨딩 플래너(컨설팅)를 이용했거나 이용할 계획이 있습니까?',
        options: [
          { value: 1, label: '이용했다' },
          { value: 2, label: '이용할 계획이다' },
          { value: 3, label: '이용하지 않을 계획이다' },
        ],
      },
    ],
  },
  {
    id: 'section3_1',
    title: '웨딩 플래너 및 비용 구조',
    questions: [
      {
        id: 'q8_1',
        type: 'likert_5',
        required: true,
        conditionalDisplay: { questionId: 'q8', value: 1 },
        question: '웨딩 플래너를 통한 전반적인 경험에 만족하셨습니까?',
        scale: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'],
      },
      {
        id: 'q8_2',
        type: 'multiple_choice',
        required: true,
        conditionalDisplay: { questionId: 'q8', value: 3 },
        maxSelect: 2,
        question: '플래너를 이용하지 않는 주된 이유는? (최대 2개)',
        options: [
          { value: 1, label: '비용/수수료 부담' },
          { value: 2, label: '직접 비교하고 선택하고 싶어서' },
          { value: 3, label: '필요성을 못 느껴서' },
          { value: 4, label: '수수료 구조에 대한 불신' },
          { value: 5, label: '기타' },
        ],
      },
      {
        id: 'q9',
        type: 'single_choice',
        required: true,
        question: '플래너가 업체로부터 받는 중개 수수료(통상 20~30%)가 있다는 사실을 알고 계셨습니까?',
        options: [
          { value: 1, label: '전혀 몰랐다' },
          { value: 2, label: '있다는 건 알았지만 비율은 몰랐다' },
          { value: 3, label: '대략 알고 있었다' },
          { value: 4, label: '정확히 알고 있었다' },
        ],
      },
      {
        id: 'q10',
        type: 'likert_5',
        required: true,
        question: '수수료 구조가 투명하게 공개된다면, 서비스 선택에 영향을 미칠 것 같습니까?',
        scale: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'],
      },
    ],
  },
  {
    id: 'section4',
    title: '기존 서비스 이용 경험',
    questions: [
      {
        id: 'q11',
        type: 'single_choice',
        required: true,
        question: '결혼 준비에 가장 많이 활용한 채널은 무엇입니까?',
        options: [
          { value: 1, label: '웨딩북 / 아이웨딩 등 웨딩 앱' },
          { value: 2, label: '네이버 카페 (듀오웨딩, 웨딩수다 등)' },
          { value: 3, label: '인스타그램' },
          { value: 4, label: '오프라인 웨딩 플래너/컨설팅' },
          { value: 5, label: '지인 소개' },
          { value: 6, label: '유튜브' },
          { value: 7, label: '기타' },
          { value: 8, label: '이용한 서비스 없음', skipTo: 'q13' },
        ],
      },
      {
        id: 'q11_1',
        type: 'likert_5',
        required: true,
        conditionalDisplay: { questionId: 'q11', valueNot: 8 },
        question: '위에서 선택한 채널의 만족도는 어떠했습니까?',
        scale: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'],
      },
      {
        id: 'q12',
        type: 'multiple_choice',
        required: true,
        conditionalDisplay: { questionId: 'q11_1', valueIn: [1, 2, 3] },
        maxSelect: 2,
        question: '해당 서비스에서 불만족스러웠던 점은? (최대 2개)',
        options: [
          { value: 1, label: '정보가 부정확하거나 오래됨' },
          { value: 2, label: '가격 정보가 불투명함' },
          { value: 3, label: '광고/협찬 콘텐츠가 많음' },
          { value: 4, label: '예약/문의 과정이 불편함' },
          { value: 5, label: '업체 비교가 어려움' },
          { value: 6, label: '실시간 정보(빈자리 등) 부족' },
          { value: 7, label: '기타' },
        ],
      },
    ],
  },
  {
    id: 'section5',
    title: '신규 서비스 기능 평가',
    questions: [
      {
        id: 'q13',
        type: 'ranking',
        required: true,
        maxRank: 3,
        question: '새로운 결혼 준비 서비스에 가장 필요한 기능 3가지를 순위대로 선택해 주십시오.',
        options: [
          { value: 'A', label: '실시간 예약 확인 및 즉시 예약' },
          { value: 'B', label: '인기 업체 빈자리 알림' },
          { value: 'C', label: '추가금 포함 총 비용 예측' },
          { value: 'D', label: '수수료 구조 투명 공개 (플래너/플랫폼이 받는 중개 수수료를 사전에 명시)' },
          { value: 'E', label: '업체 가격/포트폴리오/후기 비교' },
          { value: 'F', label: '24시간 AI 상담 (사용자의 취향과 예산에 맞는 업체 추천)' },
          { value: 'G', label: 'AI 가상 드레스 피팅 (내 사진으로 드레스 착용 모습 미리보기)' },
        ],
      },
      {
        id: 'q14',
        type: 'multiple_choice',
        required: true,
        maxSelect: 2,
        question: 'AI 챗봇 서비스에서 가장 기대하는 기능은? (최대 2개)',
        options: [
          { value: 1, label: '24시간 실시간 질문 응답' },
          { value: 2, label: '내 예산/스타일에 맞는 업체 추천' },
          { value: 3, label: '계약 전 체크리스트 및 주의사항 안내' },
          { value: 4, label: '일정 관리 및 리마인더' },
          { value: 5, label: '가격 협상 팁/전략 조언' },
          { value: 6, label: '후기 요약 및 분석' },
        ],
      },
    ],
  },
  {
    id: 'section6',
    title: '서비스 가격 인식',
    questions: [
      {
        id: 'q15',
        type: 'price_input',
        required: true,
        question: '이 서비스의 월 구독료로 적절하다고 생각하는 금액은 얼마입니까?',
        subQuestions: [
          { id: 'q15_a', label: "'합리적이고 적정하다'고 느끼는 금액", unit: '원/월' },
          { id: 'q15_b', label: "'비싸지만 가치가 있다면 고려할 수 있다'고 느끼는 금액", unit: '원/월' },
        ],
      },
      {
        id: 'q16',
        type: 'single_choice',
        required: true,
        question: '결제 방식 중 선호하는 것은 무엇입니까?',
        options: [
          { value: 1, label: '무료 기능만 이용' },
          { value: 2, label: '필요 시 건당 결제' },
          { value: 3, label: '월 정액 구독' },
          { value: 4, label: '결혼 준비 기간 한정 일시불' },
        ],
      },
    ],
  },
  {
    id: 'section7',
    title: '추가 서비스 관심도',
    questions: [
      {
        id: 'q17',
        type: 'multiple_choice',
        required: true,
        question: '다음 중 AI 추천/비교 서비스가 있으면 이용하고 싶은 항목을 모두 선택해 주세요.',
        options: [
          { value: 1, label: '웨딩홀/예식장' },
          { value: 2, label: '신혼여행' },
          { value: 3, label: '사회/축가' },
          { value: 4, label: '예물/예단' },
          { value: 5, label: '한복' },
          { value: 6, label: '청첩장/모바일 청첩장' },
          { value: 7, label: '부케/꽃장식' },
          { value: 8, label: '폐백/이바지' },
          { value: 9, label: '기타' },
        ],
      },
      {
        id: 'q18',
        type: 'single_choice',
        required: true,
        question: '위 항목 중 가장 정보가 부족하거나 비교가 어려웠던 것은?',
        options: [
          { value: 1, label: '웨딩홀/예식장' },
          { value: 2, label: '신혼여행' },
          { value: 3, label: '예물/예단' },
          { value: 4, label: '한복' },
          { value: 5, label: '혼수가전/가구' },
          { value: 6, label: '기타' },
        ],
      },
    ],
  },
  {
    id: 'section8',
    title: '종합 평가',
    questions: [
      {
        id: 'q19',
        type: 'single_choice',
        required: true,
        question: '위에서 설명한 서비스가 출시된다면 사용할 의향이 있습니까?',
        options: [
          { value: 1, label: '반드시 사용하겠다' },
          { value: 2, label: '아마 사용할 것 같다' },
          { value: 3, label: '잘 모르겠다' },
          { value: 4, label: '사용하지 않을 것 같다' },
        ],
      },
      {
        id: 'q20',
        type: 'nps',
        required: true,
        question: '이 서비스를 지인에게 추천할 의향은?',
        npsScale: { min: 0, max: 10, minLabel: '전혀 추천 안 함', maxLabel: '적극 추천' },
      },
    ],
  },
  {
    id: 'section9',
    title: '응답자 정보',
    questions: [
      {
        id: 'q22',
        type: 'demographic',
        required: true,
        question: '성별 / 연령대 / 스드메 예산',
        subQuestions: [
          { id: 'q22_gender', label: '성별', options: ['남성', '여성', '응답 안 함'] },
          { id: 'q22_age', label: '연령', options: ['20대', '30대', '40대 이상'] },
          { id: 'q22_budget', label: '스드메 예산', options: ['300만원 미만', '300~500만원', '500~700만원', '700만원 이상'] },
        ],
      },
    ],
  },
];

// 전체 질문 리스트 (flat)
export const allQuestions = sections.flatMap((s) => s.questions);

// 섹션 인덱스에서 질문 ID 조회
export function getQuestionSection(questionId: string): Section | undefined {
  return sections.find((s) => s.questions.some((q) => q.id === questionId));
}
