import type { WeddingCodeV06AxisKey, WeddingCodeQuestionKey } from "@/constants/weddingCodeV06";
import type { WeddingCodeSelfLean } from "@/constants/weddingCodeSelfReading";
import { WEDDING_CODE_V11_VERSION } from "@/constants/weddingCodeV11";
import { WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import { describeWeddingCodeCount } from "@/lib/weddingCode/profile/letters";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import type { WeddingCodeSceneConfig } from "./config";
import {
  buildWeddingCodeSelfProfile,
  describeSelfAxisReading,
  type WeddingCodeSelfAxisReading,
  type WeddingCodeSelfProfile,
  type WeddingCodeSelfQuote,
} from "./selfProfile";

export type WeddingCodeResultAxisReading = WeddingCodeSelfAxisReading & Readonly<{
  /** 새 판에서 직접 고른 답만 연결한다. 선택하지 않은 이유는 설명하지 않는다. */
  reflection?: string;
  allEvidence?: readonly WeddingCodeSelfQuote[];
}>;

export type WeddingCodeResultProfile = Omit<WeddingCodeSelfProfile, "axes"> & Readonly<{
  axes: readonly WeddingCodeResultAxisReading[];
}>;

type ReadingCopy = Readonly<{ tellPartner: string; watchOut: string }>;

type SelectedScene = WeddingCodeSelfQuote & Readonly<{
  key: WeddingCodeQuestionKey;
  value: string;
  construct: string;
  side: "left" | "right";
}>;

type AnswerConnection = Readonly<{
  reflection: string;
  tellPartner: string;
  supporting: readonly SelectedScene[];
}>;

/** 서로 다른 두 장면 이상에 실제로 남긴 답만 연결한다. 동기는 추측하지 않는다. */
function connectSelectedAnswers(axis: WeddingCodeV06AxisKey, selected: readonly SelectedScene[]): AnswerConnection | null {
  if (selected.length < 2) return null;
  if (axis === "decisionCriteria") {
    const groups = new Map<string, SelectedScene[]>();
    for (const item of selected) groups.set(item.construct, [...(groups.get(item.construct) ?? []), item]);
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    const [construct, supporting] = sorted[0];
    if (supporting.length < 2 || supporting.length === sorted[1]?.[1].length) return null;
    const wording: Record<string, Readonly<{ reflection: string; tellPartner: string }>> = {
      costRisk: {
        reflection: "총액이나 예산, 돌려받을 돈을 먼저 확인하는 답을 여러 번 골랐어요.",
        tellPartner: "이 항목에는 얼마까지 쓰면 마음이 편할까? 더 쓰고 싶은 게 있다면 이유도 얘기해보자.",
      },
      evidenceDecision: {
        reflection: "견적이나 서비스 내용을 더 확인하는 답을 여러 번 골랐어요.",
        tellPartner: "비싸서 걸리는 걸까, 뭘 해주는지 몰라서 걸리는 걸까? 아직 모르는 것부터 같이 적어볼까?",
      },
      aestheticMood: {
        reflection: "사진이나 영상, 공간의 모습을 먼저 보는 답을 여러 번 골랐어요.",
        tellPartner: "같은 사진을 보고 있어도 마음에 든 부분은 다를 수 있잖아. 너는 어디가 제일 좋아?",
      },
      experienceMeaning: {
        reflection: "그날의 경험이나 나중에 간직할 기억을 먼저 떠올리는 답을 여러 번 골랐어요.",
        tellPartner: "그날 꼭 기억에 남았으면 하는 순간이 뭐야? 나는 어떤 순간을 남기고 싶은지도 얘기해볼게.",
      },
    };
    return wording[construct] ? { ...wording[construct], supporting: supporting.slice(0, 2) } : null;
  }

  if (axis === "preparationMode") {
    const preparation = selected.find((item) => item.key === "B1" || item.key === "B2");
    const decision = selected.find((item) => ["B3", "B4", "B5"].includes(item.key) && item.side !== preparation?.side);
    if (preparation && decision) {
      return {
        reflection: preparation.side === "right"
          ? "후보를 고르거나 상담을 듣는 일은 한 사람이 맡고, 마지막 선택은 함께하는 답도 골랐어요."
          : "후보를 고르거나 상담에서 질문하는 일에는 둘 다 참여하고, 마지막 선택은 한 사람에게 맡기는 답도 골랐어요.",
        tellPartner: "알아보는 일과 마지막에 정하는 일을 나눠보면 어떨까? 어디까지 맡기고, 어디부터 같이 보고 싶어?",
        supporting: [preparation, decision],
      };
    }
    const own = new Set(["B1C", "B2C", "B3B", "B4D", "B5B"]);
    const partner = new Set(["B1D", "B3A", "B4B", "B5D"]);
    const myAnswers = selected.filter((item) => own.has(item.key + item.value));
    const partnerAnswers = selected.filter((item) => partner.has(item.key + item.value));
    if (myAnswers.length >= 2 && myAnswers.length > partnerAnswers.length) {
      return {
        reflection: "이번에는 내가 맡아서 고르거나 알아보겠다는 답을 여러 번 골랐어요.",
        tellPartner: "내가 맡아도 괜찮은 일은 뭐야? 네가 꼭 같이 보고 싶은 부분은 미리 알려줘.",
        supporting: myAnswers.slice(0, 2),
      };
    }
    if (partnerAnswers.length >= 2 && partnerAnswers.length > myAnswers.length) {
      return {
        reflection: "이번에는 상대에게 선택을 맡기는 답을 여러 번 골랐어요.",
        tellPartner: "네가 골라줬으면 하는 일도 있어. 맡기기 전에 내가 알려줄 조건은 뭐가 있을까?",
        supporting: partnerAnswers.slice(0, 2),
      };
    }
  }

  if (axis === "supportOrder") {
    const receiving = selected.find((item) => item.key === "D1");
    const giving = selected.find((item) => item.key === "D3");
    if (receiving && giving && receiving.side !== giving.side) {
      return {
        reflection: receiving.side === "left"
          ? "명단이 버거울 때는 내 마음을 말하고, 계약서를 보던 상대에게는 같이 할 일을 제안하는 답을 골랐어요."
          : "명단이 버거울 때는 할 일을 정하고, 계약서를 보던 상대에게는 기분이나 마음에 관한 말을 건네는 답을 골랐어요.",
        tellPartner: "내가 힘들 때와 네가 힘들 때 먼저 꺼내는 얘기가 다를 수도 있겠네. 그럴 땐 너에게 어떤 말을 해주면 좋을까?",
        supporting: [receiving, giving],
      };
    }
  }
  return null;
}

/** 선택하지 않은 행동을 실수로 예측하지 않고, 지금 확인할 질문을 준다. */
const V11_READING: Record<WeddingCodeV06AxisKey, Record<WeddingCodeSelfLean, ReadingCopy>> = {
  decisionCriteria: {
    left: {
      tellPartner: "지금 보는 곳에서 더 알고 싶은 게 뭐야? 가격이랑 포함된 것 중에 하나씩 말해볼까?",
      watchOut: "궁금한 항목이 있다면 둘의 질문을 모아 업체에 물어보세요. 이미 확인한 내용은 다시 묻지 않아도 돼요.",
    },
    right: {
      tellPartner: "제일 마음에 든 장면이 뭐야? 각자 왜 좋았는지도 얘기해볼까?",
      watchOut: "같은 사진을 골라도 좋아한 부분은 다를 수 있어요. 각자 마음에 든 부분을 짚고, 그 모습이 가능한지 업체에 물어보세요.",
    },
    mixed: {
      tellPartner: "다음에 정할 것에서 꼭 확인하고 싶은 걸 하나씩 말해볼까?",
      watchOut: "모든 항목을 같은 기준으로 고를 필요는 없어요. 다음에 정할 것 하나를 놓고 각자 먼저 보고 싶은 걸 말해보세요.",
    },
  },
  preparationMode: {
    left: {
      tellPartner: "같이 고를 때, 처음부터 같이 볼까? 각자 찾아온 걸 놓고 얘기할까?",
      watchOut: "같이 알아보는 것과 마지막에 같이 정하는 것을 나눠 얘기해보세요. 둘이 함께하고 싶은 부분이 같은지 확인할 수 있어요.",
    },
    right: {
      tellPartner: "하나씩 맡는다면, 나는 어떤 걸 맡고 너는 어떤 걸 맡고 싶어?",
      watchOut: "이번 주 일 하나를 골라 맡을 사람을 정해보세요. 혼자 끝내도 되는지, 결제 전에 함께 볼지도 같이 정하면 돼요.",
    },
    mixed: {
      tellPartner: "알아보는 건 나눠도, 마지막에 꼭 같이 보고 싶은 건 뭐야?",
      watchOut: "둘이 볼 일과 한 사람이 맡을 일을 나눠 적어보세요. 같이 정하는 일도 업체에 연락할 사람은 한 명으로 정할 수 있어요.",
    },
  },
  coordinationScope: {
    left: {
      tellPartner: "우리가 먼저 정하고 싶은 건 뭐야? 부모님 의견을 듣고 싶은 것도 따로 있을까?",
      watchOut: "다음에 정할 일 하나를 놓고 누구 의견을 언제 들을지 얘기해보세요. 의견을 듣는 사람과 마지막에 정하는 사람이 꼭 같을 필요는 없어요.",
    },
    right: {
      tellPartner: "부모님과 같이 얘기해보고 싶은 건 뭐야? 그 전에 우리끼리 맞춰둘 것도 있을까?",
      watchOut: "부모님께 여쭤볼 내용을 각자 하나씩 골라보세요. 부탁을 모두 들어드리는 것과 의견을 듣는 것은 나눠서 생각해도 돼요.",
    },
    mixed: {
      tellPartner: "우리끼리 정할 것과 부모님께 여쭤볼 것을 어디서 나눌까?",
      watchOut: "모든 일을 같은 방식으로 정할 필요는 없어요. 지금 남은 일 중 부모님과 함께 정할 것 하나, 둘이 정할 것 하나를 골라보세요.",
    },
  },
  supportOrder: {
    left: {
      tellPartner: "준비하다 힘들 때, 어떤 말부터 듣고 싶어?",
      watchOut: "힘들다는 말에 곧바로 답을 찾기보다 지금 원하는 도움을 물어보세요. 얘기를 듣는 것과 일을 나누는 것 중 그날 필요한 쪽부터 시작할 수 있어요.",
    },
    right: {
      tellPartner: "힘들 때는 내가 뭘 같이 해주면 좋겠어? 얘기부터 듣고 싶은 날엔 그것도 말해줘.",
      watchOut: "해줄 수 있는 일을 떠올렸다면 먼저 제안해보세요. 상대가 지금 바라는 도움인지 물어본 뒤 시작하면 돼요.",
    },
    mixed: {
      tellPartner: "지금은 얘기를 들어줄까, 같이 하나씩 정리할까?",
      watchOut: "한 번 정한 도움 방식이 매번 같을 필요는 없어요. 준비 얘기를 시작할 때 그날 필요한 것을 짧게 물어보세요.",
    },
  },
};

// v1.2는 C에서 최종 결정의 참여자를, D1/D5에서 받고 싶은 도움을 직접 묻는다.
const V12_READING: typeof V11_READING = {
  ...V11_READING,
  coordinationScope: {
    left: {
      tellPartner: "어떤 일은 우리 둘이 정하고 싶어? 부모님과 함께 정하고 싶은 것도 있을까?",
      watchOut: "의견을 듣는 것과 마지막 결정을 함께하는 것은 다를 수 있어요. 다음에 정할 일 하나를 놓고 어디까지 함께 얘기할지 맞춰보세요.",
    },
    right: {
      tellPartner: "부모님과 함께 정하고 싶은 건 뭐야? 그 전에 우리끼리 맞춰둘 것도 있을까?",
      watchOut: "함께 고를 일인지, 부모님께 선택을 맡길 일인지 구분해보세요. 같은 가족이 참여해도 정하는 방식은 다를 수 있어요.",
    },
    mixed: {
      tellPartner: "우리끼리 정할 것과 부모님과 정할 것을 어디서 나눌까?",
      watchOut: "모든 일을 같은 방식으로 정할 필요는 없어요. 이번에 정할 일 하나를 놓고 누가 마지막 선택에 참여할지 얘기해보세요.",
    },
  },
  supportOrder: {
    ...V11_READING.supportOrder,
    left: {
      tellPartner: "힘들 때 먼저 들어줬으면 하는 말이 있어? 같이 해줬으면 하는 일도 알려줘.",
      watchOut: "내가 받고 싶은 도움과 상대가 바라는 도움은 다를 수 있어요. 얘기를 들어줄지, 일을 같이 할지 그날 필요한 쪽을 물어보세요.",
    },
  },
};

const V12_FAMILY_LABELS = { left: "둘이 정하기", right: "부모님도 참여" } as const;

const V12_CHECK_PHRASES: Readonly<Record<string, string>> = {
  "적힌 내용이 사실인지": "무엇을 어떻게 해주는지",
  "결혼식 날에 거는 기대나 받은 인상": "그날의 경험과 남길 기억",
  "우리 둘 먼저": V12_FAMILY_LABELS.left,
  "가족·하객까지": V12_FAMILY_LABELS.right,
};

/** 문항에서 바뀐 확인 범위를 결과 전체에 적용하고, 구판의 이름은 보존한다. */
function v12DisplayCopy(reading: WeddingCodeSelfAxisReading): Partial<WeddingCodeSelfAxisReading> {
  const missingPhrases = reading.missingPhrases.map(phrase => V12_CHECK_PHRASES[phrase] ?? phrase);
  const base = { missingPhrases, questionVersion: WEDDING_CODE_V12_VERSION };
  if (reading.axis === "coordinationScope") {
    const title = reading.lean === "mixed"
      ? `‘${V12_FAMILY_LABELS.left}’와 ‘${V12_FAMILY_LABELS.right}’ 답을 같은 수만큼 골랐어요`
      : `이번엔 ‘${V12_FAMILY_LABELS[reading.lean]}’ 쪽 답이 더 많았어요`;
    return {
      ...base, title,
      leftLabel: V12_FAMILY_LABELS.left, rightLabel: V12_FAMILY_LABELS.right,
      letterLabels: V12_FAMILY_LABELS,
      ...(reading.lean !== "mixed" ? { letterMeaning: reading.lean === "left"
        ? "마지막 선택을 둘이 하는 답을 더 많이 골랐어요"
        : "부모님과 함께 정하거나 선택을 맡기는 답을 더 많이 골랐어요" } : {}),
    };
  }
  if (reading.axis === "decisionCriteria" && reading.lean === "left") {
    return { ...base, letterMeaning: "비용이나 서비스 내용을 먼저 확인하는 답을 더 많이 골랐어요" };
  }
  if (reading.axis === "preparationMode" && reading.lean !== "mixed") {
    return { ...base, letterMeaning: reading.lean === "left"
      ? "함께 고르거나 상담을 같이 듣는 답을 더 많이 골랐어요"
      : "각자 일을 나누거나, 한 사람이 고르고 알아보는 답을 더 많이 골랐어요" };
  }
  return base;
}

function connectV12Answers(axis: WeddingCodeV06AxisKey, selected: readonly SelectedScene[]): AnswerConnection | null {
  if (selected.length < 2) return null;
  if (axis === "decisionCriteria") return connectSelectedAnswers(axis, selected);
  if (axis === "preparationMode") {
    const preparation = selected.find((item) => item.key === "B1" || item.key === "B2");
    const decision = selected.find((item) => ["B3", "B4", "B5"].includes(item.key) && item.side !== preparation?.side);
    if (preparation && decision) {
      return {
        reflection: preparation.side === "right"
          ? "후보 고르기나 상담은 맡을 사람을 정하고, 마지막 선택은 함께하는 답도 골랐어요."
          : "후보를 고르거나 상담을 듣는 일은 함께하고, 마지막에는 한 사람이 고르는 답도 골랐어요.",
        tellPartner: "알아보는 일과 마지막에 정하는 일을 나눠보면 어떨까? 어디까지 맡기고, 어디부터 같이 보고 싶어?",
        supporting: [preparation, decision],
      };
    }
    const own = new Set(["B1B", "B2C", "B3B", "B4B", "B5B"]);
    const partner = new Set(["B1C", "B2D", "B3C", "B4C", "B5C"]);
    const mine = selected.filter((item) => own.has(item.key + item.value));
    const theirs = selected.filter((item) => partner.has(item.key + item.value));
    if (mine.length >= 2 && mine.length > theirs.length) {
      return {
        reflection: "이번에는 내가 맡아서 고르거나 알아보겠다는 답을 여러 번 골랐어요.",
        tellPartner: "내가 맡아도 괜찮은 일은 뭐야? 네가 꼭 같이 보고 싶은 부분은 미리 알려줘.",
        supporting: mine.slice(0, 2),
      };
    }
    if (theirs.length >= 2 && theirs.length > mine.length) {
      return {
        reflection: "이번에는 고르거나 알아보는 일을 상대에게 맡기는 답을 여러 번 골랐어요.",
        tellPartner: "네가 맡아줬으면 하는 일도 있어. 내가 원하는 조건은 미리 같이 얘기해둘까?",
        supporting: theirs.slice(0, 2),
      };
    }
  }
  if (axis === "coordinationScope") {
    const venue = selected.find((item) => item.key === "C1");
    const money = selected.find((item) => item.key === "C5");
    if (venue && money && venue.side !== money.side) {
      return {
        reflection: venue.side === "left"
          ? "식장은 둘이 정하고, 지원금의 사용처는 부모님과 함께 정하는 답을 골랐어요."
          : "식장은 부모님과 함께 정하고, 지원금의 사용처는 둘이 정하는 답을 골랐어요.",
        tellPartner: "부모님과 함께 정할 일과 우리가 정할 일을 미리 나눠볼까?",
        supporting: [venue, money],
      };
    }
  }
  if (axis === "supportOrder") {
    const receiving = selected.find((item) => item.key === "D1");
    const giving = selected.find((item) => item.key === "D3");
    if (receiving && giving && receiving.side !== giving.side) {
      return {
        reflection: receiving.side === "left"
          ? "명단 때문에 버거울 때는 얘기를 들어주길 바라고, 계약서가 걱정된다는 상대에게는 함께 읽자고 하는 답을 골랐어요."
          : "명단은 함께 추려주길 바라고, 계약서가 걱정된다는 상대에게는 서두르지 말자고 하는 답을 골랐어요.",
        tellPartner: "내가 바라는 도움과 네게 해주려는 도움이 다를 수도 있겠네. 너는 그럴 때 어떤 도움이 먼저 필요해?",
        supporting: [receiving, giving],
      };
    }
  }
  return null;
}

export function buildWeddingCodeResultProfile(
  answers: WeddingCodeV06Answers,
  config: WeddingCodeSceneConfig,
): WeddingCodeResultProfile {
  const profile = buildWeddingCodeSelfProfile(answers, config);
  if (config.version !== WEDDING_CODE_V11_VERSION && config.version !== WEDDING_CODE_V12_VERSION) return profile;
  const isV12 = config.version === WEDDING_CODE_V12_VERSION;

  return {
    ...profile,
    repeated: isV12 ? profile.repeated.map(item => ({
      ...item, phrase: V12_CHECK_PHRASES[item.phrase] ?? item.phrase,
    })) : profile.repeated,
    axes: profile.axes.map((reading) => {
      const axis = config.axes.find((item) => item.key === reading.axis)!;
      const leftConstructs: readonly string[] = axis.left.constructs;
      const selected: SelectedScene[] = config.questions
        .filter((question) => question.axis === reading.axis)
        .flatMap((question) => {
          const option = question.options.find((item) => item.value === answers[question.key]);
          if (!option) return [];
          const construct = option.weights[0].construct;
          return [{ key: question.key, value: option.value, construct,
            side: leftConstructs.includes(construct) ? "left" : "right",
            scene: question.scene, label: option.label }];
        });
      const allEvidence = selected.map(({ scene, label }) => ({ scene, label }));
      const connection = isV12 ? connectV12Answers(reading.axis, selected) : connectSelectedAnswers(reading.axis, selected);
      const supporting = connection?.supporting ?? [];
      // 연결한 두 답을 바로 보여주되, 반대쪽 선택도 인용에서 사라지지 않게 한다.
      const opposite = supporting.length > 0 && supporting.every((item) => item.side === supporting[0].side)
        ? selected.find((item) => item.side !== supporting[0].side) : undefined;
      const evidence = supporting.length > 0
        ? [...supporting, ...(opposite ? [opposite] : [])].map(({ scene, label }) => ({ scene, label }))
        : reading.evidence;
      return {
        ...reading,
        ...(isV12 ? V12_READING : V11_READING)[reading.axis][reading.lean],
        ...(isV12 ? v12DisplayCopy(reading) : {}),
        ...(connection ? { reflection: connection.reflection, tellPartner: connection.tellPartner } : {}),
        evidence,
        allEvidence,
      };
    }),
  };
}

export function describeWeddingCodeResultReading(reading: WeddingCodeResultAxisReading): string {
  // 새 판은 모두 같은 가정 응답 시제다. 옛 판의 경험·바람 혼재 설명을 그대로 붙이지 않는다.
  return reading.allEvidence
    ? describeWeddingCodeCount(reading.axis, reading.leftCount, reading.rightCount, reading.letterLabels)
    : describeSelfAxisReading(reading);
}
