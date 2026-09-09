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
 * 고객센터 주소를 이 문장에 중복하지 않는다. 설정은 공통 CONTACT의 메일 링크를
 * 직접 제공하며, 안내를 받기 위해 삭제 API를 호출하지 않는다.
 */
export const ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE =
  "지금은 설정에서 바로 탈퇴 접수가 되지 않아요. 아래에서 요청 방법을 안내해 드릴게요." as const;

/**
 * **서버 렌더링 화면(처리방침·약관)이 쓰는 같은 판정.**
 *
 * 2026-09-02: 자동 접수를 켜는 순간 처리방침 제6조와 약관 제10조의 "현재는
 * 고객센터로 접수받고 있으며" 가 **거짓 문장이 된다.** 그 두 문장을 손으로
 * 고치면 다음에 플래그가 움직일 때 또 어긋나고, 어긋난 쪽이 법적 고지라 대가가
 * 크다. 그래서 문구를 플래그와 같은 곳에서 낸다.
 *
 * 서버 컴포넌트에서만 부를 것 — 이 값은 브라우저 번들에 실리면 안 된다.
 * (클라이언트는 위 `parseAccountDeletionIntakeCapability` 로 `/api/auth/me` 를 읽는다.)
 */
export function isAccountDeletionIntakeOpenOnServer(): boolean {
  return process.env.ACCOUNT_DELETION_INTAKE_ENABLED === "true";
}

/**
 * 탈퇴 접수 경로를 설명하는 **한 문장**. 처리방침과 약관이 같은 문장을 쓴다.
 *
 * 두 화면이 각자 문장을 갖고 있으면 한쪽만 고쳐지고 다른 쪽이 남는다 — 이
 * 저장소에서 여러 번 그랬다. 사실이 하나면 문장도 하나여야 한다.
 */
export function accountDeletionIntakeSentence(supportEmail: string): string {
  return isAccountDeletionIntakeOpenOnServer()
    ? "탈퇴는 설정 페이지에서 직접 신청할 수 있습니다. 신청하면 곧바로 삭제 절차가 시작되고, 확인이 필요한 파일이 있으면 운영자가 검토한 뒤 이어서 처리합니다."
    : `탈퇴는 현재 고객센터(${supportEmail})로 접수받고 있으며, 운영자가 본인 확인 후 처리합니다.`;
}
