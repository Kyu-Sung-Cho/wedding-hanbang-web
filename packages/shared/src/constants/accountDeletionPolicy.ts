// 탈퇴 정책 — 되돌릴 수 없는 행동 앞에서 사람이 알아야 하는 사실들.
//
// 여기 적는 것은 **스키마가 실제로 하는 일**이다. 지어내지 않았다.
//   - profiles 외 다수: auth.users 참조가 ON DELETE CASCADE → 함께 삭제
//   - couples.bride_id / couples.groom_id: ON DELETE SET NULL
//   - messages.sender_id: ON DELETE SET NULL
//     (20260716117000_account_deletion_auth_fk_contract.sql 주석:
//      "Preserve couple/chat history for a surviving partner while
//       anonymizing the deleted user's identifiers.")
//   - vendors.owner_id: ON DELETE RESTRICT → 업체 소유자는 삭제가 막힌다
//   - 스토리지: ACCOUNT_DELETION_BUCKETS 를 워커가 지운다
//   - public.account_deletions: 사유와 시각만 남는다(누구인지 남지 않는다)
//   - public.events: user_id 가 NULL 이 되어 더 이상 개인을 가리키지 않는다
//
// 모달과 약관·처리방침이 서로 다른 말을 하지 않도록 한 곳에 둔다.
//
// 2026-08-25 웹에서 shared 로 옮겼다. 모바일 탈퇴 확인창이 이 사실들을 **하나도**
// 보여주지 않아서, 배우자 화면에 내 대화가 남는다는 것을 모른 채 진행하고 있었다.
// 되돌릴 수 없는 행동이라 두 앱이 같은 문장을 써야 한다.

export type AccountDeletionFact = Readonly<{
  key: string;
  /** 화면에 그대로 나가는 문장. */
  text: string;
  /** 되돌릴 수 없거나 사람을 놀라게 하는 사실인가. */
  emphasis: boolean;
}>;

export const ACCOUNT_DELETION_FACTS: readonly AccountDeletionFact[] = [
  {
    key: "irreversible",
    text: "한 번 삭제하면 되돌릴 수 없어요. 같은 이메일로 다시 가입해도 이전 기록은 돌아오지 않아요.",
    emphasis: true,
  },
  {
    key: "partner_keeps_history",
    text: "파트너와 함께 만든 준비 기록과 주고받은 대화는 파트너 화면에 그대로 남아요. 보낸 사람이 나라는 표시만 지워져요.",
    emphasis: true,
  },
  {
    key: "own_data_removed",
    text: "계정과 로그인 정보, 프로필, 내가 올린 사진·첨부 파일은 삭제돼요.",
    emphasis: false,
  },
  {
    key: "anonymous_stats",
    text: "탈퇴 사유와 시각은 누구인지 알 수 없는 형태로만 남아요.",
    emphasis: false,
  },
  {
    key: "vendor_owner_blocked",
    // "먼저 정리해야 한다"고 적었었다. 그런데 소유자가 자기 업체를 내리는
    // 수단이 제품에 없다(오너용 DELETE 라우트도, 화면도 없다). 할 수 없는
    // 일을 지시하지 않는다.
    text: "등록한 업체가 있으면 탈퇴가 완료되지 않아요. 고객센터로 먼저 문의해 주세요.",
    emphasis: false,
  },
];

// ⚠️ 처리 시점("접수하면 바로 처리를 시작해요")은 여기 두지 않는다.
// 접수 스위치(ACCOUNT_DELETION_INTAKE_ENABLED)가 꺼져 있으면 그 문장이
// 거짓이 되는데, 이 목록은 클라이언트에서 조건 없이 렌더된다.
// 이 목록은 **무엇이 지워지고 무엇이 남는가**만 말한다 — 스위치와 무관하게
// 참인 것들이다. 처리 절차는 제출 결과가 알려준다:
//   접수 열림  -> 202/409 가 "처리 중" 또는 "검토 중"을 돌려준다
//   접수 닫힘  -> 503 이 `CONTACT.email` 접수 경로를 돌려준다
// 두 응답 모두 apps/web/src/app/(app)/settings/page.tsx 가 그대로 보여준다.

// ── 자동 탈퇴 접수가 열려 있는가 ─────────────────────────────────────────────
//
// 판정은 서버가 한다(`/api/auth/me` 의 `capabilities.accountDeletionIntake`, 서버는
// `ACCOUNT_DELETION_INTAKE_ENABLED` 를 읽는다). 화면은 받은 값만 본다.
//
// 2026-09-18 웹(`apps/web/src/lib/account/deletionIntake.ts`)에서 여기로 옮겼다. 앱 설정은
// 이 값을 읽지 않고 두 번 확인을 다 누르게 한 **뒤에야** 503 을 보여주고 있었다. 앱이 같은
// 판정과 같은 문장을 쓰려면 한 곳에 있어야 한다 — 웹은 옛 경로에서 그대로 다시 내보낸다.

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
 * 고객센터 주소를 이 문장에 중복하지 않는다. 화면은 공통 CONTACT의 메일 링크를
 * 직접 제공하며, 안내를 받기 위해 삭제 API를 호출하지 않는다.
 */
export const ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE =
  "지금은 설정에서 바로 탈퇴 접수가 되지 않아요. 아래에서 요청 방법을 안내해 드릴게요." as const;

/** 열렸는지 확인하지 못했을 때(요청 실패·다른 모양의 응답). 삭제 확인은 띄우지 않는다. */
export const ACCOUNT_DELETION_INTAKE_UNKNOWN_NOTICE =
  "자동 탈퇴 접수 상태를 확인하지 못했어요. 고객센터로 요청하실 수 있어요." as const;

/** 닫힘·모름일 때의 유일한 행동 — `mailto:${CONTACT.email}` 을 연다. */
export const ACCOUNT_DELETION_EMAIL_REQUEST_LABEL = "이메일로 탈퇴 요청하기" as const;

/** 약관·처리방침에 같은 사실이 적혀 있는지 검사할 때 쓰는 핵심 어구. */
export const ACCOUNT_DELETION_POLICY_ANCHORS: readonly string[] = [
  "되돌릴 수 없",
  "파트너의 화면",
  "등록한 업체",
];
