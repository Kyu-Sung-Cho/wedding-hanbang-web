import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  WEDDING_CODE_V06_VERSION,
  type WeddingCodeV06Axis,
  type WeddingCodeV06Question,
  type WeddingCodeQuestionKey,
  type WeddingCodeV06QuestionKey,
} from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_V08_AXES,
  WEDDING_CODE_V08_NEXT_STEPS,
  WEDDING_CODE_V08_QUESTIONS,
  WEDDING_CODE_V08_VERSION,
} from "@/constants/weddingCodeV08";
import {
  WEDDING_CODE_V09_AXES,
  WEDDING_CODE_V09_NEXT_STEPS,
  WEDDING_CODE_V09_QUESTIONS,
  WEDDING_CODE_V09_VERSION,
} from "@/constants/weddingCodeV09";

const WEDDING_CODE_V06_NEXT_STEPS = {
  A1: "각자 먼저 확인할 항목을 하나씩 말하고, 총액·받는 사진 수·보정해 주는 사진 수·앨범에 들어가는 사진 수·취소 조건을 견적서에서 확인해 보세요.",
  A2: "둘이 넘지 않을 최대 금액을 정하고, 추가 비용을 낼 경우 줄일 항목과 같은 조건의 다른 예식장 한 곳을 함께 비교해 보세요.",
  A3: "영상이 필요한 이유를 각자 말한 뒤, 촬영 시간·받는 영상 종류·전달 날짜·추가 비용을 서면으로 확인해 보세요.",
  A4: "사진 취향과 계약 안전을 따로 확인하세요. 전체 작업 사례·실제 고객 후기·취소 시 환불액을 보고 다른 업체 한 곳과 비교해 보세요.",
  B1: "누가 후보를 줄일지, 둘이 함께 볼 기준은 무엇인지, 최종 결정은 어떻게 할지를 먼저 나눠 보세요.",
  B2: "남은 일을 적은 뒤 조사 담당·후보 정리 담당·최종 확인 담당을 나누고, 함께 결정할 일에 표시해 보세요.",
  B3: "각 담당자가 후보 두 개와 추천 이유를 준비하고, 다른 사람의 확인을 받은 뒤 최종 선택을 정해 보세요.",
  B4: "탈락 기준 세 가지를 함께 정하고 각자 남길 후보를 고른 뒤, 겹치는 곳과 서로 꼭 남기고 싶은 한 곳만 비교해 보세요.",
  C1: "둘이 포기하지 않을 조건과 부모님이 걱정한 음식·주차 조건을 나눠 적고, 확인된 사실을 본 뒤 최종 결정 범위를 정해 보세요.",
  C2: "두 사람과 부모님에게 이 절차가 왜 중요한지 들은 뒤, 생략·축소·대체 중 가능한 방법과 설명할 사람을 정해 보세요.",
  C3: "전체 하객 수와 예산 상한을 먼저 정하고, 두 사람 몫과 양가 몫을 숫자로 나눈 뒤 꼭 필요한 명단부터 채워 보세요.",
  C4: "둘이 불가능한 날짜를 먼저 빼고 가능한 날짜를 만든 뒤, 양쪽 부모님께 같은 마감일까지 답을 받아 정해 보세요.",
  D1: "\"지금은 들어주는 것과 같이 해결하는 것 중 뭐가 필요해?\"라고 먼저 묻고, 답에 맞춰 대화를 이어가 보세요.",
  D2: "대화 시간을 정하고 각자 힘든 점 한 가지를 말한 뒤, 오늘 정할 일은 하나만 고르세요.",
  D3: "어떤 조항이 걱정되는지 묻고 표시한 뒤, 모르는 내용은 업체에 서면으로 질문하고 답을 받은 다음 결정하세요.",
  D4: "상담 자리에서 잠시 나온 뒤 총금액·추가 비용·취소 조건·할인 기한을 적고, 할인 없이도 계약할지 각자 답해 보세요.",
} as const satisfies Readonly<Record<WeddingCodeV06QuestionKey, string>>;

/**
 * 화면에 쓰는 「열여섯 장면」의 수를 문항 수에서 만든다.
 *
 * 문항 수가 바뀔 때마다 카피에 박힌 숫자가 조용히 거짓이 된다. 이 저장소에서 실제로
 * 그 방식으로 결함이 네 건 나왔다(건너뛰기를 넣자 「열여섯 장면 중 2곳에서 갈렸어요」가
 * 비교하지도 못한 장면을 「같았다」로 세기 시작했다). 그래서 숫자는 손으로 쓰지 않는다.
 */
const KOREAN_COUNTS: Readonly<Record<number, string>> = {
  12: "열두",
  16: "열여섯",
  20: "스무",
  24: "스물네",
};

export function weddingCodeSceneCountLabel(count: number): string {
  return KOREAN_COUNTS[count] ?? String(count);
}

export type WeddingCodeSceneVersion =
  | typeof WEDDING_CODE_V06_VERSION
  | typeof WEDDING_CODE_V08_VERSION
  | typeof WEDDING_CODE_V09_VERSION;

export type WeddingCodeSceneConfig = Readonly<{
  version: WeddingCodeSceneVersion;
  questions: readonly WeddingCodeV06Question[];
  axes: readonly WeddingCodeV06Axis[];
  nextSteps: Readonly<Partial<Record<WeddingCodeQuestionKey, string>>>;
}>;

export const WEDDING_CODE_V06_SCENE_CONFIG: WeddingCodeSceneConfig = {
  version: WEDDING_CODE_V06_VERSION,
  questions: WEDDING_CODE_V06_QUESTIONS,
  axes: WEDDING_CODE_V06_AXES,
  nextSteps: WEDDING_CODE_V06_NEXT_STEPS,
};

export const WEDDING_CODE_V08_SCENE_CONFIG: WeddingCodeSceneConfig = {
  version: WEDDING_CODE_V08_VERSION,
  questions: WEDDING_CODE_V08_QUESTIONS,
  axes: WEDDING_CODE_V08_AXES,
  nextSteps: WEDDING_CODE_V08_NEXT_STEPS,
};

export const WEDDING_CODE_V09_SCENE_CONFIG: WeddingCodeSceneConfig = {
  version: WEDDING_CODE_V09_VERSION,
  questions: WEDDING_CODE_V09_QUESTIONS,
  axes: WEDDING_CODE_V09_AXES,
  nextSteps: WEDDING_CODE_V09_NEXT_STEPS,
};

/**
 * 새로 시작하는 사람이 푸는 판. 옛 판은 **그 판으로 만든 링크를 열 때만** 쓴다.
 *
 * v0.8 → v0.9 (2026-09-17): 팀원이 라이브에서 풀어보고 선택지가 겹치고(동시에 고를 수
 * 있고), 정답이 뻔하고, 준비를 안 해본 사람은 상황을 모르고, 말투가 AI 같다고 했다.
 * 고치려면 선택지의 **뜻**이 바뀐다. 같은 `v0.8-code` 로 문장만 바꾸면 이미 보낸 링크가
 * 상대가 고르지도 않은 문장을 인용하고, 연구 기여 답도 두 문구가 한 판으로 섞인다.
 * 그래서 판을 올렸다.
 */
export const CURRENT_WEDDING_CODE_SCENE_CONFIG = WEDDING_CODE_V09_SCENE_CONFIG;

const SCENE_CONFIGS: Readonly<Record<WeddingCodeSceneVersion, WeddingCodeSceneConfig>> = {
  [WEDDING_CODE_V06_VERSION]: WEDDING_CODE_V06_SCENE_CONFIG,
  [WEDDING_CODE_V08_VERSION]: WEDDING_CODE_V08_SCENE_CONFIG,
  [WEDDING_CODE_V09_VERSION]: WEDDING_CODE_V09_SCENE_CONFIG,
};

/**
 * 판 이름 → 그 판의 문항.
 *
 * 예전에는 「v0.6 이 아니면 v0.8」 삼항식이었다. 판을 하나 더하면 **새 판 답이 옛 판
 * 문장으로 보이는데** 타입 검사도 못 잡는다. 판마다 표에 한 줄씩 두면 판을 union 에
 * 더하는 순간 이 표가 빠진 칸을 타입 오류로 알려준다.
 */
export function weddingCodeSceneConfigForExactVersion(
  version: WeddingCodeSceneVersion,
): WeddingCodeSceneConfig {
  return SCENE_CONFIGS[version];
}

function isWeddingCodeSceneVersion(value: string): value is WeddingCodeSceneVersion {
  return Object.hasOwn(SCENE_CONFIGS, value);
}

/**
 * v0.6 초기에 만든 공유 링크에는 버전이 없었다. 답 코드가 있는 무버전 링크만 v0.6으로
 * 해석하고, 새 진입은 현재 판으로 연다. 알 수 없는 버전은 다른 문항으로 조용히 해석하지 않는다.
 */
export function resolveWeddingCodeSceneConfig(
  version: string | null | undefined,
  hasEncodedAnswers: boolean,
): WeddingCodeSceneConfig | null {
  const normalized = typeof version === "string" ? version.trim() : "";
  if (normalized !== "" && isWeddingCodeSceneVersion(normalized)) return SCENE_CONFIGS[normalized];
  if (normalized === "") {
    return hasEncodedAnswers
      ? WEDDING_CODE_V06_SCENE_CONFIG
      : CURRENT_WEDDING_CODE_SCENE_CONFIG;
  }
  return null;
}
