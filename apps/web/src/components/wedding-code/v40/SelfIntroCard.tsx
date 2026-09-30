"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useId, useRef } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ProgressSegment } from "@/lib/weddingCode/v40/types";
import { ProgressBar } from "./ProgressBar";
import { ActionBar, PinBarSpacer, pinnedScreenRootClass } from "./SectionCard";
import { useScreenFocus } from "./useScreenFocus";

export interface SelfIntroCardProps {
  /** 진행 막대 다섯 칸(flow.progressSegments). 없으면 막대를 그리지 않는다. */
  readonly segments?: readonly ProgressSegment[];
  readonly embedded?: boolean;
  readonly onContinue: () => void;
  readonly onBack?: () => void;
}

/**
 * 마지막 정리 카드(마지막 구간 뒤, 자기 선택 화면 앞). 「마지막 정리예요. 하나씩만 더 골라 주세요.」 한 문장과 이어서 하기 단추뿐이다.
 * 구간 이름이 내용을 약속하지 않게 이야기나 상황 설정은 두지 않는다. 이 화면에는 고지 문장도 없다.
 */
export function SelfIntroCard({ segments, embedded = false, onContinue, onBack }: SelfIntroCardProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, "selfIntro");
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-screen="self-intro"
      className={pinnedScreenRootClass(embedded)}
    >
      {segments ? <ProgressBar segments={segments} className="mb-8" /> : null}
      <h1 id={titleId} className="break-keep text-2xl font-semibold leading-snug text-[var(--hb-text-strong)]">
        {V40_COPY.wrapUp.intro}
      </h1>
      <PinBarSpacer embedded={embedded} />
      <ActionBar embedded={embedded}>
        <div className="flex gap-3">
          {onBack ? (
            <Button variant="secondary" size="lg" onClick={onBack}>
              <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
              {V40_COPY.question.previousButton}
            </Button>
          ) : null}
          <Button variant="primary" size="lg" onClick={onContinue} className="flex-1">
            {V40_COPY.wrapUp.continueButton}
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Button>
        </div>
      </ActionBar>
    </section>
  );
}

export default SelfIntroCard;
