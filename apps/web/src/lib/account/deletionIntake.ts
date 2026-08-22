/**
 * 자동 탈퇴 접수가 지금 열려 있는가.
 *
 * ## 왜 이 파일이 필요한가
 *
 * `/api/auth/delete`는 `ACCOUNT_DELETION_INTAKE_ENABLED`가 "true"가 아니면 **인증보다
 * 먼저** 503을 돌려준다(`api/auth/delete/route.ts`). 그런데 설정 화면에는 그 판정이
 * 닿지 않아서, 사용자는 사유를 고르고 "탈퇴합니다"를 손으로 친 **다음에야** 거부당한다.
 *
 * 확인 문구까지 타이핑시킨 뒤 거부하는 것은 다크패턴으로 읽힌다. 게다가 탈퇴는
 * 약관 제10조가 약속한 권리라, 그 경로에서 헛수고를 시키는 것은 특히 나쁘다.
 *
 * 옆 화면이 이미 옳은 모양을 하고 있다 — `settings/amora-memory`는 서버가 내려준
 * `runtimeEnabled`로 **진입 즉시** 배너를 띄우고 토글을 비활성화한다. 같은 방식으로 맞춘다.
 *
 * ## 왜 클라이언트가 직접 env를 안 보는가
 *
 * 플래그 판정은 서버가 한다. 브라우저 번들에 `ACCOUNT_DELETION_INTAKE_ENABLED`를
 * 노출하면 값이 공개되고, 무엇보다 **판정 주체가 둘이 되어 어긋난다.**
 * `neutralPreparationSpace`가 쓰는 통로(`/api/auth/me`의 `capabilities`)를 그대로 쓴다.
 */

/** `/api/auth/me` 의 `capabilities` 에서 이 값을 읽는 이름. */
export const ACCOUNT_DELETION_INTAKE_CAPABILITY = "accountDeletionIntake" as const;

/**
 * capabilities 를 읽어 "자동 접수가 열려 있는가"를 돌려준다.
 *
 * **모르면 닫힌 것으로 본다.** 응답이 없거나 모양이 다르면 false다 — 열려 있다고
 * 잘못 말하면 사용자가 다시 헛수고를 하게 되고, 닫혔다고 잘못 말하면 안내가 한 번 더
 * 뜰 뿐이다. 이 방향의 실패가 싸다.
 */
export function parseAccountDeletionIntakeCapability(value: unknown): boolean {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>)[ACCOUNT_DELETION_INTAKE_CAPABILITY] === true
  );
}

/**
 * 자동 접수가 닫혔을 때 화면이 **먼저** 하는 말.
 *
 * 여기서 대체 경로를 단정하지 않는다. 고객센터 주소를 이 문장에 박아 두면, 그 사서함이
 * 살아 있지 않을 때 화면이 또 한 번 거짓말을 하게 된다. 주소는 서버 응답이 주는 것을
 * 그대로 보여준다(`api/auth/delete` 의 `supportEmail`).
 */
export const ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE =
  "지금은 설정에서 바로 탈퇴 접수가 되지 않아요. 아래에서 요청 방법을 안내해 드릴게요." as const;
