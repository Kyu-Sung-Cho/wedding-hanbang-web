/**
 * 아모라의 첫마디 — 튜토리얼이 끝난 직후, 사람이 아무것도 누르지 않았을 때 먼저 건네는 말.
 *
 * ## 왜 모델이 쓰지 않는가
 *
 * 첫마디는 그 사람이 방금 온보딩에서 **직접 적은 것**만 가지고 만든다. 예식일과 지금 어디까지
 * 왔는지. 그게 전부다.
 *
 * **성별은 쓰지 않는다.** 처음에는 `role: "bride" | "groom"`을 받았는데 본문이 그 값을 한
 * 번도 읽지 않았다 — 사용자의 성별을 두 단계나 실어 나르고 버리고 있었다. 제품 정본이
 * 첫 가치 도달 전 성별 역할 강제를 금지하고, main의 #138도 같은 이유로 채팅 말풍선에서
 * 성별 명사를 걷어냈다. 필드를 남겨두면 언젠가 누군가 그것을 읽는다.
 *
 * 모델에게 맡기면 세 가지가 한꺼번에 걸린다. (1) 아직 확인되지 않은 사실을 말할 수 있고
 * — 이 제품은 사용자가 확인한 것만 기록으로 남긴다 — (2) 첫 화면이 네트워크와 토큰에
 * 묶여서 느리거나 실패하면 "먼저 말을 건다"가 아예 일어나지 않으며, (3) 두 사람이 같은
 * 상황에서 다른 인사를 받는다.
 *
 * 그래서 첫마디만은 결정적으로 만든다. 이후의 진짜 대화는 평소대로 모델이 한다.
 *
 * ## 무엇을 말하지 않는가
 *
 * - 준비가 얼마나 됐는지 **판정하지 않는다**. "늦으셨어요", "잘 하고 계세요" 둘 다 안 한다.
 * - 업체·가격·계약에 대해 아무 말도 하지 않는다. 근거가 없다.
 * - 체크리스트 완료율·예산 같은 숫자를 만들어내지 않는다. 온보딩의 자기 신고는 그 자체로
 *   준비 완료 사실이 아니다.
 * - 자기를 "플래너"나 "파트너"로 소개하지 않는다. 이 제품에서 파트너는 배우자될 사람이고,
 *   아모라의 정본 호칭은 결혼 준비 동반자다.
 *
 * ## 무엇을 하는가
 *
 * 그 사람이 적은 것을 **그대로 되읽어 주고**, 다음에 볼 것 **하나**를 고르자고 제안한다.
 * 할 일 목록을 펼치지 않는다 — 시작이 쉬워야 하고, 목록은 이미 라운지에 있다.
 */

import {
  findPreparationStageOption,
  type PreparationStageValue,
} from "../constants/preparationStage";

export interface AmoraFirstHelloInput {
  /** `YYYY-MM-DD`. 아직 미정이면 null. */
  weddingDate?: string | null;
  /** 온보딩 한 줄 단계. 없으면 null(예전에 온보딩한 커플). */
  preparationStage?: PreparationStageValue | null;
  /** 화면에 이미 파트너가 연결돼 있는가. 아직이면 초대 한 줄을 덧붙인다. */
  partnerLinked?: boolean;
  /** 지금 시각(ms). 테스트가 시계를 고정할 수 있게 받는다. */
  now: number;
}

export interface AmoraFirstHello {
  /** FAB 옆 말풍선에 보이는 한 줄. 길면 잘리므로 여기서 짧게 만든다. */
  preview: string;
  /** 대화를 열었을 때 보이는 전문. 문단은 줄바꿈으로 나눈다. */
  body: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 이 제품은 KST 하나만 쓴다. `coupleConnection.ts` 도 같은 이유로 고정 오프셋을 직접
// 쓴다 — 한국은 서머타임이 없어 +09:00 이 언제나 정확하다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 예식일까지 남은 날.
 *
 * ## 왜 KST 로 오늘을 읽는가
 *
 * 예식일은 사용자가 고른 **한국 날짜**다("2027-04-17" 은 한국의 4월 17일). 그런데
 * "오늘"을 `getUTCDate()` 로 읽으면 Vercel(UTC)에서 **한국 새벽 00:00~09:00 동안 어제**가
 * 되어 D-day 가 하루 많게 나왔다. 하루 24시간 중 9시간이다.
 *
 *     예식일 2026-08-25, 한국 2026-08-24 06:00
 *       실제 D-1  ->  화면 "결혼식까지 2일 남았어요"
 *
 * 가장 나쁜 형태는 **예식 당일 새벽**이다 — "오늘이 결혼식이네요" 대신 "결혼식까지
 * 1일 남았어요"가 나갔다.
 *
 * 웹은 이미 `lib/utils/kstDate.ts` 로 같은 사고를 한 번 겪고 고쳤고, 그 파일 머리말이
 * "모든 사용자-노출 날짜 계산은 이 헬퍼를 통과시킨다"고 적어 뒀다. 이 계산만 그 규칙
 * 밖에 있었다.
 *
 * 기존 검사가 못 잡은 이유: `NOW = Date.UTC(2026, 7, 20)` 은 KST 09:00 이라 UTC 와
 * 날짜가 일치하기 시작하는 첫 시각이다. 깨진 구간을 한 번도 지나지 않았다.
 *
 * 형식이 아니거나 실재하지 않는 날짜면 null — 없는 D-day를 지어내지 않는다.
 */
export function daysUntilWedding(
  weddingDate: unknown,
  now: number,
): number | null {
  if (typeof weddingDate !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(weddingDate);
  if (!match) return null;

  const [, year, month, day] = match;
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(target);
  // 2026-02-30 같은 값은 Date.UTC가 조용히 3월로 넘긴다. 되돌려 확인한다.
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  const todayKst = new Date(now + KST_OFFSET_MS);
  const todayUtc = Date.UTC(
    todayKst.getUTCFullYear(),
    todayKst.getUTCMonth(),
    todayKst.getUTCDate(),
  );
  return Math.round((target - todayUtc) / MS_PER_DAY);
}

/** 예식일을 사람이 읽는 말로. 없으면 null이고, 부르는 쪽은 그 줄을 아예 쓰지 않는다. */
function describeWeddingTiming(
  weddingDate: unknown,
  now: number,
): string | null {
  const remaining = daysUntilWedding(weddingDate, now);
  if (remaining === null) return null;
  if (remaining > 0) return `결혼식까지 ${remaining}일 남았어요`;
  if (remaining === 0) return "오늘이 결혼식이네요";
  // 지난 날짜도 판정하지 않는다. 연기됐을 수도, 잘못 적었을 수도 있다.
  return "적어주신 예식일이 지나 있어요";
}

/**
 * 파트너가 아직 연결되지 않은 사람에게 첫마디 끝에 붙이는 초대 문단.
 *
 * 이 문장은 **함께 대화에서만 참이다.** 나만 (상담)은 파트너를 연결해도 보이지 않는다.
 * 그래서 대화 화면은 이 문단을 `amoraFirstHelloBodyForLane` 으로 걸러서 그린다.
 */
export const AMORA_FIRST_HELLO_PARTNER_INVITE =
  "설정에서 초대 코드를 보내면 두 사람이 같은 화면을 봐요.";

/**
 * 대화 화면 맨 위에 놓을 첫마디 본문. 초대 문단은 '함께 대화'로 정해진 칸에서만 남긴다.
 *
 * ## 왜 있나(2026-09-27 검토)
 *
 * 라운지는 파트너가 없는 사람에게 `partnerLinked: false` 로 첫마디를 만들고, 본문 끝에
 * 초대 문단을 붙인다. 대화 화면은 처음 여는 사람에게 '함께/나만'을 고르게 하는데, 첫마디를
 * 그 본문 그대로 그리면 두 곳에서 틀린다.
 * - '나만 (상담)'을 고른 사람의 탭 맨 위에 "두 사람이 같은 화면을 봐요"가 남는다. 나만
 *   레인은 파트너를 연결해도 보이지 않으니 거짓이고, 안전 때문에 '나만'을 고른 사람에게는
 *   비공개 약속을 의심하게 만든다.
 * - 고르기 전에는 선택 카드의 '함께' 덧붙임("파트너를 연결하면 …")과 같은 말을 두 번 한다.
 *
 * `lane` 은 칸이 정해졌을 때만 넘긴다. 정하기 전(선택 카드가 떠 있거나 기억을 읽는 중)은
 * `null` 이다. 문단 단위로 걷으므로 초대 문단이 본문 어디에 있어도 빠진다.
 */
export function amoraFirstHelloBodyForLane(
  body: string,
  lane: "shared" | "private" | null,
): string {
  if (lane === "shared") return body;
  return body
    .split("\n\n")
    .filter((paragraph) => paragraph.trim() !== AMORA_FIRST_HELLO_PARTNER_INVITE)
    .join("\n\n");
}

/**
 * 첫마디를 만든다. 아는 것이 하나도 없어도 말은 건다 — 그게 이 기능의 요점이다.
 */
export function buildAmoraFirstHello(
  input: AmoraFirstHelloInput,
): AmoraFirstHello {
  const timing = describeWeddingTiming(input.weddingDate, input.now);
  const stageLabel = findPreparationStageOption(input.preparationStage)?.label ?? null;

  const opening = timing
    ? `안녕하세요, 아모라예요. ${timing}.`
    : "안녕하세요, 아모라예요. 결혼식 날짜는 아직 정하지 않으셨죠.";

  // 적어준 것을 그대로 되읽는다. 여기에 "그럼 이만큼 남았네요" 같은 계산이나 판정을
  // 붙이지 않는다 — 자기 신고는 그 자체로 준비 완료 사실이 아니다.
  const echo = stageLabel
    ? `${stageLabel}라고 알려주셨어요.`
    : "지금 어디까지 오셨는지는 편하실 때 알려주세요.";

  const invite = input.partnerLinked === false
    ? `\n\n${AMORA_FIRST_HELLO_PARTNER_INVITE}`
    : "";

  const body = [
    opening,
    "",
    echo,
    "",
    "오늘은 딱 한 가지만 정해볼까요? 무엇부터 볼지 모르겠으면 그렇게 말씀해 주셔도 돼요.",
  ].join("\n") + invite;

  const preview = timing
    ? `${timing}. 오늘은 한 가지만 같이 정해봐요.`
    : "오늘은 한 가지만 같이 정해봐요.";

  return { preview, body };
}
