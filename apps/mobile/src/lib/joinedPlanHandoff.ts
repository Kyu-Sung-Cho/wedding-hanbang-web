/**
 * 파트너 합류 직후 라운지에 뜨는 안내 — "이제 이 계획을 함께 봐요".
 *
 * ## 왜 필요한가
 *
 * 초대 코드로 합류한 사람은 방금 **남이 만들어 둔 계획**에 들어왔다. 결혼식 날짜·장소·
 * 총 예산·준비 진행이 이미 채워져 있을 수 있는데, 앱은 합류가 끝나면 아무 표시 없이
 * 라운지로 보냈다. 웹은 같은 순간 `/wedding/lounge?joined=1`로 보내고 지금 함께 보게 된
 * 계획을 한 장으로 보여준다(`apps/web/src/app/(app)/lounge/page.tsx`). 앱으로 합류한
 * 사람만 그 한 장을 못 봤다.
 *
 * ## 표시는 내비게이션 파라미터일 뿐이다
 *
 * "방금 합류했다"는 그 순간에만 참이다. 기기나 서버에 적으면 다음 실행에도, 다른 기기에서도
 * "방금"이 된다. 그래서 온보딩이 라운지로 보낼 때 `?joined=1`을 붙이고, 라운지는 그 값을
 * 읽기만 하고, "이 내용 확인했어요"는 그 값을 지우기만 한다. 앱을 다시 켜면 사라진다.
 *
 * ## 이 카드는 아무것도 바꾸지 않는다
 *
 * 카드를 여는 것도, 닫는 것도 저장하거나 반영하는 일이 아니다. 문구도 그렇게 말한다 —
 * "이 화면을 열면서 새로 저장하거나 변경한 내용은 없어요". 웹과 같은 문장이다.
 *
 * 이 모듈은 아무것도 import하지 않는다. 테스트가 그대로 컴파일해 웹 카드와 나란히 잰다.
 */

/** 합류 표시를 싣는 쿼리 파라미터 이름. 웹과 같다(`?joined=1`). */
export const JOINED_PLAN_PARAM = "joined" as const;

const JOINED_PLAN_MARKER = "1";

export type LoungeHrefAfterOnboarding = "/(tabs)/lounge" | "/(tabs)/lounge?joined=1";

/**
 * 온보딩을 마친 사람이 갈 라운지 주소. 코드로 **합류한** 사람만 표시를 들고 간다 —
 * 새로 만든 사람에게 "이제 이 계획을 함께 봐요"는 틀린 말이다.
 */
export function loungeHrefAfterOnboarding(coupleAction: unknown): LoungeHrefAfterOnboarding {
  return coupleAction === "join" ? "/(tabs)/lounge?joined=1" : "/(tabs)/lounge";
}

/**
 * 라운지가 받은 파라미터가 합류 표시인가. 화면 밖에서 온 값이라 정확히 `"1"`만 믿는다.
 * expo-router는 같은 이름이 여러 번 오면 배열을 주므로 첫 값만 본다.
 */
export function hasJoinedPlanMarker(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === JOINED_PLAN_MARKER;
}

/**
 * 카드를 띄울 것인가. 웹과 같은 조건이다 — 표시가 있고, **상대가 실제로 들어와 있을 때**.
 * 상대 유무를 아직 모르거나(undefined) 없으면 "함께 봐요"는 틀린 말이므로 띄우지 않는다.
 */
export function shouldShowJoinedPlanHandoff(input: {
  marker: boolean;
  partnerLinked: boolean | undefined;
}): boolean {
  return input.marker === true && input.partnerLinked === true;
}

export interface JoinedPlanHandoffInput {
  weddingDate: string | null;
  venue: string | null;
  totalBudget: number;
  checklistDone: number;
  checklistTotal: number;
}

export interface JoinedPlanHandoffCell {
  label: string;
  value: string;
  note: string | null;
}

export interface JoinedPlanHandoffView {
  eyebrow: string;
  title: string;
  body: string;
  cells: JoinedPlanHandoffCell[];
  reviewLabel: string;
  dismissLabel: string;
}

/**
 * 금액 한 줄. 웹 라운지의 `formatLoungeWon`과 글자까지 같게 읽힌다(테스트가 나란히 잰다).
 * 안전한 정수가 아니면 짐작해서 적지 않는다.
 */
export function formatHandoffWon(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) return "금액 확인 필요";
  const tenThousands = Math.floor(amount / 10_000);
  const remainder = amount % 10_000;
  if (!tenThousands) return `${remainder.toLocaleString("ko-KR")}원`;
  return `${tenThousands.toLocaleString("ko-KR")}만${remainder ? remainder.toLocaleString("ko-KR") : ""}원`;
}

/**
 * 결혼식 날짜 한 줄. 저장값은 한국 날짜 문자열이라 기기 시간대로 다시 읽지 않고 글자를
 * 그대로 옮긴다 — 해외에서 열어도 하루가 밀리지 않는다. 읽을 수 없으면 "날짜 미정".
 */
function formatHandoffDate(value: string | null): string {
  if (!value) return "날짜 미정";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "날짜 미정";
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function readCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** 웹 카드와 같은 네 칸, 같은 문장. */
export function buildJoinedPlanHandoffView(input: JoinedPlanHandoffInput): JoinedPlanHandoffView {
  const total = readCount(input.checklistTotal);
  const done = Math.min(readCount(input.checklistDone), total);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const venue = typeof input.venue === "string" ? input.venue.trim() : "";

  return {
    eyebrow: "함께 준비 시작",
    title: "이제 이 계획을 함께 봐요",
    body: "이제 두 분이 함께 보는 현재 계획이에요. 이 화면을 열면서 새로 저장하거나 변경한 내용은 없어요.",
    cells: [
      { label: "결혼식 날짜", value: formatHandoffDate(input.weddingDate), note: null },
      { label: "장소", value: venue || "장소 미정", note: null },
      {
        label: "총 예산",
        value: input.totalBudget > 0 ? formatHandoffWon(input.totalBudget) : "미입력",
        note: null,
      },
      { label: "준비 진행", value: `${percent}%`, note: `${done}/${total}개 체크` },
    ],
    reviewLabel: "함께 확인할 내용 찾기",
    dismissLabel: "이 내용 확인했어요",
  };
}
