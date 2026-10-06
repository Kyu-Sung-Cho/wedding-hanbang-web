"use client";

import type { Letter } from "@/lib/weddingCode/v40/types";
import { useWeddingCodeResultMetadata } from "./ResultEditionContext";

export interface LetterDefinitionProps {
  readonly letter: Letter;
}

/** 글자의 영문 출처와 한글 뜻을 개인·두 사람 결과에서 같은 정의로 읽는다. */
export function LetterDefinition({ letter }: LetterDefinitionProps) {
  const { letterInfo } = useWeddingCodeResultMetadata();
  const info = letterInfo(letter);
  return (
    <div data-letter-definition={letter}>
      <p data-letter-origin="" className="text-xs font-semibold leading-relaxed text-[var(--hb-summary-label)]">
        {letter} · <span lang="en">{info.english}</span>
      </p>
      <p className="mt-1 text-base font-semibold leading-snug text-[var(--hb-text-strong)]">{info.name}</p>
      <p data-letter-meaning="" className="mt-2 break-keep text-sm leading-relaxed text-[var(--hb-text-body)]">{info.meaning}</p>
    </div>
  );
}

export default LetterDefinition;
