"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useId, useRef } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ProgressSegment } from "@/lib/weddingCode/v40/types";
import { StorageNotice, type SaveState } from "./NoticeScreens";
import { ProgressBar } from "./ProgressBar";
import { ActionBar, PinBarSpacer, pinnedScreenRootClass } from "./SectionCard";
import { bodyText } from "./styles";
import { useScreenFocus } from "./useScreenFocus";

export interface RestCardProps {
  /** 방금 마친 구간(쉬는 카드는 구간 0, 1, 2 뒤에만 있다). */
  readonly after: 0 | 1 | 2;
  /** 진행 막대 다섯 칸(flow.progressSegments). 없으면 막대를 그리지 않는다. */
  readonly segments?: readonly ProgressSegment[];
  /**
   * 마지막 저장 결과. 사실대로만 말한다: saved 일 때만 저장했다고, off 이면 쉬었다 오려면 자동 저장을 켜라고,
   * unavailable 과 conflict 는 저장 문제 안내를 대신 보인다. null 이면 저장에 관한 말을 하지 않는다.
   */
  readonly saveState?: SaveState | null;
  /**
   * 저장 시각(밀리초). 더 이상 그리지 않는다: 쉬는 카드의 저장 시각은 늘 오늘이라 날짜 줄이 저장했다는 말을 되풀이할 뿐이었다
   * (날짜 줄은 시작 화면의 하던 답 카드에만 있다). 부르는 쪽을 고치지 않아도 되게 자리만 남겨 둔다.
   */
  readonly savedAt?: number | null;
  readonly embedded?: boolean;
  readonly onContinue: () => void;
  readonly onBack?: () => void;
  /** saveState 가 off 일 때 자동 저장 켜기. */
  readonly onTurnOnAutosave?: () => void;
  /** saveState 가 conflict 일 때 두 단추. */
  readonly onLoadSaved?: () => void;
  readonly onKeepThis?: () => void;
}

/**
 * 구간 사이 쉬는 카드. 이야기 카드가 아니고 구간 이름 카드도 아니다: 저장 상태를 사실대로 말한 뒤 이어서 하게 한다.
 * 몇 번째 구간을 마쳤는지는 글로 말하지 않는다(번호를 화면에 내지 않는다는 원칙). 진행 막대와 낭독 알림이 알려 준다.
 * 이 카드에는 rest 묶음의 문구와 저장 문제 안내만 그린다(자동 저장 상태 두 줄은 rest 묶음의 두 줄과 같은 말이라 쓰지 않는다).
 * 「검증을 마친 심리검사가 아니」라는 고지는 이 화면에 없다.
 */
export function RestCard({
  after,
  segments,
  saveState = null,
  embedded = false,
  onContinue,
  onBack,
  onTurnOnAutosave,
  onLoadSaved,
  onKeepThis,
}: RestCardProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, `rest:${after}`);
  const copy = V40_COPY.rest;

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-screen="rest"
      data-rest-after={after}
      className={pinnedScreenRootClass(embedded)}
    >
      {segments ? <ProgressBar segments={segments} announcement={V40_COPY.progress.restAnnouncement} className="mb-8" /> : null}
      <h1 id={titleId} className="text-2xl font-semibold leading-snug text-[var(--hb-text-strong)]">
        {copy.title}
      </h1>

      {saveState === "saved" ? (
        <div data-rest-save="saved" className="mt-3">
          <p className={bodyText}>{copy.saved}</p>
        </div>
      ) : null}
      {saveState === "off" ? (
        <div data-rest-save="off" className="mt-3 space-y-3">
          <p className={bodyText}>{copy.autosaveOff}</p>
          {onTurnOnAutosave ? (
            <Button variant="secondary" size="md" onClick={onTurnOnAutosave}>
              {copy.turnOnAutosaveButton}
            </Button>
          ) : null}
        </div>
      ) : null}
      {saveState === "unavailable" || saveState === "conflict" ? (
        <StorageNotice problem={saveState} onLoadSaved={onLoadSaved} onKeepThis={onKeepThis} className="mt-4" />
      ) : null}

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
            {copy.continueButton}
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Button>
        </div>
      </ActionBar>
    </section>
  );
}

export default RestCard;
