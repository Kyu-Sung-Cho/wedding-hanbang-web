"use client";

import { ExternalLink, Globe, Search } from "lucide-react";
import {
  getWebLookupPageCard,
  getWebLookupSearchCard,
  WEB_LOOKUP_COPY,
} from "@hanbang/shared/web-lookup-presentation";
import type { ToolExecutionResult } from "@/types/database.types";

/**
 * 찾아보기 카드(웹). 칸과 문장은 `@hanbang/shared/web-lookup-presentation` 이 정한다 — 앱 카드와 같다.
 * 검색 결과는 네이버 순서 그대로이고 순위 번호·별점·후기를 붙이지 않는다(D-85, D-14 조건).
 */

const CARD_SHELL = "rounded-[6px] border border-[#F5F0E8] bg-white shadow-sm w-full max-w-[520px] overflow-hidden";

function NoteCard({ icon, title, body }: { icon: "search" | "page"; title: string; body: string }) {
  const Icon = icon === "search" ? Search : Globe;
  return (
    <div className="flex justify-start ml-14 my-2">
      <div role="note" className="rounded-[6px] border border-[#F5F0E8] bg-gradient-to-br from-[#FAF7F2] to-white px-5 py-4 shadow-sm max-w-[440px]">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
            <Icon className="h-5 w-5 text-rose-700" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--hb-text-strong)]">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-body)]">{body}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebLookupSearchCardView({ result }: { result: ToolExecutionResult }) {
  const card = getWebLookupSearchCard(result.toolOutput, result.success);
  if (!card) return null;
  if (card.kind !== "results") return <NoteCard icon="search" title={card.title} body={card.body} />;
  const { columns } = WEB_LOOKUP_COPY;
  return (
    <div className="flex justify-start ml-14 my-2" data-testid="web-lookup-search-card">
      <section className={CARD_SHELL} aria-label={card.title}>
        <header className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
            <Search className="h-5 w-5 text-rose-700" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--hb-text-strong)]">{card.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--hb-text-muted)]">{card.subtitle}</p>
          </div>
        </header>
        <table className="w-full table-fixed border-t border-black/[0.06] text-left text-sm">
          <thead className="bg-[#FAF7F2] text-xs text-[var(--hb-text-muted)]">
            <tr>
              <th scope="col" className="w-[58%] px-4 py-2 font-medium sm:w-[44%]">{columns.name}</th>
              {/* 좁은 화면에서는 지역 칸을 숨기고 이름 아래 줄로 옮긴다(375px 에서 글자가 세로로 쪼개졌다). */}
              <th scope="col" className="hidden w-[18%] px-2 py-2 font-medium sm:table-cell">{columns.area}</th>
              <th scope="col" className="px-4 py-2 font-medium">{columns.page}</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row) => (
              <tr key={row.ref || row.name} className="border-t border-black/[0.05] align-top">
                <td className="px-4 py-2.5">
                  <p className="break-words font-semibold text-[var(--hb-text-strong)]">{row.name}</p>
                  {(row.category || row.telephone) && (
                    <p className="mt-0.5 text-xs text-[var(--hb-text-muted)]">
                      {[row.category, row.telephone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {row.area && <p className="mt-0.5 text-xs text-[var(--hb-text-muted)] sm:hidden">{row.area}</p>}
                  {row.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-[var(--hb-text-muted)]">{row.description}</p>
                  )}
                </td>
                <td className="hidden px-2 py-2.5 text-[var(--hb-text-body)] sm:table-cell">{row.area ?? "-"}</td>
                <td className="px-4 py-2.5">
                  {row.href ? (
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex max-w-full items-center gap-1 break-all text-[var(--color-rose-700)] underline-offset-2 hover:underline"
                    >
                      <span className="truncate">{row.hrefLabel ?? columns.page}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-[var(--hb-text-muted)]">-</span>
                  )}
                  {row.href && !row.readable && (
                    <p className="mt-0.5 text-[11px] text-[var(--hb-text-muted)]">{WEB_LOOKUP_COPY.linkOnly}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="border-t border-black/[0.05] bg-[#FAFAF8] px-4 py-2.5 text-xs text-[var(--hb-text-muted)]">
          <p>{WEB_LOOKUP_COPY.verifyNote}</p>
          <p className="mt-1">
            출처: {WEB_LOOKUP_COPY.sourceName}
            {card.naverHref && (
              <>
                {" · "}
                <a href={card.naverHref} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--hb-success)] hover:underline">
                  {WEB_LOOKUP_COPY.openNaver}
                </a>
              </>
            )}
          </p>
        </footer>
      </section>
    </div>
  );
}

export function WebLookupPageCardView({ result }: { result: ToolExecutionResult }) {
  const card = getWebLookupPageCard(result.toolOutput, result.success);
  if (!card) return null;
  if (card.kind === "failed") return <NoteCard icon="page" title={card.title} body={card.body} />;
  const { columns } = WEB_LOOKUP_COPY;
  return (
    <div className="flex justify-start ml-14 my-2" data-testid="web-lookup-page-card">
      <section className={CARD_SHELL} aria-label={card.title}>
        <header className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C4967E]/15">
            <Globe className="h-5 w-5 text-rose-700" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--hb-text-strong)]">{card.title}</p>
            {card.pageTitle && <p className="mt-0.5 truncate text-sm text-[var(--hb-text-body)]">{card.pageTitle}</p>}
            {card.subtitle && <p className="mt-1 text-xs text-[var(--hb-text-muted)]">{card.subtitle}</p>}
          </div>
        </header>
        <table className="w-full table-fixed border-t border-black/[0.06] text-left text-sm">
          <thead className="bg-[#FAF7F2] text-xs text-[var(--hb-text-muted)]">
            <tr>
              <th scope="col" className="w-[45%] px-4 py-2 font-medium">{columns.item}</th>
              <th scope="col" className="px-4 py-2 font-medium">{columns.price}</th>
            </tr>
          </thead>
          <tbody>
            {card.priceCell ? (
              <tr className="border-t border-black/[0.05]">
                <td className="px-4 py-2.5 text-[var(--hb-text-body)]">{columns.price}</td>
                <td className="px-4 py-2.5 font-semibold text-[var(--hb-text-strong)]">{card.priceCell}</td>
              </tr>
            ) : card.prices.map((price, index) => (
              <tr key={`${price.label}-${price.amount}-${index}`} className="border-t border-black/[0.05] align-top">
                <td className="px-4 py-2.5 text-[var(--hb-text-body)]">{price.label}</td>
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-[var(--hb-text-strong)]">{price.amount}</p>
                  {price.quote && <p className="mt-0.5 break-words text-xs text-[var(--hb-text-muted)]">{price.quote}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="flex items-center justify-between gap-3 border-t border-black/[0.05] bg-[#FAFAF8] px-4 py-2.5 text-xs text-[var(--hb-text-muted)]">
          <p className="min-w-0">{card.note}</p>
          {card.href && (
            <a
              href={card.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-[var(--color-rose-700)] hover:underline"
            >
              {WEB_LOOKUP_COPY.openPage}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </footer>
      </section>
    </div>
  );
}
