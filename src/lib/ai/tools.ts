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
      "특정 카테고리의 예산 또는 지출 금액을 변경합니다. '스튜디오 예산 400만원으로 해줘', '드레스에 250만원 썼어' 같은 요청에 사용합니다.",
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
      "고객의 예산, 선호도, 진행 상황을 고려하여 맞춤 업체를 추천합니다. 고객이 '업체 추천해줘', '예산에 맞는 스튜디오 찾아줘', '어디가 좋을까?' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "추천 카테고리 (한글). 예: '스튜디오', '드레스', '메이크업'",
        },
        limit: {
          type: "number",
          description: "추천 업체 수 (기본 3)",
        },
      },
      required: ["category"],
    },
  },
];
