"use client";

import { useId } from "react";
import { Lock } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import Button from "@/components/ui/Button";
import {
  AMORA_LANE_CHOICE_COPY,
  type AmoraLaneChoice,
} from "@hanbang/shared/amora-lane-choice";

/**
 * 아모라 대화를 처음 열 때 '함께 대화'와 '나만 (상담)' 중 하나를 고르게 하는 카드.
 *
 * 2026-09-26 파운더 결정. 문구는 `AMORA_LANE_CHOICE_COPY` 한 벌을 그대로 그린다. 전체화면
 * (`ChatContent`)과 옆 패널(`ChatSidePanel`)이 같은 카드를 쓰고, 고른 칸을 기억하는 일과
 * 탭을 옮기는 일은 부르는 쪽이 한다(`onChoose`).
 *
 * 파트너 연결 전인 사람에게만 '함께' 설명 뒤에 연결 안내 한 줄을 붙인다. 이미 연결된
 * 사람에게는 틀린 말이 된다.
 */
export default function AmoraLaneChoiceCard({
  onChoose,
  partnerLinked,
  disabled = false,
  compact = false,
}: {
  onChoose: (lane: AmoraLaneChoice) => void;
  partnerLinked: boolean;
  disabled?: boolean;
  /** 옆 패널처럼 폭이 좁은 곳. 두 선택지를 한 줄에 나란히 두지 않는다. */
  compact?: boolean;
}) {
  const titleId = useId();
  const copy = AMORA_LANE_CHOICE_COPY;
  // 공통 Button(secondary)을 쓰되, 이름 아래 설명이 줄바꿈되는 선택지 모양으로만 펼친다.
  const optionClass = "h-auto flex-col items-start! justify-start! gap-1! whitespace-normal! px-3.5! py-3 text-left";

  return (
    <section
      role="group"
      aria-labelledby={titleId}
      data-testid="amora-lane-choice"
      className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-3.5 shadow-[var(--shadow-raised)]"
    >
      <p id={titleId} className="text-[15px] font-semibold leading-6 text-[var(--hb-text-strong)]">
        {copy.title}
      </p>
      <div className={`mt-2.5 grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
        <Button
          variant="secondary"
          fullWidth
          data-amora-lane-option="shared"
          disabled={disabled}
          onClick={() => onChoose("shared")}
          className={optionClass}
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-accent-hover)]">
            <AmoraMark className="h-4 w-4" />
            {copy.shared.label}
          </span>
          <span className="text-[13px] font-normal leading-5 text-[var(--hb-text-body)]">
            {copy.shared.description}
          </span>
          {!partnerLinked && (
            <span
              data-testid="amora-lane-choice-unlinked-note"
              className="text-[12.5px] font-normal leading-5 text-[var(--hb-text-muted)]"
            >
              {copy.shared.unlinkedPartnerNote}
            </span>
          )}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          data-amora-lane-option="private"
          disabled={disabled}
          onClick={() => onChoose("private")}
          className={optionClass}
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5a6147]">
            <Lock className="h-4 w-4" aria-hidden="true" />
            {copy.private.label}
          </span>
          <span className="text-[13px] font-normal leading-5 text-[var(--hb-text-body)]">
            {copy.private.description}
          </span>
        </Button>
      </div>
      <p className="mt-2 text-[12.5px] leading-5 text-[var(--hb-text-muted)]">{copy.footnote}</p>
    </section>
  );
}
