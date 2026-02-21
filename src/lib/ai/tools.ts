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
            "venue",
            "studio",
            "dress",
            "makeup",
            "ring",
            "hanbok",
            "honeymoon",
            "houseware",
            "invitation",
            "gift",
          ],
          description:
            "변경할 카테고리. venue=예식장, studio=스튜디오, dress=드레스, makeup=메이크업, ring=예물, hanbok=한복, honeymoon=신혼여행, houseware=혼수, invitation=청첩장, gift=답례품",
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
            "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "honeymoon", "houseware", "invitation", "gift",
          ],
          description: "관련 카테고리 (선택). 일정이 특정 웨딩 준비 카테고리와 관련될 때 지정",
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
            "venue", "studio", "dress", "makeup", "ring",
            "hanbok", "honeymoon", "houseware", "invitation", "gift",
          ],
          description:
            "카테고리. venue=예식장, studio=스튜디오, dress=드레스, makeup=메이크업, ring=예물, hanbok=한복, honeymoon=신혼여행, houseware=혼수, invitation=청첩장, gift=답례품",
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
];
