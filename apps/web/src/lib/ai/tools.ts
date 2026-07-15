import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
export { RETIRED_VENDOR_BOOKING_TOOL_NAMES } from "@/lib/ai/retiredVendorBookingTools";

/**
 * Names are retained only so stored or stale calls can be rejected before any
 * database, network, or wedding-context access. They are never model schemas.
 */
export const RETIRED_AMORA_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "update_wedding_date",
  "update_task_status",
  "update_venue",
  "add_schedule_event",
  "update_schedule_event",
  "delete_schedule_event",
  "toggle_checklist_item",
  "log_wedding_event",
]);

/** External place lookup is retired and retained only as a stale-call denylist. */
export const RETIRED_EXTERNAL_PLACE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "search_nearby_places",
]);

/** Historical names removed because their output could not support the claimed decision. */
export const RETIRED_UNTRUSTED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "apply_budget_plan",
  "update_budget",
  "update_category_budget",
  "add_custom_category",
  "delete_category",
  "reset_category",
  "analyze_contract_readiness",
  "simulate_guest_guarantee",
]);

/** Product capability removed from every model and executor schema. */
export const RETIRED_PRODUCT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "analyze_quote",
]);

/** Historical Amora action subsystem retained only as a stale-call denylist. */
export const RETIRED_AMORA_ACTION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "add_amora_action",
  "get_amora_actions",
  "update_amora_action",
]);

/**
 * The complete model-visible Amora tool surface.
 *
 * Every tool is read-only. Mutation and external place-search schemas are
 * intentionally absent rather than hidden behind a runtime flag.
 */
export const WEDDING_TOOLS: AiToolDefinition[] = [
  {
    name: "get_budget_summary",
    description:
      "사용자가 직접 기록한 계획 예산, 계약 합계, 실제 지급액을 구분해 조회합니다. 추정하거나 새 금액을 저장하지 않습니다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_schedule_summary",
    description:
      "사용자가 직접 시작한 항목 기준 완료율을 조회합니다. 시작하지 않은 선택형 템플릿은 진행률에 포함하지 않습니다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_wedding_info",
    description:
      "사용자가 직접 기록한 예식일, 장소, D-day와 준비 진행 정보를 조회합니다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_schedule_events",
    description:
      "사용자가 직접 등록한 일정 기록을 지정한 기간 범위에서 조회합니다.",
    input_schema: {
      type: "object",
      properties: {
        from_date: {
          type: "string",
          description: "조회 시작일(YYYY-MM-DD). 생략하면 오늘입니다.",
        },
        to_date: {
          type: "string",
          description: "조회 종료일(YYYY-MM-DD). 생략하면 시작일로부터 30일입니다.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_market_price",
    description:
      "공개 조사자료의 전국·서울 웨딩 가격 범위를 조회합니다. 개인 견적이나 적정 가격을 판정하지 않습니다.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "total",
            "venue",
            "sdm",
            "studio",
            "dress",
            "makeup",
            "options",
            "seasonal",
          ],
          description: "조회할 공개 가격 카테고리입니다.",
        },
        scope: {
          type: "string",
          enum: ["national", "seoul"],
          description: "전국 또는 서울 범위입니다. 기본값은 national입니다.",
        },
      },
      required: ["category"],
    },
  },
];
