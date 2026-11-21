import { calcCostUsd } from "@/lib/compliance/ai-log";
import { getAmoraModelConfig } from "@/lib/ai/modelConfig";

/**
 * 아모라가 맡은 일(D-84)의 스위치와 한도(D-88).
 *
 * - 스위치 `AMORA_TASKS_ENABLED` 는 정확히 "true" 일 때만 켜진다. 기본은 꺼짐이다(`.env.example`).
 *   꺼져 있으면 대화에 카드 도구가 가지 않고, API 는 `{ enabled:false }` 를 주고, 크론은 아무것도 잡지 않는다.
 * - 한도 숫자는 코드 상수다. 환경값으로 바꾸게 하면 화면 문장과 숫자가 어긋날 수 있어 문장에 숫자를 쓰지 않았다.
 *   운영 하루치를 읽은 뒤 숫자를 다시 본다(D-88 "운영에서 하루치를 읽은 뒤 숫자를 다시 본다").
 */

export function isAmoraTasksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AMORA_TASKS_ENABLED === "true";
}

export const AMORA_TASK_LIMITS = Object.freeze({
  /** 커플이 하루(한국 날짜)에 맡길 수 있는 일. D-88. */
  dailyTasks: 3,
  /** 커플의 하루 모델 걸음. D-88. */
  dailyModelSteps: 60,
  /** 커플의 하루 인터넷 찾기. D-88. 갈래 3 의 대화 속 찾기와 같은 장부로 합칠 자리다(병합 때 맞춘다). */
  dailyWebSearches: 30,
  /** 일 하나가 쓸 수 있는 모델 걸음과 찾기. 한 일이 하루 몫을 혼자 다 쓰지 않게 한다. */
  taskModelSteps: 16,
  taskWebSearches: 12,
  /** 대화 밖 작업이 쓸 수 있는 몫: 전역 하루 금액 상한의 20%. D-88, 12장 P9. */
  backgroundCostShare: 0.2,
});

/** 걸음 하나의 입력·출력 상한. 대화의 상한(64k)보다 좁게 둔다. */
export const AMORA_TASK_MAX_INPUT_TOKENS = 24_000;
export const AMORA_TASK_MAX_OUTPUT_TOKENS = 1_400;

/** 카드가 열려 있는 시간. */
export const AMORA_TASK_OFFER_TTL_SECONDS = 24 * 60 * 60;

/** 일꾼 한 번이 잡는 시간(선점)과 한 번에 하는 걸음 수. */
export const AMORA_TASK_LEASE_SECONDS = 180;
export const AMORA_TASK_ACTIONS_PER_SLICE = 6;

const DEFAULT_GLOBAL_DAILY_COST_CAP_USD = 20;

/** `costGuard.ts` 와 같은 규칙으로 읽는다(양수 달러, 잘못된 값이면 기본값). */
function globalDailyCostCapMicrousd(env: NodeJS.ProcessEnv): number {
  const raw = env.AMORA_GLOBAL_DAILY_COST_CAP_USD;
  const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  const usd = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_DAILY_COST_CAP_USD;
  return Math.round(usd * 1_000_000);
}

/** 서비스 전체에서 맡은 일이 하루에 예약할 수 있는 금액(마이크로달러). */
export function amoraTaskGlobalCostCapMicrousd(env: NodeJS.ProcessEnv = process.env): number {
  return Math.floor(globalDailyCostCapMicrousd(env) * AMORA_TASK_LIMITS.backgroundCostShare);
}

/**
 * 모델 걸음 하나의 최악 비용(마이크로달러). 가격표(`config/amora-model-pricing.json`)와 위 상한에서 계산한다.
 * 입력 전부가 캐시 쓰기 값으로 매겨진다고 보고 올림한다. 가격을 모르면 null(걸음을 하지 않는다).
 */
export function amoraTaskStepReservationMicrousd(): number | null {
  const model = getAmoraModelConfig("fast").model;
  const usd = calcCostUsd(
    model,
    AMORA_TASK_MAX_INPUT_TOKENS,
    AMORA_TASK_MAX_OUTPUT_TOKENS,
    AMORA_TASK_MAX_INPUT_TOKENS,
    0,
  );
  if (usd === null || !Number.isFinite(usd) || usd <= 0) return null;
  return Math.ceil(usd * 1_000_000);
}
