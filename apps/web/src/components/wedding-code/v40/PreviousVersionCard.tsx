"use client";

import { V40_COPY, savedOnLine } from "@/lib/weddingCode/v40/copy";
import { SectionCard } from "./SectionCard";

export interface PreviousVersionCardProps {
  /** 이전 웨딩코드 진행 저장의 저장 시각(밀리초). 모르면 null 이고 날짜 줄을 그리지 않는다. */
  readonly savedAt?: number | null;
  readonly className?: string;
}

/**
 * 이 기기에 이전 웨딩코드(v3.1) 진행 저장이 있을 때 시작 화면 위에 놓는 읽기만 하는 카드.
 * 단추도 링크도 없다: 질문이 바뀌어서 새 웨딩코드로 옮길 수 없고 자동 이전도 하지 않는다는 것만 알린다.
 */
export function PreviousVersionCard({ savedAt = null, className }: PreviousVersionCardProps) {
  const savedOn = savedOnLine(savedAt);
  return (
    <SectionCard title={V40_COPY.intro.legacy.title} dataCard="legacy" className={className}>
      <p>{V40_COPY.intro.legacy.body}</p>
      {savedOn ? <p className="text-[var(--hb-text-muted)]">{savedOn}</p> : null}
    </SectionCard>
  );
}

export default PreviousVersionCard;
