/**
 * 동반자 모멘트 카탈로그 v1
 * 근거: docs/MOMENT_CATALOG_2026-06-10.md (내부 자산 채굴 + 실제 여정 리서치)
 *
 * 모멘트 = 결혼 준비 여정에서 아모라가 먼저 챙기는 시점 있는 사건.
 * 각 모멘트는 D-3(챙김) / D-1(출발 전 체크) / D+1(안부·기억) 최대 3셀.
 * 문안은 사용자를 재촉하지 않는 따뜻하고 직접적인 말투를 사용한다.
 *
 * trigger:
 * - "event": 유저 일정 입력(progress.__events의 momentType 매칭) 기준
 * - "wedding_relative": 결혼식 날짜 ± weddingOffsetDays로 모멘트 날짜 자동 산출
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
  /** 아모라 발화 본문 */
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
  /** wedding_relative일 때 결혼식 날짜 기준 오프셋 (결혼식 날 = 0, 이후 = 양수) */
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
    label: "한쪽 가족에게 첫인사",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "가족에게 처음 인사드리기 사흘 전이네. 선물은 가족마다 달라서 꼭 준비해야 하는 정답은 없어. 챙기고 싶다면 파트너에게 음식 제한·선호와 서로 편한 예산부터 물어보자. 주문이 필요하면 받을 수 있는 날짜만 확인하면 돼.",
    },
    d1: {
      message: "내일이지? 떨리는 게 자연스러워. 정답을 맞히는 자리가 아니라 서로 인사하는 자리야.",
      checklist: [
        "선물을 준비했다면 수령·보관 방법 확인",
        "장소와 가족 분위기에 맞는 편안한 복장",
        "호칭과 피하고 싶은 주제는 파트너에게 미리 확인",
        "약속 시간과 이동 시간 다시 확인",
        "음식 알레르기·접근성 등 필요한 배려 확인",
      ],
      script:
        "처음 뵙겠습니다, ○○○입니다. 만나 뵙게 되어 반갑습니다. 오늘 편하게 이야기 나눴으면 좋겠습니다.",
    },
    dAfter: {
      message: "어제 잘 다녀왔어? 고생했어.",
      question:
        "분위기는 어땠어? 다음 만남에도 참고하고 싶은 호칭이나 취향이 있었다면, 저장해도 되는 내용만 알려줘.",
    },
    memoryKeys: ["parent_preference", "family_atmosphere", "naming_convention"],
    sourceRefs: ["user_choice:family_custom", "etiquette:neutral_family_coordination"],
  },

  sanggyeonrye: {
    type: "sanggyeonrye",
    label: "양쪽 부모님이 함께 만나는 자리",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "양쪽 부모님이 함께 만나는 날 사흘 전이야. 무슨 이야기를 해야 할지 걱정될 수 있어. 오늘은 식당 예약·참석 인원·음식 제한을 확인하고, 꼭 논의할 것과 다음으로 미룰 것을 파트너와 맞춰보자.",
    },
    d1: {
      message: "내일 양쪽 부모님이 함께 만나. 서로 편하게 대화할 수 있도록 필요한 것만 마지막으로 맞춰보자.",
      checklist: [
        "예약·참석 인원 최종 확인",
        "이동이 불편한 분을 고려해 좌석·접근성 확인",
        "오늘 다룰 주제와 피하고 싶은 주제를 파트너와 합의",
        "식사비 결제 방식은 당사자끼리 미리 합의",
        "대화가 부담스러울 때 쉬어갈 신호 정하기",
      ],
      script:
        "내일 ○시에 ○○로 예약했어요. 편하게 인사 나누는 자리로 생각해 주세요. 자세한 결정은 저희가 정리해서 다시 말씀드릴게요.",
    },
    dAfter: {
      message: "양쪽 부모님이 함께 만나는 자리를 잘 마쳤네. 고생했어.",
      question:
        "어제 분위기 어땠어? 실제로 합의된 내용과 아직 의견만 나온 내용을 나눠서 정리해볼까? 저장은 네가 원하는 항목만 할게.",
    },
    memoryKeys: ["yedan_agreement", "wedding_timing_agreement", "family_dynamics"],
    sourceRefs: ["user_choice:family_custom", "provider:restaurant_reservation"],
  },

  venue_tour: {
    type: "venue_tour",
    label: "결혼식장 방문",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "결혼식장 방문 사흘 전이야. 가격과 조건은 장소·날짜·계약마다 달라서 구두 설명보다 서면 견적과 계약서가 기준이야. 비교할 질문을 같이 챙겨가자.",
    },
    d1: {
      message: "내일 결혼식장을 방문하지? 현장에서 바로 계약하자고 하면 이 말로 답해도 돼.",
      checklist: [
        "결혼식장에 보장하기로 한 최소 식사 인원·1인당 식사 금액과 인원 확정 시점",
        "필수·선택 항목, 세금·봉사료를 포함한 총액",
        "가격 변경, 취소·날짜 변경·환불 규정",
        "오늘 결제 가능한 상한과 숙려 시간을 둘이 미리 합의",
      ],
      script: "오늘은 둘러보러 온 거라서요, 견적서만 받아갈게요. 상의해보고 연락드릴게요.",
    },
    dAfter: {
      message: "결혼식장 다녀오느라 고생했어.",
      question: "어디가 제일 마음에 남았어? 받아온 견적이 있으면 포함 여부를 아직 확인하지 않은 항목부터 같이 보자.",
    },
    memoryKeys: ["venue_candidates", "venue_quotes"],
    sourceRefs: ["provider:venue_quote", "contract:venue_terms", "quoteCheck"],
  },

  dress_tour: {
    type: "dress_tour",
    label: "드레스 매장 방문",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "드레스 매장 방문 사흘 전이야. 드레스를 입어보는 비용·결제 방식·사진 촬영 가능 여부는 매장마다 달라. 예약 안내를 보거나 매장에 직접 확인하고, 기록이 제한되면 허용되는 범위에서 특징을 메모하자.",
    },
    d1: {
      message: "내일 드레스를 입어보는 날이야. 매장에서 요청한 준비물과 네가 편하게 움직일 수 있는지만 확인하자.",
      checklist: [
        "매장 안내에 맞는 편안한 속옷",
        "머리 묶을 끈",
        "매장에서 요청했다면 결혼식 날 신을 높이와 비슷한 신발",
        "원하는 스타일 참고 사진",
        "매장이 안내한 드레스 입어보기 비용과 결제 수단",
      ],
    },
    dAfter: {
      message: "드레스 어땠어? 입어본 날은 기억이 섞이기 쉬우니 지금 적어두면 나중에 비교하기 편해.",
      question:
        "어떤 옷이 가장 편하고 마음에 들었어? 몸에 맞는 정도·목선·움직임과 추가 비용 안내를 나눠 적어두면 다음 매장을 비교하기 쉬워.",
    },
    memoryKeys: ["dress_preference", "shop_impressions", "helper_fee_disclosed"],
    sourceRefs: ["provider:dress_shop_policy", "contract:dress_quote", "user_choice:comfort"],
  },

  studio_shoot: {
    type: "studio_shoot",
    label: "스튜디오 촬영",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "촬영 사흘 전이야. 촬영 업체 안내문을 기준으로 손에 드는 꽃·의상·착용을 돕는 직원의 포함 범위와 추가 결제 항목을 다시 확인하자. 결제 수단도 업체에 확인해두면 당일이 편해.",
    },
    d1: {
      message:
        "내일 촬영이네. 몸이나 식사에 무리한 규칙을 만들 필요는 없어. 업체가 보낸 준비 안내와 휴식·수분·이동 시간만 챙기자.",
      checklist: [
        "각자 업체가 안내한 이너웨어·촬영 의상",
        "구두·벨트·양말 등 선택한 의상 소품",
        "계약서상 별도 비용과 업체가 안내한 결제 수단",
        "물·필요한 간식·복용 중인 개인 물품",
      ],
    },
    dAfter: {
      message: "촬영 끝! 고생 많았어, 허리 안 아파?",
      question: "제일 마음에 든 사진이나 분위기가 있었어? 결혼식 날 사진 촬영을 정할 때 참고할 수 있어.",
    },
    memoryKeys: ["shoot_concept_preference", "studio_done"],
    sourceRefs: ["provider:studio_checklist", "contract:studio_quote", "user_choice:comfort"],
  },

  dress_fitting: {
    type: "dress_fitting",
    label: "드레스 수선·최종 확인",
    trigger: "event",
    moneyInvolved: false,
    d3: {
      message:
        "드레스 수선 상태를 확인하기 사흘 전이야. 몸을 일정에 맞추려고 무리하지 않아도 돼. 최근 착용감이나 체형 변화가 걱정되면 매장에 먼저 알려 고칠 수 있는 범위와 완료 날짜를 확인하자.",
    },
    d1: {
      message: "내일 드레스 수선 상태를 확인해. 입어보기만 하지 말고 실제로 움직여보자.",
      checklist: [
        "매장에서 요청했다면 결혼식 날 신을 높이와 비슷한 신발",
        "파트너와 함께 입는다면 전체 비율 확인",
        "앉기·걷기·팔 들기 테스트",
        "면사포·장갑 등 함께 빌릴 물품 최종 확정",
      ],
    },
    dAfter: {
      message: "드레스 수선 상태 확인은 잘 끝났어?",
      question: "더 고치기로 한 곳이 있어? 결혼식 날 드레스 착용을 돕는 직원 비용도 확인했다면 예산에 함께 적어둘 수 있어.",
    },
    memoryKeys: ["final_dress_spec", "wedding_helper_fee"],
    sourceRefs: ["provider:dress_shop_policy", "user_choice:comfort"],
  },

  invitation_meeting: {
    type: "invitation_meeting",
    label: "초대장 전달 모임",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "이번 주에 초대장을 전하는 모임이 있지? 식사비를 누가 내는지는 관계와 모임마다 달라서 정답은 없어. 초대할 사람과 전달 방식을 확인하고, 둘이 편한 총예산 안에서 식당과 결제 계획을 정하면 돼.",
    },
    d1: {
      message: "오늘(내일) 모임 나가기 전에 30초만 — 이것만 확인하고 나가.",
      checklist: [
        "참석 인원에 맞춘 종이 초대장과 필요한 여유분",
        "상대가 원할 때 보낼 모바일 초대장 링크",
        "합의한 예산과 결제 수단",
        "식당 예약 재확인",
      ],
      script: "시간 내줘서 고마워! 오늘은 편하게 이야기하고 가. 식사비는 우리가 준비했어.",
    },
    dAfter: {
      message: "모임 재밌었어?",
      question:
        "모임은 어땠어? 참석 여부를 직접 말해준 사람만 따로 정리해볼까? 아직 답하지 않은 사람은 확정 인원으로 세지 않을게.",
    },
    memoryKeys: ["invitation_group_done", "expected_guests_update"],
    sourceRefs: ["user_choice:invitation_custom", "provider:restaurant_reservation"],
  },

  final_check: {
    type: "final_check",
    label: "결혼식 30일 전 확인",
    trigger: "wedding_relative",
    weddingOffsetDays: -30,
    moneyInvolved: true,
    d1: {
      message:
        "결혼식까지 한 달 남았어. 빠뜨린 것이 걱정된다면 계약서와 직접 정한 일정부터 차례로 확인해보자.",
      checklist: [
        "결혼식장에 보장하기로 한 최소 식사 인원의 확정 날짜 확인",
        "결혼식 진행자에게 진행 순서 전달",
        "남은 계약 금액 일정표 만들기 (누가·언제·얼마)",
        "축하금을 받거나 비용을 정리할 담당자와 방식을 합의",
        "계약별 남은 금액·감사 비용과 결제 수단 확인",
      ],
    },
    memoryKeys: ["final_check_started"],
    sourceRefs: ["contract:venue_terms", "user_choice:payment_plan", "guestGuarantee:user_input"],
  },

  wedding_day: {
    type: "wedding_day",
    label: "결혼식 날",
    trigger: "wedding_relative",
    weddingOffsetDays: 0,
    moneyInvolved: true,
    d3: {
      message:
        "결혼식이 사흘 뒤네. 오늘은 축하금 접수·비용 정리·업체에 남은 금액을 누가 어떤 방식으로 맡을지 정리하자. 가족이 함께 관리할 돈이 있다면 보관·기록·정리 기준을 당사자끼리 미리 합의해두자.",
    },
    d1: {
      message: "내일이야. 두 사람이 모든 일을 직접 해결할 필요는 없어. 담당자에게 최종 정보를 건네고, 오늘은 쉴 시간을 확보하자.",
      checklist: [
        "계약별 남은 금액·감사 비용과 확인된 결제 수단",
        "각자 필요한 개인 소지품과 여분",
        "결혼식 진행 순서 최종 확인 + 진행자에게 전달 완료",
        "내일 집합 시간·동선 공유",
      ],
      script:
        "내일 진행을 맡아주셔서 감사해요! 최종 진행 순서를 보내드려요. 시작 전에 한 번만 맞춰봐요. 도착하시면 연락 주세요.",
    },
    dAfter: {
      message: "진짜 결혼했네, 우리. 고생 많았어.",
      question:
        "민감한 장부와 결제 기록은 안전한 곳에 보관하고, 정산은 두 사람이 준비됐을 때 해도 돼. 감사 인사 대상은 저장을 원할 때만 정리해줄게.",
    },
    memoryKeys: ["wedding_done", "thanks_list", "settlement_note"],
    sourceRefs: ["contract:vendor_payment_terms", "user_choice:family_settlement"],
  },

  honeymoon_departure: {
    type: "honeymoon_departure",
    label: "신혼여행 출발",
    trigger: "wedding_relative",
    weddingOffsetDays: 1,
    moneyInvolved: true,
    d1: {
      message:
        "내일 출발이지? 입국 조건은 목적지·국적·경유지마다 달라. 정부·대사관 등 공식 안내와 항공사 안내에서 여권 유효기간·비자·경유 조건을 다시 확인하고, 여권은 이동 중 직접 꺼낼 수 있게 보관하자.",
      checklist: [
        "여권·비자·경유 조건을 공식 출처에서 확인",
        "예약 확인서를 안전한 두 위치에 보관",
        "현지 결제 수단과 비상 연락 방법",
        "여행자보험 보장 내용·연락처 확인",
        "복용 중인 약과 목적지 반입 규정 확인",
      ],
    },
    dAfter: {
      message: "잘 도착했어? 답장은 여유 있을 때 해도 돼.",
      question:
        "귀국일을 일정에 넣어두고 싶다면 알려줘. 선물은 의무가 아니니, 필요할 때만 대상과 예산을 함께 정리하자.",
    },
    memoryKeys: ["honeymoon_return_date"],
    sourceRefs: ["official:destination_entry_rules", "provider:airline_rules", "contract:travel_booking"],
  },

  family_visit_after: {
    type: "family_visit_after",
    label: "귀국 후 두 가족에게 인사",
    trigger: "wedding_relative",
    weddingOffsetDays: 8,
    moneyInvolved: true,
    d1: {
      message:
        "귀국 뒤 인사 방식과 시기는 가족 상황에 따라 달라. 먼저 쉬는 시간과 가능한 날짜를 파트너와 맞추고, 방문·전화·메시지 중 모두가 편한 방식을 확인하자. 선물도 선택이야.",
      checklist: [
        "각 가족에게 편한 인사 방식과 날짜 확인",
        "방문 순서와 이동 부담을 둘이 합의",
        "선물을 준비한다면 서로 편한 총예산 합의",
      ],
    },
    dAfter: {
      message: "두 가족에게 인사를 잘 드렸어?",
      question: "다음에도 참고하고 싶은 일정이나 취향이 있었어? 저장해도 되는 내용만 알려줘.",
    },
    memoryKeys: ["family_visit_done", "gift_reaction"],
    sourceRefs: ["user_choice:family_custom", "provider:visit_schedule"],
  },

  first_holiday: {
    type: "first_holiday",
    label: "결혼 후 첫 명절",
    trigger: "event",
    moneyInvolved: true,
    d3: {
      message:
        "결혼 후 첫 명절이 다가오면 방문 순서와 역할 때문에 부담될 수 있어. 정해진 답은 없으니 오늘 둘이 체력·거리·가족 일정·돌봄 노동을 함께 놓고 가능한 계획을 합의하자.",
    },
    d1: {
      message: "내일부터 명절이야. 순서 정했지? 그럼 절반은 끝났어.",
      checklist: [
        "방문 순서 최종 확정 (두 가족에게 미리 알리기)",
        "선물·용돈은 의무로 가정하지 말고 둘의 총예산 합의",
        "이동·준비·정리 역할을 한쪽에 몰지 않게 나누기",
        "쉬어야 하는 시간과 불편한 요청에 대한 경계 합의",
      ],
    },
    dAfter: {
      message: "첫 명절 지나왔네. 즐거웠든 힘들었든 일단 쉬어도 돼.",
      question:
        "다음에는 유지하고 싶은 점과 바꾸고 싶은 점이 뭐였어? 저장은 둘이 합의한 내용만 할게.",
    },
    memoryKeys: ["holiday_order", "holiday_gift_record"],
    sourceRefs: ["user_choice:family_custom", "user_choice:shared_labor"],
  },
};

export const MOMENT_LIST: MomentDefinition[] = Object.values(MOMENTS);

export const EVENT_MOMENT_TYPES: MomentType[] = MOMENT_LIST.filter(
  (m) => m.trigger === "event"
).map((m) => m.type);

export const WEDDING_RELATIVE_MOMENTS: MomentDefinition[] = MOMENT_LIST.filter(
  (m) => m.trigger === "wedding_relative"
);
