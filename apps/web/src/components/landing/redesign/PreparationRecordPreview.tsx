import { CalendarDays, ClipboardList, Wallet } from "lucide-react";

import { landingContent } from "./landingContent";

/** 저장 제안을 각각 확인한 뒤 볼 수 있는 준비 기록의 정적 예시. */
export default function PreparationRecordPreview() {
  const { tools, records } = landingContent.confirm;
  const toolIcons = [Wallet, ClipboardList, CalendarDays];

  return (
    <section
      aria-labelledby="preparation-record-title"
      className="min-w-0"
    >
      <div className="border-b border-[var(--color-paper-edge)] pb-3">
        <h2 id="preparation-record-title" className="landing-display text-[19px] leading-[1.45] text-[var(--color-paper-ink)] lg:text-[22px]">
          {records.title}
        </h2>
        <p className="mt-2 text-[14px] leading-[1.6] text-[var(--color-paper-ink-soft)]">{records.note}</p>
      </div>

      <ul>
        {tools.map((tool, index) => {
          const Icon = toolIcons[index] ?? ClipboardList;
          return (
            <li key={tool.title} className="flex items-center gap-3 border-b border-[var(--color-paper-edge)] py-[14px] last:border-b-0 lg:py-4">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-ivory-warm)] text-[var(--color-rose-700)]">
                <Icon className="size-5" strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-[1.5] text-[var(--color-paper-ink-soft)]">{tool.status}</p>
                <p className="mt-0.5 break-words text-[15px] font-semibold leading-[1.5] text-[var(--color-paper-ink)]">{tool.recordTitle}</p>
              </div>
              <p className="max-w-[42%] shrink-0 break-words text-right text-[15px] font-semibold leading-[1.5] tabular-nums text-[var(--color-paper-ink)]">{tool.value}</p>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-[var(--color-paper-edge)] pt-3 text-[14px] leading-[1.6] text-[var(--color-paper-ink-soft)]">
        {records.sharedNote}
      </p>
    </section>
  );
}
