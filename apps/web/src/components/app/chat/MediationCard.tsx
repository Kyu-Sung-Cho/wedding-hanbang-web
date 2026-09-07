"use client";

import {
  CircleHelp,
  Heart,
  MessagesSquare,
  Users,
} from "lucide-react";
import {
  getExpectedMediationRevision,
  isRequesterSummaryMediationV2,
  type MediationBlock,
} from "./mediationBlock";

import MediationResponseControls from "./MediationResponseControls";

export type { MediationBlock } from "./mediationBlock";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function MediationCard({ block, messageId }: { block: MediationBlock; messageId?: string }) {
  const expectedRevision = getExpectedMediationRevision(block);
  const isRequesterSummaryV2 = isRequesterSummaryMediationV2(block);
  const expectedProposalVersion = expectedRevision?.expectedProposalVersion;
  const expectedRosterFingerprint = expectedRevision?.expectedRosterFingerprint;
  const canConfirm = Boolean(
    block.resolution?.trim()
    && messageId
    && UUID_PATTERN.test(messageId)
    && expectedProposalVersion
    && expectedRosterFingerprint,
  );

  const sections = (isRequesterSummaryV2
    ? [
        { key: "empathy", title: "요청자가 전한 감정", Icon: Heart, text: block.empathy },
        { key: "translation", title: "요청자가 전한 상황", Icon: MessagesSquare, text: block.translation },
        { key: "data", title: "상대방에게 확인할 점", Icon: CircleHelp, text: block.data },
        { key: "resolution", title: "같이 검토할 선택안", Icon: Users, text: block.resolution },
      ]
    : [
        { key: "empathy", title: "전해진 감정", Icon: Heart, text: block.empathy },
        { key: "translation", title: "상황 정리", Icon: MessagesSquare, text: block.translation },
        { key: "data", title: "확인할 내용", Icon: CircleHelp, text: block.data },
        { key: "resolution", title: "같이 검토할 선택안", Icon: Users, text: block.resolution },
      ]).filter((section) => Boolean(section.text?.trim()));

  if (sections.length === 0) return null;

  return (
    <section
      aria-label="요청자 요약 기반 조율 초안"
      className="mt-3 overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-[#FFFDF9]"
    >
      <div className="border-b border-[#EEE6DF] px-4 py-3.5">
        <p className="text-xs leading-relaxed text-[#6D625B]">
          {isRequesterSummaryV2
            ? "요청자가 직접 적은 요약을 바탕으로 만든 조율 초안이에요. 상대방의 생각은 아직 확인되지 않았어요."
            : "확인 출처가 없는 이전 조율 초안이에요. 내용은 참고만 하고 새 공동 결정으로 확인하려면 조율 초안을 다시 요청해 주세요."}
        </p>
      </div>

      <div className="divide-y divide-[#EEE6DF]">
        {sections.map((section) => (
          <div key={section.key} className="px-4 py-3.5">
            <div className="flex items-center gap-2 text-[#566A61]">
              <section.Icon className="h-4 w-4" aria-hidden="true" />
              <h3 className="text-xs font-semibold">{section.title}</h3>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#2B2A29]">
              {section.text}
            </p>
          </div>
        ))}
      </div>

      {canConfirm && messageId && expectedRevision && <MediationResponseControls revision={{ messageId, ...expectedRevision }} />}
    </section>
  );
}
