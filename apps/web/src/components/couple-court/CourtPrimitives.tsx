"use client";

import Link from "next/link";
import { AlertCircle, Archive, ArrowRight, RefreshCw, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";
import type { CourtCaseStatus } from "./types";
import { COURT_CATEGORY_CATALOG } from "@/lib/coupleCourt/catalog";
import { COURT_SAFETY_RESOURCES } from "@/lib/coupleCourt/support";

export const COURT_CATEGORIES = COURT_CATEGORY_CATALOG.map((category) => ({
  value: category.id,
  label: category.label,
}));

export function categoryLabel(value: string) {
  return COURT_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

export const STATUS_LABELS: Record<CourtCaseStatus, string> = {
  draft: "작성 중",
  awaiting_applicant_statement: "신청인 진술 대기",
  awaiting_partner: "상대방 초대 대기",
  awaiting_partner_statement: "상대방 진술 대기",
  statements_complete: "판결 요청 가능",
  judging: "판결 작성 중",
  verdict_ready: "판결 완료",
  mission_active: "화해 처방 진행",
  resolved: "합의 완료",
  archived: "보관됨",
};

export function CourtPage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1040px] pb-[calc(5rem+env(safe-area-inset-bottom))] text-base text-[#263832] ${className}`}>{children}</div>;
}

export function CourtSeal({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`inline-flex items-center justify-center rounded-full border border-[#A77B74]/25 bg-[#F7EFEC] text-[#8F6662] shadow-[0_8px_24px_rgba(143,102,98,0.12)] ${compact ? "h-11 w-11" : "h-16 w-16"}`} aria-hidden="true">
      <Scale className={compact ? "h-5 w-5" : "h-7 w-7"} strokeWidth={1.8} />
    </div>
  );
}

export function StatusBadge({ status }: { status: CourtCaseStatus }) {
  return <span className="inline-flex min-h-7 items-center rounded-full border border-[#36534E]/15 bg-[#EEF4F1] px-3 py-1 text-xs font-semibold text-[#36534E]">{STATUS_LABELS[status]}</span>;
}

export function CourtLink({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" | "text"; className?: string }) {
  const variants = {
    primary: "bg-[#36534E] text-white shadow-[0_10px_24px_rgba(54,83,78,0.16)] hover:bg-[#2D4642]",
    secondary: "border border-[#D9CFC3] bg-white text-[#36534E] hover:border-[#36534E]/45 hover:bg-[#F8FAF9]",
    text: "text-[#36534E] underline decoration-[#A9BDB5] underline-offset-4 hover:text-[#243832]",
  };
  return <Link {...weddingLinkProps(href)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 ${variants[variant]} ${className}`}>{children}</Link>;
}

export function CourtButton({ children, onClick, type = "button", variant = "primary", disabled = false, className = "", ariaLabel }: { children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; variant?: "primary" | "secondary" | "danger"; disabled?: boolean; className?: string; ariaLabel?: string }) {
  const variants = {
    primary: "bg-[#36534E] text-white hover:bg-[#2D4642]",
    secondary: "border border-[#D9CFC3] bg-white text-[#36534E] hover:border-[#36534E]/45 hover:bg-[#F8FAF9]",
    danger: "border border-[#B45353]/30 bg-white text-[#9B3F3F] hover:bg-[#FFF5F5]",
  };
  return <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${className}`}>{children}</button>;
}

export function Surface({ children, className = "", as = "section", id }: { children: React.ReactNode; className?: string; as?: "section" | "article" | "div"; id?: string }) {
  const Component = as;
  return <Component id={id} className={`rounded-[22px] border border-[#E4D9CC] bg-white p-5 shadow-[0_12px_36px_rgba(38,56,50,0.055)] sm:p-7 ${className}`}>{children}</Component>;
}

export function LoadingState({ label = "불러오는 중이에요." }: { label?: string }) {
  return <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center" role="status" aria-live="polite"><Sparkles className="h-8 w-8 animate-pulse text-[#A77B74] motion-reduce:animate-none" aria-hidden="true" /><p className="text-base font-medium text-[#5E6C66]">{label}</p></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Surface className="mx-auto max-w-[680px] text-center" as="div"><AlertCircle className="mx-auto h-9 w-9 text-[#9B3F3F]" aria-hidden="true" /><h2 className="mt-4 text-xl font-bold text-[#263832]">지금은 이어갈 수 없어요</h2><p className="mt-2 text-base leading-7 text-[#5E6C66]" role="alert">{message}</p>{onRetry && <CourtButton onClick={onRetry} variant="secondary" className="mt-5"><RefreshCw className="h-4 w-4" aria-hidden="true" />다시 시도</CourtButton>}</Surface>;
}

export function ArchivedCaseNotice({ caseId, showVerdictLink = false, className = "" }: { caseId: string; showVerdictLink?: boolean; className?: string }) {
  return <Surface className={`border-[#D8CDC1] bg-[#FCFAF6] ${className}`} as="div"><Archive className="h-7 w-7 text-[#65716C]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">보관된 사건은 읽기 전용이에요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">보관 당시의 판결과 기록만 확인할 수 있어요. 새 진술, 재심, 초대, 공개, 화해 처방 변경은 더 이상 제공하지 않습니다.</p><div className="mt-5 flex flex-col gap-2 sm:flex-row"><CourtLink href={`/couple-court/cases/${caseId}`} variant="secondary">사건 기록으로</CourtLink>{showVerdictLink && <CourtLink href={`/couple-court/cases/${caseId}/verdict`} variant="secondary">보관된 판결 보기</CourtLink>}</div></Surface>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="rounded-[22px] border border-dashed border-[#CFC2B4] bg-[#FCFAF6] px-5 py-10 text-center"><CourtSeal compact /><h2 className="mt-4 text-xl font-bold text-[#263832]">{title}</h2><p className="mx-auto mt-2 max-w-[520px] text-base leading-7 text-[#65716C]">{description}</p>{action && <div className="mt-6">{action}</div>}</div>;
}

export function SafetyNotice({ highRisk = false }: { highRisk?: boolean }) {
  return <div className={`rounded-[18px] border p-4 ${highRisk ? "border-[#B45353]/25 bg-[#FFF7F5]" : "border-[#9DB5AC]/35 bg-[#F2F7F4]"}`} role={highRisk ? "alert" : undefined}><div className="flex gap-3"><ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${highRisk ? "text-[#9B3F3F]" : "text-[#36534E]"}`} aria-hidden="true" /><div><p className="font-semibold text-[#263832]">{highRisk ? "재미있는 판결보다 안전 확인이 먼저예요" : "안전하고 사적인 대화를 지켜드려요"}</p><p className="mt-1 text-sm leading-6 text-[#5E6C66]">{highRisk ? "지금 즉시 위험하다면 혼자 해결하려 하지 말고 안전한 장소에서 긴급 지원이나 믿을 수 있는 사람에게 도움을 요청해 주세요." : "한방 판결은 법률·의료·상담 진단이 아닌 커뮤니케이션 보조 기능이며, 사건과 판결은 기본적으로 비공개예요."}</p>{highRisk && <ul className="mt-3 flex flex-wrap gap-2" aria-label="대한민국 긴급 지원 연락처">{COURT_SAFETY_RESOURCES.map((resource) => <li key={resource.id}><a href={resource.href} className="inline-flex min-h-11 items-center rounded-full border border-[#B45353]/25 bg-white px-4 py-2 text-sm font-bold text-[#8D3535] outline-none focus-visible:ring-2 focus-visible:ring-[#8D3535]">{resource.label} {resource.phone}</a></li>)}</ul>}</div></div></div>;
}

export function PageIntro({ eyebrow, title, description, children, titleId, headingLevel = "h1" }: { eyebrow: string; title: string; description: string; children?: React.ReactNode; titleId?: string; headingLevel?: "h1" | "h2" }) {
  const Heading = headingLevel;
  return <div className="mb-7"><div className="flex items-center gap-3"><CourtSeal compact /><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8F6662]">{eyebrow}</p></div><Heading id={titleId} className="mt-4 text-[30px] font-bold leading-[1.25] tracking-[-0.025em] text-[#263832] sm:text-[38px]">{title}</Heading><p className="mt-3 max-w-[720px] text-base leading-7 text-[#5E6C66] sm:text-[17px]">{description}</p>{children}</div>;
}

export function SectionHeading({ title, description, action, titleId }: { title: string; description?: string; action?: React.ReactNode; titleId?: string }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 id={titleId} className="text-xl font-bold text-[#263832] sm:text-2xl">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-[#65716C]">{description}</p>}</div>{action}</div>;
}

export function ContinueArrow() {
  return <ArrowRight className="h-4 w-4" aria-hidden="true" />;
}
