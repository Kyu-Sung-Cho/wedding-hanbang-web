import { createHash } from "node:crypto";

/**
 * 커플 구성 지문 — "이 승인이 어떤 두 사람 사이에서 이뤄졌는가"를 고정한다.
 *
 * 제안과 실행 사이에 파트너가 합류하거나 빠지면, 같은 문장이라도 승인의 의미가
 * 달라진다. 혼자 정해도 되던 일이 둘이 정해야 하는 일이 되고, 그 반대도 된다.
 * 그래서 승인 증거에는 내용(proposal digest)뿐 아니라 그때의 구성도 함께 적는다.
 *
 * md5는 여기서 보안 해시가 아니라 두 uuid의 동일성 지문이다. 강한 해시로 "개선"하면
 * `amora_mediation_acceptances`와 `amora_shared_action_acceptances`에 이미 쌓인
 * 지문이 전부 불일치로 바뀌어 과거 승인이 통째로 무효가 된다. 저장된 증거와
 * 같은 계산을 유지해야 한다.
 */
export const ROSTER_FINGERPRINT_PATTERN = /^[a-f0-9]{32}$/;

export function computeCoupleRosterFingerprint(
  brideId: unknown,
  groomId: unknown,
): string {
  const bride = typeof brideId === "string" ? brideId : "-";
  const groom = typeof groomId === "string" ? groomId : "-";
  return createHash("md5").update(`${bride}:${groom}`, "utf8").digest("hex");
}
