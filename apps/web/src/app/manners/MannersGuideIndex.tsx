"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { MannersAudience, MannersCategoryTier } from "@/lib/manners/types";

export type MannersIndexPart = {
  slug: string;
  title: string;
  subtitle: string;
  audience: MannersAudience;
  searchText: string;
};

export type MannersIndexGroup = {
  id: string;
  tier: MannersCategoryTier;
  label: string;
  description: string;
  parts: MannersIndexPart[];
};

const AUDIENCE_LABEL: Record<MannersAudience, string> = {
  guest: "초대받은 분께",
  couple: "준비하는 두 분께",
  both: "모두에게",
};

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

export default function MannersGuideIndex({ groups }: { groups: MannersIndexGroup[] }) {
  const [activeTier, setActiveTier] = useState<MannersCategoryTier>(groups[0]?.tier ?? "core");
  const [query, setQuery] = useState("");
  const activeGroup = groups.find((group) => group.tier === activeTier) ?? groups[0];
  const normalizedQuery = normalizeSearch(query);

  const visibleEntries = useMemo(() => {
    if (!activeGroup) return [];
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return activeGroup.parts.map((part) => ({ part, group: activeGroup }));
    }

    return groups.flatMap((group) =>
      group.parts
        .filter((part) => {
          const target = normalizeSearch(part.searchText);
          return tokens.every((token) => target.includes(token));
        })
        .map((part) => ({ part, group })),
    );
  }, [activeGroup, groups, normalizedQuery]);

  if (!activeGroup) return null;

  return (
    <section aria-labelledby="manners-guide-list-heading" className="mt-10">
      <div className="border-y border-[#c7d1c2] bg-white/55 px-4 py-5 sm:px-5">
        <label htmlFor="manners-guide-search" className="block text-[13px] font-semibold text-[#243832]">
          필요한 내용 검색
        </label>
        <input
          id="manners-guide-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="예: 상견례, 축의금, 혼인신고"
          className="mt-2 min-h-11 w-full rounded-xl border border-[#243832]/20 bg-[#fbf8f2] px-3.5 text-[15px] text-[#243832] outline-none placeholder:text-[#53645e]/65 focus:border-[#6d806e] focus:ring-2 focus:ring-[#6d806e]/20"
        />

        <div role="group" aria-label="가이드 범위" className="mt-4 grid grid-cols-3 gap-2">
          {groups.map((group) => {
            const selected = group.tier === activeTier;
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setActiveTier(group.tier);
                  setQuery("");
                }}
                className={`min-h-11 rounded-xl border px-2 py-2 text-[12.5px] font-semibold leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6d806e] focus-visible:ring-offset-2 sm:text-[13px] ${
                  selected
                    ? "border-[#36534e] bg-[#36534e] text-white"
                    : "border-[#c7d1c2] bg-[#fbf8f2] text-[#36534e] hover:border-[#6d806e] hover:bg-[#f7faf5]"
                }`}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-7">
        <p className="text-[11.5px] font-semibold tracking-[0.12em] text-[#8F5150]">
          {normalizedQuery
            ? "SEARCH ALL GUIDES"
            : activeGroup.tier === "core"
              ? "START HERE"
              : activeGroup.tier === "lifecycle"
                ? "AFTER THE WEDDING"
                : "WHEN IT APPLIES"}
        </p>
        <h2 id="manners-guide-list-heading" className="mt-1 text-[22px] font-semibold text-[#243832]">
          {normalizedQuery ? "전체 가이드 검색 결과" : activeGroup.label}
        </h2>
        <p className="mt-1.5 max-w-[650px] text-[13.5px] leading-6 text-[#3d4a45]">
          {normalizedQuery
            ? "핵심·결혼 후 생활·상황별 안내를 모두 찾아봤어요. 각 결과에 해당 범위를 함께 표시합니다."
            : activeGroup.description}
        </p>
        <p aria-live="polite" className="mt-2 text-[12px] text-[#53645e]">
          {normalizedQuery ? `검색 결과 ${visibleEntries.length}개` : `가이드 ${visibleEntries.length}개`}
        </p>
      </div>

      {visibleEntries.length > 0 ? (
        <ul className="mt-3 border-y border-[#243832]/15">
          {visibleEntries.map(({ part, group }) => (
            <li key={part.slug} className="border-b border-[#243832]/10 last:border-b-0">
              <Link
                href={`/wedding/manners/${part.slug}`}
                prefetch={false}
                className="group flex min-h-11 items-center justify-between gap-4 px-1 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6d806e] focus-visible:ring-offset-2 sm:px-2"
              >
                <span>
                  <span className="block text-[11.5px] font-semibold tracking-wide text-[#53645e]">
                    {normalizedQuery ? `${group.label} · ` : ""}
                    {AUDIENCE_LABEL[part.audience]}
                  </span>
                  <span className="mt-1 block text-[16px] font-semibold leading-snug text-[#243832] group-hover:text-[#8F5150]">
                    {part.title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-[1.65] text-[#3d4a45]/85">
                    {part.subtitle}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-[18px] text-[#6d806e] transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 border-y border-[#243832]/12 bg-[#fbf8f2] px-4 py-6 text-center">
          <p className="text-[14px] font-semibold text-[#243832]">찾은 가이드가 없어요.</p>
          <p className="mt-1 text-[13px] leading-6 text-[#53645e]">검색어를 줄이거나 다른 표현으로 찾아보세요.</p>
        </div>
      )}
    </section>
  );
}
