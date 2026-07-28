import { CANDIDATE6_ITEM_REVIEW_FLAGS, type Candidate6ItemId } from "./candidate6";

/**
 * 「오늘 한 마디」 장면 텍스트 — 로컬 연구 프로토타입 전용 결정적 상수.
 *
 * 기획: `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md`
 *
 * ## 최상위 불변식
 *
 * **이 파일의 문장은 문항 화면(측정)에 단 하나도 렌더되지 않는다.** 회수 화면(S4)과
 * 그 이후에만 나타난다. 재미있는 지문이 M0 문항의 기준점을 옮기기 때문이다 — 잘
 * 쓸수록 더 위험하다. 그래서 재미는 측정 앞(문 앞 한 문장)과 뒤(회수·카드)에만 둔다.
 *
 * ## 저작 규칙
 *
 * - 회수 문장(`recapLines`): 과잉 구체 디테일 정확히 **하나**, 감정 지시어 0개,
 *   3줄 이내·한 줄 15자 이내(320px 실사용 폭 270px, 16px 한글 ≈16.8자/줄).
 * - 두 anchor 중 어느 쪽에도 구체 후보를 배정하지 않는다. Form A/B 위치편향 상쇄를
 *   무력화하는 결함이 된다.
 * - 상대의 무응답·불일치를 사실로 깔지 않는다("답이 달랐다", "읽음이 떴고" 금지).
 * - 카드 질문은 그대로 소리 내 말할 반말 한 문장, 30자 이내, 물음표로 끝난다.
 * - `when`은 하루 속의 자리다. 가사 성역할·운전 상황은 쓰지 않는다.
 *
 * ## 리뷰 플래그 4항목
 *
 * `CANDIDATE6_ITEM_REVIEW_FLAGS`의 rewrite/drop 판정 전에는 우리 문장을 얹지 않는다
 * (`recapLines`·`card` 모두 `null`). 회수 화면은 문항 원문 `scenario`를 그대로 렌더한다.
 * 폐기 예정 항목에 카피 비용을 태우지 않고, 특히 DS3의 업체 서술을 우리 발화로
 * 승격시키지 않기 위한 것이다.
 */
export const CANDIDATE6_SCENE_TEXT_VERSION = "scene-text.1";

export type Candidate6ConversationCard = Readonly<{
  /** 그대로 소리 내 말할 반말 한 문장. */
  prompt: string;
  /** 하루 속의 자리. 소요 시간 추정이 아니다. */
  when: string;
  /** 「10분 안에」 라벨과 함께 렌더되는 행동 하나. */
  action: string;
}>;

export type Candidate6SceneTextEntry = Readonly<{
  /** 회수 목록·카드 후보의 행 제목. 21개가 서로 다르다. */
  sceneTitle: string;
  /** 회수 화면 문장. `null`이면 문항 원문 `scenario`를 그대로 렌더한다. */
  recapLines: readonly string[] | null;
  /** `null`이면 카드 후보에서 제외된다. */
  card: Candidate6ConversationCard | null;
}>;

/**
 * `scenario`가 같은 쌍이 넷 있다(ES/AS support-a·b·c, CP1/CP3). 회수 목록에 같은
 * 제목이 두 번 나오면 사용자에게는 버그로 읽히므로, 제목은 `scenario`가 아니라 그
 * 문항의 `behavior`가 가리키는 차이에서 뽑는다.
 */
export const CANDIDATE6_SCENE_TEXT = {
  // ── 선택의 첫 단추 ────────────────────────────────────────────────
  "C6-DS1": {
    sceneTitle: "마지막 두 곳",
    recapLines: ["조건은 둘 다 맞다.", "두 곳이 남았다.", "이제 취향 얘기다."],
    card: {
      prompt: "조건 말고, 어느 쪽이 더 좋았어?",
      when: "자기 전에 불 끄고 누워서",
      action: "각자 마음에 남은 쪽 하나만 말하기",
    },
  },
  "C6-DS2": {
    sceneTitle: "기록 두 방법",
    recapLines: ["기록은 남기기로 했다.", "방법이 둘 남았다.", "쓸 조건은 둘 다 맞다."],
    card: {
      prompt: "우리 나중에 뭘 제일 다시 볼까?",
      when: "주말 아침에 아직 안 일어났을 때",
      action: "각자 다시 볼 것 하나만 말하기",
    },
  },
  "C6-DS3": { sceneTitle: "도와줄 두 곳", recapLines: null, card: null },
  "C6-DS4": { sceneTitle: "알리는 두 방법", recapLines: null, card: null },

  // ── 우리의 팀플 ──────────────────────────────────────────────────
  "C6-JI1": {
    sceneTitle: "첫 목록 만들기",
    recapLines: ["둘 다 잠깐은 낼 수 있다.", "떠넘기는 방식은 없다.", "같이 만들어도 된다."],
    card: {
      prompt: "첫 목록만 오늘 같이 만들어볼래?",
      when: "밥 먹고 나서 앉은 자리에서",
      action: "각자 한 개씩만 올려서 목록 시작하기",
    },
  },
  "C6-JI2": {
    sceneTitle: "마지막 비교",
    recapLines: ["결정 권리는 똑같다.", "마지막 비교만 남았다.", "같이 볼 수 있다."],
    card: {
      prompt: "마지막 비교는 같이 앉아서 볼래?",
      when: "주말 아침에 아직 안 일어났을 때",
      action: "같이 볼 시간 하나만 정하기",
    },
  },
  "C6-JI3": {
    sceneTitle: "쌓인 작은 일",
    recapLines: ["작은 일들이 쌓였다.", "급한 마감은 없다.", "하나만 골라도 된다."],
    card: {
      prompt: "짧은 것 하나만 오늘 같이 끝낼래?",
      when: "자기 전에 불 끄고 누워서",
      action: "제일 짧은 하나를 골라 지금 끝내기",
    },
  },
  "C6-OA1": {
    sceneTitle: "찾기를 맡았다",
    recapLines: ["찾기는 한 명이 맡았다.", "범위는 합의했다.", "방법은 아직 안 정했다."],
    card: {
      prompt: "방법은 내 방식대로 해도 괜찮아?",
      when: "밥 먹고 나서 앉은 자리에서",
      action: "어디까지 내가 정할지 한 줄로 맞추기",
    },
  },
  "C6-OA2": {
    sceneTitle: "정리를 맡았다",
    recapLines: ["정리는 한 명이 맡았다.", "끝 기준은 합의했다.", "방식은 아직 안 정했다."],
    card: {
      prompt: "정리 방식은 내가 정해도 괜찮아?",
      when: "카톡으로 딱 이 한 줄만",
      action: "정리 방식 한 가지만 적어 보내기",
    },
  },
  "C6-OA3": {
    sceneTitle: "작은 일을 맡았다",
    recapLines: ["작은 일은 한 명이 맡았다.", "범위는 합의했다.", "순서는 내가 정한다."],
    card: {
      prompt: "순서는 내가 정해도 괜찮아?",
      when: "지하철에서 나란히 앉아서",
      action: "먼저 할 것 하나만 정해 말하기",
    },
  },
  "C6-CP1": {
    sceneTitle: "중간에 확인",
    recapLines: ["며칠 걸리는 일이다.", "중간 시점을 약속했다.", "같이 확인하면 된다."],
    card: {
      prompt: "중간에 한 번 같이 볼 날 정할래?",
      when: "카톡으로 딱 이 한 줄만",
      action: "중간에 볼 날 하나만 정하기",
    },
  },
  "C6-CP2": {
    sceneTitle: "확정 직전",
    recapLines: ["준비는 끝났다.", "확정만 안 눌렀다.", "아직 고칠 수 있다."],
    card: {
      prompt: "확정 누르기 전에 같이 볼래?",
      when: "카톡으로 딱 이 한 줄만",
      action: "확정 전에 볼 항목 두 개만 정하기",
    },
  },
  "C6-CP3": { sceneTitle: "막힌 일이 생겼다", recapLines: null, card: null },

  // ── 필요한 도움 ──────────────────────────────────────────────────
  "C6-ES1": { sceneTitle: "부담을 묻는다", recapLines: null, card: null },
  "C6-AS1": {
    sceneTitle: "다음 일을 제안",
    recapLines: ["일정이 밀렸다.", "우리가 정한 게 아니다.", "오늘 마감은 없다."],
    card: {
      prompt: "다음 할 일 하나만 정해줄래?",
      when: "지하철에서 나란히 앉아서",
      action: "다음 한 가지만 골라 말하기",
    },
  },
  "C6-ES2": {
    sceneTitle: "복잡한 마음",
    recapLines: ["후보가 너무 많다.", "머리가 복잡하다.", "오늘 정할 일은 없다."],
    card: {
      prompt: "지금은 들어주는 게 좋아, 정하는 게 좋아?",
      when: "자기 전에 불 끄고 누워서",
      action: "지금 더 필요한 쪽을 골라 말로 말하기",
    },
  },
  "C6-AS2": {
    sceneTitle: "기준 하나 제안",
    recapLines: ["후보가 너무 많다.", "고를 기준이 없다.", "오늘 정할 일은 없다."],
    card: {
      prompt: "비교할 기준 하나만 정해줄래?",
      when: "밥 먹고 나서 앉은 자리에서",
      action: "기준 하나만 골라 적어두기",
    },
  },
  "C6-ES3": {
    sceneTitle: "아쉬운 마음",
    recapLines: ["원했던 게 어려워졌다.", "아쉬움이 남는다.", "살펴볼 시간은 있다."],
    card: {
      prompt: "아쉬운 얘기 잠깐 들어줄래?",
      when: "자기 전에 불 끄고 누워서",
      action: "아쉬운 점 하나만 말하기",
    },
  },
  "C6-AS3": {
    sceneTitle: "대안 첫 단계",
    recapLines: ["원했던 게 어려워졌다.", "대안을 봐야 한다.", "시간은 아직 있다."],
    card: {
      prompt: "대안 찾는 첫 단계만 같이 정할래?",
      when: "지하철에서 나란히 앉아서",
      action: "제일 먼저 볼 것 하나만 정하기",
    },
  },

  // ── 주변 의견 다루기 ──────────────────────────────────────────────
  "C6-SI1": {
    sceneTitle: "첫 초안",
    recapLines: ["초안을 만들 차례다.", "의견은 듣기로 했다.", "순서만 남았다."],
    card: {
      prompt: "우리 그림부터 먼저 맞춰볼까?",
      when: "주말 아침에 아직 안 일어났을 때",
      action: "우리가 편한 쪽 하나만 먼저 정하기",
    },
  },
  "C6-SI2": {
    sceneTitle: "함께할 경험",
    recapLines: ["경험 두 가지가 있다.", "의견은 듣기로 했다.", "순서만 남았다."],
    card: {
      prompt: "우리 편한 쪽부터 얘기해볼까?",
      when: "밥 먹고 나서 앉은 자리에서",
      action: "편한 쪽 하나만 먼저 말하기",
    },
  },
} as const satisfies Record<Candidate6ItemId, Candidate6SceneTextEntry>;

/**
 * 막간에 쓰는 문장. **약속의 재진술만 한다** — 도메인 명사를 하나도 쓰지 않으므로
 * 특정 문항을 가리킬 수 없고, 어떤 anchor도 미리 밀어주지 않는다.
 *
 * 막간은 문항 사이에 오기 때문에 이후 항목을 프라이밍할 수 있는 유일한 지점이다.
 * R1에서 오염이 확인되면 이 배열을 비우는 것만으로 되돌릴 수 있다.
 */
export const CANDIDATE6_INTERLUDE_SENTENCES = [
  "여기서 고르는 건 순서예요. 무엇이 옳은지가 아니라.",
  "지금 당장 정하지 않아도 되는 것만 물었어요.",
  "남은 장면도 같은 약속으로 물어봐요.",
] as const;

const REVIEW_FLAGGED_IDS = new Set<string>(Object.keys(CANDIDATE6_ITEM_REVIEW_FLAGS));

/**
 * 진행 표시를 숫자에서 말로 바꾼다. 진행률 바를 쓰지 않는 이유는 §3이 이야기 리듬을
 * 권하기 때문이고, 마지막 세 장에서 숫자가 문장으로 바뀌는 순간 자체가 "끝이 온다"는
 * 신호가 된다. 퍼센트·분수·"진행" 표기를 만들지 않는다.
 */
export function sceneRhythmLabel(index: number, total: number): string {
  if (index <= 0) return "첫 장면";
  if (index === total - 1) return "마지막 한 장";
  if (index === total - 2) return "다음이 마지막";
  if (index === total - 3) return "세 장 남았어요";
  return `장면 ${index + 1}`;
}

/**
 * 막간을 넣을 위치. **journey 길이만의 순수 함수다** — 응답·라벨·chapter 경계를 보지
 * 않는다. chapter 경계를 트리거로 쓰면 CORE_ORDER의 테마 교차 배치 때문에 막간이
 * 열 번 넘게 발생한다. 마지막 항목과 인접하지 않고 최대 3회다.
 */
export function interludeIndexes(total: number): readonly number[] {
  if (total < 9) return [Math.floor(total / 2)];
  if (total < 15) return [Math.floor(total / 3), Math.floor((2 * total) / 3)];
  const step = Math.floor(total / 4);
  return [step, step * 2, step * 3];
}

/**
 * 카드 후보. **응답도 라벨도 인자로 받지 않는다** — 앱이 답을 보고 골라줬다는 오해
 * 경로를 코드에서 없앤다. 투여된 항목에서 리뷰 플래그만 빼고 journey 순서를 보존한다.
 * 적용하지 않기로 한 항목은 투여되지 않으므로 후보에도 없다(끈 것이 되살아나지 않는다).
 */
export function deriveCardCandidates(
  administeredIds: readonly Candidate6ItemId[],
): readonly Candidate6ItemId[] {
  return administeredIds.filter((id) => !REVIEW_FLAGGED_IDS.has(id));
}

/**
 * 초대로 내보내는 문자열. 고른 문장 하나뿐이다 — URL·브랜드·장면 제목·답·라벨이 없다.
 * 링크가 없으므로 OG 프리뷰가 생길 표면도, 상대가 답해야 내 결과가 열리는 구조도
 * 성립하지 않는다.
 */
export function buildInviteCopyLine(cardPrompt: string): string {
  return cardPrompt;
}
