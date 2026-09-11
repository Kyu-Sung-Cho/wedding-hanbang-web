"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import Button from "@/components/ui/Button";

export type MannersDirectoryGroup = {
  label: string;
  entries: { slug: string; searchText: string; card: ReactNode }[];
};

export default function MannersGuideDirectory({ groups }: { groups: MannersDirectoryGroup[] }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const words = query.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean);
    return groups.filter(group => !topic || group.label === topic).map(group => ({
      ...group,
      entries: group.entries.filter(entry => words.every(word => entry.searchText.includes(word))),
    })).filter(group => group.entries.length > 0);
  }, [groups, query, topic]);
  const count = filtered.reduce((sum, group) => sum + group.entries.length, 0);
  const clearQuery = () => { setQuery(""); searchInput.current?.focus(); };
  const reset = () => { setQuery(""); setTopic(null); searchInput.current?.focus(); };

  return (
    <div className="mt-5 sm:mt-6">
      <div className="relative max-w-[620px]">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-[var(--amora-muted)]" />
        <input ref={searchInput} type="search" aria-label="가이드 검색" placeholder="제목이나 궁금한 내용 검색" value={query} onChange={event => setQuery(event.target.value)} className="min-h-11 w-full rounded-[12px] border border-[var(--color-paper-outline)] bg-white py-2.5 pl-10 pr-12 text-[14px] text-[var(--amora-ink)] placeholder:text-[var(--amora-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]" />
        {query && <Button variant="icon" label="검색어 지우기" onClick={clearQuery} className="absolute right-0 top-0 rounded-[12px]! text-[var(--amora-muted)]!"><X aria-hidden className="h-4 w-4" /></Button>}
      </div>
      <nav aria-label="가이드 주제" className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {[null, ...groups.map(group => group.label)].map(label => <Button key={label ?? "all"} variant={topic === label ? "primary" : "secondary"} aria-pressed={topic === label} onClick={() => setTopic(label)} className={`shrink-0 rounded-full! border px-3.5! text-[12px]! ${topic === label ? "border-[var(--amora-selected-line)]! bg-[var(--amora-selected-bg)]! text-[var(--amora-selected-text)]! hover:bg-[var(--amora-selected-bg)]!" : "border-[var(--color-paper-outline)]! bg-white! text-[var(--amora-soft)]!"}`}>{label ?? "전체"}</Button>)}
      </nav>
      <div className="mb-3 flex min-h-11 items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-[12px] text-[var(--amora-muted)]">{query || topic ? `찾은 가이드 ${count}편` : `전체 ${count}편`}</p>
        {(query || topic) && <Button variant="ghost" onClick={reset} aria-label="검색과 주제 초기화" className="px-2! text-[12px]! text-[var(--amora-accent)]!">초기화</Button>}
      </div>
      {count === 0 ? <div className="rounded-[14px] border border-[var(--amora-line)] bg-white px-5 py-7 text-center"><p className="text-[15px] font-semibold text-[var(--amora-ink)]">찾는 가이드가 없어요</p><p className="mt-2 text-[13px] leading-relaxed text-[var(--amora-soft)]">다른 검색어를 쓰거나 주제를 전체로 바꿔보세요.</p></div> : <div className="space-y-6">{filtered.map((group, index) => <section key={group.label} aria-labelledby={`guide-group-${index}`}><h2 id={`guide-group-${index}`} className="text-[13px] font-semibold text-[var(--amora-rose-deep)]">{group.label}</h2><ul className="mt-2 grid gap-2 sm:grid-cols-2">{group.entries.map(entry => <li key={entry.slug} data-guide-slug={entry.slug} className="flex items-center rounded-[14px] border border-[var(--amora-line)] bg-white sm:rounded-[16px]">{entry.card}</li>)}</ul></section>)}</div>}
    </div>
  );
}
