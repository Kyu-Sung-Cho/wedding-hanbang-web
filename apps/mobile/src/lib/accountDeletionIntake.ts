/**
 * 회원 탈퇴를 누른 순간 — **접수가 열려 있는지부터** 확인한다.
 *
 * `/api/auth/delete` 는 `ACCOUNT_DELETION_INTAKE_ENABLED` 가 "true" 가 아니면 인증보다 먼저
 * 503 을 돌려준다. 앱은 그 판정을 읽지 않고 「탈퇴하기 → 최종 확인」 두 번을 다 누르게 한
 * **뒤에야** 오류를 보여줬다. 웹 설정은 `/api/auth/me` 의 `capabilities.accountDeletionIntake`
 * 를 먼저 읽어, 닫혔거나 모르면 삭제 확인 대신 이메일 요청 안내만 보여준다. 같은 방식으로 맞춘다.
 *
 * 규칙은 하나다: **열림이 확인된 경우에만** 되돌릴 수 없는 흐름을 연다. 요청 실패, 모양이
 * 다른 응답, 다른 계정의 응답, 기다리는 사이의 계정 전환은 모두 "모름"이고, 모름은 안내다.
 * 안내를 잘못 한 번 더 보이는 것은 싸고, 닫힌 접수 앞에서 두 번 확인을 시키는 것은 비싸다.
 *
 * 판정 규칙과 안내 문장은 웹과 같은 공유 상수(`@hanbang/shared`)에서 온다.
 */
import {
  ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE,
  ACCOUNT_DELETION_INTAKE_UNKNOWN_NOTICE,
  parseAccountDeletionIntakeCapability,
} from "@hanbang/shared/constants";

export type AccountDeletionIntakeState = "open" | "closed" | "unknown";
export type AccountDeletionSupportState = Exclude<AccountDeletionIntakeState, "open">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `/api/auth/me` 응답 하나를 판정으로 바꾼다.
 *
 * `capabilities` 가 아예 없으면(그 값을 모르는 옛 서버) 닫혔다고 단정하지 않고 "모름"으로 둔다.
 * 있는데 `accountDeletionIntake` 가 `true` 가 아니면 웹과 같이 닫힌 것으로 읽는다.
 */
export function readAccountDeletionIntakeState(
  ok: boolean,
  payload: unknown,
  expectedUserId: string,
): AccountDeletionIntakeState {
  if (!ok || !isRecord(payload)) return "unknown";
  const user = payload.user;
  if (
    !isRecord(user)
    || typeof user.id !== "string"
    || user.id.toLowerCase() !== expectedUserId.toLowerCase()
  ) return "unknown";
  if (!isRecord(payload.capabilities)) return "unknown";
  return parseAccountDeletionIntakeCapability(payload.capabilities) ? "open" : "closed";
}

export function accountDeletionSupportNotice(state: AccountDeletionSupportState): string {
  return state === "closed"
    ? ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE
    : ACCOUNT_DELETION_INTAKE_UNKNOWN_NOTICE;
}

type MeResponseLike = { ok: boolean; json: () => Promise<unknown> };

export type BeginAccountDeletionDeps = {
  /** 지금 로그인한 사용자. 모르면 null. */
  readOwnerId: () => Promise<string | null>;
  /** 그 사용자로만 `/api/auth/me` 를 읽는다. */
  fetchMe: (ownerId: string) => Promise<MeResponseLike>;
  /** 열림이 확인됐을 때만 부른다 — 되돌릴 수 없는 두 번 확인. */
  showConfirm: () => void;
  /** 닫힘·모름 — 이메일 요청 안내. 삭제 API 를 부르지 않는다. */
  showSupport: (notice: string, state: AccountDeletionSupportState) => void;
};

export async function beginAccountDeletion(
  deps: BeginAccountDeletionDeps,
): Promise<AccountDeletionIntakeState> {
  let state: AccountDeletionIntakeState = "unknown";
  try {
    const ownerId = await deps.readOwnerId();
    if (ownerId) {
      const response = await deps.fetchMe(ownerId);
      const payload = await response.json().catch(() => null);
      state = readAccountDeletionIntakeState(response.ok, payload, ownerId);
      // 응답을 기다리는 사이 계정이 바뀌었으면 그 열림은 지금 계정의 것이 아니다.
      if (state === "open" && (await deps.readOwnerId()) !== ownerId) state = "unknown";
    }
  } catch {
    state = "unknown";
  }
  if (state === "open") {
    deps.showConfirm();
  } else {
    deps.showSupport(accountDeletionSupportNotice(state), state);
  }
  return state;
}
