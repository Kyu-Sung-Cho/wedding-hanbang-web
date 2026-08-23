/**
 * 서버가 "왜 안 됐는지" 말했을 때, 그 말을 화면까지 안전하게 들고 가는 자리.
 *
 * ## 왜 필요한가
 *
 * `/api/journey` 는 거절할 때 **사람이 읽을 문장과 기계가 읽을 코드**를 함께 준다.
 *
 *   PLAN_CHANGE_STALE     "그 사이 준비 정보가 바뀌었어요. 최신 화면을 다시 불러와 주세요."
 *   PLAN_CHANGE_REJECTED  "파트너가 이 변경을 거절했어요. 최신 화면을 다시 확인해 주세요."
 *
 * 그런데 화면이 그것을 버리고 "일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
 * 하나로 바꿨다. **잠시 후 다시 시도해도 결과가 같다** — 상대가 거절한 것이고, 화면이
 * 낡은 것이다. 사용자는 같은 버튼을 반복해서 누르게 된다.
 *
 * ## 그런데 서버 문구를 그대로 올리면 안 된다
 *
 * 같은 경로로 내부 오류 원문이 새어 나갈 수 있다. 이 저장소는 그것을 계약으로
 * 못박아 두었다 — `EventFormModal.execution-fields.test.tsx` 가 PostgREST 오류 원문이
 * 화면에 나오지 않는지 검사한다.
 *
 * 그래서 **문자열을 믿지 않고 코드를 믿는다.** 아는 코드일 때만 문장을 만들고, 그
 * 문장도 서버가 준 것을 그대로 쓰지 않고 **여기 적힌 것**을 쓴다. 아는 코드가 아니면
 * `null` 을 돌려주고, 부르는 쪽이 원래 쓰던 문구로 떨어진다.
 */

/** 사용자에게 그대로 보여도 되는 계획 변경 거절 사유. */
export const PLAN_CHANGE_MESSAGES: Readonly<Record<string, string>> = {
  PLAN_CHANGE_STALE:
    "그 사이 준비 정보가 바뀌었어요. 최신 화면을 다시 불러와 주세요.",
  PLAN_CHANGE_REJECTED:
    "파트너가 이 변경을 거절했어요. 최신 화면을 다시 확인해 주세요.",
};

/** 서버 코드를 실은 오류. `authStore` 가 던진다. */
export class PlanChangeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PlanChangeError";
    this.code = code;
  }
}

/**
 * 이 오류를 사용자에게 보여줄 문장으로 바꾼다. 모르면 `null`.
 *
 * 모른다는 것은 "말할 말이 없다"가 아니라 **"내가 지어내면 안 된다"**는 뜻이다.
 * 부르는 쪽이 자기 화면에 맞는 기본 문구를 갖고 있다.
 */
export function planChangeMessage(error: unknown): string | null {
  if (!(error instanceof PlanChangeError)) return null;
  return PLAN_CHANGE_MESSAGES[error.code] ?? null;
}
