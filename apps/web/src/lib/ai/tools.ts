import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * 도구 스키마의 분야 목록은 **손으로 적지 않는다.**
 *
 * 2026-08-21에 분야를 열아홉에서 스물하나로 늘렸는데 이 파일의 enum 여섯 개와 설명
 * 문자열이 옛 열아홉 개인 채로 남았다. 프롬프트 쪽(`prompts.ts`)은 템플릿에서 뽑아
 * 쓰기 때문에 아모라는 새 분야를 **말할 수는 있는데 지목할 수는 없는** 상태가 됐다.
 * 실행기(`scheduleTools`)는 템플릿 기반이라 받아줄 준비가 돼 있었고, 막힌 것은 오직
 * 모델에게 건네는 이 목록이었다.
 *
 * 그래서 정본에서 뽑는다. 분야가 늘면 아모라도 같이 안다.
 */
/**
 * **DB가 아직 받지 못하는 분야는 모델에게 주지 않는다.**
 *
 * 쓰기 도구는 `apply_amora_atomic_tool_execution`을 지나는데, 그 본체(지금은
 * `..._pre_shared_revision`으로 이름만 바뀐 `20260716112000` 마이그레이션)가 분야 키
 * 화이트리스트를 여섯 군데 하드코딩해 두었고 거기에 열아홉 개뿐이다.
 *
 * 그래서 여기서 정본 그대로를 열어 주면 오히려 나빠진다. 지금은 모델이 새 분야를
 * 지목하지 못해 조용히 넘어가는데, 열어 주면 모델이 지목하고 DB가 거절해서 **스트리밍
 * 되던 답이 지워지고 "다시 이어갈 수 없어요"가 뜬다.** 같은 말을 다시 해도 같은 자리에서
 * 죽는다.
 *
 * DB 쪽을 고치려면 마이그레이션을 새로 추가해야 하고, 그러면 릴리스 매니페스트와
 * Vercel 소유자 서명까지 함께 가야 한다(안 그러면 프로덕션 빌드가 통째로 죽는다).
 * 그건 파운더가 여는 문이라 여기서 하지 않는다.
 *
 * `toolSchemaMatchesDatabase.test.ts`가 이 목록을 마이그레이션 원문에서 뽑은 것과
 * 대조한다. DB가 새 분야를 받게 되는 순간 그 검사가 실패하고, 그때 이 제약을 지우면 된다.
 */
const CATEGORIES_THE_DATABASE_CANNOT_ACCEPT = new Set([
  "greeting",
  "registration",
  "address",
  "ibaji",
  "housewarming",
]);

export const CHECKLIST_CATEGORY_KEYS = CATEGORY_CHECKLISTS
  .map(({ key }) => key)
  .filter((key) => !CATEGORIES_THE_DATABASE_CANNOT_ACCEPT.has(key));

/** 예산에는 체크리스트에 없는 예비비 칸이 하나 더 있다. */
export const BUDGET_CATEGORY_KEYS = Object.keys(PLANNING_CATEGORY_LABELS)
  .filter((key) => !CATEGORIES_THE_DATABASE_CANNOT_ACCEPT.has(key));

/** 일정은 어느 분야에도 안 걸리는 일정을 위해 `general`을 함께 받는다. */
export const SCHEDULE_CATEGORY_KEYS = ["general", ...CHECKLIST_CATEGORY_KEYS];

/**
 * 라벨만으로는 모델이 가르기 어려운 분야에만 풀이를 덧붙인다.
 *
 * `greeting`(배우자 부모님께 첫인사)과 `meeting`(부모님 첫 만남)은 이름이 비슷한데
 * 서로 다른 자리다 — 앞의 것은 각자 따로 가고, 뒤의 것은 넷이 함께 만난다.
 * 라벨을 그대로 주면 모델이 섞는다.
 */
const CATEGORY_GLOSS: Record<string, string> = {
  greeting: "각자 상대 부모님을 따로 처음 뵙는 자리",
  meeting: "두 사람이 양쪽 부모님과 함께 만나는 자리",
  registration: "혼인신고와 그 뒤 주소·보험 신고",
};

const PLANNING_CATEGORY_DESCRIPTION = CATEGORY_CHECKLISTS
  .filter(({ key }) => !CATEGORIES_THE_DATABASE_CANNOT_ACCEPT.has(key))
  .map(({ key, label }) => `${key}=${CATEGORY_GLOSS[key] ?? label}`)
  .join(", ");

const BUDGET_CATEGORY_DESCRIPTION =
  `${PLANNING_CATEGORY_DESCRIPTION}, reserve=예비비`;

export const WEDDING_TOOLS: AiToolDefinition[] = [
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
      "결혼 준비 항목의 진행 상태를 변경합니다. 사용자가 '결혼식장 계약 완료했어', '드레스 진행 중으로 바꿔줘' 같은 요청을 할 때 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: CHECKLIST_CATEGORY_KEYS,
          description: `변경할 카테고리. ${PLANNING_CATEGORY_DESCRIPTION}`,
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
    description: "결혼식장 이름을 설정하거나 변경합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        venue: {
          type: "string",
          description: "결혼식장 이름. 예: '샘플 결혼식장'",
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
      "특정 카테고리의 예산 또는 사용자가 직접 기록한 지출 금액을 변경합니다. 기록 지출은 결제 완료 증거가 아닙니다. '스튜디오 예산 400만원으로 해줘', '드레스에 250만원 썼어' 같은 요청에 사용합니다. 기존 20개 카테고리에 없는 새 항목은 add_custom_category를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: BUDGET_CATEGORY_KEYS,
          description: `카테고리. ${BUDGET_CATEGORY_DESCRIPTION}`,
        },
        budget: {
          type: "number",
          description: "새 예산 금액 (원 단위). 예: 4000000 = 400만원. 예산 변경 불필요 시 생략",
        },
        spent: {
          type: "number",
          description: "새 기록 지출 금액 (원 단위, 결제 완료 여부와 별도). 예: 2500000 = 250만원. 변경 불필요 시 생략",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "apply_budget_plan",
    description:
      "예산 인터뷰 완료 후 카테고리별 배분을 한 번에 적용합니다. 사용자가 '이대로 적용', '좋아 그렇게 해줘'처럼 명시적으로 확정한 경우에만 호출하세요. 총 예산도 함께 갱신되며, allocations 합계는 total_budget과 같거나 작아야 합니다 (남으면 reserve로 자동 처리).",
    input_schema: {
      type: "object" as const,
      properties: {
        total_budget: {
          type: "number",
          description:
            "총 결혼 예산 (원 단위). 이 금액이 어디까지 덮는지는 사용자가 확인해 준 범위를 따릅니다. 결혼식, 사진 촬영·드레스·메이크업, 결혼반지, 신혼여행, 가전·가구, 신혼집은 서로 다른 자금 범위일 수 있으므로 금액 크기로 포함 여부를 추정하지 말고, 모호하면 먼저 한 문장으로 확인하세요.",
        },
        allocations: {
          type: "array",
          description:
            "카테고리별 배분 리스트. 사용자가 직접 입력하거나 확인한 목표 금액·견적·상한만 사용하세요. 선호도나 평균을 근거로 금액 또는 비율을 새로 만들지 말고, 확인되지 않은 금액은 배분하지 않은 채 남겨 두세요. 합계가 total_budget보다 작으면 잔여분은 자동으로 reserve(아직 쓰임을 정하지 않은 금액)로 처리됩니다.",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: BUDGET_CATEGORY_KEYS,
                description: "카테고리 키",
              },
              budget: {
                type: "number",
                description: "이 카테고리 배분 금액 (원 단위)",
              },
              rationale: {
                type: "string",
                description:
                  "금액의 확인 가능한 출처를 한 줄로 적습니다. 예: '사용자가 입력한 견적', '사용자가 정한 지출 상한'. 우선순위만으로 임의의 비율이나 금액을 만들지 마세요.",
              },
            },
            required: ["category", "budget"],
          },
        },
        intake_summary: {
          type: "string",
          description:
            "이번 배분의 근거가 된 사용자 우선순위·가치관·제약 1~3줄 요약. 이 도구는 총액과 배분만 저장하며, 요약 원문 자체는 저장하지 않습니다.",
        },
      },
      required: ["total_budget", "allocations", "intake_summary"],
    },
  },
  {
    name: "add_custom_category",
    description:
      "기존 20개 카테고리에 없는 예산 항목을 추가하거나 바꿉니다. '차량 이동에 50만원 썼어', '사진 촬영 공간 예산은 30만원이야' 등 기존 카테고리에 없는 항목에 사용합니다. 이미 같은 이름의 항목이 있으면 새로 만들지 않고 그 항목의 금액을 바꿉니다 — 직접 추가한 항목은 update_category_budget으로는 바꿀 수 없으니 이 도구를 쓰세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        label: {
          type: "string",
          description: "카테고리 이름 (예: '차량 이동', '사진 촬영 공간')",
        },
        budget: {
          type: "number",
          description: "예산 금액 (원 단위). 예: 500000 = 50만원. 예산 불필요 시 생략",
        },
        spent: {
          type: "number",
          description: "기록 지출 금액 (원 단위, 결제 완료 여부와 별도). 예: 300000 = 30만원. 변경 불필요 시 생략",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "delete_category",
    description:
      "예산 카테고리를 삭제합니다. 기존 카테고리(결혼식장, 웨딩 사진 촬영 등)와 사용자가 추가한 카테고리 모두 삭제할 수 있습니다. 반드시 삭제 전에 사용자에게 '정말 삭제하시겠어요?'라고 확인받은 뒤에만 호출하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "삭제할 카테고리 키. 기존 카테고리: meeting, venue, studio, dress, makeup, ring, hanbok, yedan, honeymoon, houseware, housing, invitation, snap, shoes, bouquet, gift, mc, ham, pyebaek, reserve. 커스텀 카테고리: custom_로 시작하는 키. 먼저 get_budget_summary로 현재 카테고리 목록을 확인하세요.",
        },
        confirmed: {
          type: "boolean",
          description: "사용자가 삭제를 명시적으로 확인한 뒤에만 true로 설정합니다.",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "reset_category",
    description:
      "특정 카테고리의 예산·기록 지출 데이터만 초기화합니다(카테고리 자체는 유지). '결혼식장 금액 초기화해줘', '사진 촬영 금액 초기화' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "초기화할 카테고리 키. meeting, venue, studio, dress, makeup, ring, hanbok, yedan, honeymoon, houseware, housing, invitation, snap, shoes, bouquet, gift, mc, ham, pyebaek, reserve 또는 custom_으로 시작하는 커스텀 키",
        },
        confirmed: {
          type: "boolean",
          description: "사용자가 초기화를 명시적으로 확인한 뒤에만 true로 설정합니다.",
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
      "캘린더에 새 일정을 추가합니다. 같은 카테고리 일정이 있어도 기존 일정을 덮어쓰지 않습니다. 기존 일정을 바꾸려면 먼저 get_schedule_events로 event_id를 확인한 뒤 update_schedule_event를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "일정 날짜 (YYYY-MM-DD 형식). 예: 2026-03-15",
        },
        time: {
          type: "string",
          pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
          description: "일정 현지 시각 (24시간제 HH:mm 형식, 선택). 예: 14:30",
        },
        title: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "일정 제목. 예: '드레스 입어보기 예약'",
        },
        memo: {
          type: "string",
          maxLength: 2000,
          description: "일정 메모 (선택). 예: '강남 드레스 매장 오후 2시'",
        },
        category_key: {
          type: "string",
          enum: SCHEDULE_CATEGORY_KEYS,
          description: `관련 카테고리 (선택). 대표 준비 일정이면 반드시 넣습니다. general=일반, ${PLANNING_CATEGORY_DESCRIPTION}`,
        },
        schedule_scope: {
          type: "string",
          enum: ["confirmed_fact", "shared_commitment", "external_commitment"],
          description: "일정 성격. 이미 당사자에게 확정된 사실을 기록할 때만 confirmed_fact, 두 사람이 새로 정할 약속은 shared_commitment, 업체·가족과의 약속은 external_commitment. 모호하면 shared_commitment.",
        },
      },
      required: ["date", "title"],
    },
  },
  {
    name: "update_schedule_event",
    description:
      "기존 캘린더 일정을 수정합니다. '드레스 입어보는 날짜를 3월 20일로 변경해줘' 같은 요청에 사용합니다. 먼저 get_schedule_events로 event_id를 확인하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "수정할 일정의 ID",
        },
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "변경할 날짜 (YYYY-MM-DD). 날짜 변경 불필요 시 생략",
        },
        time: {
          type: "string",
          pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
          description: "변경할 현지 시각 (24시간제 HH:mm 형식). 시간 변경 불필요 시 생략",
        },
        title: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "변경할 제목. 제목 변경 불필요 시 생략",
        },
        memo: {
          type: "string",
          maxLength: 2000,
          description: "변경할 메모. 메모 변경 불필요 시 생략",
        },
        // 이 둘이 없으면 확인 카드가 "무엇을 어디서" 옮기는지 말하지 못한다.
        // 카드 문구는 서버가 선언된 키로만 만들고(`formatCanonicalConfirmation`),
        // 본문에 덧붙인 설명은 표식이 있으면 통째로 갈아치워진다. 그래서 옮기는
        // 대상과 원래 날짜를 사용자에게 보여줄 길은 이 필드뿐이다.
        //
        // 형제 도구(`cancel_schedule_event`·`restore_schedule_event`)는 이 둘을
        // **필수**로 받는다. 여기서는 선택으로 둔다 — 필수로 만들면 모델이 하나만
        // 빠뜨려도 표식이 조용히 통째로 버려져 카드가 0건이 되고, 이 저장소가
        // 실제로 겪은 실패 모양이 그것이다. 채우면 보이고, 안 채우면 예전과 같다.
        expected_title: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "옮기려는 일정의 **현재** 제목. `### 등록된 일정`에 적힌 그대로 넣으면 확인 카드에 '대상 일정'으로 보입니다. 사용자가 무엇이 바뀌는지 알려면 필요합니다.",
        },
        expected_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "옮기려는 일정의 **현재** 날짜 (YYYY-MM-DD). 확인 카드에 '현재 날짜'로 보입니다. 새 날짜는 `date`에 넣으세요.",
        },
        schedule_scope: {
          type: "string",
          enum: ["confirmed_fact", "shared_commitment", "external_commitment"],
          description: "변경하는 일정의 성격. 값과 관계없이 사용자 확인 카드를 거칩니다.",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "cancel_schedule_event",
    description:
      "일정을 지우지 않고 취소 상태로 바꾸며 취소 시각·처리한 구성원·선택적 사유를 남깁니다. event_id는 문맥의 `### 등록된 일정` 줄 앞(`evt_…=`)에 있습니다. 거기 없는 일정이면 지어내지 말고 어느 일정인지 되물으세요.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        event_id: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "취소할 일정의 ID",
        },
        expected_title: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "get_schedule_events에서 확인한 현재 일정 제목. 대상이 바뀌지 않았는지 서버가 다시 검증합니다.",
        },
        expected_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "get_schedule_events에서 확인한 현재 일정 날짜 (YYYY-MM-DD)",
        },
        reason: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          pattern: "^[^\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]+$",
          description: "사용자가 말한 취소 사유만 선택적으로 기록합니다. 추정해서 채우지 마세요.",
        },
      },
      required: ["event_id", "expected_title", "expected_date"],
    },
  },
  {
    name: "restore_schedule_event",
    description:
      "취소 상태인 일정 하나를 예정 상태로 복원하고 취소 감사 정보는 제거합니다. event_id는 문맥의 `### 등록된 일정` 줄 앞(`evt_…=`)에 있습니다. 거기 없는 일정이면 지어내지 말고 어느 일정인지 되물으세요.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        event_id: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "복원할 취소 일정의 ID",
        },
        expected_title: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "get_schedule_events에서 확인한 취소 일정의 현재 제목",
        },
        expected_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "get_schedule_events에서 확인한 취소 일정의 현재 날짜 (YYYY-MM-DD)",
        },
      },
      required: ["event_id", "expected_title", "expected_date"],
    },
  },
  {
    name: "delete_schedule_event",
    description:
      "지원이 중단된 과거 호환 도구입니다. 일정을 삭제하지 않으며 cancel_schedule_event를 사용해야 합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "삭제할 일정의 ID",
        },
        confirmed: {
          type: "boolean",
          description: "사용자가 일정 삭제를 명시적으로 확인한 뒤에만 true로 설정합니다.",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "toggle_checklist_item",
    description:
      "특정 카테고리의 체크리스트 항목을 완료·미완료로 변경합니다. '결혼식장 방문 완료했어' 같은 요청에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: CHECKLIST_CATEGORY_KEYS,
          description: `카테고리. ${PLANNING_CATEGORY_DESCRIPTION}`,
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
      "캘린더 일정을 상태별로 조회합니다. 일반 조회는 planned만 사용하고, 사용자가 취소 기록이나 복원을 명시적으로 요청한 경우에만 status=cancelled를 사용하세요.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        from_date: {
          type: "string",
          description: "조회 시작일 (YYYY-MM-DD). 생략하면 오늘부터",
        },
        to_date: {
          type: "string",
          description: "조회 종료일 (YYYY-MM-DD). 생략하면 시작일+30일",
        },
        status: {
          type: "string",
          enum: ["planned", "cancelled", "all"],
          description: "조회 상태. 생략하면 planned. cancelled는 명시적 취소 기록/복원 요청에만 사용합니다.",
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
          enum: SCHEDULE_CATEGORY_KEYS,
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
          // 예시는 defaultActionHref·prompts.ts의 안내와 같은 경로만 둔다.
          // 없는 경로를 예시로 주면 모델이 그대로 복사해 404 카드를 만든다
          // (가족 조율 페이지 제거 후 /wedding/etiquette가 그렇게 남아 있었다).
          description: "관련 페이지 경로. 예: /wedding/community/quote-check, /wedding/schedule, /wedding/budget",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "log_wedding_event",
    description:
      "사용자가 결혼 준비 일정의 제목과 날짜를 명시적으로 저장하겠다고 확인한 경우에만 일정에 반영합니다. 상대 날짜는 오늘 기준 YYYY-MM-DD로 변환하되 애매하면 저장 전에 확인합니다. 이 도구는 일정 저장만 보장하며, 별도 기능 상태와 수신 동의가 필요한 선제 알림을 약속하지 않습니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        moment_type: {
          type: "string",
          enum: [
            "family_greeting",
            "sanggyeonrye",
            "venue_tour",
            "dress_tour",
            "studio_shoot",
            "dress_fitting",
            "invitation_meeting",
            "first_holiday",
          ],
          description:
            "일정 종류: family_greeting(한쪽 가족에게 첫인사), sanggyeonrye(양쪽 부모님이 함께 만나는 자리), venue_tour(결혼식장 방문), dress_tour(드레스 매장 방문), studio_shoot(웨딩 사진 촬영), dress_fitting(드레스 수선·최종 확인), invitation_meeting(초대장 전달 모임), first_holiday(결혼 후 첫 명절)",
        },
        date: {
          type: "string",
          description: "일정 날짜 YYYY-MM-DD",
        },
        title: {
          type: "string",
          description: "일정 제목. 생략하면 종류 기본 라벨. 초대장 전달 모임은 그룹을 담아 '대학 친구 초대장 전달 모임'처럼 작성",
        },
        memo: {
          type: "string",
          description: "장소·인원 등 참고 메모 (선택)",
        },
      },
      required: ["moment_type", "date"],
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
      "정확한 업체명을 직접 찾거나 공시 추천 미지원 카테고리를 탐색할 때만 사용합니다. 웨딩 사진 촬영·드레스·헤어·메이크업·결혼식장의 지역·예산·취향 비교 탐색은 반드시 recommend_vendors를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "업체 카테고리 (한글). 예: '웨딩 사진 촬영', '드레스', '헤어·메이크업', '결혼식장', '한복', '결혼반지', '신혼여행'",
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
          description: "정확히 찾으려는 업체명. 지원 카테고리에서 태그·스타일 탐색어로 사용하지 않습니다.",
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
      "아모라 내부에 등록된 특정 업체의 가능 시간 후보를 조회합니다. 실제 업체 재고를 실시간 조회하거나 예약 가능 여부를 확정하는 도구가 아니며, 모든 결과는 업체 최종 확인이 필요합니다. 고객이 '이 업체 언제 상담 후보가 있어?', '○○ 스튜디오 토요일 후보가 있어?' 같은 요청에 사용합니다.",
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
      "고객이 업체를 비교·추천받으려 할 때 사용합니다. 웨딩 사진 촬영·드레스·헤어·메이크업·결혼식장은 검수된 공개 가격과 확인 조건만으로 설명 가능한 결과를 반환하며, 공식 데이터 장애 시 과거 순위로 대체하지 않습니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "추천 카테고리 (한글). 예: '웨딩 사진 촬영', '드레스', '헤어·메이크업', '결혼식장', '한복', '결혼반지'",
        },
        mood: {
          type: "string",
          description: "고객이 원하는 분위기/스타일. 예: '모던', '클래식', '내추럴', '로맨틱', '빈티지', '럭셔리', '심플', '화려한', '따뜻한', '감성적인'",
        },
        preferred_tags: {
          type: "array",
          items: { type: "string" },
          description: "고객이 직접 말한 선호 태그. 예: ['자연광', '필름감성']. 임의로 만들어 넣지 않습니다.",
        },
        required_attrs: {
          type: "object",
          description: "반드시 필요한 확인 조건. 예: 스튜디오 원본 포함은 { original_files_policy: 'included' }. 고객이 명시한 조건만 넣습니다.",
          additionalProperties: true,
        },
        wedding_month: {
          type: "string",
          description: "고객이 특정한 결혼 예정 월(YYYY-MM). 예: 2026-11",
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
      "특정 업체의 공시 근거·가격·태그를 우선 조회하고, 예약 상품·스태프는 보조 정보로만 조회합니다. 고객이 추천 결과의 상세를 요청할 때 사용하며, 메시지에 [vendor:ID] 태그가 있으면 해당 ID를 사용하세요.",
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
      "아모라 내부에 등록된 업체의 가능 시간 후보를 조회합니다. 실제 업체 재고의 실시간 조회나 예약 가능 확정이 아니며 업체 최종 확인이 필요합니다. 고객이 상품과 스태프를 선택한 후 후보 시간을 확인할 때 사용합니다. 메시지에 [vendor:ID][product:ID][staff:ID] 태그가 있으면 해당 ID를 사용하세요. 사용자가 특정 월/주/날짜를 지정하면 target_month 또는 target_date 를 함께 넘기세요. 특정 날짜 요청이면 target_date 를 반드시 사용하고, 결과의 fallbackSlots 는 '다른 날짜 참고 후보'일 뿐 예약 확정 날짜로 취급하지 마세요.",
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
        target_month: {
          type: "string",
          description:
            "특정 월 필터 (YYYY-MM 형식, 예: '2026-08'). 사용자가 '8월', '다음 달', '8월쯤' 같이 월 단위로 묻는 경우 사용. 결과가 0이면 시스템이 자동으로 인접 월(전월/다음월) 슬롯도 함께 반환.",
        },
        target_date: {
          type: "string",
          description:
            "특정 일자 필터 (YYYY-MM-DD 형식). 사용자가 '6월 3일', '이번 주 토요일' 같이 구체 날짜를 말했을 때 반드시 사용. target_month 보다 우선.",
        },
      },
      required: ["vendor_id"],
    },
  },
  {
    name: "create_booking",
    description:
      "고객이 날짜와 시간을 선택한 뒤 아모라 내부에 방문·상담 예약 요청 기록과 일정을 만듭니다. 업체에 요청을 전송하거나 예약을 확정하지 않으며, 금액은 견적일 뿐 결제·지출 기록이 아닙니다. 업체 전달 및 최종 확정은 별도 확인이 필요합니다. 사용자가 특정 날짜를 말했거나 메시지에 [date:YYYY-MM-DD] 태그가 있으면 date 는 반드시 그 날짜와 정확히 같아야 합니다. 해당 날짜 후보가 없으면 create_booking 을 호출하지 말고 get_available_slots 결과를 바탕으로 불가 안내와 대체 후보만 제안하세요. 메시지에 [vendor:ID][product:ID][staff:ID][date:YYYY-MM-DD][time:HH:00] 태그가 있으면 해당 값을 사용하세요.",
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
      "현재 커플이 아모라 내부에 남긴 방문·상담 예약 요청 기록을 조회합니다. 업체 전달·확정 상태를 뜻하지 않습니다. 내부 기록 취소나 현황 확인 시 먼저 호출하여 booking_id를 확인하세요.",
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
      "아모라 내부의 예약 요청 기록과 연결 일정을 취소 상태로 표시합니다. 업체에 취소를 전송하거나 업체 취소·환불을 확정하지 않으며, 실제 지출 기록은 보존합니다. 업체 취소와 환불은 별도 확인이 필요합니다. 고객이 내부 기록 취소를 요청하면 사용하고, 메시지에 [booking:ID] 태그가 있으면 해당 값을 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        booking_id: {
          type: "string",
          description: "예약 ID",
        },
        confirmed: {
          type: "boolean",
          description: "사용자가 예약 취소를 명시적으로 확인한 뒤에만 true로 설정합니다.",
        },
      },
      required: ["booking_id"],
    },
  },
  {
    name: "get_market_price",
    // 카테고리·지역은 `v_public_official_prices` 실측값이다(2026-08-22). 스키마가
    // 데이터와 갈라지면 모델이 없는 값을 골라 조회가 늘 0건이 된다 — 같은 실수를
    // pending_action 표식에서 이미 한 번 했다.
    description:
      "검수·공시된 결혼서비스 가격(한국소비자원 참가격)의 카테고리 통계를 조회합니다. 사용자가 평균·중간값 같은 참고 금액을 물을 때 사용하며, 결과에는 출처와 기준 시점이 함께 옵니다. 개별 업체 추천·품질 판정·최종 결제액 판정에는 사용하지 않습니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: ["hall", "studio", "dress", "makeup"],
          description: "조회할 항목. hall=결혼식장, studio=웨딩 사진 촬영, dress=드레스, makeup=헤어·메이크업. 공시 자료가 있는 항목은 이 넷뿐입니다.",
        },
        region: {
          type: "string",
          enum: [
            "seoul_gangnam3", "seoul_etc", "gyeonggi", "incheon", "gangwon",
            "chungcheong", "daejeon", "jeolla", "gwangju", "gyeongsang",
            "daegu", "busan", "ulsan", "jeju",
          ],
          description: "사용자가 지역을 말했을 때만 넣습니다. 말하지 않았으면 반드시 비워서 전국 공시가 전체를 봅니다 — 임의로 좁히면 금액이 배로 달라집니다(200명 식대 전국 1,280만 vs 강남권 2,300만). seoul_gangnam3=서울 강남·서초·송파, seoul_etc=그 외 서울.",
        },
        itemType: {
          type: "string",
          enum: ["대관료", "식대", "옵션", "장식비"],
          description: "category=hall 일 때만 씁니다. 식대는 1인당 금액이고 대관료는 건당이라 단위가 다릅니다. 비우면 네 항목을 각각 나눠서 돌려주니, 사용자가 한 항목만 물었을 때만 지정하세요.",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "analyze_contract_readiness",
    description:
      "계약 전 확인 도우미입니다. 사용자가 계약서·견적서·메신저 조건·환불·계약 취소 비용·추가금·말로만 들은 약속·결혼식장 계약을 확인해달라고 할 때 사용합니다. 법률 판단을 확정하지 말고, 계약 전 문서로 남길 항목과 업체에 보낼 질문을 정리합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: ["venue", "sdm_package", "studio", "dress", "makeup", "snap", "other"],
          description: "계약 카테고리. venue=결혼식장, sdm_package=사진 촬영·드레스·헤어·메이크업 묶음, snap=결혼식 날 사진·영상",
        },
        vendor_name: {
          type: "string",
          description: "업체명 (선택)",
        },
        contract_amount: {
          type: "number",
          description: "계약 총액 (만원 단위). 사용자가 원 단위로 말했어도 만원으로 환산해서 넣으세요.",
        },
        deposit_amount: {
          type: "number",
          description: "계약금/예약금 (만원 단위)",
        },
        has_written_contract: {
          type: "boolean",
          description: "계약서 또는 확정 견적서가 문서로 있는지",
        },
        uses_standard_contract: {
          type: "boolean",
          description: "표준계약서 또는 표준 약관 기반인지. 모르면 생략.",
        },
        included_items: {
          type: "array",
          items: { type: "string" },
          description: "사용자가 문서/캡처에서 확인한 포함 항목. 추측 금지.",
        },
        checked_clauses: {
          type: "array",
          items: { type: "string" },
          description: "이미 문서로 확인된 조항 id 또는 자연어 항목. 예: cancellation_refund, 보증 인원, 원본 제공",
        },
        missing_clauses: {
          type: "array",
          items: { type: "string" },
          description: "사용자가 없다고 말한 조항 id 또는 자연어 항목",
        },
        evidence_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["quote", "contract", "deposit", "message_capture", "receipt", "schedule", "vendor_policy"],
          },
          description: "사용자가 갖고 있는 증빙 종류",
        },
        oral_promises: {
          type: "array",
          items: { type: "string" },
          description: "상담 중 말로 들은 무료 제공/할인/서비스 약속. 문서화 여부 확인 대상.",
        },
        cancellation_policy: {
          type: "string",
          description: "취소/환불/위약금 관련 문구",
        },
        change_policy: {
          type: "string",
          description: "날짜/시간/인원/담당자 변경 관련 문구",
        },
        payment_schedule: {
          type: "string",
          description: "계약금·계약 뒤 남은 금액·결제일 관련 문구",
        },
        extra_fee_policy: {
          type: "string",
          description: "추가금/별도 비용/옵션 관련 문구",
        },
        memo: {
          type: "string",
          description: "문서나 캡처에서 읽힌 주요 내용 요약. 첨부 파일을 본 경우 핵심 문구를 여기에 넣으세요.",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "simulate_guest_guarantee",
    description:
      "결혼식장 예상 참석 인원, 1인당 식사 금액, 계약상 최소 식사 인원 계산기입니다. 사용자가 참석 인원·식사 금액·계약상 최소 인원·최종 인원 전달 날짜·사용하지 못한 식사 비용을 묻거나 결혼식장 계약을 검토할 때 사용합니다. 사용자 입력만으로 계산하고 확인 질문을 정리합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        estimated_guests: {
          type: "number",
          description: "예상 하객 수",
        },
        guaranteed_guests: {
          type: "number",
          description: "계약서상 보증 인원 또는 최소 보증 인원",
        },
        meal_price: {
          type: "number",
          description: "1인 식대 (만원 단위). 예: 7.5 = 7만5천원. 원 단위로 입력된 경우 실행기가 보정합니다.",
        },
        confirmed_rsvp_guests: {
          type: "number",
          description: "이미 참석 확정된 하객 수 (선택)",
        },
        no_show_rate_percent: {
          type: "number",
          description: "사용자가 직접 정한 노쇼/불참 시나리오 비율(0~100). 업계 평균이나 기본값을 추정하지 말고, 모르면 계산 전에 사용자에게 확인합니다.",
        },
        notice_deadline: {
          type: "string",
          description: "최종 인원 통보 마감일 (YYYY-MM-DD, 선택)",
        },
        venue_name: {
          type: "string",
          description: "결혼식장 이름 (선택)",
        },
        memo: {
          type: "string",
          description: "계약서나 상담 내용에서 확인된 특이사항",
        },
      },
      required: [],
    },
  },
  // 네이버 지역 검색 API 장소 검색
  {
    name: "search_nearby_places",
    description:
      "네이버 지역 검색으로 식당·카페 같은 일반 장소를 찾습니다. 고객이 '강남역 근처 양쪽 부모님이 만나기 좋은 식당', '홍대 카페 추천' 처럼 말해도 **query 에는 지역과 종류만 짧게** 넣으세요('강남역 한정식', '홍대 카페'). 웨딩 사진 촬영·드레스·헤어·메이크업 업체가 아닌 일반 장소 검색에만 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "**지역 + 장소 종류**만 넣은 짧은 검색어(낱말 2~3개). 네이버 지역 검색은 "
            + "키워드로 찾으므로 말하듯 길게 쓰면 결과가 하나도 안 나옵니다. "
            + "예: '강남역 한정식', '식사동 한식', '홍대 카페', '서초 한식당'. "
            + "'근처', '하기 좋은', '조용한', '양쪽 부모님 모임' 같은 말은 빼세요.",
          minLength: 2,
          maxLength: 40,
        },
      },
      required: ["query"],
    },
  },
  // 견적 분석 (AI 견적 체크)
  {
    name: "analyze_quote",
    description:
      "사진 촬영·드레스·메이크업 견적의 항목 상태를 정리합니다. 1단계에서는 included_items와 not_needed_items를 빈 배열로 호출해 체크리스트를 보여주세요. [quote_analysis] 결과가 온 2단계에서만 사용자가 고른 두 배열을 전달하고 checklist_confirmed=true로 호출하세요. 항목을 추측하지 마세요.",
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
          description: "견적 카테고리. sdm_package=사진 촬영·드레스·헤어·메이크업 묶음, studio=웨딩 사진 촬영만, dress=드레스만, makeup=헤어·메이크업만",
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
        not_needed_items: {
          type: "array",
          items: { type: "string" },
          description: "사용자가 이용하지 않겠다고 고른 항목. 1단계에서는 빈 배열, 2단계에서만 [quote_analysis]의 ‘이용 안 함’ 목록을 그대로 넣으세요.",
        },
        checklist_confirmed: {
          type: "boolean",
          description: "사용자가 체크리스트 결과를 보낸 2단계에서만 true. 첫 호출은 false 또는 생략.",
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
// 현재 웹 MVP에서 노출하는 도구
// =============================================
// 장기 기능의 스키마·실행기는 보존하되, 현재 제품 계약 밖인 업체 추천·예약·조회는
// 모델에 제공하지 않는다. 다시 켤 때는 사용자 가치 검증과 최신 거래·개인정보 고지를
// 별도 출시 조건으로 통과해야 한다.
export const BETA_DISABLED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "search_vendors",
  "check_vendor_availability",
  "recommend_vendors",
  "get_vendor_detail",
  "get_available_slots",
  // These operations require a server-issued, single-use user confirmation
  // contract. A model-generated `confirmed: true` is not authorization.
  "create_booking",
  "get_my_bookings",
  "cancel_booking",
  // `search_nearby_places` 는 2026-08-22에 열었다. 여기 묶여 있던 이유는 업체 추천
  // 보류였는데, 이 도구는 **업체를 찾아주지 않는다** — 안에 울타리가 두 겹 있다:
  // 웨딩업체 질의를 `wedding_vendor_query_blocked` 로 막고, 네이버 결과에서도
  // 웨딩업체를 걸러낸다. 남는 것은 상견례 식당 같은 일반 장소뿐이고, 그건
  // 예약·결제 없이 공개 검색 결과를 보여주는 것이다.
  // 자격증명이 없으면 라우트가 `isPlaceSearchConfigured()` 로 걸러 모델에게 주지 않는다.
  "delete_category",
  "reset_category",
  "delete_schedule_event",
]);

/** 베타용: 비활성 도구를 제외한 안전한 도구 목록 */
export const BETA_SAFE_TOOLS: AiToolDefinition[] = WEDDING_TOOLS.filter(
  (t) => !BETA_DISABLED_TOOL_NAMES.has(t.name)
);
