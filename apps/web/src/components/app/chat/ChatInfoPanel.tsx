"use client";

import { useId, useState, type ElementType } from "react";
import { X, Wallet, CheckCircle2, CalendarClock, MessagesSquare } from "lucide-react";
import Button from "@/components/ui/Button";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";
import BudgetTab from "./panel/BudgetTab";
import ChecklistTab from "./panel/ChecklistTab";
import UpcomingTab from "./panel/UpcomingTab";
import ConversationRecapPanel, { type ConversationRecapPanelProps } from "./panel/ConversationRecapPanel";

type Tab = "recap" | "budget" | "checklist" | "upcoming";
const TABS: { key: Tab; label: string; icon: ElementType }[] = [
  { key: "recap", label: "대화 정리", icon: MessagesSquare },
  { key: "budget", label: "예산", icon: Wallet },
  { key: "checklist", label: "체크리스트", icon: CheckCircle2 },
  { key: "upcoming", label: "임박 일정", icon: CalendarClock },
];
interface Props { isOpen: boolean; onClose(): void; recap?: ConversationRecapPanelProps }

export default function ChatInfoPanel({ isOpen, onClose, recap }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(recap ? "recap" : "checklist");
  const headingId = useId();
  const dialogRef = useAccessibleModal({ open: isOpen, onClose });
  if (!isOpen) return null;
  const tabs = recap ? TABS : TABS.filter(tab => tab.key !== "recap");
  return <>
    <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/20 md:bg-black/5" onClick={onClose} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-2xl border-l border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-overlay)] md:inset-x-auto md:top-[72px] md:right-0 md:bottom-0 md:h-auto md:w-[380px] md:rounded-none">
      <div className="flex items-center justify-between border-b border-[var(--hb-hairline)] px-4 py-3">
        <h3 id={headingId} className="text-[var(--hb-text-strong)]">결혼 준비 현황</h3>
        <Button variant="icon" label="준비 현황 닫기" onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></Button>
      </div>
      <nav aria-label="준비 현황 보기" className="flex border-b border-[var(--hb-hairline)]">
        {tabs.map(tab => <Button key={tab.key} variant="ghost" aria-pressed={activeTab === tab.key}
          onClick={() => setActiveTab(tab.key)} className={`min-w-0 flex-1 flex-col gap-1! rounded-none! px-1! py-2 text-[11px]! ${activeTab === tab.key ? "bg-[var(--hb-surface-hover)] text-[var(--hb-accent-hover)]!" : ""}`}>
          <tab.icon className="h-4 w-4" aria-hidden="true" />{tab.label}
        </Button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "recap" && recap && <ConversationRecapPanel {...recap} />}
        {activeTab === "budget" && <BudgetTab />}
        {activeTab === "checklist" && <ChecklistTab />}
        {activeTab === "upcoming" && <UpcomingTab />}
      </div>
    </div>
  </>;
}
