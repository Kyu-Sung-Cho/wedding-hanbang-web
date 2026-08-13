import Link from "next/link";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { buildMannersAmoraChatPath } from "@/lib/manners/amoraContract";
import { CHECKLIST_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { CHECKLIST_CATEGORY_GUIDES } from "@hanbang/shared/checklist-guides";
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

const SOURCE_KIND_META = {
  official: {
    label: "공식 근거",
    className: "border-[#36534E]/20 bg-[#E9F1E8] text-[#36534E]",
  },
  original: {
    label: "기관 원문",
    className: "border-[#526A64]/20 bg-[#EEF2F0] text-[#405A54]",
  },
  secondary: {
    label: "보도·2차 근거",
    className: "border-[#9A6A50]/25 bg-[#F7EFE7] text-[#76513F]",
  },
} as const satisfies Record<MannersSource["kind"], { label: string; className: string }>;

function SourceKindBadge({ kind }: { kind: MannersSource["kind"] }) {
  const meta = SOURCE_KIND_META[kind];
  return (
    <span
      data-source-kind={kind}
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[15px] leading-[1.75] text-[#3d4a45]">
          <span aria-hidden className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#7D5753]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ block, sources }: { block: MannersBlock; sources: MannersSource[] }) {
  if (block.kind === "paragraph") {
    return <p className="text-[15px] leading-[1.85] text-[#3d4a45]">{block.text}</p>;
  }

  if (block.kind === "checklist") {
    return (
      <div>
        {block.title ? <h3 className="text-[15px] font-semibold text-[#243832]">{block.title}</h3> : null}
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "tip" || block.kind === "warning") {
    const tone = BLOCK_TONE[block.kind];
    return (
      <div className={`rounded-xl border px-4 py-3 ${tone.box}`}>
        <h3 className="text-[13px] font-semibold tracking-wide text-[#7D5753]">
          {block.title ?? tone.label}
        </h3>
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "dialogue") {
    // 이 제품의 값은 "예의를 지키세요"가 아니라 실제로 할 수 있는 문장이다.
    return (
      <div className="rounded-xl border border-[#243832]/12 bg-white/70 px-4 py-3">
        <h3 className="text-[13px] font-semibold tracking-wide text-[#36534E]">
          {block.title ?? "이렇게 말할 수 있어요"}
        </h3>
        <div className="mt-2.5 space-y-3">
          {block.lines.map((line) => (
            <div key={line.say}>
              <p className="text-[15px] leading-[1.7] text-[#243832]">
                <span aria-hidden className="mr-1.5 text-[#7D5753]">“</span>
                {line.say}
                <span aria-hidden className="ml-1 text-[#7D5753]">”</span>
              </p>
              {line.note ? (
                <p className="mt-1 text-[14px] leading-[1.65] text-[#52605B]">{line.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.kind === "journeyMap") {
    return (
      <section
        aria-labelledby="planning-journey-map-title"
        className="rounded-2xl border border-[#C7D1C2] bg-[#F7FAF5] px-4 py-4 sm:px-5"
      >
        <h3 id="planning-journey-map-title" className="text-[16px] font-semibold text-[#243832]">
          {block.title}
        </h3>
        <p className="mt-1.5 text-[14px] leading-[1.7] text-[#52605B]">{block.introduction}</p>
        <ol className="mt-4 space-y-4">
          {block.stages.map((stage) => (
            <li key={stage.title} className="rounded-xl border border-[#243832]/10 bg-white/80 px-4 py-4">
              <h4 className="text-[15px] font-semibold leading-6 text-[#243832]">{stage.title}</h4>
              <dl className="mt-2 space-y-2 text-[14px] leading-[1.7] text-[#3D4A45]">
                <div>
                  <dt className="font-semibold text-[#36534E]">먼저 정할 것</dt>
                  <dd>{stage.dependsOn}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#36534E]">실제 마감 기준</dt>
                  <dd>{stage.deadlineRule}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {stage.categoryKeys.map((categoryKey) => (
                  <Link
                    key={categoryKey}
                    {...weddingLinkProps(`/checklist/${encodeURIComponent(categoryKey)}`)}
                    className={`inline-flex min-h-11 items-center rounded-full border border-[#36534E]/25 bg-white px-3 py-2 text-[13px] font-semibold text-[#36534E] hover:bg-[#EDF3ED] ${INTERACTIVE_FOCUS}`}
                  >
                    {CHECKLIST_CATEGORY_LABELS[categoryKey]}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  // 표는 사용자가 캡처해서 옮긴다. 그래서 "관행"이라는 말이 표 안에 같이 붙어 있어야 한다.
  const citedSources = (block.sourceRefs ?? [])
    .map((ref) => sources[ref - 1])
    .filter((source): source is MannersSource => Boolean(source));
  const isSecondaryOnly =
    citedSources.length > 0 && citedSources.every((source) => source.kind === "secondary");

  return (
    <figure className="rounded-xl border border-[#243832]/12 bg-white/70">
      <figcaption className="border-b border-[#243832]/10 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-[15px] font-semibold text-[#243832]">{block.title}</h3>
          {/* 시점을 제목 옆에 붙인다 — 표만 캡처해 옮겨도 기준 시점이 함께 간다. */}
          <span className="rounded-full bg-[#243832]/[0.06] px-2 py-0.5 text-[12px] font-medium text-[#3d4a45]">
            {block.asOf}
          </span>
        </div>
        <p className="mt-1.5 text-[14px] leading-[1.65] text-[#52605B]">{block.caption}</p>
        {/* 이 숫자가 말하지 않는 것. 출처가 완벽해도 이게 없으면 오해가 남는다. */}
        <p className="mt-1.5 text-[13px] leading-[1.65] text-[#7D5753]">
          <span className="font-semibold">이 숫자가 말하지 않는 것 · </span>
          {block.limits}
        </p>
        {block.unsourced ? (
          <p className="mt-1.5 text-[13px] font-medium text-[#76513F]">
            공개된 검증 가능한 근거 자료를 아직 찾지 못했어요. 주변에서 흔히 말하는 범위로만 참고해 주세요.
          </p>
        ) : citedSources.length > 0 ? (
          <div className="mt-2 space-y-2 text-[13px] leading-5 text-[#52605B]">
            {isSecondaryOnly ? (
              <p
                data-evidence-basis="secondary-only"
                className="rounded-lg border border-[#9A6A50]/25 bg-[#F7EFE7] px-3 py-2 font-medium text-[#76513F]"
              >
                이 표는 보도·2차 자료만으로 확인했어요. 원조사 전문이 공개되면 표본과 계산 방식을 다시
                확인해야 해요.
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span>근거 ·</span>
              {citedSources.map((source) => (
                <span key={source.url} className="inline-flex items-center gap-1.5">
                  <SourceKindBadge kind={source.kind} />
                  <a href={source.url} target="_blank" rel="noreferrer noopener" className="rounded-sm font-medium text-[#7D5753] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]">
                    {source.label}
                  </a>
                </span>
              ))}
            </p>
          </div>
        ) : null}
      </figcaption>
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[#243832]/10">
              {block.columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-2.5 text-[13px] font-semibold text-[#36534E]">
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
                    className={`px-4 py-2.5 text-[14px] leading-[1.65] ${
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
                    <dd className="text-[15px] font-semibold leading-6 text-[#243832]">{cell}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-[12px] font-semibold leading-5 text-[#52605B]">{block.columns[index]}</dt>
                    <dd className="text-[14px] leading-6 text-[#3d4a45]">{cell}</dd>
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

const INTERACTIVE_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]";

function SectionLinks({ part, desktop = false }: { part: MannersPart; desktop?: boolean }) {
  return (
    <ol className={desktop ? "space-y-1" : "space-y-0.5"}>
      {part.sections.map((section, index) => (
        <li key={section.heading}>
          <a
            href={`#section-${index + 1}`}
            className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-[14px] font-medium leading-5 text-[#3d4a45] hover:bg-[#F7F1E8] hover:text-[#7D5753] ${INTERACTIVE_FOCUS} ${
              desktop ? "border-l-2 border-transparent hover:border-[#A77B74]" : ""
            }`}
          >
            <span aria-hidden className="mr-2 tabular-nums text-[12px] text-[#52605B]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{section.heading}</span>
            {section.visibility === "conditional" ? (
              <span className="ml-auto rounded-full bg-[#F2E8DF] px-2 py-0.5 text-[11px] font-semibold text-[#76513F]">
                조건부
              </span>
            ) : null}
          </a>
        </li>
      ))}
    </ol>
  );
}

function ChecklistLink({ categoryKey, label }: { categoryKey: string; label: string }) {
  return (
    <Link
      {...weddingLinkProps(`/checklist/${encodeURIComponent(categoryKey)}`)}
      className={`inline-flex min-h-11 items-center rounded-full bg-[#36534E] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2B4541] ${INTERACTIVE_FOCUS}`}
    >
      {label} 체크리스트
    </Link>
  );
}

function SectionBlocks({ part, sectionIndex }: { part: MannersPart; sectionIndex: number }) {
  const section = part.sections[sectionIndex];
  if (!section) return null;

  return (
    <div className="mt-3 space-y-4">
      {section.blocks.map((block, blockIndex) => (
        <Block key={`${section.heading}-${blockIndex}`} block={block} sources={part.sources} />
      ))}
    </div>
  );
}

export default function MannersPartView({ part }: { part: MannersPart }) {
  // 상세 화면은 대표 링크 하나가 아니라 체크리스트 정본에 이 가이드를 연결한 모든 분야를 보여준다.
  const categoryKeys = [
    ...new Set(
      Object.values(CHECKLIST_CATEGORY_GUIDES)
        .filter((guide) => guide.relatedMannersSlugs.includes(part.slug))
        .map((guide) => guide.categoryKey),
    ),
  ];
  const amoraChatPath = buildMannersAmoraChatPath(part.slug);
  const checklistLinks = categoryKeys.map((categoryKey) => ({
    categoryKey,
    label: CHECKLIST_CATEGORY_LABELS[categoryKey],
  }));
  const firstChecklistLinks = checklistLinks.slice(0, 3);
  const remainingChecklistLinks = checklistLinks.slice(3);
  const lastCheckedAt = part.sources
    .map((source) => source.checkedAt)
    .sort()
    .at(-1);
  const readingMinutes = Math.max(3, Math.ceil(JSON.stringify(part.sections).length / 1800));

  return (
    <div
      id="manners-top"
      className="mx-auto grid w-full max-w-[1120px] gap-6 px-5 py-8 sm:px-6 sm:py-10 lg:grid-cols-[220px_minmax(0,760px)] lg:items-start lg:justify-center lg:gap-8"
    >
      <aside className="lg:sticky lg:top-[92px]">
        <details className="group rounded-xl border border-[#243832]/15 bg-white/80 lg:hidden">
          <summary
            className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-[#243832] [&::-webkit-details-marker]:hidden ${INTERACTIVE_FOCUS}`}
          >
            <span>목차 · {part.sections.length}개 주제</span>
            <span aria-hidden className="text-[#6D806E] transition-transform duration-200 group-open:rotate-180">
              ↓
            </span>
          </summary>
          <nav aria-label="이 글의 목차" className="border-t border-[#243832]/10 px-2 py-2">
            <SectionLinks part={part} />
          </nav>
        </details>

        <div className="hidden lg:block">
          <p className="text-[13px] font-semibold tracking-[0.08em] text-[#7D5753]">
            이 글에서 바로 찾기
          </p>
          <nav aria-label="이 글의 목차" className="mt-3">
            <SectionLinks part={part} desktop />
          </nav>
        </div>
      </aside>

      <article className="min-w-0">
        <header>
          <p className="text-[14px] font-semibold tracking-wide text-[#7D5753]">{part.subtitle}</p>
          <h1 className="mt-1.5 text-3xl font-semibold leading-snug text-[#1B1C1C] sm:text-4xl">
            {part.title}
          </h1>
          <p className="mt-3 text-base leading-[1.8] text-[#3D4A45]">{part.description}</p>
          <section
            aria-labelledby={`part-summary-${part.slug}`}
            className="mt-5 border-y border-[#C7D1C2] bg-[#F7FAF5] px-4 py-4 sm:px-5"
          >
            <h2
              id={`part-summary-${part.slug}`}
              className="text-[14px] font-semibold tracking-[0.08em] text-[#36534E]"
            >
              한눈에 보기
            </h2>
            <ul className="mt-2.5 space-y-2">
              {part.summary.map((item) => (
                <li key={item} className="flex gap-2.5 text-[15px] leading-6 text-[#31423D]">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#6D806E]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
          {/* 가족·지역마다 답이 다르다는 한계를 접거나 흐리지 않는다. */}
          <p className="mt-4 rounded-xl border border-[#243832]/15 bg-[#243832]/[0.035] px-4 py-3 text-[15px] leading-[1.7] text-[#3D4A45]">
            {part.caveat}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#52605B]">
            <span>예상 읽기 {readingMinutes}분</span>
            <span>{lastCheckedAt ? `${lastCheckedAt} 출처 확인` : "관행 중심 편집 안내"}</span>
          </div>
          <section
            aria-labelledby={`part-actions-${part.slug}`}
            className="mt-5 rounded-2xl border border-[#EADFC9] bg-[#FFFDF7] px-4 py-4"
          >
            <h2
              id={`part-actions-${part.slug}`}
              className="text-[13px] font-semibold tracking-wide text-[#76513F]"
            >
              읽은 뒤 준비하기
            </h2>
            <p className="mt-1 text-[15px] leading-6 text-[#3D4A45]">
              {checklistLinks.length > 0
                ? "관련 준비 항목을 확인하고, 우리 상황에 적용할 부분은 아모라와 정리해 보세요."
                : "우리 상황에 맞게 적용할 부분을 아모라와 정리해 보세요."}
            </p>
            {firstChecklistLinks.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {firstChecklistLinks.map(({ categoryKey, label }) => (
                  <ChecklistLink key={categoryKey} categoryKey={categoryKey} label={label} />
                ))}
              </div>
            ) : null}
            {remainingChecklistLinks.length > 0 ? (
              <details className="group mt-2">
                <summary
                  className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-[#36534E] hover:bg-[#F7F1E8] [&::-webkit-details-marker]:hidden ${INTERACTIVE_FOCUS}`}
                >
                  체크리스트 {remainingChecklistLinks.length}개 더 보기
                  <span aria-hidden className="transition-transform duration-200 group-open:rotate-180">
                    ↓
                  </span>
                </summary>
                <div className="hidden flex-wrap gap-2 pb-1 pt-1 group-open:flex">
                  {remainingChecklistLinks.map(({ categoryKey, label }) => (
                    <ChecklistLink key={categoryKey} categoryKey={categoryKey} label={label} />
                  ))}
                </div>
              </details>
            ) : null}
            <div className={`${checklistLinks.length > 0 ? "mt-4 border-t border-[#EADFC9] pt-4" : "mt-3"}`}>
              <p className="text-[14px] leading-6 text-[#52605B]">
                아모라가 이 가이드의 검증된 요약과 주의점을 바탕으로 질문을 이어가요.
              </p>
              <Link
                {...weddingLinkProps(amoraChatPath)}
                className={`mt-2.5 inline-flex min-h-11 items-center rounded-full bg-[#8F6662] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#7D5753] ${INTERACTIVE_FOCUS}`}
              >
                아모라로 우리 상황에 적용
              </Link>
            </div>
          </section>
        </header>

        <div className="mt-8 space-y-10">
          {part.sections.map((section, index) => {
            const sectionProps = {
              id: `section-${index + 1}`,
              tabIndex: -1,
              className:
                "scroll-mt-24 rounded-sm target:outline-2 target:outline-offset-4 target:outline-[#C7D1C2] focus:outline-none",
            } as const;

            if (section.visibility === "conditional") {
              return (
                <section key={section.heading} {...sectionProps}>
                  <details className="group rounded-xl border border-[#C7D1C2] bg-[#FBF8F2] px-4">
                    <summary
                      className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 [&::-webkit-details-marker]:hidden ${INTERACTIVE_FOCUS}`}
                    >
                      <span role="heading" aria-level={2}>
                        <span className="block text-[12px] font-semibold tracking-wide text-[#7D5753]">
                          해당할 때만
                        </span>
                        <span className="mt-0.5 block text-lg font-semibold leading-snug text-[#243832]">
                          {section.heading}
                        </span>
                      </span>
                      <span aria-hidden className="shrink-0 text-[#6D806E] transition-transform group-open:rotate-180">
                        ↓
                      </span>
                    </summary>
                    <div className="border-t border-[#243832]/10 pb-4">
                      <SectionBlocks part={part} sectionIndex={index} />
                    </div>
                  </details>
                </section>
              );
            }

            return (
              <section key={section.heading} {...sectionProps}>
                <h2 className="text-xl font-semibold leading-snug text-[#243832]">{section.heading}</h2>
                <SectionBlocks part={part} sectionIndex={index} />
              </section>
            );
          })}
        </div>

        <footer className="mt-10 border-t border-[#243832]/15 pt-5">
          <h2 className="text-base font-semibold text-[#243832]">어디서 확인한 내용인가요</h2>
          {part.sources.length === 0 ? (
            <p className="mt-2 text-[14px] leading-[1.7] text-[#3D4A45]">
              이 페이지에는 공개된 검증 가능한 근거 자료로 확인한 수치가 아직 없어요. 금액이나 법적 절차는
              해당 기관 안내를 직접 확인해 주세요.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[13px] leading-5 text-[#52605B]">
                공식 근거는 정부·공공기관 자료, 기관 원문은 해당 기관이 직접 낸 안내, 보도·2차는 제3자가
                원자료를 인용하거나 요약한 자료예요.
              </p>
              <ul className="mt-3 space-y-3">
                {part.sources.map((source) => (
                  <li key={source.url} className="text-[14px] leading-[1.7] text-[#3D4A45]">
                    <span className="mr-1.5 inline-flex align-middle">
                      <SourceKindBadge kind={source.kind} />
                    </span>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`rounded-sm font-medium text-[#7D5753] underline underline-offset-2 ${INTERACTIVE_FOCUS}`}
                  >
                    {source.label}
                  </a>
                  <span className="text-[#52605B]">
                    {" · "}
                    {source.scope}
                    {" · "}
                    {source.checkedAt} 확인
                  </span>
                  <p className="mt-0.5 text-[13px] leading-5 text-[#52605B]">
                    뒷받침하는 내용 · {source.supports}
                  </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <a
            href="#manners-top"
            className={`mt-6 inline-flex min-h-11 items-center rounded-lg px-2 text-[14px] font-semibold text-[#36534E] hover:bg-[#F7F1E8] ${INTERACTIVE_FOCUS}`}
          >
            맨 위로 돌아가기 ↑
          </a>
        </footer>
      </article>
    </div>
  );
}
