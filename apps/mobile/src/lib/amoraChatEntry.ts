/**
 * 아모라 대화를 여는 문이 여러 개일 때, 문마다 다른 것을 들려 보낸다.
 *
 * ## 왜 필요한가
 *
 * 라운지에는 아모라로 가는 문이 여럿이다 — 우하단 버튼, 첫 도착 카드의 CTA, "오늘 확인할
 * 게 없다"는 히어로 카드의 CTA, 그리고 하단 탭. 전부 같은 화면을 파라미터 없이 열었기
 * 때문에, 방금 "이제 막 시작했어요"를 고르고 온 사람과 무작정 탭을 누른 사람이 완전히
 * 같은 빈 대화를 만났다. 문이 여럿인 값을 하나도 못 한 것이다.
 *
 * 상시로 떠 있던 전폭 카드("막막한 순간은 아모라에게")는 2026-08-20에 지웠다. 우하단
 * 버튼이 늘 같은 화면에 떠 있고 안내도 그 버튼을 "막히면 여기"라고 짚는데, 라운지 아래에
 * 같은 곳으로 가는 큰 카드를 하나 더 두는 것은 자리만 차지하고 고르기만 어렵게 했다.
 *
 * 웹은 최소한 `?prefill=`로 입력창 초안을 다르게 놓는다. 여기서는 같은 일을 하되 URL에
 * 문장을 싣지 않고 **진입구 키**만 싣는다. 문구가 URL을 타고 다니면 같은 말이 진입구마다
 * 흩어지고, 앱에서는 사람이 그 주소를 볼 일도 없다.
 *
 * ## 무엇을 채우는가
 *
 * 채우는 것은 **사용자가 할 말의 초안**이지 아모라의 답이 아니다. 그래서 여기 문구는
 * 진척을 판정하거나 업체를 권하지 않고, 지우고 다시 쓸 수 있는 한 줄로만 둔다.
 *
 * 하단 탭에는 키를 붙이지 않는다. "그냥 아모라와 이야기하러 왔다"도 하나의 맥락이고,
 * 탭에 초안을 얹으면 매번 대화를 열 때마다 남의 말이 입력창에 들어앉는다.
 */

/** 진입구를 싣는 쿼리 파라미터 이름. */
export const AMORA_CHAT_ENTRY_PARAM = "entry" as const;

/**
 * 라운지 할 일에서 「아모라에게 묻기」를 누르고 온 문(2026-11-13). 아래 고정 초안 표에 넣지 않는다.
 * 초안은 할 일마다 다르고(`loungeAmoraAsk.ts`), 주소에는 번호만 싣고 문장은 앱 안에서 건넨다.
 * 표에 넣으면 고정 문구가 먼저 입력칸에 들어가 할 일 질문을 막는다.
 */
export const AMORA_CHAT_TASK_ENTRY = "lounge_task" as const;

export const AMORA_CHAT_ENTRY_VALUES = [
  "lounge_fab",
  "lounge_first_arrival",
  "lounge_focus_calm",
  "joined_plan_review",
] as const;

export type AmoraChatEntry = (typeof AMORA_CHAT_ENTRY_VALUES)[number];

/**
 * 진입구별 입력창 초안.
 *
 * 전부 사용자의 말투다. 아모라가 먼저 단정하는 문장은 여기 두지 않는다 — 이 값은 그대로
 * 전송되는 것이 아니라 입력창에 놓이는 초안이고, 사람이 고쳐 쓸 수 있어야 한다.
 */
const ENTRY_PREFILL: Record<AmoraChatEntry, string> = {
  // 우하단 버튼: 아모라가 먼저 말을 걸어둔 자리다. 이어서 말하는 쪽으로 연다.
  lounge_fab: "라운지에서 왔어. 지금 상황에서 뭘 먼저 보면 좋을지 같이 정해줘.",
  // 첫 도착 카드: 방금 "이제 막 시작했어요"를 고르고 온 사람.
  lounge_first_arrival: "이제 막 결혼 준비를 시작했어. 무엇부터 할지 같이 정해줘.",
  // 히어로 카드가 "오늘 확인 항목이 없어요"라고 말한 뒤의 CTA. 화면이 방금 한 말을
  // 그대로 이어받는다 — 없는 진척을 지어내지 않는다.
  lounge_focus_calm:
    "저장된 일정 기준으로는 오늘 확인할 게 없대. 다음에 뭘 준비하면 좋을지 같이 정리해줘.",
  // 파트너 합류 직후 라운지 카드("이제 이 계획을 함께 봐요")의 CTA. 웹 카드가 채우는 문장
  // (`JOINED_PLAN_REVIEW_PROMPT`, apps/web/src/lib/amora/dashboardCompanion.ts)과 글자까지 같다 —
  // 같은 사람이 웹과 앱에서 다른 질문을 받지 않게. 계획을 바꾸거나 담당자를 정하라고 하지 않는다.
  joined_plan_review:
    "방금 파트너와 연결됐어. 지금 함께 보게 된 결혼식 날짜, 장소, 예산, 준비 진행 중 둘이 먼저 확인할 부분을 짚어줘. 계획을 변경하거나 담당자를 정하지 말고, 같이 확인할 내용만 알려줘.",
};

/**
 * 화면 밖에서 온 값(딥링크·오래된 링크·손으로 고친 주소)이라 그대로 믿지 않는다.
 * 아는 키가 아니면 null이고, 그러면 대화는 평소처럼 빈 입력창으로 열린다.
 */
export function resolveAmoraChatEntry(value: unknown): AmoraChatEntry | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  return (AMORA_CHAT_ENTRY_VALUES as readonly string[]).includes(raw)
    ? (raw as AmoraChatEntry)
    : null;
}

/** 이 진입구가 입력창에 놓을 초안. 모르는 진입구면 null. */
export function getAmoraChatEntryPrefill(value: unknown): string | null {
  const entry = resolveAmoraChatEntry(value);
  return entry ? ENTRY_PREFILL[entry] : null;
}

/** 진입구가 열 주소. 호출하는 쪽이 문자열을 직접 적지 않게 한다. */
export function buildAmoraChatEntryHref(entry: AmoraChatEntry): string {
  return `/(tabs)/chat?${AMORA_CHAT_ENTRY_PARAM}=${entry}`;
}
