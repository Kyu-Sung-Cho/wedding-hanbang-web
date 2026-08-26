import Link from "next/link";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { weddingLinkProps } from "@/lib/weddingPaths";

/**
 * 이 글을 읽는 데 실제로 걸리는 시간.
 *
 * 예전에는 `JSON.stringify(part.sections).length / 1800` 이었는데 두 곳에서 틀렸다.
 *
 *   1. **JSON 길이를 셌다.** 따옴표·중괄호·`"kind"` 같은 키 이름까지 글자로 세어
 *      실제 본문보다 1.36배 부풀었다(25편 실측).
 *   2. **분당 1,800자를 가정했다.** 한국어 묵독은 그 3분의 1 수준이고, 이 글에는 표와
 *      목록이 섞여 있어 더 느리다.
 *
 * 둘이 곱해져 **화면이 실제의 절반을 표시했다.** 「축의금」은 8분이라고 적혀 있었지만
 * 실제로는 10,377자짜리다. 8분인 줄 알고 연 사람이 17분을 쓰게 되고, 그 사람은 다음에
 * 이 가이드를 안 연다. 예상 시간은 장식이 아니라 **읽을지 말지를 정하는 숫자**다.
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

const KOREAN_CHARS_PER_MINUTE = 600;

/** 사람이 읽는 글자만 센다 — 블록 종류나 근거 번호는 화면에 글로 나오지 않는다. */
function readableCharCount(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + readableCharCount(item), 0);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<number>(
      (sum, [key, item]) =>
        key === "kind" || key === "sourceRefs" || key === "unsourced"
          ? sum
          : sum + readableCharCount(item),
      0,
    );
  }
  return 0;
}
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
  const primaryCategory = categoryKeys[0];
  const checklistLabel = primaryCategory
    ? PLANNING_CATEGORY_LABELS[primaryCategory as keyof typeof PLANNING_CATEGORY_LABELS]
    : null;
  const lastCheckedAt = part.sources
    .map((source) => source.checkedAt)
    .sort()
    .at(-1);
  const readingMinutes = Math.max(
    1,
    Math.round(readableCharCount(part.sections) / KOREAN_CHARS_PER_MINUTE),
  );

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
        className="sticky top-0 z-20 -mx-4 border-b border-[#243832]/10 bg-[#fffdf8]/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:top-[92px] lg:z-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none"
        aria-label="이 글의 목차"
      >
        <p className="hidden text-[12px] font-semibold tracking-[0.12em] text-[#8F5150] lg:block">이 글에서 바로 찾기</p>
        <nav className="flex gap-2 overflow-x-auto pb-1 lg:mt-3 lg:flex-col lg:overflow-visible lg:pb-2">
          {part.sections.map((section, index) => (
            <a
              key={section.heading}
              href={`#section-${index + 1}`}
              className="shrink-0 rounded-full border border-[#243832]/12 bg-white px-3 py-2 text-[12.5px] font-medium text-[#3d4a45] hover:border-[#8F5150]/40 hover:text-[#8F5150] lg:rounded-none lg:border-0 lg:border-l lg:bg-transparent lg:px-3 lg:py-1.5"
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
        <h1 className="mt-1.5 text-[28px] font-semibold leading-snug text-[#1b1c1c] sm:text-[34px]">
          {part.title}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.8] text-[#3d4a45]">{part.description}</p>
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
            className="mt-3 inline-flex rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541]"
          >
            {checklistLabel ? `${checklistLabel} 체크리스트 열기` : "아모라에게 물어보기"}
          </Link>
        </div>
      </header>

      <div className="mt-8 space-y-9">
        {part.sections.map((section, index) => (
          <section key={section.heading} id={`section-${index + 1}`} className="scroll-mt-24">
            <h2 className="text-[17px] font-semibold leading-snug text-[#243832]">
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
