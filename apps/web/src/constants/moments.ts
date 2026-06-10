/**
 * 동반자 모멘트 카탈로그 v1
 * 근거: docs/MOMENT_CATALOG_2026-06-10.md (내부 자산 채굴 + 실제 여정 리서치)
 *
 * 모멘트 = 결혼 준비 여정에서 아모라가 먼저 챙기는 시점 있는 사건.
 * 각 모멘트는 D-3(챙김) / D-1(출발 전 체크) / D+1(안부·기억) 최대 3셀.
 * 문안은 친언니 톤 5원칙: 결론 먼저 / 불안 명명 / 선택지 2개+나라면 / 카톡체 대본 / 편들기.
 *
 * trigger:
 * - "event": 유저 일정 입력(progress.__events의 momentType 매칭) 기준
 * - "wedding_relative": 예식일 ± weddingOffsetDays로 모멘트 날짜 자동 산출
 */

export type MomentType =
  | "family_greeting"
  | "sanggyeonrye"
  | "venue_tour"
  | "dress_tour"
  | "studio_shoot"
  | "dress_fitting"
  | "invitation_meeting"
  | "final_check"
  | "wedding_day"
  | "honeymoon_departure"
  | "family_visit_after"
  | "first_holiday";

export interface MomentCell {
  /** 아모라 발화 본문 (친언니 톤) */
  message: string;
  /** D-1 출발 전 체크 항목 */
  checklist?: string[];
  /** 복붙 가능한 카톡체 대본 */
  script?: string;
  /** D+1 안부 질문 */
  question?: string;
}

export interface MomentDefinition {
  type: MomentType;
  label: string;
  trigger: "event" | "wedding_relative";
  /** wedding_relative일 때 예식일 기준 오프셋 (본식 = 0, 식후 = 양수) */
  weddingOffsetDays?: number;
  /** 돈이 걸린 모멘트 여부 (우선순위 가중) */
  moneyInvolved: boolean;
  d3?: MomentCell;
  d1: MomentCell;
  dAfter?: MomentCell;
  /** D+1 응답에서 기억으로 저장할 키 (customer_insights/decision_nodes 연동용) */
  memoryKeys: string[];
  /** 내부 콘텐츠 소스 (예절 파트 P번호, 체크리스트 키) */
  sourceRefs: string[];
}

export const MOMENTS: Record<MomentType, MomentDefinition> = {
  family_greeting: {
    type: "family_greeting",
    label: "양가 첫인사",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "첫인사 3일 전이야. 제일 무서운 건 '뭘 들고 가야 하나'일 텐데, 빈손만 아니면 절반은 성공이야. 과일이나 떡 케이크 10~20만원 선이 무난하고, 오늘 주문해야 안 늦어.",
    },
    d1: {
      message: "내일이지? 떨리는 게 정상이야. 아래만 챙기면 돼 — 나머지는 웃으면 돼.",
      checklist: [
        "선물 (주문한 것 픽업 확인)",
        "단정한 복장 — 화려한 것보다 깔끔한 쪽",
        "호칭은 '아버님·어머님'으로",
        "10분 일찍 도착",
        "돈·집 얘기는 오늘 꺼내지 않기",
      ],
      script:
        "처음 뵙겠습니다, ○○○입니다. 좋게 봐주셔서 감사합니다. 앞으로 잘 부탁드리겠습니다.",
    },
    dAfter: {
      message: "어제 잘 다녀왔어? 고생했어.",
      question: "어머님이 뭘 좋아하시는 것 같았어? 기억해뒀다가 명절이나 집들이 때 다시 꺼내줄게.",
    },
    memoryKeys: ["parent_preference", "family_atmosphere", "naming_convention"],
    sourceRefs: ["etiquette:P1"],
  },

  sanggyeonrye: {
    type: "sanggyeonrye",
    label: "상견례",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "상견례 사흘 전이야. '무슨 얘기 하지' 걱정되지? 대화 주제는 3개면 충분해. 오늘은 딱 두 개만 하자 — 식당 예약 재확인이랑, 양가 부모님 음식 취향 체크.",
    },
    d1: {
      message: "내일 상견례야. 아래 다섯 개만 확인하면 분위기는 알아서 따라와.",
      checklist: [
        "예약·참석 인원 최종 확인",
        "자리배치 — 부모님이 안쪽 상석",
        "금지 주제(예단·돈·정치·과거연애) 양가에 미리 공유",
        "계산은 누가 할지 미리 합의",
        "건배사 한 줄 준비",
      ],
      script:
        "엄마, 내일 12시 ○○ 예약했어. 돈 얘기는 그 자리에서 안 꺼내기로 했으니까 그것만 기억해줘!",
    },
    dAfter: {
      message: "상견례 끝! 진짜 큰 산 하나 넘었어.",
      question:
        "어제 분위기 어땠어? 예단이나 예식 시기 얘기 나온 거 있으면 알려줘 — 합의된 건 내가 기억해둘게.",
    },
    memoryKeys: ["yedan_agreement", "wedding_timing_agreement", "family_dynamics"],
    sourceRefs: ["etiquette:P2", "checklist:meeting"],
  },

  venue_tour: {
    type: "venue_tour",
    label: "예식장 투어",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "예식장 투어 3일 전. 투어에서 제일 많이 당하는 게 보증인원이랑 성수기 할증이야. 질문 리스트 만들어놨으니까 이것만 들고 가면 호구 잡힐 일 없어.",
    },
    d1: {
      message: "내일 투어지? 현장에서 바로 계약하자고 하면 이 말 한마디면 돼.",
      checklist: [
        "보증인원 최소치가 몇 명인지 질문",
        "식대 인상 조건 (계약 후 인상 가능 여부)",
        "취소·날짜 변경 규정",
        "예약금 상한 — 둘이 미리 합의한 금액 이상 걸지 않기",
      ],
      script: "오늘은 둘러보러 온 거라서요, 견적서만 받아갈게요. 상의해보고 연락드릴게요.",
    },
    dAfter: {
      message: "투어 다녀온 거 고생했어!",
      question: "어디가 제일 마음에 남았어? 받아온 견적 있으면 견적 체크 돌려줄게 — 빠진 항목부터 보자.",
    },
    memoryKeys: ["venue_candidates", "venue_quotes"],
    sourceRefs: ["checklist:venue", "quoteCheck", "hiddenCosts"],
  },

  dress_tour: {
    type: "dress_tour",
    label: "드레스 투어",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "드레스 투어 3일 전! 피팅비는 샵당 3~5만원 현금이야, 미리 뽑아둬. 그리고 사진 못 찍게 하는 샵이 많아서 — 마음에 든 드레스는 이름이라도 적어 와야 해.",
    },
    d1: {
      message: "내일 드레스 입는 날이야. 준비물 다섯 개, 이것 때문에 우는 신부 진짜 많아.",
      checklist: [
        "누드톤 심리스 속옷 (검정은 비쳐서 사고 남)",
        "머리 묶을 끈",
        "본식 굽 높이와 비슷한 신발",
        "원하는 스타일 참고 사진",
        "피팅비 현금 (샵당 3~5만원)",
      ],
    },
    dAfter: {
      message: "드레스 어땠어? 입어본 날은 기억이 다 섞이니까 지금 적어두는 게 최고야.",
      question:
        "몇 번째 드레스가 제일 예뻤어? 핏·목라인·움직임 세 가지만 말해줘 — 다음 샵 비교 기준으로 기억해둘게. 헬퍼비 안내받았는지도!",
    },
    memoryKeys: ["dress_preference", "shop_impressions", "helper_fee_disclosed"],
    sourceRefs: ["checklist:dress", "hiddenCosts:dress"],
  },

  studio_shoot: {
    type: "studio_shoot",
    label: "스튜디오 촬영",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "촬영 3일 전이야. 오늘 챙길 건 딱 두 개 — 부케 생화 예약 확인이랑 헬퍼이모비 현금. 이 둘이 깜빡 1·2위야.",
    },
    d1: {
      message: "내일 촬영! 오늘 밤 규칙 하나: 린스 금지(샴푸만), 과식 금지. 내일 빛나려면 오늘 심심하게.",
      checklist: [
        "신부 — 누드브라 + 여분, 베이지 보정속옷, 셀프 촬영복(구김 없이)",
        "신랑 — 구두·벨트·무라벨 정장양말, 면도는 내일 아침에",
        "헬퍼이모비 현금",
        "간식·물 (3시간 넘게 걸려)",
      ],
    },
    dAfter: {
      message: "촬영 끝! 고생 많았어, 허리 안 아파?",
      question: "제일 마음에 든 컷이나 컨셉 있었어? 본식 스냅 정할 때 기준으로 기억해둘게.",
    },
    memoryKeys: ["shoot_concept_preference", "studio_done"],
    sourceRefs: ["etiquette:P12", "hiddenCosts:studio"],
  },

  dress_fitting: {
    type: "dress_fitting",
    label: "가봉·최종피팅",
    trigger: "event",
    moneyInvolved: false,
    d3: {
      message:
        "가봉 3일 전. 가봉 최대 실패가 뭔지 알아? '가봉 후 다이어트'야. 지금 체중 그대로 가는 게 정답이야, 진짜야.",
    },
    d1: {
      message: "내일 가봉이야. 드레스는 입는 게 아니라 '움직여보는' 날이야.",
      checklist: [
        "본식 굽 높이 슈즈 지참 (밑단 길이 조정용)",
        "신랑 동행 — 나란히 서서 키 비율 확인",
        "앉기·걷기·팔 들기 테스트",
        "베일·장갑 등 소품 최종 확정",
      ],
    },
    dAfter: {
      message: "가봉 잘 끝났어?",
      question: "수선 들어간 데 있어? 본식 헬퍼비 금액도 들었으면 알려줘 — 예산에 미리 잡아둘게.",
    },
    memoryKeys: ["final_dress_spec", "wedding_helper_fee"],
    sourceRefs: ["checklist:dress"],
  },

  invitation_meeting: {
    type: "invitation_meeting",
    label: "청첩장 모임",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "이번 주 청첩장 모임이지? 청첩장은 인원수+2장 여유로 챙기고, 식사는 너희가 내는 게 국룰이야 — 1인 5만원 잡으면 마음 편해. 답례품은 10명 중 8명이 생략하니까 부담 갖지 마.",
    },
    d1: {
      message: "오늘(내일) 모임 나가기 전에 30초만 — 이것만 확인하고 나가.",
      checklist: [
        "종이 청첩장 (인원수 + 여유 2장)",
        "모바일 청첩장 링크 (못 오는 친구용)",
        "계산용 카드",
        "식당 예약 재확인",
      ],
      script: "와줘서 고마워~ 밥은 우리가 살게, 부담 없이 와!",
    },
    dAfter: {
      message: "모임 재밌었어?",
      question:
        "애들 반응 어땠어? 못 온 친구한텐 모바일로 보냈고? 참석 의사 들은 인원 알려주면 예상 하객 수 갱신해둘게 — 보증인원 정할 때 그대로 써.",
    },
    memoryKeys: ["invitation_group_done", "expected_guests_update"],
    sourceRefs: ["etiquette:P4", "research:청첩장모임"],
  },

  final_check: {
    type: "final_check",
    label: "D-30 최종점검",
    trigger: "wedding_relative",
    weddingOffsetDays: -30,
    moneyInvolved: true,
    d1: {
      message:
        "한 달 남았어. '뭔가 빠뜨린 것 같은데 뭔지 모르겠는' 그 느낌, 다들 그래 — 정상이야. 자주 빠지는 다섯 개부터 같이 보자.",
      checklist: [
        "보증인원 확정 데드라인 확인",
        "사회자에게 식순 전달",
        "잔금 일정표 만들기 (누가·언제·얼마)",
        "축의대 담당 양가 1명씩 정하기",
        "사례비 현금 봉투 준비 목록",
      ],
    },
    memoryKeys: ["final_check_started"],
    sourceRefs: ["etiquette:P21", "guestGuarantee"],
  },

  wedding_day: {
    type: "wedding_day",
    label: "본식",
    trigger: "wedding_relative",
    weddingOffsetDays: 0,
    moneyInvolved: true,
    d3: {
      message:
        "사흘 뒤면 진짜야. 오늘은 사람 정하는 날 — 축의대 양가 1명씩, 사례비 봉투 준비. 그리고 축의금 정산 기준은 오늘 양가랑 합의해 둬. 이게 식후 갈등 막는 유일한 방법이야.",
    },
    d1: {
      message: "내일이야. 신부(신랑)는 내일 확인만 하면 돼 — 뛰는 건 다른 사람들 몫이야. 오늘은 일찍 자.",
      checklist: [
        "잔금·사례비 현금 봉투",
        "신부 클러치 — 립스틱·스타킹 여분",
        "식순 최종 확인 + 사회자에게 전달 완료",
        "내일 집합 시간·동선 공유",
      ],
      script:
        "내일 사회 봐주셔서 감사해요! 식순 최종본 보내드려요. 시작 전에 한 번만 맞춰봐요 — 도착하시면 연락 주세요.",
    },
    dAfter: {
      message: "진짜 결혼했네, 우리. 고생 많았어.",
      question:
        "오늘은 축의금 장부 사진만 찍어둬 — 정산은 내일 해도 돼. 도와준 사람 목록만 알려주면 감사 인사 대상으로 기억해둘게.",
    },
    memoryKeys: ["wedding_done", "thanks_list", "settlement_note"],
    sourceRefs: ["etiquette:P5", "etiquette:P9", "etiquette:P21"],
  },

  honeymoon_departure: {
    type: "honeymoon_departure",
    label: "신혼여행 출발",
    trigger: "wedding_relative",
    weddingOffsetDays: 1,
    moneyInvolved: true,
    d1: {
      message:
        "내일 출발이지? 여권부터. 유효기간 6개월 남았는지 보고, 여권은 절대 캐리어 말고 손가방에 — 이거로 공항에서 우는 사람 진짜 많아.",
      checklist: [
        "여권 — 기내 손가방에 (유효기간 6개월+)",
        "바우처 종이+폰 이중 보관",
        "환전 + 팁용 소액 현금",
        "여행자보험 가입 확인",
        "상비약",
      ],
    },
    dAfter: {
      message: "잘 도착했어? 사진 한 장만!",
      question: "귀국일이 언제더라? 돌아오기 전에 양가 선물(면세점) 챙기는 것까지 내가 알려줄게.",
    },
    memoryKeys: ["honeymoon_return_date"],
    sourceRefs: ["checklist:honeymoon"],
  },

  family_visit_after: {
    type: "family_visit_after",
    label: "귀국 후 양가 인사",
    trigger: "wedding_relative",
    weddingOffsetDays: 8,
    moneyInvolved: true,
    d1: {
      message:
        "신혼여행 다녀와서 사흘 안에 양가 인사가 예의야(P6 룰). 나라면 양가 선물을 같은 급으로 맞춰 — 한쪽만 비싸면 그게 꼭 말이 나와.",
      checklist: [
        "양가 동일 수준 선물",
        "방문 순서 둘이 합의",
        "여행 사진 몇 장 (보여드리면 좋아하셔)",
      ],
    },
    dAfter: {
      message: "양가 인사 다 다녀왔어?",
      question: "어머님이 뭐라셔? 선물 반응 좋았던 거 기억해둘게 — 명절 때 또 써먹자.",
    },
    memoryKeys: ["family_visit_done", "gift_reaction"],
    sourceRefs: ["etiquette:P6"],
  },

  first_holiday: {
    type: "first_holiday",
    label: "결혼 후 첫 명절",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "결혼 후 첫 명절이 부부싸움 1순위인 거 알아? 원인은 딱 하나 — '어느 집 먼저'를 당일에 정해서야. 오늘 둘이서 순서부터 합의해. 네 잘못 아니야, 원래 다 싸워.",
    },
    d1: {
      message: "내일부터 명절이야. 순서 정했지? 그럼 절반은 끝났어.",
      checklist: [
        "방문 순서 최종 확정 (양가에 미리 알리기)",
        "양가 동일 수준 선물",
        "용돈 봉투 (드릴 거면 양가 동일하게)",
        "세배·음식 돕기 — 부담 갖지 말고 '뭐 도와드릴까요?' 한마디면 충분",
      ],
    },
    dAfter: {
      message: "첫 명절 무사 통과! 진짜 어른 됐네.",
      question: "양쪽 다 잘 다녀왔어? 서운한 거 없었어? 이번 순서·선물 내역 기억해둘게 — 다음 명절 기준값이야.",
    },
    memoryKeys: ["holiday_order", "holiday_gift_record"],
    sourceRefs: ["etiquette:P10"],
  },
};

export const MOMENT_LIST: MomentDefinition[] = Object.values(MOMENTS);

export const EVENT_MOMENT_TYPES: MomentType[] = MOMENT_LIST.filter(
  (m) => m.trigger === "event"
).map((m) => m.type);

export const WEDDING_RELATIVE_MOMENTS: MomentDefinition[] = MOMENT_LIST.filter(
  (m) => m.trigger === "wedding_relative"
);
