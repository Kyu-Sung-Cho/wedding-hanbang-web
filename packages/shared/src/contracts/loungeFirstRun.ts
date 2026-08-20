/**
 * 웨딩 라운지에 처음 도착했을 때 무엇을 보여줄 것인가.
 *
 * ## 왜 필요한가
 *
 * 온보딩을 막 끝낸 커플에게는 데이터가 하나도 없다. 체크리스트도 예산도 일정도
 * 비어 있고, 그 상태의 대시보드는 "아무것도 없는 화면"이다. 안내 오버레이가 기능을
 * 설명해줘도, 오버레이를 닫으면 여전히 빈 화면이 남는다.
 *
 * 그런데 그 사람은 방금 여러 가지를 **말했다** — 예식일, 지금 어디까지 왔는지, 어떤
 * 분위기를 원하는지. 첫 화면이 그걸 되비추지 않으면, 사람은 자기가 한 입력이 어디로
 * 갔는지 모른 채 빈 위젯을 본다.
 *
 * 그래서 첫 도착 화면은 세 가지만 한다:
 *   1. 방금 말한 것을 그대로 되읽어 준다 (판정하지 않고)
 *   2. 다음에 할 수 있는 일 **하나**를 크게 세운다
 *   3. 왜 아직 비어 있고 무엇이 채우는지 정직하게 말한다
 *
 * ## 다음 할 일을 어떻게 고르는가
 *
 * 온보딩에서 받은 단계 한 줄만 본다. 추천이 아니라 **그 단계에서 대체로 다음에 오는
 * 것**이고, 화면에도 그렇게 적는다. 업체를 고르라거나 얼마를 쓰라는 말은 하지 않는다 —
 * 근거가 없다.
 *
 * 목적지는 이 저장소에 **오늘 실제로 있는 화면**만 쓴다. 플랫폼마다 경로가 다르므로
 * 의미 키(`destination`)만 돌려주고 매핑은 각 앱이 한다. 여기에 경로 문자열을 적으면
 * 한쪽이 바뀔 때 다른 쪽이 죽은 링크를 연다.
 *
 * ## 도착하면 거기도 비어 있다
 *
 * 이 카드는 **라운지가 비어 있을 때만** 뜬다. 그 말은 예산도 일정도 아직 비어 있다는
 * 뜻이다. 그런데 "적어두면 남은 예산이 보여요"라고 쓰면, 눌러서 도착한 사람은 또 빈
 * 화면을 만난다 — 이 기능이 없애려던 바로 그 경험을 한 걸음 뒤로 옮기는 것이다.
 *
 * 그래서 문구는 "이미 있는 것을 보러 간다"가 아니라 **"첫 하나를 넣으면 그때부터 보인다"**로
 * 쓴다. 사람이 도착해서 보게 될 것과 화면이 약속한 것이 같아야 한다.
 */

import {
  findPreparationStageOption,
  type PreparationStageValue,
} from "../constants/preparationStage";
import { daysUntilWedding } from "./amoraFirstHello";

/** 첫 도착 화면이 열 수 있는 곳. 각 앱이 자기 경로로 매핑한다. */
export type LoungeFirstRunDestination =
  | "amora"
  | "checklist"
  | "budget"
  | "schedule"
  | "price";

export interface LoungeFirstRunNextStep {
  destination: LoungeFirstRunDestination;
  /** 카드 제목. 명령이 아니라 제안으로 쓴다. */
  title: string;
  /** 한 줄 설명. 왜 지금 이걸 보는지. */
  body: string;
  /** 버튼 문구. */
  cta: string;
}

export interface LoungeFirstRunEchoLine {
  /** 왼쪽 라벨. */
  label: string;
  /** 오른쪽 값. 사용자가 말한 것 그대로. */
  value: string;
}

export interface LoungeFirstRunView {
  /** "확인했어요" 카드에 들어갈 줄들. 사용자가 말하지 않은 것은 줄 자체가 없다. */
  echo: LoungeFirstRunEchoLine[];
  /** 크게 세울 다음 걸음 하나. */
  nextStep: LoungeFirstRunNextStep;
  /** 파트너가 아직 없을 때만 값이 있다. */
  invite: { title: string; body: string; cta: string } | null;
  /** 화면이 아직 비어 있는 이유. 빈 위젯을 설명 없이 두지 않는다. */
  emptyNote: string;
}

const NEXT_STEP_BY_STAGE: Record<
  PreparationStageValue,
  LoungeFirstRunNextStep
> = {
  just_started: {
    destination: "amora",
    title: "무엇부터 할지 같이 정해요",
    body: "아직 정한 게 없어도 괜찮아요. 한 가지만 골라두면 그다음은 훨씬 쉬워져요.",
    cta: "아모라와 이야기하기",
  },
  venue_hunting: {
    destination: "price",
    title: "공시된 가격을 먼저 보세요",
    body: "업체가 공개한 가격과 위약금 원문을 그대로 볼 수 있어요. 상담 전에 보면 기준이 생겨요.",
    cta: "공시 가격 보기",
  },
  venue_booked: {
    destination: "checklist",
    title: "다음에 볼 것을 골라두세요",
    body: "식장이 정해지면 촬영·드레스·메이크업 순으로 이어지는 경우가 많아요. 순서는 바꿔도 돼요.",
    cta: "체크리스트 열기",
  },
  sdm_in_progress: {
    destination: "budget",
    title: "지금까지 쓴 것을 적어두세요",
    body: "한 건만 적어두면 그때부터 남은 예산이 같이 보여요. 정확하지 않아도 되고, 나중에 고칠 수 있어요.",
    cta: "예산 열기",
  },
  wrapping_up: {
    destination: "schedule",
    title: "남은 날짜를 한자리에 모아요",
    body: "큰 것이 정해졌으면 이제 날짜가 중요해져요. 먼저 잡힌 일정 하나만 넣어두면 그다음이 쉬워져요.",
    cta: "일정 열기",
  },
};

/**
 * `2026-12-20` → `12월 20일`. 해가 바뀌면 연도까지 붙인다.
 *
 * 형식이 아니면 받은 값을 그대로 돌려준다 — 여기서 날짜를 고쳐 쓰지 않는다.
 */
function formatWeddingDate(value: string, now?: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const thisYear =
    typeof now === "number" ? new Date(now).getUTCFullYear() : Number(year);
  const monthDay = `${Number(month)}월 ${Number(day)}일`;
  return Number(year) === thisYear ? monthDay : `${year}년 ${monthDay}`;
}

/** 단계를 모르는 커플(예전 온보딩)에게는 아모라부터 권한다. 무엇을 권할 근거가 없다. */
const FALLBACK_NEXT_STEP: LoungeFirstRunNextStep = NEXT_STEP_BY_STAGE.just_started;

/**
 * 저장된 준비 현황이 **온보딩이 채워준 제안값 그대로**인가.
 *
 * ## 왜 이걸 구분해야 하나
 *
 * 온보딩 마지막 화면은 고른 단계의 제안값으로 19항목을 미리 채운다. 거기서
 * "저장하고 시작하기"를 누르면 그 값들이 `couples.progress`에 그대로 저장된다.
 *
 * 그런데 라운지의 "첫 도착" 판정은 progress에 뭔가 있으면 "이 커플은 이미 만들었다"로
 * 본다. 그래서 단계를 `just_started`가 아닌 것으로 고른 사람 — **5개 중 4개** — 은
 * 첫 도착 화면을 한 번도 못 본다. 자기가 방금 말한 것을 되읽어 주는 화면도, 다음 걸음
 * 하나도, 초대 안내도 못 본 채 빈 위젯 앞에 선다. 앱에서는 안내의 초대 단계까지
 * 조용히 사라진다(그 앵커가 그 카드 안에만 있다).
 *
 * 제안값은 사용자가 **화면에서 확인한 것**이지 라운지에서 **한 일**이 아니다. 그래서
 * 그것만 있는 상태는 여전히 "아직 아무것도 안 한" 상태로 본다. 반대로 한 칸이라도
 * 손으로 고쳤다면 그건 진짜 입력이므로 첫 도착 화면은 물러난다.
 *
 * @param recorded 저장된 카테고리별 상태(예약 키 제외). `{ venue: "completed", ... }`
 */
export function isOnlyStageSuggestion(
  recorded: Readonly<Record<string, string>>,
  stage: PreparationStageValue | null | undefined,
): boolean {
  const suggested = findPreparationStageOption(stage)?.suggested;
  if (!suggested) return Object.keys(recorded).length === 0;

  const recordedKeys = Object.keys(recorded);
  const suggestedKeys = Object.keys(suggested);
  if (recordedKeys.length !== suggestedKeys.length) return false;

  for (const key of suggestedKeys) {
    if (recorded[key] !== suggested[key as keyof typeof suggested]) return false;
  }
  return true;
}

export interface LoungeFirstRunInput {
  /** `YYYY-MM-DD`. 아직 미정이면 null. */
  weddingDate?: string | null;
  preparationStage?: PreparationStageValue | null;
  /** 온보딩에서 고른 웨딩 스타일 라벨(이미 사람이 읽는 말로 바꾼 것). */
  weddingStyleLabel?: string | null;
  partnerLinked?: boolean;
  now: number;
}

export function buildLoungeFirstRunView(
  input: LoungeFirstRunInput,
): LoungeFirstRunView {
  const echo: LoungeFirstRunEchoLine[] = [];

  const remaining = daysUntilWedding(input.weddingDate, input.now);
  if (typeof input.weddingDate === "string" && remaining !== null) {
    // 카드의 다른 값은 전부 사람이 쓰는 말인데 날짜만 `2026-12-20`으로 되읽으면,
    // "들었다"는 느낌이 아니라 저장된 레코드를 보여주는 느낌이 된다.
    const spoken = formatWeddingDate(input.weddingDate, input.now);
    echo.push({
      label: "결혼식",
      value:
        remaining > 0
          ? `${spoken} · ${remaining}일 남음`
          : remaining === 0
            ? `${spoken} · 오늘`
            : spoken,
    });
  } else {
    // 아직 안 정한 것도 사실이다. 빈칸으로 두면 입력을 빠뜨린 것처럼 보인다.
    echo.push({ label: "결혼식", value: "날짜는 아직" });
  }

  const stageLabel = findPreparationStageOption(input.preparationStage)?.label;
  if (stageLabel) echo.push({ label: "지금", value: stageLabel });

  if (input.weddingStyleLabel) {
    echo.push({ label: "원하는 분위기", value: input.weddingStyleLabel });
  }

  const nextStep = input.preparationStage
    ? NEXT_STEP_BY_STAGE[input.preparationStage]
    : FALLBACK_NEXT_STEP;

  const invite = input.partnerLinked === false
    ? {
        title: "파트너를 부르면 같이 봐요",
        body: "초대 코드를 보내면 두 사람이 같은 화면을 봐요. 혼자서도 다 되지만, 같이 보면 두 번 말할 일이 줄어요.",
        cta: "초대 코드 보기",
      }
    : null;

  return {
    echo,
    nextStep,
    invite,
    emptyNote:
      "예산·체크리스트·일정은 두 분이 확인한 것만 쌓여요. 그래서 지금은 비어 있어요.",
  };
}
