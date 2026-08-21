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
    text: "등록한 업체가 있으면 먼저 정리해야 탈퇴할 수 있어요.",
    emphasis: false,
  },
  {
    key: "timing",
    text: "접수하면 바로 처리를 시작해요. 안전 확인이 필요한 파일이 있으면 확인한 뒤 완료돼요.",
    emphasis: false,
  },
];

/** 약관·처리방침에 같은 사실이 적혀 있는지 검사할 때 쓰는 핵심 어구. */
export const ACCOUNT_DELETION_POLICY_ANCHORS: readonly string[] = [
  "되돌릴 수 없",
  "파트너의 화면",
  "등록한 업체",
];
