"use client";

import { CircleHelp } from "lucide-react";

/**
 * 온보딩 가이드 수동 진입점.
 * 가이드 자동 팝업을 제거하면서(첫 세션 마찰 해소) 유일한 오픈 경로가 된 이벤트를 발화한다.
 * 가이드 컴포넌트가 같은 페이지에 마운트된 곳에서만 사용할 것.
 */
export default function GuideOpenButton({
  eventName,
  label,
}: {
  eventName: string;
  label: string;
}) {
  return (
    <div className="flex justify-center pt-1 pb-3">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(eventName))}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--hb-hairline)] bg-white/80 px-4 text-[12px] font-semibold text-[var(--hb-text-muted)] transition-colors hover:text-[var(--hb-text-strong)]"
      >
        <CircleHelp className="h-3.5 w-3.5" />
        {label}
      </button>
    </div>
  );
}
