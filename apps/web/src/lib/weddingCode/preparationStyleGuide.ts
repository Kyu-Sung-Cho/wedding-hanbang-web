import type {
  WeddingCodeV06AxisKey,
  WeddingCodeV06OptionValue,
  WeddingCodeQuestionKey,
} from "@/constants/weddingCodeV06";
import {
  resolveWeddingCodeSceneConfig,
  type WeddingCodeSceneConfig,
  type WeddingCodeSceneVersion,
} from "./scene/config";
import {
  buildWeddingCodeResultProfile,
  describeWeddingCodeResultReading,
  type WeddingCodeResultAxisReading,
} from "./scene/resultProfile";
import { isWeddingCodeQuestionOption } from "./v06/code";
import type { WeddingCodeV06Answers } from "./v06/gap";

export type PreparationStyleResponse = Readonly<{
  version: string;
  answers: WeddingCodeV06Answers;
}>;

export type PreparationStyleGroupId = "budget" | "roles" | "family" | "support";

const GROUPS = [
  { id: "budget", axis: "decisionCriteria", label: "예산·선택 기준" },
  { id: "roles", axis: "preparationMode", label: "역할 나누기" },
  { id: "family", axis: "coordinationScope", label: "가족과 정하기" },
  { id: "support", axis: "supportOrder", label: "도움 주고받기" },
] as const satisfies readonly Readonly<{
  id: PreparationStyleGroupId;
  axis: WeddingCodeV06AxisKey;
  label: string;
}>[];

export type PreparationStyleChoice = Readonly<{
  value: WeddingCodeV06OptionValue;
  label: string;
}>;

type SceneBase = Readonly<{
  key: WeddingCodeQuestionKey;
  scene: string;
  question: string;
}>;

export type PreparationStylePersonalScene = SceneBase & Readonly<{
  answer: PreparationStyleChoice | null;
  nextStep: string | null;
}>;

export type PreparationStylePersonalGroup = Readonly<{
  id: PreparationStyleGroupId;
  axis: WeddingCodeV06AxisKey;
  label: string;
  summary: string;
  countLine: string;
  answered: number;
  total: number;
  skipped: number;
  reading: WeddingCodeResultAxisReading;
  scenes: readonly PreparationStylePersonalScene[];
}>;

export type PreparationStyleIndividual = Readonly<{
  version: WeddingCodeSceneVersion;
  answered: number;
  total: number;
  skipped: number;
  complete: boolean;
  summary: string;
  groups: readonly PreparationStylePersonalGroup[];
}>;

export type PreparationStyleComparisonScene = SceneBase & Readonly<{
  mine: PreparationStyleChoice | null;
  partner: PreparationStyleChoice | null;
  status: "same" | "different" | "not_compared";
  explanation: string;
  nextStep: string | null;
}>;

export type PreparationStyleComparisonGroup = Readonly<{
  id: PreparationStyleGroupId;
  axis: WeddingCodeV06AxisKey;
  label: string;
  summary: string;
  compared: number;
  same: number;
  different: number;
  skipped: number;
  skippedMessage: string | null;
  scenes: readonly PreparationStyleComparisonScene[];
}>;

export type PreparationStyleGuide =
  | Readonly<{
      status: "invalid";
      participant: "mine" | "partner";
      reason: "unsupported_version" | "invalid_answers";
      message: string;
    }>
  | Readonly<{ status: "solo"; personal: PreparationStyleIndividual }>
  | Readonly<{
      status: "version_mismatch";
      personal: PreparationStyleIndividual;
      partner: PreparationStyleIndividual;
      message: string;
    }>
  | Readonly<{
      status: "couple";
      personal: PreparationStyleIndividual;
      partner: PreparationStyleIndividual;
      summary: string;
      compared: number;
      same: number;
      different: number;
      skipped: number;
      skippedMessage: string | null;
      groups: readonly PreparationStyleComparisonGroup[];
    }>;

type ValidationResult =
  | Readonly<{ ok: true; config: WeddingCodeSceneConfig }>
  | Readonly<{ ok: false; reason: "unsupported_version" | "invalid_answers" }>;

function validateResponse(response: PreparationStyleResponse): ValidationResult {
  // 링크용 resolver의 무버전·공백 보정은 저장된 응답에 적용하지 않는다.
  if (typeof response.version !== "string" || response.version.length === 0
    || response.version.trim() !== response.version) {
    return { ok: false, reason: "unsupported_version" };
  }
  const config = resolveWeddingCodeSceneConfig(response.version, true);
  if (!config) return { ok: false, reason: "unsupported_version" };
  const answers = response.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)
    || (Object.getPrototypeOf(answers) !== Object.prototype && Object.getPrototypeOf(answers) !== null)) {
    return { ok: false, reason: "invalid_answers" };
  }
  for (const [key, value] of Object.entries(answers)) {
    const question = config.questions.find(item => item.key === key);
    if (!question || (value !== undefined && !isWeddingCodeQuestionOption(question, value))) {
      return { ok: false, reason: "invalid_answers" };
    }
  }
  return { ok: true, config };
}

function invalidGuide(participant: "mine" | "partner", reason: "unsupported_version" | "invalid_answers"): PreparationStyleGuide {
  return {
    status: "invalid", participant, reason,
    message: reason === "unsupported_version"
      ? "어떤 문항으로 답했는지 확인하지 못했어요. 웨딩코드에 다시 답해 주세요."
      : "고른 답을 확인하지 못했어요. 웨딩코드에 다시 답해 주세요.",
  };
}

function buildIndividual(response: PreparationStyleResponse, config: WeddingCodeSceneConfig): PreparationStyleIndividual {
  // 기존 개인 요약의 셈·인용과 판별 문구를 함께 재사용한다. 새 성격 해석은 만들지 않는다.
  const profile = buildWeddingCodeResultProfile(response.answers, config);
  return {
    version: config.version,
    answered: profile.answered,
    total: profile.total,
    skipped: profile.total - profile.answered,
    complete: profile.complete,
    summary: profile.answered === 0
      ? "아직 답한 장면이 없어요."
      : `답한 ${profile.answered}장면에서 고른 답을 주제별로 정리했어요.`,
    groups: GROUPS.map(group => {
      const reading = profile.axes.find(axis => axis.axis === group.axis)!;
      const questions = config.questions.filter(question => question.axis === group.axis);
      return {
        ...group,
        summary: reading.answered === 0 ? "이 주제는 아직 답한 장면이 없어요." : reading.title,
        countLine: describeWeddingCodeResultReading(reading),
        answered: reading.answered,
        total: questions.length,
        skipped: questions.length - reading.answered,
        reading,
        scenes: questions.map(question => {
          const option = question.options.find(item => item.value === response.answers[question.key]);
          return {
            key: question.key, scene: question.scene, question: question.question,
            answer: option ? { value: option.value, label: option.label } : null,
            nextStep: option ? config.nextSteps[question.key] ?? null : null,
          };
        }),
      };
    }),
  };
}

function summarizeComparison(compared: number, same: number, different: number): string {
  if (compared === 0) return "둘이 함께 답한 장면이 없어 아직 비교하지 않았어요.";
  return `함께 답한 ${compared}장면 중 ${same}곳은 같은 답, ${different}곳은 다른 답을 골랐어요.`;
}

function skippedMessage(skipped: number): string | null {
  return skipped === 0 ? null
    : `한 사람이라도 답하지 않은 ${skipped}장면은 비교하지 않았어요.`;
}

function compareScene(mine: PreparationStylePersonalScene, partner: PreparationStylePersonalScene): PreparationStyleComparisonScene {
  const base = { key: mine.key, scene: mine.scene, question: mine.question, mine: mine.answer, partner: partner.answer };
  if (!mine.answer || !partner.answer) {
    return {
      ...base, status: "not_compared", nextStep: null,
      explanation: !mine.answer && !partner.answer
        ? "두 사람 모두 답하지 않아 비교하지 않았어요."
        : !mine.answer ? "내가 답하지 않아 비교하지 않았어요." : "상대가 답하지 않아 비교하지 않았어요.",
    };
  }
  // 같은 집계 방향이어도 보기 자체가 다르면 서로 다른 선택이다.
  const same = mine.answer.value === partner.answer.value;
  return {
    ...base,
    status: same ? "same" : "different",
    explanation: same
      ? "같은 답을 골랐어요. 고른 이유도 같은지는 서로 물어보세요."
      : "고른 답이 달라요. 왜 그 답을 골랐는지부터 이야기해 보세요.",
    nextStep: mine.nextStep,
  };
}

/** 저장·공유 권한은 호출 전에 확인한다. 이 함수는 전달받은 실제 선택만 읽는 순수 모델이다. */
export function buildPreparationStyleGuide(
  mine: PreparationStyleResponse,
  partner?: PreparationStyleResponse | null,
): PreparationStyleGuide {
  const ownValidation = validateResponse(mine);
  if (!ownValidation.ok) return invalidGuide("mine", ownValidation.reason);
  const personal = buildIndividual(mine, ownValidation.config);
  if (!partner) return { status: "solo", personal };

  const partnerValidation = validateResponse(partner);
  if (!partnerValidation.ok) return invalidGuide("partner", partnerValidation.reason);
  const other = buildIndividual(partner, partnerValidation.config);
  if (mine.version !== partner.version) {
    return {
      status: "version_mismatch", personal, partner: other,
      message: "서로 다른 문항으로 답해서 나란히 비교하지 않았어요. 같은 문항으로 다시 답하면 함께 볼 수 있어요.",
    };
  }

  const groups = personal.groups.map(group => {
    const partnerGroup = other.groups.find(item => item.id === group.id)!;
    const scenes = group.scenes.map((scene, index) => compareScene(scene, partnerGroup.scenes[index]));
    const same = scenes.filter(scene => scene.status === "same").length;
    const different = scenes.filter(scene => scene.status === "different").length;
    const compared = same + different;
    const skipped = scenes.length - compared;
    return {
      id: group.id, axis: group.axis, label: group.label,
      summary: summarizeComparison(compared, same, different),
      compared, same, different, skipped, skippedMessage: skippedMessage(skipped), scenes,
    };
  });
  const compared = groups.reduce((count, group) => count + group.compared, 0);
  const same = groups.reduce((count, group) => count + group.same, 0);
  const different = groups.reduce((count, group) => count + group.different, 0);
  const skipped = personal.total - compared;
  return {
    status: "couple", personal, partner: other,
    summary: summarizeComparison(compared, same, different),
    compared, same, different, skipped, skippedMessage: skippedMessage(skipped), groups,
  };
}
