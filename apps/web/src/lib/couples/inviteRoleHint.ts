/**
 * 합류자가 고른 역할이 초대한 쪽과 같은지 **RPC 를 부르기 전에** 미리 본다.
 *
 * 2026-09-04 출시 전날 실측: 신부가 만든 유효한 코드에 신랑이 역할만 '신부'로 고르면
 * DB(`join_couple_invite_core`)는 같은 역할은 못 들어간다며 INVALID_INVITE_CODE 를 돌려주고,
 * 화면은 "초대 코드가 올바르지 않습니다" 라고 했다. 코드는 맞는데 오타를 의심하게 만들고,
 * 실패 한 번마다 합류 재시도 한도(10회/10분)만 태웠다.
 *
 * 이 헬퍼는 **판정을 대신하지 않는다.** 만료·봉인·중복 합류는 여전히 RPC 가 정한다.
 * 여기서 보는 것은 하나뿐이다 — 고른 역할의 자리가 다른 사람으로 이미 차 있고 반대 자리가
 * 비어 있는가. 그때만 "반대 역할" 안내를 낼 수 있다. 본인이 그 자리면(재합류·멱등) 손대지
 * 않고, 코드로 커플을 못 찾으면 역시 RPC 에 맡긴다.
 *
 * 온보딩 라우트가 `couples` 를 직접 읽지 않도록(coupleConnectionSettings.test 의 경계)
 * 읽기는 여기 한 곳에만 둔다.
 */
type InviteCoupleRow = { bride_id: string | null; groom_id: string | null };

type AdminLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error?: unknown }>;
      };
    };
  };
};

export async function inviteRoleMismatchForJoin(
  admin: AdminLike,
  input: { inviteCode: string; role: "bride" | "groom"; actorUserId: string },
): Promise<boolean> {
  const lookup = await admin
    .from("couples")
    .select("bride_id, groom_id")
    .eq("invite_code", input.inviteCode)
    .maybeSingle();
  const row = lookup.data as InviteCoupleRow | null | undefined;
  if (!row || typeof row !== "object") return false;
  const chosenSlot = input.role === "bride" ? row.bride_id : row.groom_id;
  const oppositeSlot = input.role === "bride" ? row.groom_id : row.bride_id;
  return Boolean(chosenSlot) && chosenSlot !== input.actorUserId && !oppositeSlot;
}
