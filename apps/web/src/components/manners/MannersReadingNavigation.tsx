"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, List } from "lucide-react";
import MannersAnchor from "./MannersAnchor";

type ReadingSection = { id: string; label: string; role?: string };
const roleMatch: Record<string, string> = { couple: "두 사람", elders: "양가 어른", guest: "하객" };
function includesRole(section: ReadingSection, role: string) {
  return role === "all" || !section.role || section.role === "공통" || section.role === roleMatch[role];
}

export default function MannersReadingNavigation({ slug, sections, controls, children, hasRoles }: { slug: string; sections: ReadingSection[]; controls: ReactNode; children: ReactNode; hasRoles: boolean }) {
  const [role, setRole] = useState("all");
  const root = useRef<HTMLDivElement>(null);
  const visible = sections.filter(section => includesRole(section, role));

  useEffect(() => {
    const revealHash = () => {
      const section = sections.find(item => `#${item.id}` === window.location.hash);
      if (!section || includesRole(section, role)) return;
      const all = root.current?.querySelector<HTMLInputElement>('input[type="radio"][value="all"]');
      if (all) all.checked = true;
      setRole("all");
      const target = document.getElementById(section.id);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
    };
    window.addEventListener("hashchange", revealHash);
    return () => window.removeEventListener("hashchange", revealHash);
  }, [sections, role]);

  return <div ref={root} className={hasRoles ? "manners-roles" : undefined} onChange={event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "radio" || input.name !== `${slug}-role`) return;
    setRole(input.value);
  }}>
    {controls}
    <details id="manners-toc" tabIndex={-1} className="group mt-4 scroll-mt-28 rounded-[12px] border border-[var(--amora-line)] bg-white px-3.5 focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-[var(--amora-ink)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]"><List aria-hidden className="h-4 w-4" />목차<span className="text-[12px] font-normal text-[var(--amora-muted)]">{visible.length}개 절</span><ChevronDown aria-hidden className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" /></summary>
      <nav aria-label="이 글의 목차" className="border-t border-[var(--amora-line)] py-1"><ol className="grid sm:grid-cols-2">{visible.map(section => <li key={section.id}><MannersAnchor href={`#${section.id}`} className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 py-2 text-[13px] leading-relaxed text-[var(--amora-soft)] hover:text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]"><span aria-hidden className="shrink-0 text-[12px] text-[var(--amora-rose-deep)]">{section.id.slice(8).padStart(2, "0")}</span>{section.label}</MannersAnchor></li>)}</ol></nav>
    </details>
    {children}
  </div>;
}
