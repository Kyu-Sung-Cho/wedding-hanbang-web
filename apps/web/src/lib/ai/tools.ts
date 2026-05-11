import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export const WEDDING_TOOLS: Tool[] = [
  {
    name: "update_budget",
    description:
      "커플의 총 결혼 예산을 변경합니다. 사용자가 '예산을 3000만원으로 해줘' 같은 요청을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        total_budget: {
          type: "number",
          description: "새로운 총 예산 금액 (원 단위). 예: 30000000 = 3000만원",
        },
      },
      required: ["total_budget"],
    },
  },
  {
    name: "update_wedding_date",
    description:
      "결혼 예정일을 변경합니다. 사용자가 '결혼식 날짜를 11월 15일로 변경해줘' 같은 요청을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        wedding_date: {
          type: "string",
          description: "새로운 결혼 날짜 (YYYY-MM-DD 형식). 예: 2026-11-15",
        },
      },
      required: ["wedding_date"],
    },
  },
  {
    name: "update_task_status",
    description:
      "웨딩 준비 항목의 진행 상태를 변경합니다. 사용자가 '예식장 계약 완료했어', '드레스 진행중으로 바꿔줘' 같은 요청을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "meeting", "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "yedan", "honeymoon", "houseware", "housing",
            "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
          ],
          description:
            "변경할 카테고리. meeting=상견례, venue=예식장, studio=스튜디오, dress=드레스/턱시도, makeup=메이크업, ring=예물, hanbok=한복, yedan=예단, honeymoon=신혼여행, houseware=혼수, housing=신혼집, invitation=청첩장, snap=본식스냅/영상, shoes=웨딩구두, bouquet=부케, gift=답례품, mc=사회/축가, ham=함, pyebaek=폐백",
        },
        status: {
          type: "string",
          enum: ["not_started", "in_progress", "completed"],
          description:
            "새로운 상태. not_started=시작전, in_progress=진행중, completed=완료",
        },
      },
      required: ["category", "status"],
    },
  },
  {
    name: "update_venue",
    description: "예식장 이름을 설정하거나 변경합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        venue: {
          type: "string",
          description: "예식장 이름. 예: '더 리버사이드 호텔'",
        },
      },
      required: ["venue"],
    },
  },
  {
    name: "get_budget_summary",
    description:
      "현재 예산 배분 현황을 조회합니다. 사용자가 '예산 현황 보여줘', '얼마나 썼어?' 같은 질문을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "update_category_budget",
    description:
      "특정 카테고리의 예산 또는 지출 금액을 변경합니다. '스튜디오 예산 400만원으로 해줘', '드레스에 250만원 썼어' 같은 요청에 사용합니다. 기존 20개 카테고리에 없는 새 항목은 add_custom_category를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "meeting", "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "yedan", "honeymoon", "houseware", "housing",
            "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek", "reserve",
          ],
          description:
            "카테고리. meeting=상견례, venue=예식장, studio=스튜디오, dress=드레스/턱시도, makeup=메이크업, ring=예물, hanbok=한복, yedan=예단, honeymoon=신혼여행, houseware=혼수, housing=신혼집, invitation=청첩장, snap=본식스냅/영상, shoes=웨딩구두, bouquet=부케, gift=답례품, mc=사회/축가, ham=함, pyebaek=폐백, reserve=예비비",
        },
        budget: {
          type: "number",
          description: "새 예산 금액 (원 단위). 예: 4000000 = 400만원. 예산 변경 불필요 시 생략",
        },
        spent: {
          type: "number",
          description: "새 지출 금액 (원 단위). 예: 2500000 = 250만원. 지출 변경 불필요 시 생략",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "add_custom_category",
    description:
      "기존 20개 카테고리에 없는 새로운 예산 항목을 추가합니다. '웨딩카 50만원 썼어', '포토부스 예산 30만원으로 해줘' 등 기존 카테고리에 없는 항목에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        label: {
          type: "string",
          description: "카테고리 이름 (예: '웨딩카', '포토부스', '축의금')",
        },
        budget: {
          type: "number",
          description: "예산 금액 (원 단위). 예: 500000 = 50만원. 예산 불필요 시 생략",
        },
        spent: {
          type: "number",
          description: "지출 금액 (원 단위). 예: 300000 = 30만원. 지출 불필요 시 생략",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "delete_category",
    description:
      "예산 카테고리를 삭제합니다. 기존 20개 카테고리(예식장, 스튜디오 등)와 커스텀 카테고리 모두 삭제 가능합니다. ⚠️ 중요: 반드시 삭제 전에 사용자에게 '정말 삭제하시겠어요?' 라고 확인을 받은 후에만 이 도구를 호출하세요. 사용자가 확인하기 전에는 절대 호출하지 마세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "삭제할 카테고리 키. 기존 카테고리: meeting, venue, studio, dress, makeup, ring, hanbok, yedan, honeymoon, houseware, housing, invitation, snap, shoes, bouquet, gift, mc, ham, pyebaek, reserve. 커스텀 카테고리: custom_로 시작하는 키. 먼저 get_budget_summary로 현재 카테고리 목록을 확인하세요.",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "reset_category",
    description:
      "특정 카테고리의 예산/지출 데이터만 초기화합니다(카테고리 자체는 유지). '예식장 데이터 리셋해줘', '스튜디오 금액 초기화' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "초기화할 카테고리 키. meeting, venue, studio, dress, makeup, ring, hanbok, yedan, honeymoon, houseware, housing, invitation, snap, shoes, bouquet, gift, mc, ham, pyebaek, reserve 또는 custom_으로 시작하는 커스텀 키",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "get_schedule_summary",
    description:
      "현재 웨딩 준비 진행 상황을 조회합니다. 사용자가 '지금 뭐가 완료됐어?', '진행 현황 알려줘' 같은 질문을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_wedding_info",
    description:
      "결혼 날짜, D-day, 전체 진행률 등 기본 웨딩 정보를 조회합니다.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "add_schedule_event",
    description:
      "캘린더에 새로운 일정을 추가합니다. '3월 15일에 드레스 피팅 잡아줘' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "일정 날짜 (YYYY-MM-DD 형식). 예: 2026-03-15",
        },
        title: {
          type: "string",
          description: "일정 제목. 예: '드레스 피팅 예약'",
        },
        memo: {
          type: "string",
          description: "일정 메모 (선택). 예: '강남 드레스샵 2시'",
        },
        category_key: {
          type: "string",
          enum: [
            "general", "meeting", "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "yedan", "honeymoon", "houseware", "housing",
            "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
          ],
          description: "관련 카테고리 (선택). general=일반, meeting=상견례, venue=예식장, studio=스튜디오, dress=드레스/턱시도, makeup=메이크업, ring=예물, hanbok=한복, yedan=예단, honeymoon=신혼여행, houseware=혼수, housing=신혼집, invitation=청첩장, snap=본식스냅/영상, shoes=웨딩구두, bouquet=부케, gift=답례품, mc=사회/축가, ham=함, pyebaek=폐백",
        },
      },
      required: ["date", "title"],
    },
  },
  {
    name: "update_schedule_event",
    description:
      "기존 캘린더 일정을 수정합니다. '피팅 날짜를 3월 20일로 변경해줘' 같은 요청에 사용합니다. 먼저 get_schedule_events로 event_id를 확인하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "수정할 일정의 ID",
        },
        date: {
          type: "string",
          description: "변경할 날짜 (YYYY-MM-DD). 날짜 변경 불필요 시 생략",
        },
        title: {
          type: "string",
          description: "변경할 제목. 제목 변경 불필요 시 생략",
        },
        memo: {
          type: "string",
          description: "변경할 메모. 메모 변경 불필요 시 생략",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "delete_schedule_event",
    description:
      "캘린더에서 일정을 삭제합니다. '피팅 일정 취소해줘' 같은 요청에 사용합니다. 먼저 get_schedule_events로 event_id를 확인하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "삭제할 일정의 ID",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "toggle_checklist_item",
    description:
      "특정 카테고리의 체크리스트 항목을 완료/미완료로 변경합니다. '예식장 투어 완료했어' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "meeting", "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "yedan", "honeymoon", "houseware", "housing",
            "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
          ],
          description:
            "카테고리. meeting=상견례, venue=예식장, studio=스튜디오, dress=드레스/턱시도, makeup=메이크업, ring=예물, hanbok=한복, yedan=예단, honeymoon=신혼여행, houseware=혼수, housing=신혼집, invitation=청첩장, snap=본식스냅/영상, shoes=웨딩구두, bouquet=부케, gift=답례품, mc=사회/축가, ham=함, pyebaek=폐백",
        },
        item_id: {
          type: "string",
          description: "체크리스트 항목 ID. 예: venue_03",
        },
        done: {
          type: "boolean",
          description: "완료 여부. true=완료, false=미완료",
        },
      },
      required: ["category", "item_id", "done"],
    },
  },
  {
    name: "get_schedule_events",
    description:
      "캘린더에 등록된 일정을 조회합니다. '다음 주 일정 뭐 있어?', '등록된 일정 보여줘' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        from_date: {
          type: "string",
          description: "조회 시작일 (YYYY-MM-DD). 생략하면 오늘부터",
        },
        to_date: {
          type: "string",
          description: "조회 종료일 (YYYY-MM-DD). 생략하면 시작일+30일",
        },
      },
      required: [],
    },
  },
  {
    name: "add_amora_action",
    description:
      "아모라가 사용자의 다음 행동을 저장합니다. 사용자가 '이거 기억해줘', '다음 할 일로 추가해줘', '챙겨줘'라고 하거나, 견적/일정/예산 상담 후 실제로 해야 할 구체적인 행동이 생겼을 때 사용합니다. 막연한 조언에는 사용하지 말고, 사용자가 실행할 수 있는 한 가지 행동으로 저장하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "행동 카드 제목. 30자 이내 권장. 예: '스튜디오 원본 USB 포함 여부 확인'",
        },
        description: {
          type: "string",
          description: "왜 해야 하는지, 확인할 내용을 한 문장으로 정리",
        },
        due_date: {
          type: "string",
          description: "마감일 YYYY-MM-DD. 정확한 날짜가 있을 때만 입력",
        },
        category_key: {
          type: "string",
          enum: [
            "general", "meeting", "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "yedan", "honeymoon", "houseware", "housing",
            "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
          ],
          description: "관련 카테고리. 불명확하면 general",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "중요도. 계약/마감/추가금 위험은 high, 일반 확인은 medium, 참고는 low",
        },
        source: {
          type: "string",
          enum: ["chat", "quote", "schedule", "budget", "guardrail", "manual"],
          description: "행동이 생긴 맥락. 견적 분석이면 quote, 일정이면 schedule, 예산이면 budget, 일반 대화면 chat",
        },
        href: {
          type: "string",
          description: "관련 페이지 경로. 예: /community/quote-check, /schedule, /budget, /scripts",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "get_amora_actions",
    description:
      "아모라가 저장한 다음 행동 목록을 조회합니다. 사용자가 '내가 해야 할 일 뭐야?', '아모라가 기억한 것 보여줘', '남은 액션 보여줘'라고 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["open", "done", "dismissed", "all"],
          description: "조회할 상태. 기본 open",
        },
      },
      required: [],
    },
  },
  {
    name: "update_amora_action",
    description:
      "저장된 아모라 행동 카드의 상태나 내용을 변경합니다. 사용자가 '이거 완료했어', '이 할 일 지워줘', '마감일 바꿔줘'라고 할 때 사용합니다. 먼저 get_amora_actions로 action_id를 확인하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_id: {
          type: "string",
          description: "수정할 행동 카드 ID",
        },
        status: {
          type: "string",
          enum: ["open", "done", "dismissed"],
          description: "새 상태. 완료했으면 done, 숨기면 dismissed",
        },
        title: {
          type: "string",
          description: "새 제목. 변경할 때만 입력",
        },
        description: {
          type: "string",
          description: "새 설명. 변경할 때만 입력",
        },
        due_date: {
          type: "string",
          description: "새 마감일 YYYY-MM-DD. 변경할 때만 입력",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "새 중요도. 변경할 때만 입력",
        },
        href: {
          type: "string",
          description: "새 관련 페이지 경로. 변경할 때만 입력",
        },
      },
      required: ["action_id"],
    },
  },
  // ── 업체 검색 & 추천 도구 ──
  {
    name: "search_vendors",
    description:
      "업체를 검색합니다. 고객이 '강남 스튜디오 찾아줘', '메이크업 업체 보여줘', '300만원 이하 드레스샵' 같은 요청을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "업체 카테고리 (한글). 예: '스튜디오', '드레스', '메이크업', '예식장', '한복', '예물', '신혼여행'",
        },
        location: {
          type: "string",
          description: "지역. 예: '강남', '서울', '경기'",
        },
        price_min: {
          type: "number",
          description: "최소 가격 (원 단위)",
        },
        price_max: {
          type: "number",
          description: "최대 가격 (원 단위)",
        },
        search: {
          type: "string",
          description: "검색어 (업체명, 태그, 스타일 등)",
        },
        limit: {
          type: "number",
          description: "최대 결과 수 (기본 5)",
        },
      },
      required: [],
    },
  },
  {
    name: "check_vendor_availability",
    description:
      "특정 업체의 예약 가능 시간을 조회합니다. 고객이 '이 업체 언제 예약 가능해?', '○○ 스튜디오 토요일 가능해?' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor_id: {
          type: "string",
          description: "업체 ID",
        },
        product_id: {
          type: "string",
          description: "상품 ID (선택). 지정하면 해당 상품의 타임슬롯만 확인",
        },
        day: {
          type: "number",
          description: "특정 요일만 확인 (0=월 ~ 6=일). 생략하면 전체 요일",
        },
      },
      required: ["vendor_id"],
    },
  },
  {
    name: "recommend_vendors",
    description:
      "고객의 예산, 선호도, 분위기, 시간 등을 종합적으로 고려하여 맞춤 업체를 추천합니다. 고객이 '업체 추천해줘', '예산에 맞는 스튜디오 찾아줘', '어디가 좋을까?', '모던한 분위기 스튜디오', '토요일 오후에 가능한 업체' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "추천 카테고리 (한글). 예: '스튜디오', '드레스', '메이크업', '예식장', '한복', '예물'",
        },
        mood: {
          type: "string",
          description: "고객이 원하는 분위기/스타일. 예: '모던', '클래식', '내추럴', '로맨틱', '빈티지', '럭셔리', '심플', '화려한', '따뜻한', '감성적인'",
        },
        preferred_day: {
          type: "number",
          description: "선호 요일 (0=월 ~ 6=일). 고객이 특정 요일을 원할 때. 예: 5=토요일",
        },
        preferred_time: {
          type: "string",
          description: "선호 시간대. 'morning'=오전(9~12), 'afternoon'=오후(12~17), 'evening'=저녁(17~21)",
        },
        price_max: {
          type: "number",
          description: "최대 가격 (원 단위). 고객이 구체적인 예산 한도를 말할 때",
        },
        location: {
          type: "string",
          description: "선호 지역. 예: '강남', '서울', '경기', '홍대'",
        },
        limit: {
          type: "number",
          description: "추천 업체 수 (기본 3)",
        },
      },
      required: ["category"],
    },
  },
  // ── 업체 상세 & 예약 도구 ──
  {
    name: "get_vendor_detail",
    description:
      "특정 업체의 상품(패키지)과 스태프 목록을 조회합니다. 고객이 업체 추천 결과에서 특정 업체의 상세 정보를 요청할 때 사용합니다. 메시지에 [vendor:ID] 태그가 있으면 해당 ID를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor_id: {
          type: "string",
          description: "업체 ID. 고객 메시지의 [vendor:ID] 태그에서 추출",
        },
      },
      required: ["vendor_id"],
    },
  },
  {
    name: "get_available_slots",
    description:
      "업체의 예약 가능한 시간대를 조회합니다. 고객이 상품과 스태프를 선택한 후 예약 가능 시간을 확인할 때 사용합니다. 메시지에 [vendor:ID][product:ID][staff:ID] 태그가 있으면 해당 ID를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor_id: {
          type: "string",
          description: "업체 ID",
        },
        product_id: {
          type: "string",
          description: "상품 ID (선택). 상품별 타임슬롯 확인",
        },
        staff_id: {
          type: "string",
          description: "스태프 ID (선택). 스태프별 타임슬롯 확인",
        },
      },
      required: ["vendor_id"],
    },
  },
  {
    name: "create_booking",
    description:
      "업체에 예약을 생성합니다. 고객이 날짜와 시간을 최종 선택한 후 사용합니다. 메시지에 [vendor:ID][product:ID][staff:ID][date:YYYY-MM-DD][time:HH:00] 태그가 있으면 해당 값을 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor_id: {
          type: "string",
          description: "업체 ID",
        },
        product_id: {
          type: "string",
          description: "상품 ID (선택)",
        },
        staff_id: {
          type: "string",
          description: "스태프 ID (선택)",
        },
        date: {
          type: "string",
          description: "예약 날짜 (YYYY-MM-DD 형식)",
        },
        time: {
          type: "string",
          description: "예약 시간 (HH:00 형식)",
        },
        memo: {
          type: "string",
          description: "예약 메모 (선택)",
        },
      },
      required: ["vendor_id", "date", "time"],
    },
  },
  {
    name: "get_my_bookings",
    description:
      "현재 커플의 예약 목록을 조회합니다. 예약 취소, 예약 현황 확인 시 먼저 호출하여 booking_id를 확인하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description: "필터할 예약 상태 (선택). pending, confirmed, cancelled 등. 미지정 시 취소 제외 전체.",
        },
      },
      required: [],
    },
  },
  {
    name: "cancel_booking",
    description:
      "예약을 취소합니다. 고객이 예약 취소를 요청하면 사용합니다. 메시지에 [booking:ID] 태그가 있으면 해당 값을 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        booking_id: {
          type: "string",
          description: "예약 ID",
        },
      },
      required: ["booking_id"],
    },
  },
  {
    name: "get_market_price",
    description:
      "한국소비자원 웨딩 시세 데이터를 조회합니다. 고객이 '스드메 시세가 어떻게 돼?', '서울 예식장 평균 비용', '드레스 얼마가 적정해?' 같은 질문을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: ["total", "venue", "sdm", "studio", "dress", "makeup", "options", "seasonal"],
          description: "조회할 카테고리. total=전체비용, venue=예식장, sdm=스드메패키지, studio=스튜디오, dress=드레스, makeup=메이크업, options=옵션별상세, seasonal=성수기/비수기",
        },
        scope: {
          type: "string",
          enum: ["national", "seoul"],
          description: "전국/서울 구분 (기본: national)",
        },
      },
      required: ["category"],
    },
  },
  // 네이버 지역 검색 API 장소 검색
  {
    name: "search_nearby_places",
    description:
      "네이버 지역 검색을 사용해 특정 위치 근처의 레스토랑/카페/장소를 검색합니다. 고객이 '강남역 근처 상견례 레스토랑', '홍대 카페 추천', '식사동 한식 맛집' 등 외부 장소를 찾을 때 사용합니다. 웨딩 업체(스튜디오/드레스/메이크업)가 아닌 일반 장소 검색에만 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "검색어. 위치+종류를 포함하세요. 예: '강남역 근처 한식 레스토랑', '식사동 상견례 맛집', '서울 강남구 고급 한정식'",
        },
      },
      required: ["query"],
    },
  },
  // 견적 분석 (AI 견적 체크)
  {
    name: "analyze_quote",
    description:
      "스드메 견적을 분석합니다. **중요: 2단계 플로우!** 1단계: 사용자가 견적 금액을 말하면 included_items를 반드시 빈 배열([])로 호출 → 체크리스트 카드가 표시됨. 2단계: 사용자가 [quote_analysis] 태그로 체크 결과를 보내면 그때 included_items에 항목을 넣어 재호출. 절대 included_items를 추측해서 넣지 마세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        quote_price: {
          type: "number",
          description: "견적 금액 (만원 단위). 예: 290 = 290만원",
        },
        category: {
          type: "string",
          enum: ["sdm_package", "studio", "dress", "makeup"],
          description: "견적 카테고리. sdm_package=스드메 패키지, studio=스튜디오만, dress=드레스만, makeup=메이크업만",
        },
        region: {
          type: "string",
          enum: ["seoul", "gyeonggi", "busan", "daegu", "other"],
          description: "지역. 기본값: seoul",
        },
        included_items: {
          type: "array",
          items: { type: "string" },
          description: "견적 포함 항목. **1단계에서는 반드시 빈 배열 []로 호출하세요.** 2단계([quote_analysis] 태그 메시지)에서만 사용자가 체크한 항목을 넣으세요. 추측 금지.",
        },
        vendor_name: {
          type: "string",
          description: "업체명 (선택). 비교 분석에 사용.",
        },
      },
      required: ["quote_price", "category"],
    },
  },
];

// =============================================
// 베타 단계: 개별 업체 추천/예약 도구 비활성
// =============================================
// 이유: 현재 vendors 테이블에 진짜 업체 데이터 없음. 가짜 업체를 AI가 자신만만하게
//       추천하면 사용자 신뢰 망가짐 + 표시광고법 리스크.
// 정식 출시 시: 진짜 vendor onboarding 후 이 배열을 비우면 자동 활성화.
// 영향받지 않는 도구: analyze_quote, search_nearby_places, 예산/일정/진행률 도구는 모두 정상.
export const BETA_DISABLED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "search_vendors",
  "recommend_vendors",
  "get_vendor_detail",
  "get_available_slots",
  "create_booking",
  "get_my_bookings",
  "cancel_booking",
]);

/** 베타용: 비활성 도구를 제외한 안전한 도구 목록 */
export const BETA_SAFE_TOOLS: Tool[] = WEDDING_TOOLS.filter(
  (t) => !BETA_DISABLED_TOOL_NAMES.has(t.name)
);
