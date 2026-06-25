import type { WeddingCodeConstructDefinition } from "./types";

// Public 4-letter codes, characters, and 16 types are future presentation layers.
// These construct definitions are internal measurement scaffolding and are the source of truth for Genesis v0.1.
export const WEDDING_CODE_CONSTRUCT_DEFINITIONS = [
  {
    key: "costRisk",
    labelKo: "비용·리스크 민감도",
    labelEn: "Cost & Risk Orientation",
    shortDefinitionKo: "총액, 추가금, 환불 조건, 계약 리스크를 먼저 확인하려는 경향",
    whatItMeasuresKo: "결혼 준비에서 비용 안정성, 추가금, 위약금, 계약 조건을 얼마나 먼저 확인하는지 봅니다.",
    whatItDoesNotMeasureKo:
      "돈을 아끼는 사람인지, 인색한 사람인지, 결혼식 만족도를 포기하는 사람인지를 판단하지 않습니다.",
    productSurfaces: ["quote_check", "amora", "checklist"],
    provisionalPublicLetterCandidates: ["B", "R"],
    evidenceTags: ["KOREAN_WEDDING_RISK", "COUPLE_ASSESSMENT", "HANBANG_ASSET"],
    validationHypotheses: [
      "costRisk가 높은 사용자는 /check 진입률이 높을 것이다.",
      "costRisk가 높은 사용자는 추가금/계약 체크 액션 저장률이 높을 것이다.",
    ],
  },
  {
    key: "experienceMeaning",
    labelKo: "경험·의미 중시도",
    labelEn: "Experience & Meaning Orientation",
    shortDefinitionKo: "드레스, 사진, 공간, 분위기처럼 오래 남는 경험 만족감을 중요하게 보는 경향",
    whatItMeasuresKo:
      "결혼식의 감정적 의미, 무드, 사진·영상, 드레스, 공간 경험을 얼마나 중요하게 보는지 봅니다.",
    whatItDoesNotMeasureKo: "과소비 성향이나 비합리성을 판단하지 않습니다.",
    productSurfaces: ["amora", "checklist", "wedding_lounge"],
    provisionalPublicLetterCandidates: ["D", "V"],
    evidenceTags: ["WEDDING_PLATFORM_SEGMENTATION", "PRODUCT_DATA", "UI_IDENTITY"],
    validationHypotheses: [
      "experienceMeaning이 높은 사용자는 무드/드레스/스냅 콘텐츠 체류시간이 높을 것이다.",
      "experienceMeaning이 높은 사용자는 감성예산 관련 액션에 반응할 것이다.",
    ],
  },
  {
    key: "coPreparation",
    labelKo: "함께준비 기대도",
    labelEn: "Co-Preparation Need",
    shortDefinitionKo: "결혼 준비를 둘이 함께 알아보고 결정하는 과정으로 느끼고 싶은 경향",
    whatItMeasuresKo: "결혼 준비 과정에서 상대와 같이 보고, 이야기하고, 결정하고 싶은 기대를 봅니다.",
    whatItDoesNotMeasureKo: "의존적이거나 집착하는 성향을 판단하지 않습니다.",
    productSurfaces: ["couple_report", "onboarding", "amora", "checklist"],
    provisionalPublicLetterCandidates: ["C", "T"],
    evidenceTags: ["COUPLE_ASSESSMENT", "DYADIC_COPING", "PRODUCT_DATA"],
    validationHypotheses: [
      "coPreparation이 높은 사용자는 상대 초대율이 높을 것이다.",
      "coPreparation이 높은 사용자는 커플 리포트 관심도가 높을 것이다.",
    ],
  },
  {
    key: "roleOwnership",
    labelKo: "역할주도 선호도",
    labelEn: "Role Ownership Preference",
    shortDefinitionKo: "각자 잘하는 일을 맡고 담당자가 주도하는 방식을 선호하는 경향",
    whatItMeasuresKo:
      "결혼 준비 일을 역할별로 나누고 담당자가 효율적으로 이끄는 방식을 얼마나 선호하는지 봅니다.",
    whatItDoesNotMeasureKo: "무관심하거나 차가운 사람인지를 판단하지 않습니다.",
    productSurfaces: ["couple_report", "checklist", "amora"],
    provisionalPublicLetterCandidates: ["O"],
    evidenceTags: ["COUPLE_ASSESSMENT", "PRODUCT_DATA"],
    validationHypotheses: [
      "roleOwnership이 높은 사용자는 역할분담표 저장률이 높을 것이다.",
      "roleOwnership이 높은 사용자는 실행형 체크리스트 반응률이 높을 것이다.",
    ],
  },
  {
    key: "evidenceDecision",
    labelKo: "근거기반 결정성향",
    labelEn: "Evidence-Based Decision Orientation",
    shortDefinitionKo: "후기, 실거래가, 계약서, 가격표처럼 확인 가능한 근거를 먼저 보는 경향",
    whatItMeasuresKo:
      "웨딩 선택에서 리뷰, 실거래가, 계약 조건, 견적 비교를 얼마나 먼저 확인하는지 봅니다.",
    whatItDoesNotMeasureKo: "더 이성적이거나 더 우월한 판단 방식임을 의미하지 않습니다.",
    productSurfaces: ["quote_check", "community", "amora"],
    provisionalPublicLetterCandidates: ["P"],
    evidenceTags: ["DECISION_STYLE", "KOREAN_WEDDING_RISK", "HANBANG_ASSET"],
    validationHypotheses: [
      "evidenceDecision이 높은 사용자는 계약 체크리스트 저장률이 높을 것이다.",
      "evidenceDecision이 높은 사용자는 시세/후기 콘텐츠 이용률이 높을 것이다.",
    ],
  },
  {
    key: "aestheticMood",
    labelKo: "무드·취향 결정성향",
    labelEn: "Aesthetic/Mood Decision Orientation",
    shortDefinitionKo: "포트폴리오, 색감, 분위기, 첫인상, 취향 일치감을 먼저 보는 경향",
    whatItMeasuresKo:
      "웨딩 선택에서 비주얼 무드, 취향, 색감, 공간감, 첫인상을 얼마나 중요하게 보는지 봅니다.",
    whatItDoesNotMeasureKo: "비합리적이거나 감정적이라는 뜻이 아닙니다.",
    productSurfaces: ["wedding_lounge", "amora", "checklist"],
    provisionalPublicLetterCandidates: ["M"],
    evidenceTags: ["DECISION_STYLE", "WEDDING_PLATFORM_SEGMENTATION", "UI_IDENTITY"],
    validationHypotheses: [
      "aestheticMood가 높은 사용자는 포트폴리오/무드보드 콘텐츠 반응률이 높을 것이다.",
      "aestheticMood가 높은 사용자는 이미지 기반 추천에 더 잘 반응할 것이다.",
    ],
  },
  {
    key: "familyIntegration",
    labelKo: "가족·양가 조율도",
    labelEn: "Family System Integration",
    shortDefinitionKo: "부모님, 혼주, 하객수, 식사, 교통, 체면을 의사결정에 반영하는 경향",
    whatItMeasuresKo:
      "결혼 준비에서 양가, 부모님, 혼주, 하객, 식사, 교통을 얼마나 고려하는지 봅니다.",
    whatItDoesNotMeasureKo: "부모님에게 무조건 맞추는 사람인지 판단하지 않습니다.",
    productSurfaces: ["etiquette_guide", "couple_report", "amora", "checklist"],
    provisionalPublicLetterCandidates: ["F"],
    evidenceTags: ["COUPLE_ASSESSMENT", "HANBANG_ASSET", "PRODUCT_DATA"],
    validationHypotheses: [
      "familyIntegration이 높은 사용자는 예절가이드 사용률이 높을 것이다.",
      "familyIntegration이 높은 사용자는 부모님 설득/하객수 조율 콘텐츠 반응률이 높을 것이다.",
    ],
  },
  {
    key: "coupleAutonomy",
    labelKo: "커플자율 지향도",
    labelEn: "Couple Autonomy Orientation",
    shortDefinitionKo: "둘의 취향, 삶의 방식, 예산, 실속을 기준으로 자유롭게 결정하려는 경향",
    whatItMeasuresKo:
      "결혼 준비에서 가족·관습보다 두 사람의 기준과 실속을 얼마나 우선하는지 봅니다.",
    whatItDoesNotMeasureKo: "이기적이거나 가족을 배려하지 않는다는 뜻이 아닙니다.",
    productSurfaces: ["etiquette_guide", "couple_report", "checklist"],
    provisionalPublicLetterCandidates: ["U"],
    evidenceTags: ["COUPLE_ASSESSMENT", "PRODUCT_DATA"],
    validationHypotheses: [
      "coupleAutonomy가 높은 사용자는 스몰웨딩/생략 가능한 예절 콘텐츠 반응률이 높을 것이다.",
      "coupleAutonomy가 높은 사용자는 커플 기준 합의서 반응률이 높을 것이다.",
    ],
  },
  {
    key: "emotionalSupport",
    labelKo: "공감먼저 필요도",
    labelEn: "Emotional Support Need",
    shortDefinitionKo: "결혼 준비 스트레스에서 해결책 전에 감정 인정과 공감을 먼저 원하는 경향",
    whatItMeasuresKo: "갈등이나 부담 상황에서 공감, 정서적 참여, 감정 인정이 먼저 필요한지를 봅니다.",
    whatItDoesNotMeasureKo: "예민하거나 약한 사람이라는 뜻이 아닙니다.",
    productSurfaces: ["amora", "couple_report"],
    provisionalPublicLetterCandidates: [],
    evidenceTags: ["DYADIC_COPING", "DEMAND_WITHDRAW", "PRODUCT_DATA"],
    validationHypotheses: [
      "emotionalSupport가 높은 사용자는 공감형 아모라 답변 만족도가 높을 것이다.",
    ],
  },
  {
    key: "executionSupport",
    labelKo: "실행먼저 필요도",
    labelEn: "Execution Support Need",
    shortDefinitionKo: "결혼 준비 스트레스에서 구체적 실행안, 역할분담, 마감, 결론을 먼저 원하는 경향",
    whatItMeasuresKo: "막막한 상황에서 감정 정리보다 액션, 일정, 역할, 결론을 먼저 원하는지를 봅니다.",
    whatItDoesNotMeasureKo: "차갑거나 공감 능력이 없다는 뜻이 아닙니다.",
    productSurfaces: ["amora", "checklist", "couple_report"],
    provisionalPublicLetterCandidates: [],
    evidenceTags: ["DYADIC_COPING", "PRODUCT_DATA"],
    validationHypotheses: [
      "executionSupport가 높은 사용자는 액션카드 클릭률이 높을 것이다.",
      "executionSupport가 높은 사용자는 체크리스트 저장률이 높을 것이다.",
    ],
  },
  {
    key: "decisionPaceRisk",
    labelKo: "빠른계약 위험도",
    labelEn: "Decision Pace & Commitment Control",
    shortDefinitionKo: "한정 할인, 박람회, 상담 당일 계약 상황에서 빠르게 확정할 가능성",
    whatItMeasuresKo: "시간 압박이나 할인 조건에서 충분한 검토 없이 계약할 위험을 봅니다.",
    whatItDoesNotMeasureKo: "충동적이거나 어리석은 사람이라는 뜻이 아닙니다.",
    productSurfaces: ["quote_check", "amora", "checklist"],
    provisionalPublicLetterCandidates: [],
    evidenceTags: ["DECISION_STYLE", "KOREAN_WEDDING_RISK", "HANBANG_ASSET"],
    validationHypotheses: [
      "decisionPaceRisk가 높은 사용자는 24시간 계약 보류 알림에 더 잘 반응할 것이다.",
    ],
  },
  {
    key: "guidanceNeed",
    labelKo: "정보압축 필요도",
    labelEn: "Guidance & Information Load Need",
    shortDefinitionKo: "정보가 많을 때 아모라가 후보와 다음 행동을 압축해주길 원하는 정도",
    whatItMeasuresKo:
      "웨딩 정보 과부하 상황에서 직접 탐색보다 가이드와 압축된 선택지를 얼마나 필요로 하는지 봅니다.",
    whatItDoesNotMeasureKo: "무능하거나 의존적인 사람이라는 뜻이 아닙니다.",
    productSurfaces: ["amora", "onboarding", "wedding_lounge", "checklist"],
    provisionalPublicLetterCandidates: [],
    evidenceTags: ["DECISION_STYLE", "HANBANG_ASSET", "PRODUCT_DATA"],
    validationHypotheses: [
      "guidanceNeed가 높은 사용자는 아모라의 top-3 추천과 다음 할 일 카드 반응률이 높을 것이다.",
    ],
  },
] as const satisfies readonly WeddingCodeConstructDefinition[];
