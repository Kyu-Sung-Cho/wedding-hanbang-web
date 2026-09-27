/**
 * 아모라 대화를 처음 열 때 '함께 대화'와 '나만 (상담)' 중 하나를 고르게 하는 규칙과 문구.
 *
 * ## 왜 있나
 *
 * 2026-09-26 파운더 결정. 지금까지 아모라 대화는 누구에게나 '함께 대화'로 열렸다. 웹
 * 전체화면(`ChatContent.tsx`), 웹 옆 패널(`ChatSidePanel.tsx`), 앱(`app/(tabs)/chat.tsx`)
 * 세 곳이 모두 `useState("shared")` 로 시작했다. 이제는 처음 열 때 고르게 하고, 고른 칸을
 * 이 기기에 계정별로 기억한다.
 *
 * 같은 규칙을 세 화면이 따로 쓰면 한쪽만 고쳐지고 나머지가 남는 일이 이 저장소에서 여러 번
 * 있었다. 그래서 규칙과 문구를 여기 한 벌만 두고 웹과 앱이 같이 가져다 쓴다.
 *
 * ## 여기서 하지 않는 것
 *
 * - **저장소를 직접 읽고 쓰지 않는다.** 웹은 localStorage(동기), 앱은 AsyncStorage(비동기)라
 *   읽는 방식이 다르다. 호출부가 try/catch 로 감싸 읽고, 실패하면 `null` 을 넘긴다. 그러면
 *   아래 규칙이 선택 카드를 다시 띄운다(모르는 채로 한쪽을 고르지 않는 편이 안전하다).
 * - **메시지가 저장되는 레인을 정하지 않는다.** 서버가 요청 레인대로 정한다. 여기서 정하는
 *   것은 화면이 처음 어느 탭으로 열리는가뿐이다. 서버와 DB는 이 결정으로 바뀌지 않는다.
 * - **분석 이벤트를 보내지 않는다.** 무엇을 골랐는지는 처리방침 범위 밖이다.
 */

import type { AmoraChatScope } from "../utils/chatLane";

/** 고를 수 있는 두 칸. 기존 탭 값(`"shared" | "private"`)과 같다. */
export type AmoraLaneChoice = AmoraChatScope;

// ── 기억 ─────────────────────────────────────────────────────────────

/**
 * 저장 키 앞부분. 값 모양을 바꾸게 되면 `v2` 로 올린다. 옛 값은 파서가 버리므로 그 사람은
 * 선택 카드를 한 번 더 본다.
 */
export const AMORA_LANE_STORAGE_KEY_PREFIX = "hb:amora-lane:v1:";

/**
 * 이 기기에서 이 계정의 마지막 레인을 담는 키.
 *
 * 키에 사용자 id 를 넣는 이유: 한 기기를 두 사람이 번갈아 쓸 수 있다(예비부부가 노트북
 * 하나를 같이 쓰는 경우). 앞사람이 고른 칸으로 뒷사람의 대화가 열리면 안 된다.
 *
 * id 가 비었으면 `null` 을 준다. 빈 id 로 키를 만들면 로그인하지 않은 모든 사람이 한 칸을
 * 나눠 쓰게 된다. 호출부는 `null` 이면 읽지도 쓰지도 않는다.
 */
export function amoraLaneStorageKey(userId: string | null | undefined): string | null {
  if (typeof userId !== "string" || userId.trim() === "") return null;
  return AMORA_LANE_STORAGE_KEY_PREFIX + userId;
}

/**
 * 저장소에서 읽은 값을 레인으로 바꾼다. 정확히 `"shared"` 나 `"private"` 일 때만 그 값을
 * 주고, 나머지는 전부 `null` 이다.
 *
 * 공백을 걷거나 대소문자를 맞추지 않는다. 이 값은 이 코드만 쓰므로 모양이 다르면 누가
 * 건드렸거나 다른 판의 값이다. 짐작해서 한쪽으로 열기보다 다시 묻는다.
 */
export function parseStoredAmoraLane(value: unknown): AmoraLaneChoice | null {
  return value === "shared" || value === "private" ? value : null;
}

// ── 처음 열 때 어느 칸으로 여나 ──────────────────────────────────────────

export interface ResolveInitialAmoraLaneInput {
  /**
   * 이 기기에 이 계정으로 기억된 레인. 읽지 못했거나 없으면 `null`.
   * 저장소 원문을 그대로 넘겨도 된다. 안에서 한 번 더 `parseStoredAmoraLane` 을 거친다.
   */
  storedLane: string | null | undefined;
  /**
   * 기억을 다 읽었는가. 앱 AsyncStorage 처럼 비동기로 읽으면 읽는 동안 `false` 를 넘긴다.
   * 넣지 않으면 다 읽은 것으로 본다(웹 localStorage 는 동기라 넣을 필요가 없다).
   *
   * 없으면 생기는 일: 기억을 읽는 사이에 카드가 먼저 떴다가, 기억이 도착하면 사라진다.
   */
  storedLaneLoaded?: boolean;
  /** 나만 레인을 쓸 수 있는가. 역할이 있어 `bride_private`/`groom_private` 가 정해질 때만 참. */
  privateAvailable: boolean;
  /** 체험 중인가. 체험은 나만 레인을 쓰지 못한다. */
  isDemo: boolean;
  /**
   * 레인을 정해서 들어온 경로. `resolveAmoraLaneEntryScope` 의 결과를 넘긴다. 웹 `?scope=` 값을
   * 그대로 넘겨도 된다. `"shared"`·`"private"` 가 아니면 없는 것으로 본다(지금 웹이 `?scope=` 를
   * 다루는 방식과 같다).
   */
  explicitScope: string | null | undefined;
  /**
   * 역할 정보가 도착했는가. 역할이 없다는 사실을 알게 된 것도 도착이다.
   * 도착하기 전에는 카드를 띄우지 않는다(띄웠다가 체험·무역할로 판명되면 깜빡인다).
   */
  roleKnown: boolean;
}

export interface InitialAmoraLane {
  /**
   * 열 탭. `null` 이면 아직 정하지 않았다는 뜻이다.
   * - `needsChoice` 가 거짓이면 기다리는 중이다. 카드를 띄우지 않는다.
   * - `needsChoice` 가 참이면 사람이 골라야 한다.
   * 어느 쪽이든 `null` 인 동안은 보내기를 막는 편이 안전하다. 기억된 칸이 '나만'인
   * 사람이 기다리는 사이 보낸 글이 '함께'로 가면 안 된다.
   */
  lane: AmoraLaneChoice | null;
  /** 선택 카드를 띄우고 입력창에 `composerBlockedPlaceholder` 를 보일 때만 참. */
  needsChoice: boolean;
}

/**
 * 아모라 대화를 열 때 어느 칸으로 열지 정한다.
 *
 * 순서가 규칙이다. 위에서 먼저 걸리는 것이 이긴다.
 *
 * 1. 역할 정보가 아직 없으면 기다린다. 카드도, 탭 변경도 없다.
 * 2. 체험이거나 역할이 없으면 지금처럼 '함께 대화'. 카드를 띄우지 않는다. 명시 진입이
 *    '나만'이어도 그렇다. 쓸 수 없는 탭으로는 열지 않는다(지금 웹 `?scope=private` 도
 *    이 경우 무시한다).
 * 3. 레인을 정해서 들어왔으면(`resolveAmoraLaneEntryScope`: `?scope=`, 준비 안내 질문, 파트너
 *    합류 직후 계획 점검) 그 칸. 기억보다 이긴다. 액션 확인·상대에게 보내기처럼 화면 안에서
 *    '함께'를 명시하는 동작은 여기가 아니라 호출부가 탭을 옮긴다.
 * 4. 기억을 읽는 중이면 기다린다.
 * 5. 기억이 있으면 그 칸.
 * 6. 없으면(처음이거나 기억을 읽지 못했으면) 고르게 한다.
 *
 * 한 번 정한 뒤에는 다시 불러 덮어쓰지 않는다. 사람이 탭을 바꾼 다음에 이 함수로
 * 되돌리면 `?scope=` 가 주소에 남아 있는 동안 계속 그 칸으로 끌려간다. 계정이나 커플이
 * 바뀌어 화면을 처음부터 다시 그릴 때만 다시 부른다.
 */
export function resolveInitialAmoraLane(input: ResolveInitialAmoraLaneInput): InitialAmoraLane {
  if (!input.roleKnown) return { lane: null, needsChoice: false };

  if (input.isDemo || !input.privateAvailable) return { lane: "shared", needsChoice: false };

  const explicit = parseStoredAmoraLane(input.explicitScope);
  if (explicit) return { lane: explicit, needsChoice: false };

  if (input.storedLaneLoaded === false) return { lane: null, needsChoice: false };

  const stored = parseStoredAmoraLane(input.storedLane);
  if (stored) return { lane: stored, needsChoice: false };

  return { lane: null, needsChoice: true };
}

// ── 레인을 정해서 들어온 길 ──────────────────────────────────────────

export interface AmoraLaneEntryInput {
  /** 웹 `?scope=` 값. `"shared"`·`"private"` 가 아니면 없는 것으로 본다. */
  scope?: unknown;
  /**
   * 준비 안내에서 질문을 들고 왔는가(웹·앱 `amoraSource`). 그 질문은 공개 안내를 참고 맥락으로
   * 싣고 함께 대화 입력칸에만 들어간다.
   */
  preparationSource?: boolean;
  /**
   * 파트너와 막 연결돼 이제 함께 볼 계획을 짚으러 왔는가. 웹은 `?prefill=` 이
   * `JOINED_PLAN_REVIEW_PROMPT`(`apps/web/src/lib/amora/dashboardCompanion.ts`)일 때, 앱은
   * `entry=joined_plan_review` 일 때 참이다. 두 사람이 함께 볼 계획을 묻는 말이라 성격상 '함께'다.
   */
  joinedPlanReview?: boolean;
}

/**
 * 들어온 길이 레인을 정해 주는가. 정해 주면 그 칸이고, 아니면 `null` 이다(기억이나 선택 카드를
 * 따른다). 웹 전체화면과 앱이 이 한 벌을 쓴다.
 *
 * 레인을 정하는 길은 셋뿐이다. 주소의 `?scope=`, 준비 안내 질문, 파트너 합류 직후 계획 점검.
 *
 * 나머지 초안은 칸을 정하지 않는다. 웹 `?prefill=`(라운지 '아모라에게 물어보기', 대시보드,
 * 온보딩 직후, 오늘의 준비, 미션, 커뮤니티, 견적 확인)과 가입 인계, 앱 `entry=lounge_fab` 같은
 * 진입구가 그렇다. 이런 초안은 고른 칸의 입력칸에 넣는다.
 *
 * 왜 좁혔나(2026-09-27 검토): 처음에는 웹이 `prefill` 과 가입 인계까지 '함께'를 명시한 진입으로
 * 봤다. 그런데 웹에서 대화로 들어오는 주요 길 대부분이 `prefill` 을 싣는다. 그래서 처음 온
 * 사람은 선택 카드를 못 본 채 '함께 대화'로 열렸고, 보내기를 누르면 고른 적 없이 함께 대화에
 * 저장됐다. '나만'을 기억한 사람도 그 버튼으로 들어올 때마다 '함께'로 끌려갔다. 같은 라운지
 * 버튼을 앱은 명시 진입으로 보지 않아 웹과 앱이 다르게 열리기도 했다.
 */
export function resolveAmoraLaneEntryScope(input: AmoraLaneEntryInput): AmoraLaneChoice | null {
  const scope = parseStoredAmoraLane(input.scope);
  if (scope) return scope;
  if (input.preparationSource === true || input.joinedPlanReview === true) return "shared";
  return null;
}

// ── 화면 문구(정본) ──────────────────────────────────────────────────

/**
 * 선택 카드와 입력창 안내 문구. 2026-09-26 파운더가 정한 문장 그대로다. 웹 전체화면,
 * 웹 옆 패널, 앱이 이 한 벌을 그린다.
 *
 * - 버튼 이름은 위쪽 탭 이름과 같다(웹 `ChatContent.tsx`·`ChatSidePanel.tsx`, 앱
 *   `chat.tsx` 의 탭이 '함께 대화'와 '나만 (상담)'이다). 탭 이름을 바꾸면 여기도 바꾼다.
 * - '파트너'는 배우자 될 사람이다. 아모라를 가리키지 않는다.
 * - `shared.unlinkedPartnerNote` 는 파트너가 아직 연결되지 않았을 때만 설명 뒤에 붙인다.
 *   연결된 사람에게는 이미 같이 보고 있으므로 틀린 말이 된다.
 */
export const AMORA_LANE_CHOICE_COPY = Object.freeze({
  title: "이 대화, 누구랑 볼까요?",
  shared: Object.freeze({
    label: "함께 대화",
    description:
      "파트너도 이 대화를 볼 수 있어요. 아모라와 정한 예산이나 일정이 반영되고, 바뀐 건 서로 알림이 가요.",
    unlinkedPartnerNote: "파트너를 연결하면 지금까지 나눈 대화도 같이 보게 돼요.",
  }),
  private: Object.freeze({
    label: "나만 (상담)",
    description: "나만 볼 수 있어요. 예산이나 일정 반영은 함께 대화에서 할 수 있어요.",
  }),
  footnote: "위에서 언제든 바꿀 수 있어요.",
  composerBlockedPlaceholder: "먼저 누구랑 볼지 골라 주세요.",
});
