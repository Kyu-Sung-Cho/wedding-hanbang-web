import Link from "next/link";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { readingMinutesOf } from "@/lib/manners/readingTime";
import { weddingLinkProps } from "@/lib/weddingPaths";

/**
 * 결혼 예절 안내 본문 렌더러. 서버 전용이고 클라이언트 JS가 0이다.
 *
 * 삭제된 원본 화면(`EtiquetteClient.tsx` 1,307줄)은 절반이 체크박스·메모·일정 팝오버였다.
 * 그건 지금 체크리스트·일정 화면이 이미 하는 일이라 여기서 다시 만들지 않는다.
 * 이 화면은 **읽는 곳**이고, 실행은 아모라와 일정으로 넘긴다.
 */

/**
 * 「하면 편해요」와 「조심하세요」는 **다르게 보여야 한다.**
 *
 * 예전 값은 안쪽 색이 서로 ΔE 1.57 이었다 — 사람이 색 차이를 알아채는 문턱(약 2.3) 아래다.
 * 라벨 색까지 둘 다 `#8F5150` 이라, 나란히 붙어 있는 30곳에서 같은 상자 두 개로 보였다.
 * 경고는 이 코퍼스에서 가장 중요한 블록인데 팁과 구별되지 않았다.
 *
 * 색만으로 구별하게 두지는 않는다 — 라벨 문구가 이미 비색 신호다(WCAG 1.4.1).
 */
/**
 * 목차와 제목에 붙일 절 번호는 **위치로 매긴다.**
 *
 * 25편 중 제목에 번호를 직접 적어 둔 것은 5편뿐이다(`invitation-sending`, `cost-saving` 등).
 * 그래서 어떤 편은 「1. 먼저 할 일」로, 어떤 편은 「가져갈 것」으로 보여 목록의 생김새가
 * 편마다 달랐고, 11개짜리 긴 편에서 지금 어디쯤인지 알 수 없었다.
 *
 * 원본 제목에 이미 번호가 있으면 **표시할 때만** 벗기고 위치 번호를 붙인다. 원본은 그대로
 * 둔다 — 그 문자열이 `noteSources` 의 절 조회 키다(벗긴 값을 키로 쓰면 링크가 통째로 깨진다).
 */
function sectionLabel(heading: string): string {
  return heading.replace(/^[0-9]+[.] */, "");
}

const BLOCK_TONE = {
  tip: {
    label: "이렇게 하면 편해요",
    box: "border-[var(--hb-primary)]/25 bg-[var(--hb-primary)]/[0.05]",
    labelColor: "text-[var(--hb-text-strong)]",
  },
  warning: {
    label: "이건 조심하세요",
    box: "border-[#B4785F]/55 bg-[#B4785F]/[0.13]",
    labelColor: "text-[#8a4f36]",
  },
} as const;

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2.5 space-y-2.5">
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
        {block.title ? <h4 className="text-[14px] font-semibold text-[var(--hb-text-strong)]">{block.title}</h4> : null}
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "tip" || block.kind === "warning") {
    const tone = BLOCK_TONE[block.kind];
    return (
      <div className={`rounded-[6px] border px-4 py-3 ${tone.box}`}>
        <p className={`text-[12px] font-semibold ${tone.labelColor}`}>
          {block.title ?? tone.label}
        </p>
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "dialogue") {
    // 이 제품의 값은 "예의를 지키세요"가 아니라 실제로 할 수 있는 문장이다.
    return (
      <div className="rounded-[6px] border border-[var(--hb-primary)]/12 bg-white/70 px-4 py-3">
        <p className="text-[12px] font-semibold text-[var(--hb-text-strong)]/70">
          {block.title ?? "이렇게 말할 수 있어요"}
        </p>
        <div className="mt-2.5 space-y-3">
          {block.lines.map((line) => (
            <div key={line.say}>
              <p className="text-[14px] leading-[1.7] text-[var(--hb-text-strong)]">
                <span aria-hidden className="mr-1.5 text-[#8F5150]">“</span>
                {line.say}
                <span aria-hidden className="ml-1 text-[#8F5150]">”</span>
              </p>
              {line.note ? (
                <p className="mt-1 text-[12.5px] leading-[1.6] text-[var(--hb-text-muted)]">{line.note}</p>
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
    <figure className="rounded-[6px] border border-[var(--hb-primary)]/12 bg-white/70">
      <figcaption className="border-b border-[var(--hb-primary)]/10 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-[14px] font-semibold text-[var(--hb-text-strong)]">{block.title}</p>
          {/* 시점을 제목 옆에 붙인다 — 표만 캡처해 옮겨도 기준 시점이 함께 간다. */}
          <span className="rounded-full bg-[var(--hb-primary)]/[0.06] px-2 py-0.5 text-[11.5px] font-medium text-[#3d4a45]">
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
          <p className="mt-2 text-[12px] leading-5 text-[var(--hb-text-muted)]">
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
            <tr className="border-b border-[var(--hb-primary)]/10">
              {block.columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-2.5 text-[12.5px] font-semibold text-[var(--hb-text-strong)]/75">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")} className="border-b border-[var(--hb-primary)]/6 last:border-0">
                {row.map((cell, index) => (
                  <td
                    key={`${row.join("|")}-${index}`}
                    className={`px-4 py-2.5 text-[13.5px] leading-[1.6] ${
                      index === 0 ? "font-medium text-[var(--hb-text-strong)]" : "text-[#3d4a45]"
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
      <div className="divide-y divide-[var(--hb-primary)]/10 sm:hidden">
        {block.rows.map((row) => (
          <dl key={row.join("|")} className="px-4 py-3.5">
            {row.map((cell, index) => (
              <div key={`${row.join("|")}-${index}`} className={index === 0 ? "" : "mt-2 grid grid-cols-[90px_1fr] gap-3"}>
                {index === 0 ? (
                  <>
                    <dt className="sr-only">{block.columns[index]}</dt>
                    <dd className="text-[14px] font-semibold leading-6 text-[var(--hb-text-strong)]">{cell}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-[11.5px] font-semibold leading-5 text-[var(--hb-text-muted)]">{block.columns[index]}</dt>
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
  const primaryCategory = categoryKeys[0];
  const checklistLabel = primaryCategory
    ? PLANNING_CATEGORY_LABELS[primaryCategory as keyof typeof PLANNING_CATEGORY_LABELS]
    : null;
  const lastCheckedAt = part.sources
    .map((source) => source.checkedAt)
    .sort()
    .at(-1);
  const readingMinutes = readingMinutesOf(part.sections);

  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[220px_minmax(0,760px)] lg:items-start lg:justify-center">
      {/*
        목차는 **읽는 동안에도 닿아야 한다.**

        예전에는 모바일에서 글 맨 위 가로 칩 줄이라 스크롤하면 사라졌다. 「축의금」은 절이
        11개이고 실제로 17분짜리인데, 6절을 읽다가 3절로 돌아가려면 맨 위까지 올라가야 했다.
        모바일이 주 제품이므로 그쪽이 기준이다. 상단 헤더는 고정이 아니라(`manners/layout.tsx`)
        `top-0` 이 안전하다.
      */}
      <aside
        className="sticky top-0 z-20 -mx-4 border-b border-[var(--hb-primary)]/10 bg-[#fffdf8]/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:top-[92px] lg:z-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none"
        aria-label="이 글의 목차"
      >
        <p className="hidden text-[12px] font-semibold text-[#8F5150] lg:block">이 글에서 바로 찾기</p>
        <nav className="flex gap-2 overflow-x-auto pb-1 lg:mt-3 lg:flex-col lg:overflow-visible lg:pb-2">
          {part.sections.map((section, index) => (
            <a
              key={section.heading}
              href={`#section-${index + 1}`}
              className="shrink-0 rounded-[6px] border border-[var(--hb-primary)]/12 bg-white px-3 py-2 text-[12.5px] font-medium text-[#3d4a45] hover:border-[#8F5150]/40 hover:text-[#8F5150] lg:rounded-[6px] lg:border-0 lg:border-l lg:bg-transparent lg:px-3 lg:py-1.5"
            >
              <span aria-hidden className="mr-1.5 text-[#8F5150]/70">{index + 1}</span>
              {sectionLabel(section.heading)}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0">
      <header>
        <p className="text-[12.5px] font-semibold tracking-wide text-[#8F5150]">{part.subtitle}</p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-snug text-[var(--hb-text-strong)] sm:text-[34px]">
          {part.title}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.8] text-[#3d4a45]">{part.description}</p>
        {/* 삭제 사유였던 "가족·지역마다 답이 다르다"에 대한 답이다. 접거나 흐리지 않는다. */}
        <p className="mt-4 rounded-[6px] border border-[var(--hb-primary)]/12 bg-[var(--hb-primary)]/[0.035] px-4 py-3 text-[13px] leading-[1.7] text-[#3d4a45]">
          {part.caveat}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#3d4a45]">
          <span>예상 읽기 {readingMinutes}분</span>
          <span>{lastCheckedAt ? `${lastCheckedAt} 출처 확인` : "관행 중심 편집 안내"}</span>
        </div>

        {/*
          긴 편은 **목차를 먼저 보여주고 시작한다.**

          모바일 375px 첫 화면 812px 중 본문이 59px(7%)뿐이었고, 그 59px 마저 caveat 와 첫
          절 제목이 이미 한 말("정답은 없습니다")을 네 번째로 반복하는 문장이었다. 여는 순간
          읽을 것이 없으니 나간다.

          상단 sticky 칩 띠가 있지만 gift-money 기준 실폭 1,776px 에 창은 343px — 11개 중
          2.3개만 보이고, 나머지는 가로로 밀어야 나온다. 그래서 **한 번은 세로로 전부** 보여준다.
          새 문구를 짓지 않았다 — 절 제목이 이미 라우터다("봉투 준비하기", "참석하지 못할 때",
          "받는 쪽 준비 — 접수와 보관").

          절이 적은 편에는 안 그린다. 세 줄짜리 목차는 자리만 차지한다.
        */}
        {part.sections.length >= 4 ? (
          <nav
            className="mt-5 rounded-[6px] border border-[var(--hb-primary)]/12 bg-white/60 px-4 py-3.5"
            aria-label="이 글의 차례"
          >
            <p className="text-[12px] font-semibold text-[#8F5150]">
              이 글에서 찾는 것부터 보세요
            </p>
            <ol className="mt-2.5 space-y-2">
              {part.sections.map((section, index) => (
                <li key={section.heading}>
                  <a
                    href={`#section-${index + 1}`}
                    className="flex gap-2.5 text-[14px] leading-[1.6] text-[#3d4a45] hover:text-[#8F5150]"
                  >
                    <span aria-hidden className="w-4 shrink-0 text-right text-[#8F5150]/70">
                      {index + 1}
                    </span>
                    <span className="underline decoration-[var(--hb-text-strong)]/15 underline-offset-4">
                      {sectionLabel(section.heading)}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </header>

      <div className="mt-8 divide-y divide-[var(--hb-primary)]/12">
        {part.sections.map((section, index) => (
          <section
            key={section.heading}
            id={`section-${index + 1}`}
            className="scroll-mt-28 py-7 first:pt-0"
          >
            <h2 className="text-[20px] font-semibold leading-snug text-[var(--hb-text-strong)]">
              <span aria-hidden className="mr-2 text-[#8F5150]/70">
                {index + 1}/{part.sections.length}
              </span>
              {sectionLabel(section.heading)}
            </h2>
            <div className="mt-3 space-y-4">
              {section.blocks.map((block, index) => (
                <Block key={`${section.heading}-${index}`} block={block} sources={part.sources} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/*
        「읽은 뒤 준비하기」는 **읽은 뒤에** 있어야 한다.

        모바일 375×812 첫 화면에서 이 블록이 134px(16.5%)를 먹고 있었고, 정작 본문은
        59px(7%)만 남았다. 자기 문구가 「읽은 뒤」인데 읽기 전에 서 있었다. 그리고 편 맨
        아래에는 나가는 링크가 0개라, 20화면을 내려온 사람이 갈 곳이 없었다.
        옮기면 두 문제가 같이 풀린다.
      */}
      <div className="mt-5 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-4">
        <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">읽은 뒤 준비하기</p>
        <p className="mt-1 text-[14px] leading-6 text-[#3d4a45]">
          {checklistLabel
            ? `${checklistLabel} 준비 항목을 열어 실제로 확인하고 저장할 수 있어요.`
            : "우리 상황에 맞게 적용할 부분만 아모라와 정리해 보세요."}
        </p>
        <Link
          {...weddingLinkProps(
            primaryCategory
              ? `/checklist?category=${encodeURIComponent(primaryCategory)}`
              : `/chat?${new URLSearchParams({ prefill: `${part.title} 내용을 우리 상황에 맞게 정리해줘` })}`,
          )}
          className="mt-3 inline-flex rounded-[6px] bg-[var(--hb-primary)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541]"
        >
          {checklistLabel ? `${checklistLabel} 체크리스트 열기` : "아모라에게 물어보기"}
        </Link>
      </div>

      <footer className="mt-10 border-t border-[var(--hb-primary)]/12 pt-5">
        <h2 className="text-[13px] font-semibold text-[var(--hb-text-strong)]">어디서 확인한 내용인가요</h2>
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
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--hb-text-muted)]">
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
