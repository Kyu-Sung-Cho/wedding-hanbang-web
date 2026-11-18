import type {
  InquiryApproverOutcome,
  InquiryApproverProposal,
  InquiryApproverResponse,
  InquiryApproverSetting,
} from "@hanbang/shared/invitation";
import type { CoupleContext } from "./coupleContext";
import type { StoredApproverProposal } from "./inquiryRepository";

/**
 * 승인 방식 응답(GET·PUT·확인·거절이 같은 모양을 쓴다). 확인을 기다리는 제안은 제안한 사람이 지금 회원일 때만
 * 보여 준다. 답할 수 있는 사람은 제안한 사람이 아닌 다른 회원이다. 이 판단은 DB 가 다시 한다.
 */
export function approverResponse(
  context: CoupleContext,
  setting: InquiryApproverSetting,
  proposal: StoredApproverProposal | null,
  outcome?: InquiryApproverOutcome,
): InquiryApproverResponse {
  const memberIds = context.members.map((member) => member.id);
  const pending: InquiryApproverProposal | null = proposal && memberIds.includes(proposal.proposedBy)
    ? {
      ...proposal,
      viewerCanRespond: proposal.proposedBy !== context.userId && memberIds.includes(context.userId),
    }
    : null;
  return {
    setting,
    pending,
    members: context.members.map((member) => ({ id: member.id, name: member.name, isViewer: member.id === context.userId })),
    ...(outcome ? { outcome } : {}),
  };
}
