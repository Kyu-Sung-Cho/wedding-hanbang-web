import Link from "next/link";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { CHECKLIST_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { weddingLinkProps } from "@/lib/weddingPaths";

/**
 * 결혼 예절 안내 본문 렌더러. 서버 전용이고 클라이언트 JS가 0이다.
 *
 * 삭제된 원본 화면(`EtiquetteClient.tsx` 1,307줄)은 절반이 체크박스·메모·일정 팝오버였다.
 * 그건 지금 체크리스트·일정 화면이 이미 하는 일이라 여기서 다시 만들지 않는다.
 * 이 화면은 **읽는 곳**이고, 실행은 아모라와 일정으로 넘긴다.
 */

const BLOCK_TONE = {
  tip: { label: "이렇게 하면 편해요", box: "border-[#8F5150]/25 bg-[#8F5150]/[0.05]" },
  warning: { label: "이건 조심하세요", box: "border-[#B4785F]/35 bg-[#B4785F]/[0.07]" },
} as const;

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[14px] leading-[1.75] text-[#3d4a45]">
          <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#8F5150]/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ block, sources }: { block: MannersBlock; sources: MannersSource[] }) {
  if (block.kind === "paragraph") {
    return <p className="text-[14px] leading-[1.85] text-[#3d4a45]">{block.text}</p>;
  }

  if (block.kind === "checklist") {
    return (
      <div>
        {block.title ? <h4 className="text-[14px] font-semibold text-[#243832]">{block.title}</h4> : null}
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "tip" || block.kind === "warning") {
    const tone = BLOCK_TONE[block.kind];
    return (
      <div className={`rounded-xl border px-4 py-3 ${tone.box}`}>
        <p className="text-[12px] font-semibold tracking-wide text-[#8F5150]">
          {block.title ?? tone.label}
        </p>
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "dialogue") {
    // 이 제품의 값은 "예의를 지키세요"가 아니라 실제로 할 수 있는 문장이다.
    return (
      <div className="rounded-xl border border-[#243832]/12 bg-white/70 px-4 py-3">
        <p className="text-[12px] font-semibold tracking-wide text-[#243832]/70">
          {block.title ?? "이렇게 말할 수 있어요"}
        </p>
        <div className="mt-2.5 space-y-3">
          {block.lines.map((line) => (
            <div key={line.say}>
              <p className="text-[14px] leading-[1.7] text-[#243832]">
                <span aria-hidden className="mr-1.5 text-[#8F5150]">“</span>
                {line.say}
                <span aria-hidden className="ml-1 text-[#8F5150]">”</span>
              </p>
              {line.note ? (
                <p className="mt-1 text-[12.5px] leading-[1.6] text-[#3d4a45]/75">{line.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 표는 사용자가 캡처해서 옮긴다. 그래서 "관행"이라는 말이 표 안에 같이 붙어 있어야 한다.
  const citedSources = (block.sourceRefs ?? [])
    .map((ref) => sources[ref - 1])
    .filter((source): source is MannersSource => Boolean(source));

  return (
    <figure className="rounded-xl border border-[#243832]/12 bg-white/70">
      <figcaption className="border-b border-[#243832]/10 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-[14px] font-semibold text-[#243832]">{block.title}</p>
          {/* 시점을 제목 옆에 붙인다 — 표만 캡처해 옮겨도 기준 시점이 함께 간다. */}
          <span className="rounded-full bg-[#243832]/[0.06] px-2 py-0.5 text-[11.5px] font-medium text-[#3d4a45]">
            {block.asOf}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[#3d4a45]/80">{block.caption}</p>
        {/* 이 숫자가 말하지 않는 것. 출처가 완벽해도 이게 없으면 오해가 남는다. */}
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[#8F5150]">
          <span className="font-semibold">이 숫자가 말하지 않는 것 · </span>
          {block.limits}
        </p>
        {block.unsourced ? (
          <p className="mt-1.5 text-[12px] font-medium text-[#B4785F]">
            공개된 1차 자료를 아직 찾지 못했어요. 주변에서 흔히 말하는 범위로만 참고해 주세요.
          </p>
        ) : citedSources.length > 0 ? (
          <p className="mt-2 text-[12px] leading-5 text-[#3d4a45]/75">
            근거 · {citedSources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? ", " : ""}
                <a href={source.url} target="_blank" rel="noreferrer noopener" className="font-medium text-[#8F5150] underline underline-offset-2">
                  {source.label}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </figcaption>
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[#243832]/10">
              {block.columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-2.5 text-[12.5px] font-semibold text-[#243832]/75">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")} className="border-b border-[#243832]/6 last:border-0">
                {row.map((cell, index) => (
                  <td
                    key={`${row.join("|")}-${index}`}
                    className={`px-4 py-2.5 text-[13.5px] leading-[1.6] ${
                      index === 0 ? "font-medium text-[#243832]" : "text-[#3d4a45]"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-[#243832]/10 sm:hidden">
        {block.rows.map((row) => (
          <dl key={row.join("|")} className="px-4 py-3.5">
            {row.map((cell, index) => (
              <div key={`${row.join("|")}-${index}`} className={index === 0 ? "" : "mt-2 grid grid-cols-[90px_1fr] gap-3"}>
                {index === 0 ? (
                  <>
                    <dt className="sr-only">{block.columns[index]}</dt>
                    <dd className="text-[14px] font-semibold leading-6 text-[#243832]">{cell}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-[11.5px] font-semibold leading-5 text-[#243832]/60">{block.columns[index]}</dt>
                    <dd className="text-[13px] leading-5 text-[#3d4a45]">{cell}</dd>
                  </>
                )}
              </div>
            ))}
          </dl>
        ))}
      </div>
    </figure>
  );
}

export default function MannersPartView({ part }: { part: MannersPart }) {
  const categoryKeys = categoryKeysForMannersPart(part.slug);
  const checklistLinks = categoryKeys.map((categoryKey) => ({
    categoryKey,
    label: CHECKLIST_CATEGORY_LABELS[categoryKey as keyof typeof CHECKLIST_CATEGORY_LABELS],
  }));
  const lastCheckedAt = part.sources
    .map((source) => source.checkedAt)
    .sort()
    .at(-1);
  const readingMinutes = Math.max(3, Math.ceil(JSON.stringify(part.sections).length / 1800));

  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[220px_minmax(0,760px)] lg:items-start lg:justify-center">
      <aside className="lg:sticky lg:top-[92px]" aria-label="이 글의 목차">
        <p className="text-[12px] font-semibold tracking-[0.12em] text-[#8F5150]">이 글에서 바로 찾기</p>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
          {part.sections.map((section, index) => (
            <a
              key={section.heading}
              href={`#section-${index + 1}`}
              className="shrink-0 rounded-full border border-[#243832]/12 bg-white px-3 py-2 text-[12.5px] font-medium text-[#3d4a45] hover:border-[#8F5150]/40 hover:text-[#8F5150] lg:rounded-none lg:border-0 lg:border-l lg:bg-transparent lg:px-3 lg:py-1.5"
            >
              {section.heading}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0">
      <header>
        <p className="text-[12.5px] font-semibold tracking-wide text-[#8F5150]">{part.subtitle}</p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-snug text-[#1b1c1c] sm:text-[34px]">
          {part.title}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.8] text-[#3d4a45]">{part.description}</p>
        <section
          aria-labelledby={`part-summary-${part.slug}`}
          className="mt-5 border-y border-[#c7d1c2] bg-[#f7faf5] px-4 py-4 sm:px-5"
        >
          <p id={`part-summary-${part.slug}`} className="text-[12px] font-semibold tracking-[0.1em] text-[#36534e]">
            한눈에 보기
          </p>
          <ul className="mt-2.5 space-y-2">
            {part.summary.map((item) => (
              <li key={item} className="flex gap-2.5 text-[13.5px] leading-6 text-[#31423d]">
                <span aria-hidden className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d806e]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        {/* 삭제 사유였던 "가족·지역마다 답이 다르다"에 대한 답이다. 접거나 흐리지 않는다. */}
        <p className="mt-4 rounded-xl border border-[#243832]/12 bg-[#243832]/[0.035] px-4 py-3 text-[13px] leading-[1.7] text-[#3d4a45]">
          {part.caveat}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#3d4a45]/70">
          <span>예상 읽기 {readingMinutes}분</span>
          <span>{lastCheckedAt ? `${lastCheckedAt} 출처 확인` : "관행 중심 편집 안내"}</span>
        </div>
        <div className="mt-5 rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-4">
          <p className="text-[12px] font-semibold tracking-wide text-[#9d6f36]">읽은 뒤 준비하기</p>
          <p className="mt-1 text-[14px] leading-6 text-[#3d4a45]">
            {checklistLinks.length > 0
              ? "관련 준비 항목을 열어 실제로 확인하고 저장할 수 있어요."
              : "우리 상황에 맞게 적용할 부분만 아모라와 정리해 보세요."}
          </p>
          {checklistLinks.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {checklistLinks.map(({ categoryKey, label }) => (
                <Link
                  key={categoryKey}
                  {...weddingLinkProps(`/checklist/${encodeURIComponent(categoryKey)}`)}
                  className="inline-flex rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541]"
                >
                  {label} 체크리스트
                </Link>
              ))}
            </div>
          ) : (
            <Link
              {...weddingLinkProps(`/chat?${new URLSearchParams({ prefill: `${part.title} 내용을 우리 상황에 맞게 정리해줘` })}`)}
              className="mt-3 inline-flex rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541]"
            >
              아모라에게 물어보기
            </Link>
          )}
        </div>
      </header>

      <div className="mt-8 space-y-9">
        {part.sections.map((section, index) => (
          <section key={section.heading} id={`section-${index + 1}`} className="scroll-mt-24">
            <h2 className="text-[17px] font-semibold leading-snug text-[#243832]">{section.heading}</h2>
            <div className="mt-3 space-y-4">
              {section.blocks.map((block, index) => (
                <Block key={`${section.heading}-${index}`} block={block} sources={part.sources} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-[#243832]/12 pt-5">
        <h2 className="text-[13px] font-semibold text-[#243832]">어디서 확인한 내용인가요</h2>
        {part.sources.length === 0 ? (
          <p className="mt-2 text-[13px] leading-[1.7] text-[#3d4a45]">
            이 페이지에는 공개된 1차 자료로 확인한 수치가 아직 없어요. 금액이나 법적 절차는
            해당 기관 안내를 직접 확인해 주세요.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {part.sources.map((source) => (
              <li key={source.url} className="text-[13px] leading-[1.7] text-[#3d4a45]">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-[#8F5150] underline underline-offset-2"
                >
                  {source.label}
                </a>
                <span className="text-[#3d4a45]/75">
                  {" · "}
                  {source.scope}
                  {" · "}
                  {source.checkedAt} 확인
                </span>
                <p className="mt-0.5 text-[12px] leading-5 text-[#3d4a45]/70">
                  뒷받침하는 내용 · {source.supports}
                </p>
              </li>
            ))}
          </ul>
        )}
      </footer>
      </article>
    </div>
  );
}
