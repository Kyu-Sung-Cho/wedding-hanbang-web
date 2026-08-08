import type { WeddingCodeConstructKey } from "@/lib/wedding-code/types";

/**
 * 웨딩코드 v0.6 문항.
 *
 * ## v0.5가 왜 실패했나 (실측)
 *
 * - 16문항이 전부 「가장 먼저 확인할 것은?」·「먼저 할 일은?」 한 가지 틀이었다. 우선순위
 *   고르기 열여섯 번은 퀴즈가 아니라 체크리스트다.
 * - 문항에 결혼이 없었다. D1 「걱정된다고 말했는데, 상대가 바로 해결 방법부터 말했어요」는
 *   결혼 단어가 0개고, B1·B3·B4는 「**업체나 장소**」라는 자리표시어를 썼다 — 이사업체
 *   비교에 그대로 갖다 붙여도 성립한다. 그러면 「이거 우리 얘긴데」가 안 터진다.
 * - 선택지 64개가 전부 사회적으로 옳은 신중한 행동이었다. 창피한 답, 웃긴 답, 나를 들키는
 *   답이 0개라 캡처해서 보낼 문장이 안 생겼다.
 * - 축이 기울어 있었다. 균등 무작위 응답 2만 건에서 지원 순서가 좌 27.9 / 균형 12.7 /
 *   **우 59.4**로 나왔다. 「할 일 먼저 쪽이에요」는 그 사람 특성이 아니라 가중치 설계 산물이었다.
 *
 * ## v0.6의 규칙
 *
 * 1. **`scene`이 먼저다.** 20~40자, 과잉 구체 디테일 하나. 여기서 알아봄이 터진다.
 * 2. **선택지는 그대로 인용된다.** 결과 화면이 「너는 "…", 나는 "…"」로 두 사람 답을 그대로
 *    붙여 보여준다. 그래서 각 label은 **혼자 떼어놔도 말이 되는 1인칭 문장**이어야 한다.
 * 3. **문항마다 솔직한 답이 최소 하나.** 「그냥 내가 정하고 통보했다」처럼 조금 찔리는
 *    선택지가 없으면 아무도 자기 답을 캡처하지 않는다.
 * 4. **한 문항 = 한 축, 좌 2 : 우 2.** 각 문항의 네 선택지 중 둘은 축의 왼쪽, 둘은 오른쪽에
 *    같은 크기(2)로 실린다. 균등 무작위 응답이 정확히 50:50이 되므로 v0.5의 편향이 구조적으로
 *    사라진다(`__tests__/weddingCodeV06.test.ts`가 시뮬레이션으로 강제).
 * 5. **질문 어미를 섞는다.** 「먼저 할 일은?」만 열여섯 번 나오면 리듬이 죽는다 — 실제로 한
 *    말, 속으로 든 생각, 그래서 어떻게 했나를 돌려 쓴다.
 *
 * ## 무엇을 주장하지 않는가
 *
 * 이 문항들은 **성격을 판정하지 않는다.** 결과 화면은 유형·점수·궁합을 만들지 않고
 * 「두 사람이 이 장면에서 뭐라고 답했나」라는 사실과 다음 대화 절차만 말한다. 구성개념
 * 가중치는 **어느 차이를 먼저 보여줄지 고르는 내부 정렬**에만 쓰이며
 * 사용자에게 축 이름이 정체성으로 노출되지 않는다.
 */
export const WEDDING_CODE_V06_VERSION = "v0.6-scene";

export const WEDDING_CODE_V06_COMPATIBLE_VERSIONS = [WEDDING_CODE_V06_VERSION] as const;

export type WeddingCodeV06QuestionKey =
  | "A1" | "A2" | "A3" | "A4"
  | "B1" | "B2" | "B3" | "B4"
  | "C1" | "C2" | "C3" | "C4"
  | "D1" | "D2" | "D3" | "D4";

/**
 * v0.8에서 축마다 다섯 번째 문항이 붙었다.
 *
 * 짝수 문항은 정확히 반반인 자리를 만들고, 그 자리에서는 코드 글자를 정할 수 없다
 * (4문항일 때 축마다 26%, 네 글자가 모두 나올 확률은 30%뿐이었다). 홀수로 바꾼 이유다.
 */
export type WeddingCodeV08ExtraQuestionKey = "A5" | "B5" | "C5" | "D5";

export type WeddingCodeQuestionKey =
  | WeddingCodeV06QuestionKey
  | WeddingCodeV08ExtraQuestionKey;

export type WeddingCodeV06OptionValue = "A" | "B" | "C" | "D";

export type WeddingCodeV06AxisKey =
  | "decisionCriteria"
  | "preparationMode"
  | "coordinationScope"
  | "supportOrder";

export interface WeddingCodeV06Weight {
  construct: WeddingCodeConstructKey;
  value: 1 | 2;
}

export interface WeddingCodeV06Option {
  value: WeddingCodeV06OptionValue;
  /** 그대로 인용되는 1인칭 문장. 혼자 떼어놔도 말이 돼야 한다. */
  label: string;
  /**
   * 솔직한 답. **문항마다 최소 하나** 있어야 한다.
   *
   * 네 선택지가 전부 사회적으로 옳은 행동이면 사람들은 자기가 한 일이 아니라 좋아
   * 보이는 답을 고른다. 그러면 재미도 없고(캡처해서 보낼 문장이 안 생긴다) 신호도
   * 오염된다(아모라가 받는 값이 그 사람의 실제 방식이 아니게 된다).
   *
   * **자책하는 답과는 다르다.** 「고르는 게 힘들어서 정해달라고 했다」는 흔한 일이지만,
   * 「고르는 게 지쳐서 그냥 정해달라고 했다」는 고르는 순간 자기 흠을 인정하는 문장이
   * 된다. 그러면 사람들이 그 답을 피하고, 피한 만큼 축이 기운다 — 불편함과 편향이
   * 같은 곳에서 생긴다. `그냥`·`솔직히`·`통보`처럼 자책을 부르는 말은 테스트가 막는다.
   */
  candid?: true;
  weights: readonly WeddingCodeV06Weight[];
}

export interface WeddingCodeV06Question {
  key: WeddingCodeQuestionKey;
  axis: WeddingCodeV06AxisKey;
  /** 장면 한 줄. 과잉 구체 디테일 하나. */
  scene: string;
  /** 그 장면에서 묻는 것. 어미를 문항마다 바꾼다. */
  question: string;
  options: readonly WeddingCodeV06Option[];
}

export interface WeddingCodeV06AxisSide {
  labelKo: string;
  constructs: readonly WeddingCodeConstructKey[];
}

export interface WeddingCodeV06Axis {
  key: WeddingCodeV06AxisKey;
  /** 내부 정렬·문서용. **사용자에게 정체성으로 노출하지 않는다.** */
  labelKo: string;
  left: WeddingCodeV06AxisSide;
  right: WeddingCodeV06AxisSide;
}

export const WEDDING_CODE_V06_AXES = [
  {
    key: "decisionCriteria",
    labelKo: "정할 때 뭘 먼저 보나",
    left: { labelKo: "숫자와 조건", constructs: ["costRisk", "evidenceDecision"] },
    right: { labelKo: "그림과 의미", constructs: ["experienceMeaning", "aestheticMood"] },
  },
  {
    key: "preparationMode",
    labelKo: "준비를 어떻게 나누나",
    left: { labelKo: "같이 본다", constructs: ["coPreparation"] },
    right: { labelKo: "맡아서 정리한다", constructs: ["roleOwnership"] },
  },
  {
    key: "coordinationScope",
    labelKo: "누구까지 넣고 정하나",
    left: { labelKo: "우리 둘", constructs: ["coupleAutonomy"] },
    right: { labelKo: "가족·하객까지", constructs: ["familyIntegration"] },
  },
  {
    key: "supportOrder",
    labelKo: "힘들 때 뭐부터 하나",
    left: { labelKo: "마음 먼저", constructs: ["emotionalSupport"] },
    right: { labelKo: "할 일 먼저", constructs: ["executionSupport"] },
  },
] as const satisfies readonly WeddingCodeV06Axis[];

/** 사용자에게 축 위치로 노출하지 않는 구성개념. 실무 주의 문장에만 쓴다. */
export const WEDDING_CODE_V06_NON_PUBLIC_CONSTRUCTS = [
  "decisionPaceRisk",
] as const satisfies readonly WeddingCodeConstructKey[];

export const WEDDING_CODE_V06_QUESTIONS = [
  // ── 축 1. 정할 때 뭘 먼저 보나 ──────────────────────────────────
  {
    key: "A1",
    axis: "decisionCriteria",
    scene: "카톡으로 받은 스드메 견적서를 처음 열어본 밤",
    question: "그 화면에서 제일 먼저 눈이 간 곳은?",
    options: [
      { value: "A", label: "맨 아래 총액부터 봤다", weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "포함이라고 적힌 게 진짜 포함인지 뒤졌다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "사진부터 넘겨보느라 금액은 나중에 봤다", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "D", label: "우리 결혼식이 어떤 그림일지 상상부터 했다", weights: [{ construct: "experienceMeaning", value: 2 }] },
    ],
  },
  {
    key: "A2",
    axis: "decisionCriteria",
    scene: "예산보다 삼백 비싼 예식장을 둘 다 마음에 들어한 날",
    question: "그날 밤 속으로 든 생각은?",
    options: [
      { value: "A", label: "삼백이면 신혼여행 한 번인데", weights: [{ construct: "costRisk", value: 2 }] },
      { value: "B", label: "여기 아니면 두고두고 아쉬울 것 같았다", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "C", label: "다른 데서 삼백 줄일 데가 있나 계산했다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "그 홀에 서 있는 장면이 계속 떠올랐다", weights: [{ construct: "aestheticMood", value: 2 }] },
    ],
  },
  {
    key: "A3",
    axis: "decisionCriteria",
    scene: "본식 영상을 넣으면 백오십이 더 붙는다고 들은 자리",
    question: "그때 실제로 나온 말은?",
    options: [
      { value: "A", label: "나중에 이거 보고 싶어질 것 같은데", weights: [{ construct: "experienceMeaning", value: 2 }] },
      { value: "B", label: "다들 하던데 우리만 없으면 좀 그렇잖아", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "C", label: "이거 빼면 정확히 뭐가 없어지는 건데?", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "D", label: "백오십이면 딴 데 쓰는 게 낫지 않아?", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },
  {
    key: "A4",
    axis: "decisionCriteria",
    scene: "사진은 좋은데 후기가 세 개뿐인 스튜디오를 발견한 날",
    question: "그래서 어떻게 했나?",
    options: [
      { value: "A", label: "사진이 이 정도면 됐다고 생각했다", weights: [{ construct: "aestheticMood", value: 2 }] },
      { value: "B", label: "후기 세 개를 줄 단위로 다 읽었다", weights: [{ construct: "evidenceDecision", value: 2 }] },
      { value: "C", label: "느낌이 오면 그냥 가는 편이라 넘겼다", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "D", label: "잘못되면 계약금이 얼마 날아가는지부터 봤다", weights: [{ construct: "costRisk", value: 2 }] },
    ],
  },

  // ── 축 2. 준비를 어떻게 나누나 ──────────────────────────────────
  {
    key: "B1",
    axis: "preparationMode",
    scene: "혼자 웨딩홀 열 군데를 정리해놓고 카톡을 쓰려던 밤",
    question: "결국 보낸 건?",
    options: [
      { value: "A", label: "열 개 다 보내고 같이 보자고 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "「시간 될 때 같이 볼래?」만 보냈다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "솔직히 그냥 내가 정하고 통보했다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "D", label: "괜찮은 세 개로 줄여서 보냈다", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B2",
    axis: "preparationMode",
    scene: "예약·견적 정리·연락을 두 달째 한 사람이 다 하고 있는 상태",
    question: "지금 이 상태에서 뭐가 더 필요한가?",
    options: [
      { value: "A", label: "다음 투어는 무조건 같이 가기", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "덜 바쁜 사람이 그냥 계속 맡기", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "어디서 제일 힘들었는지 먼저 듣기", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "각자 맡을 걸 적어서 딱 나누기", weights: [{ construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "B3",
    axis: "preparationMode",
    scene: "드레스와 예식장을 한 명씩 맡아 보기로 나눈 지 삼 주째",
    question: "지금 그 방식은 어떤가?",
    options: [
      { value: "A", label: "각자 맡으니 편해서 계속 이렇게 하고 싶다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "내 쪽이 더 많은 것 같아 다시 나누고 싶다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "C", label: "따로 보니까 서로 뭘 봤는지 모르겠다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "D", label: "중요한 건 결국 같이 봐야 할 것 같다", weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },
  {
    key: "B4",
    axis: "preparationMode",
    scene: "웨딩홀 후보가 스무 곳까지 늘어나 아무도 안 열어보게 된 날",
    question: "그다음에 한 일은?",
    options: [
      { value: "A", label: "내가 세 곳으로 줄여서 가져갔다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "각자 제일 괜찮은 하나씩 골라오기로 했다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "쳐낼 기준을 내가 정해서 통과시켰다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "D", label: "같이 앉아서 한 번에 쭉 지웠다", weights: [{ construct: "coPreparation", value: 2 }] },
    ],
  },

  // ── 축 3. 누구까지 넣고 정하나 ──────────────────────────────────
  {
    key: "C1",
    axis: "coordinationScope",
    scene: "예식장을 보여드렸더니 음식이랑 주차부터 물어보신 날",
    question: "그때 속으로 든 생각은?",
    options: [
      { value: "A", label: "그건 우리가 이미 정하고 온 건데", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "우리가 여기 마음에 든 이유부터 말하고 싶었다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "듣고 보니 맞는 말이라 다시 봤다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "하객 입장에선 그게 제일 중요하긴 하다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C2",
    axis: "coordinationScope",
    scene: "폐백을 생략하자는 말을 처음 꺼낸 저녁",
    question: "그 말을 어떻게 꺼냈나?",
    options: [
      { value: "A", label: "우리 결혼식이니까 우리가 정하자고 했다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "어른들께 여쭤보고 정하자며 미뤘다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "안 하면 정확히 뭐가 달라지는지부터 따졌다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "부모님이 서운해하실지부터 걱정했다", weights: [{ construct: "familyIntegration", value: 2 }] },
    ],
  },
  {
    key: "C3",
    axis: "coordinationScope",
    scene: "하객 명단에서 직장 사람들을 넣었다 지웠다 한 밤",
    question: "결국 기준으로 삼은 건?",
    options: [
      { value: "A", label: "양가에서 꼭 부르라고 한 사람인지", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "안 부르면 부모님이 곤란해질 사람인지", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "우리가 진짜 부르고 싶은 사람인지", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "D", label: "안 부르면 우리가 불편해질 사람인지", weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },
  {
    key: "C4",
    axis: "coordinationScope",
    scene: "상견례 날짜가 양가 일정 때문에 세 번 엎어진 주",
    question: "네 번째로 잡을 때 한 일은?",
    options: [
      { value: "A", label: "어른들 일정에 우리를 맞췄다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "우리 둘 편한 날로 먼저 못을 박았다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "C", label: "부모님들끼리 정하시게 두었다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "우리가 조정 가능한 범위부터 정해두었다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
    ],
  },

  // ── 축 4. 힘들 때 뭐부터 하나 ───────────────────────────────────
  {
    key: "D1",
    axis: "supportOrder",
    scene: "결혼 준비 힘들다고 했는데 바로 해결책부터 돌아온 밤",
    question: "그때 삼킨 말은?",
    options: [
      { value: "A", label: "그냥 좀 들어주면 안 돼?", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "방법 말고 내 얘기가 먼저야", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "정리해주니 사실 낫긴 했다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "그래서 뭘 하면 되는데?", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
  {
    key: "D2",
    axis: "supportOrder",
    scene: "결혼 준비 얘기만 꺼내면 십 분 만에 둘 다 조용해지던 시기",
    question: "다시 얘기를 시작한다면 뭐부터?",
    options: [
      { value: "A", label: "왜 지치는지 각자 한 번씩 말하기", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "오늘 정할 한 가지만 딱 고르기", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "오늘은 아무것도 안 정하고 얘기만 하기", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "남은 일을 쪼개서 나눠 맡기", weights: [{ construct: "executionSupport", value: 2 }] },
    ],
  },
  {
    key: "D3",
    axis: "supportOrder",
    scene: "상대가 계약서를 세 번 읽고도 아무 말이 없던 저녁",
    question: "그 침묵에 어떻게 반응했나?",
    options: [
      { value: "A", label: "모르는 조항을 같이 찾아봤다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "내가 대신 읽고 요약해서 알려줬다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "C", label: "말 안 걸고 그냥 옆에 앉아 있었다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "D", label: "무슨 생각 하냐고 물었다", weights: [{ construct: "emotionalSupport", value: 2 }] },
    ],
  },
  {
    key: "D4",
    axis: "supportOrder",
    scene: "오늘 계약하면 삼십 빼준다는 말을 상담실에서 들은 순간",
    question: "그 자리에서 내가 한 건?",
    options: [
      { value: "A", label: "취소하면 어떻게 되는지부터 물었다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "B", label: "상대 표정부터 살폈다", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "C", label: "하루만 생각해보겠다고 했다", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "둘 다 급해진 게 느껴져서 손을 잡았다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV06Question[];

export function weddingCodeV06Question(
  key: WeddingCodeV06QuestionKey,
): WeddingCodeV06Question {
  const found = WEDDING_CODE_V06_QUESTIONS.find((question) => question.key === key);
  if (!found) throw new Error(`unknown wedding code v0.6 question: ${key}`);
  return found;
}

/** 답 하나를 그대로 인용할 문장. 결과 화면이 두 사람 답을 이 문자열로 붙인다. */
export function weddingCodeV06OptionLabel(
  key: WeddingCodeV06QuestionKey,
  value: WeddingCodeV06OptionValue,
): string {
  const option = weddingCodeV06Question(key).options.find((item) => item.value === value);
  if (!option) throw new Error(`unknown option ${value} for ${key}`);
  return option.label;
}
