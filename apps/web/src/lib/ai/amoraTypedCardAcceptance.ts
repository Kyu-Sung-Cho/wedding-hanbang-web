/**
 * 확인 카드가 떠 있는데 버튼 대신 **말로 승낙한** 턴을 알아본다.
 *
 * 2026-09-15 운영 재현(고치기 전):
 *
 *   아모라: (확인 카드)
 *   사용자: "응 적용해줘"
 *   아모라: "화면에 표시된 '이대로 적용' 버튼을 눌러야 실제로 반영돼요."
 *   옛 카드: "새 대화가 이어져 이 제안은 적용할 수 없어요."  ← 잠김
 *
 * 화면은 최신 메시지의 카드만 누를 수 있게 한다. 그런데 "응 적용해줘" 는 발화만 보면
 * 범위 밖(W4-low)이라 카드 이월 관문(W0/W1)을 못 넘었고, 모델에게는 버튼을 누르라는
 * 계약문이 따로 들어갔다. 사용자는 누를 버튼이 없는 안내를 받았다.
 *
 * 지금은 이렇게 보인다:
 *
 *   사용자: "응 적용해줘"
 *   아모라: `AMORA_TYPED_CARD_ACCEPTANCE_REPLY` + (같은 확인 카드, 이월 표시)
 *   원래 카드: "같은 제안이 아래 최신 답변으로 옮겨졌어요. …" (버튼 없음)
 *
 * 원래 자리의 카드는 잠긴 채 "적용할 수 없어요" 라고 하지 않고, 옮겨진 카드를 가리키며
 * 버튼을 거둔다(웹 `PendingAmoraActionCard` 의 `CONTINUED_PENDING_ACTION_COPY`, 앱
 * `app/(tabs)/chat.tsx`). 누를 곳은 최신 답변의 카드 한 군데다.
 *
 * 이 함수는 **실행 권한을 만들지 않는다.** 참이어도 라우트가 하는 일은 같은 카드
 * (같은 action_id·만료·입력·리비전)를 새 답변으로 옮기고 고정 안내를 붙이는 것뿐이다.
 * 적용은 여전히 사용자가 옮겨진 카드의 버튼을 눌러 서버 발급 action_id 를 보내야 일어난다.
 *
 * 판정은 **허용 목록 문법**이다. 승낙어·지시어·실행 동사만으로 이루어진 짧은 문장만
 * 참이다. 금액·분야·날짜·"근데"·"아니"·"잠깐" 같은 말이 하나라도 섞이면 목록 밖이라
 * 거짓이 된다 — "응 근데 한복은 100으로" 는 승낙이 아니라 새 지시다. 목록 밖 문장은
 * 지금까지의 경로(범위 판정·되묻기 연속성·모델 답변)를 그대로 탄다.
 */

/** 승낙 한 마디는 짧다. 이보다 길면 무언가를 덧붙인 것으로 본다. */
const MAX_ACCEPTANCE_CHARS = 32;

// NFKC 는 호환 자모(ㅇ·ㅋ·ㅎ)를 조합형(ᄋ·ᄏ·ᄒ)으로 바꾼다. 둘 다 받는다.
// "ㅇㅋㅋ" 처럼 웃음 자모가 이어진 승낙도 한 단어로 본다(아래 꼬리 제거보다 먼저 대조한다).
const HEAD = "(?:응+|웅|네+|넹|넵|예|그래(?:요)?|그럼(?:요)?|좋아(?:요)?|좋습니다|오케이|ok(?:ay)?|[ㅇᄋ]{2}|[ㅇᄋ][ㅋᄏ]+|알겠어(?:요)?|알겠습니다)";
const TARGET = "(?:이대로|그대로|그렇게|그걸로|그거로|그것으로|제안대로|카드대로|(?:방금|기존|위|아까)\\s*(?:제안|내용)\\s*대로)";
const ACTION = "(?:(?<verb>적용|반영|진행|저장)\\s*)?(?:해\\s*(?:줘요?|주세요|주라|요)?|하자|할게요?|합시다)|부탁(?:해요?|드려요|드립니다)?";

const ACCEPTANCE_RE = new RegExp(
  `^(?<head>(?:${HEAD}[\\s,]*){1,2})?(?<target>${TARGET}\\s*)?(?<action>${ACTION})?$`,
  "iu",
);

/**
 * 허용 목록과 별개로 한 번 더 막는 말. 목록이 넓어져도 부정·보류·수정은 승낙이 되지
 * 않게 한다. 숫자는 새 금액·날짜라는 뜻이다.
 */
const NEGATION_OR_EDIT_RE = /\d|아니|아뇨|잠깐|잠시|말고|취소|대신|빼고|근데|그런데|하지만|다만|안\s*해|하지\s*마|보류|나중|다시|수정|바꿔|고쳐/u;

/**
 * 끝의 꼬리는 두 단계로 걷는다. 물음표는 어느 단계에서도 걷지 않는다 — "응?" 은 승낙이 아니다.
 *
 * 한 번에 문장부호와 웃음 자모를 함께 걷으면 "ㅇㅋ"(NFKC 로 "ᄋᄏ")의 ᄏ 까지 지워져 "ᄋ" 만
 * 남고 승낙이 아니게 된다(리뷰 [5]). 그래서 문장부호만 걷은 원문을 먼저 대조하고, 맞지 않을
 * 때만 웃음 자모("좋아ㅋㅋ")를 더 걷어 다시 대조한다.
 */
const PUNCTUATION_TAIL_RE = /[\s.!~。…^]+$/u;
const LAUGHTER_TAIL_RE = /[\s.!~。…ㅋㅎᄏᄒ^]+$/u;

/**
 * 승낙이 무엇으로 성립했는가.
 *
 * - `explicit`: 카드를 가리키는 지시어("이대로"·"그렇게"·"제안대로")나 적용 동사("적용·반영·
 *   진행·저장해줘")가 있다. 어떤 답변 아래에서든 그 카드에 대한 답이다.
 * - `bare`: 승낙어만 있다("응"·"네"·"좋아"·"응 해줘"). 직전 아모라 답변이 새로 던진 질문
 *   ("일정도 같이 잡아 드릴까요?")에 대한 답일 수도 있어, 라우트는 직전 행이 카드 자체를
 *   말하는 행일 때만 카드 승낙으로 본다(리뷰 [3]).
 */
export type AmoraTypedCardAcceptanceStrength = "explicit" | "bare";

function classifyCandidate(candidate: string): AmoraTypedCardAcceptanceStrength | null {
  if (candidate.length === 0 || Array.from(candidate).length > MAX_ACCEPTANCE_CHARS) return null;
  if (NEGATION_OR_EDIT_RE.test(candidate)) return null;
  const match = ACCEPTANCE_RE.exec(candidate);
  // 지시어만 있는 문장("그대로")은 승낙인지 되짚기인지 알 수 없다. 승낙어나 실행 동사가 있어야 한다.
  if (match === null || !(match.groups?.head || match.groups?.action)) return null;
  return match.groups?.target || match.groups?.verb ? "explicit" : "bare";
}

export function classifyAmoraTypedCardAcceptance(text: unknown): AmoraTypedCardAcceptanceStrength | null {
  if (typeof text !== "string") return null;
  const punctuationStripped = text.normalize("NFKC").replace(/\s+/gu, " ").trim()
    .replace(PUNCTUATION_TAIL_RE, "");
  const direct = classifyCandidate(punctuationStripped);
  if (direct !== null) return direct;
  const laughterStripped = punctuationStripped.replace(LAUGHTER_TAIL_RE, "");
  return laughterStripped === punctuationStripped ? null : classifyCandidate(laughterStripped);
}

export function isAmoraTypedCardAcceptance(text: unknown): boolean {
  return classifyAmoraTypedCardAcceptance(text) !== null;
}

/**
 * 말로 승낙한 턴에 서버가 쓰는 답. 모델 문장을 쓰지 않는다 — 모델은 누를 버튼이
 * 없는 안내나 "반영할게요" 같은 거짓 약속을 할 수 있다.
 *
 * 버튼 이름은 화면이 실제로 쓰는 것이다. 같은 공유 대화를 두 사람이 서로 다른 기기에서 보므로
 * 한 문장이 모든 화면에서 참이어야 한다. 화면은 세 가지다:
 *
 *   - 웹 카드(`PendingAmoraActionCard`): ‘내용 확인하기’ → 확인 창의 ‘이대로 적용’
 *   - 2026-09-18 이후 앱 카드(`app/(tabs)/chat.tsx`): 웹과 같은 두 단계
 *   - 그 전 앱 카드: ‘이대로 적용’ 하나 — 이 서버 문장이 배포돼도 새 판을 아직 받지 않은
 *     앱(expo-updates 전, 스토어 판)은 한동안 이 카드를 그린다.
 *
 * 그래서 세 화면 모두에 있는 마지막 버튼 ‘이대로 적용’만 이름으로 부르고, 첫 단계는 "바뀌는 내용을
 * 확인하고" 로 말한다. ‘내용 확인하기’를 이름으로 부르면 옛 앱 사용자는 없는 버튼을 찾는다 —
 * 2026-09-15 운영 사고(웹 카드에 없는 버튼만 가리켰다)와 같은 결함이다.
 */
export const AMORA_TYPED_CARD_ACCEPTANCE_REPLY =
  "아직 반영하지 않았어요. 아래 카드에서 바뀌는 내용을 확인하고 ‘이대로 적용’을 누르면 반영돼요.";

/**
 * 이미 저장된 같은 안내의 옛 문장들. 2026-09-18 전에는 앱 카드가 ‘이대로 적용’ 한 단계라 문장이
 * 웹·앱을 나눠 말했다(운영에 나간 문장은 이것 하나다). 대화에 저장된 행은 그대로 남으므로, 직전 행이 서버 고정 안내였는지 볼 때
 * (`route.ts` 의 `previousRowSpeaksForCard`) 옛 문장도 같은 안내로 알아본다. 문장만 바뀌었지 뜻은 같다.
 */
const LEGACY_TYPED_CARD_ACCEPTANCE_REPLIES: readonly string[] = [
  "아직 반영하지 않았어요. 웹에서는 아래 카드의 ‘내용 확인하기’를 누른 뒤 ‘이대로 적용’을, 앱에서는 카드의 ‘이대로 적용’을 누르면 반영돼요.",
];

/** 저장된 행 본문이 말로 한 승낙에 서버가 붙인 고정 안내(지금 문장이든 옛 문장이든)인가. */
export function isAmoraTypedCardAcceptanceReply(content: unknown): boolean {
  return typeof content === "string"
    && (content === AMORA_TYPED_CARD_ACCEPTANCE_REPLY || LEGACY_TYPED_CARD_ACCEPTANCE_REPLIES.includes(content));
}
