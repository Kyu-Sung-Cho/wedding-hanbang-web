import { createHash } from "node:crypto";
import { canonicalizeDecisionPacket, type DecisionPacket } from "@hanbang/shared";

/**
 * proposal digest 발급 — 서버 전용.
 *
 * 이 함수가 `@hanbang/shared`가 아니라 여기 있는 것은 번들 사정 때문이 아니라 보안
 * 때문이다. 클라이언트가 digest를 계산할 수 있으면 아무 내용에나 원하는 digest를
 * 붙여 "사용자가 이걸 승인했다"고 주장할 수 있다. digest는 사용자가 실제로 본
 * 화면을 서버가 증언하는 값이므로 서버만 만든다.
 *
 * 형식은 저장된 다른 증거와 맞춘다 — `amora_shared_action_acceptances.proposal_digest`,
 * `StoredAmoraPendingAction.inputDigest` 모두 sha256 hex다.
 */
export function computeProposalDigest(packet: DecisionPacket): string {
  return createHash("sha256")
    .update(canonicalizeDecisionPacket(packet), "utf8")
    .digest("hex");
}
