"use client";

import { useState } from "react";
import { EXAMPLE_LETTER, type LetterShare } from "@hanbang/shared/invitation";

import InvitationLetterSheet from "@/components/invitation/InvitationLetterSheet";

import { examplePhotoSrc, exampleRoute } from "../../exampleRoutes";

/**
 * 예시 커플 편지 확인. 스위치는 이 화면 안에서만 바뀌고, 보내기는 실제로 보내지 않고
 * 상담 확정 예시 화면으로 넘어간다(아티팩트 흐름 그대로).
 * 시트가 넓은 화면에서 스스로 480px 로 묶이므로 어두운 바탕은 화면 전체에 깐다.
 */
export default function ExampleLetterClient() {
  const [shares, setShares] = useState<readonly LetterShare[]>(EXAMPLE_LETTER.shares);

  function toggleShare(key: LetterShare["key"]) {
    setShares((current) => current.map((share) => (share.key === key ? { ...share, on: !share.on } : share)));
  }

  return (
    <InvitationLetterSheet
      model={{ ...EXAMPLE_LETTER, shares }}
      resolveRoute={exampleRoute}
      onToggleShare={toggleShare}
      photoSrc={examplePhotoSrc}
    />
  );
}
