"use client";

import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { GateInfo, QualityNotes as QualityNotesData } from "@/lib/weddingCode/v40/types";
import { buttonFocusFix, cx, noticeBox, noticeText } from "./styles";
import { bodyLine, panel, sectionTitle } from "./resultStyles";

/** 세기를 한 단계 낮춘 까닭. 위치 반복이 먼저이고, 두 힌트가 함께 걸려도 세기는 한 단계만 낮아지므로 한 줄만 보인다. */
export function demotionHint(notes: QualityNotesData): { readonly kind: "rhythm" | "skip"; readonly text: string } | null {
  if (notes.hintRhythm) return { kind: "rhythm", text: V40_COPY.quality.rhythmHint };
  if (notes.hintSkip) return { kind: "skip", text: V40_COPY.quality.skipHint };
  return null;
}

/** 세기를 낮춘 것과 별개로 결과 아래쪽 목록에 적는 안내들(넘어간 질문, 글자를 못 정한 주제, 임시 글자). */
export function listedNotes(notes: QualityNotesData): readonly { readonly key: string; readonly text: string }[] {
  const lines: { readonly key: string; readonly text: string }[] = [];
  if (notes.hasOmitted) lines.push({ key: "omitted", text: V40_COPY.quality.omitted });
  if (notes.unusableAxes.length > 0) lines.push({ key: "unusable", text: V40_COPY.quality.unusableAxis });
  if (notes.provisionalAxes.length > 0) lines.push({ key: "provisional", text: V40_COPY.quality.provisional });
  return lines;
}

/**
 * top: 세기를 낮췄을 때의 한 줄. 모든 글자 옆 세기가 낮아졌으니 이유를 코드 줄보다 먼저 읽도록 결과 맨 위(제목과 고지 바로 아래)에 놓는다.
 * list: 그 밖의 안내 목록(결과 아래쪽). 안내가 하나도 없으면 아무것도 그리지 않는다.
 * all: 둘을 한 목록에 함께(다른 화면에서 이 컴포넌트만 쓸 때).
 */
export type QualityNotesPlacement = "top" | "list" | "all";

export interface QualityNotesProps {
  readonly notes: QualityNotesData;
  readonly placement?: QualityNotesPlacement;
  /**
   * 넘어간 질문 다시 보기. 다시 보여 줄 질문이 있을 때만 준다(flow.skippedReviewIds 가 비어 있지 않을 때). 주면 목록 아래에 단추가 붙는다.
   * 다시 여는 일은 부모가 한다.
   */
  readonly onReviewSkipped?: () => void;
  readonly idPrefix?: string;
}

/**
 * 품질 안내. 위치 반복 힌트와 건너뜀 힌트는 글자 옆 세기를 한 단계 낮췄다는 뜻이고, 넘어간 질문, 글자를 못 정한 주제, 임시 글자는 결과를 읽는 데 필요한 사실이다.
 * 비난하는 말투를 쓰지 않고 숫자로 세기를 말하지 않는다. 문구는 모두 copy.ts 에서 온다.
 */
export function QualityNotes({ notes, placement = "all", onReviewSkipped, idPrefix = "wc40-quality" }: QualityNotesProps) {
  const hint = placement === "list" ? null : demotionHint(notes);
  const listed = placement === "top" ? [] : listedNotes(notes);
  if (placement === "top") {
    if (hint === null) return null;
    return (
      <p role="note" data-result-section="quality-hint" data-quality={hint.kind} className={cx(noticeBox, noticeText)}>
        {hint.text}
      </p>
    );
  }
  const lines = [...(hint === null ? [] : [{ key: hint.kind, text: hint.text }]), ...listed];
  if (lines.length === 0) return null;
  const titleId = `${idPrefix}-title`;
  return (
    <section data-result-section="quality" aria-labelledby={titleId} className={cx(panel, "space-y-2")}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.quality.title}
      </h2>
      <ul className={cx(bodyLine, "space-y-1.5")}>
        {lines.map((line) => (
          <li key={line.key} data-quality={line.key}>
            {line.text}
          </li>
        ))}
      </ul>
      {onReviewSkipped ? (
        <Button variant="secondary" size="sm" onClick={onReviewSkipped} className={buttonFocusFix}>
          {V40_COPY.quality.reviewSkippedButton}
        </Button>
      ) : null}
    </section>
  );
}

export interface GateNoticeProps {
  readonly gate: GateInfo;
  /** 넘어간 질문 다시 보기. 정보가 없어서 닫힌 관문에서만, 다시 보여 줄 질문이 있을 때 부모가 준다. */
  readonly onReviewSkipped?: () => void;
  readonly idPrefix?: string;
}

/**
 * 코드를 만들지 못한 결과(관문). 비난 없는 문구로 이유를 말하고 보낼 링크도 만들지 않았다고 알린다.
 * 처음부터 다시 하기는 결과 아래의 다시 하기 구역에 있다(지워지는 것을 알리는 확인 한 번을 거친다).
 */
export function GateNotice({ gate, onReviewSkipped, idPrefix = "wc40-gate" }: GateNoticeProps) {
  if (!gate.closed) return null;
  const titleId = `${idPrefix}-title`;
  return (
    <section data-result-section="gate" data-gate-reason={gate.reason ?? undefined} aria-labelledby={titleId} className={cx(panel, "space-y-2")}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.gate.title}
      </h2>
      <p className={bodyLine}>
        {gate.reason === "rhythm"
          ? V40_COPY.gate.rhythmBody
          : onReviewSkipped !== undefined
            ? V40_COPY.gate.noInformationBody
            : V40_COPY.gate.noInformationBodyRestartOnly}
      </p>
      <p className={bodyLine}>{V40_COPY.gate.noLinkNote}</p>
      {onReviewSkipped && gate.reason === "noInformation" ? (
        <Button variant="secondary" size="sm" onClick={onReviewSkipped} className={buttonFocusFix}>
          {V40_COPY.gate.reviewSkippedButton}
        </Button>
      ) : null}
    </section>
  );
}

export default QualityNotes;
