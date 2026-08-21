/**
 * 커플 초대 코드 — 두 사람을 잇는 유일한 열쇠.
 *
 * ## 왜 이 파일이 생겼는가
 *
 * 앱의 입력칸이 `maxLength={10}`이었다. 서버가 발급하는 코드는 `WH-` + 12자리 = 15자다
 * (supabase/migrations/20260614110000). 그래서 파트너가 보내준 코드를 붙여넣으면
 * 뒤가 잘려 나갔고, 경고도 없이 다음 단계로 넘어갔다가 온보딩 마지막에서야 "초대 코드가
 * 올바르지 않습니다"를 만났다. 코드를 다시 봐도 맞게 적혀 있으니 사람은 오타를
 * 의심하며 반복 시도했고, 10분 10회 제한에 걸리면 그마저 막혔다.
 *
 * 커플 앱에서 파트너 연결이 안 되는 문제였고, 원인은 상수 하나였다.
 *
 * 웹은 같은 자리에서 `maxLength={15}`와 형식 검사를 이미 갖고 있었다. 규칙이 두 곳에
 * 따로 적혀 있었기 때문에 한쪽만 맞았던 것이다. 그래서 여기 한 벌만 둔다.
 *
 * ## 정본은 DB다
 *
 * 형식 검사는 `join_couple`이 쓰는 것과 같아야 한다
 * (supabase/migrations/20260615092000: `^WH-[A-Z0-9]{6,12}$`). 화면이 더 좁게 잡으면
 * 멀쩡한 코드를 거절하고, 더 넓게 잡으면 사람이 마지막에 가서야 실패를 안다.
 *
 * ## 12자로 좁히지 말 것 (아직은)
 *
 * 20260812030000 이 CHECK 를 `^WH-[A-Z0-9]{12}$` 로 좁히지만, 그 전에 짧은 코드를
 * 12자로 **재발급**한다. 즉 12자 전제는 그 마이그레이션이 운영에 적용된 뒤에만
 * 참이다. 초기 생성기(20260210000000)는 6자를 만들었고 그 코드를 아직 쓰는 커플이
 * 있을 수 있다.
 *
 * 마이그레이션보다 앱이 먼저 나가는 일은 실제로 있었다(커뮤니티 3주 장애).
 * 여기를 12자로 좁히려면 20260812030000 이 운영에 적용된 것을 **실측으로 확인한
 * 뒤에** 하라. 넓은 쪽은 전환 중에도 안전하고, 좁힌 쪽은 멀쩡한 사람을 막는다.
 */

/** DB의 `join_couple`이 받아들이는 형식. 화면은 이보다 좁아서도 넓어서도 안 된다. */
const COUPLE_INVITE_CODE_RE = /^WH-[A-Z0-9]{6,12}$/u;

/** `WH-` 3자 + 최대 12자. 입력칸 길이 제한은 이 값을 쓴다. */
export const COUPLE_INVITE_CODE_MAX_LENGTH = 15;

/** 화면에 보여줄 예시. 실제 발급 길이와 같아야 사람이 길이를 오해하지 않는다. */
export const COUPLE_INVITE_CODE_PLACEHOLDER = "WH-A3F91B2C7D40";

/**
 * 사람이 친 것을 코드 모양으로 다듬는다. 소문자로 쳐도, 앞뒤에 공백이 붙어도,
 * 복사하며 따옴표가 딸려와도 통과시킨다 — 그런 것으로 파트너 연결이 막히면 안 된다.
 */
export function normalizeCoupleInviteCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9-]/gu, "")
    .slice(0, COUPLE_INVITE_CODE_MAX_LENGTH);
}

export function isCoupleInviteCode(value: unknown): value is string {
  return typeof value === "string" && COUPLE_INVITE_CODE_RE.test(value);
}

/**
 * 지금 입력된 값에 대해 화면이 보여줄 말. 아직 다 치지 않은 상태를 틀렸다고 하지
 * 않는다 — 타이핑 중에 빨간 글씨가 뜨면 사람은 자기가 잘못한 줄 안다.
 */
export function describeCoupleInviteCodeProblem(value: unknown): string | null {
  const normalized = normalizeCoupleInviteCode(value);
  if (normalized.length === 0) return "초대 코드를 입력해 주세요.";
  if (isCoupleInviteCode(normalized)) return null;
  return `코드 형식이 달라요. 파트너가 받은 코드를 그대로 넣어 주세요 (예: ${COUPLE_INVITE_CODE_PLACEHOLDER}).`;
}
