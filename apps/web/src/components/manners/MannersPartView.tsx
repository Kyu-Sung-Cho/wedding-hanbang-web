import Link from "next/link";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { readingMinutesOf } from "@/lib/manners/readingTime";
import { weddingLinkProps } from "@/lib/weddingPaths";

/**
 * 결혼 예절 안내 본문 렌더러. 서버 전용이고 클라이언트 JS가 0이다.
 *
 * 삭제된 원본 화면(`EtiquetteClient.tsx` 1,307줄)은 절반이 체크박스·메모·일정 팝오버였다.
 * 그건 지금 체크리스트·일정 화면이 이미 하는 일이라 여기서 다시 만들지 않는다.
 * 이 화면은 **읽는 곳**이고, 실행은 아모라와 일정으로 넘긴다.
 *
 * ## 2026-09-03 시안 — 절이 **카드**가 됐다
 *
 * 파운더가 준 시안(`MannersGiftMoney.dc.html` 등 8장)의 언어로 다시 짰다. 바뀐 것은
 * 표면이지 데이터가 아니다 — 시안의 문장은 전부 `lib/manners/data.ts` 에서 나온 것이고,
 * 이 파일은 그것을 다르게 그릴 뿐이다.
 *
 *   절 → 흰 카드(번호 배지 + 제목 + `절 i/N`)
 *   절의 첫 문단 → 강조 한 줄(TL;DR). 로즈 왼쪽 선 + 따뜻한 바탕
 *   대상·읽기 시간·출처 확인일 → 제목 밑 배지 줄
 *   caveat → 금색 느낌표가 붙은 안내 상자
 *
 * **시안에 있지만 넣지 않은 것: 법령 인용 상자(law-box).** 시안은 하객 매너에
 * "대법원 2006다16280" 을 인용하는데 그 사건번호가 `data.ts` 에 없다(실측 0건).
 * 화면이 지어낸 근거를 대는 것이 이 코퍼스에서 가장 위험한 실패라, 데이터가 갖고 있는
 * 인용만 그린다. 법령 인용을 넣으려면 먼저 `sources` 에 1차 출처를 올려라.
 */

/**
 * 「하면 편해요」와 「조심하세요」는 **다르게 보여야 한다.**
 *
 * 예전 값은 안쪽 색이 서로 ΔE 1.57 이었다 — 사람이 색 차이를 알아채는 문턱(약 2.3) 아래다.
 * 라벨 색까지 둘 다 `#8F5150` 이라, 나란히 붙어 있는 30곳에서 같은 상자 두 개로 보였다.
 * 경고는 이 코퍼스에서 가장 중요한 블록인데 팁과 구별되지 않았다.
 *
 * 색만으로 구별하게 두지는 않는다 — 라벨 문구가 이미 비색 신호다(WCAG 1.4.1).
 * 2026-09-03: 시안이 경고를 **빨간 점 목록**으로 그린다. 상자를 유지하되 점 색으로
 * 한 채널을 더 준다 — 두 블록이 나란히 와도 목록 모양에서 먼저 갈린다.
 */
const BLOCK_TONE = {
  tip: {
    label: "이렇게 하면 편해요",
    box: "border-[var(--hb-primary)]/25 bg-[var(--hb-primary)]/[0.05]",
    labelColor: "text-[var(--hb-text-strong)]",
    dot: "bg-[var(--color-rose-500)]",
  },
  warning: {
    label: "이건 조심하세요",
    box: "border-[#B4785F]/55 bg-[#B4785F]/[0.13]",
    labelColor: "text-[#8a4f36]",
    dot: "bg-[var(--color-danger-500)]/60",
  },
} as const;

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

/** 시안의 점 목록. 로즈 점 + 1.65 행간. */
function List({ items, dot = "bg-[var(--color-rose-500)]" }: { items: string[]; dot?: string }) {
  return (
    <ul className="mt-2.5 space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[14px] leading-[1.75] text-[var(--hb-text-body)]">
          <span aria-hidden className={`mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ block, sources }: { block: MannersBlock; sources: MannersSource[] }) {
  if (block.kind === "paragraph") {
    return <p className="text-[14px] leading-[1.85] text-[var(--hb-text-body)]">{block.text}</p>;
  }

  if (block.kind === "checklist") {
    return (
      <div>
        {block.title ? (
          <h4 className="text-[12.5px] font-bold text-[var(--color-rose-600)]">{block.title}</h4>
        ) : null}
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "tip" || block.kind === "warning") {
    const tone = BLOCK_TONE[block.kind];
    return (
      <div className={`rounded-[8px] border px-4 py-3 ${tone.box}`}>
        <p className={`text-[12px] font-semibold ${tone.labelColor}`}>
          {block.title ?? tone.label}
        </p>
        <List items={block.items} dot={tone.dot} />
      </div>
    );
  }

  if (block.kind === "dialogue") {
    return (
      <div>
        <p className="text-[12.5px] font-bold text-[var(--color-rose-600)]">
          {block.title ?? "그대로 쓰셔도 되는 말"}
        </p>
        {/*
          시안은 상대별 문장을 카드로 나눠 그린다(웹 3열, 모바일 세로 스택). 문장을
          한 덩어리 목록으로 두면 "누구에게 하는 말인지"가 문장 안에 묻힌다.
        */}
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {block.lines.map((line) => (
            <div key={line.say} className="rounded-[12px] bg-[var(--color-ivory-warm)] px-4 py-4">
              {line.note ? (
                <p className="text-[11px] font-bold text-[var(--color-rose-600)]">{line.note}</p>
              ) : null}
              <p
                className={`relative pl-3.5 text-[13px] leading-[1.6] text-[var(--hb-text-strong)] ${
                  line.note ? "mt-2" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="absolute -top-1 left-0 text-[20px] leading-none text-[var(--color-rose-500)]"
                >
                  “
                </span>
                {line.say}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const refs = (block.sourceRefs ?? [])
    .map((index) => sources[index - 1])
    .filter((source): source is MannersSource => Boolean(source));

  return (
    <figure className="m-0 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]">
      <figcaption className="border-b border-[var(--hb-hairline)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-[14px] font-semibold text-[var(--hb-text-strong)]">{block.title}</p>
          {/*
            기준 시점은 **표 안에** 있어야 한다. 각주에만 적었더니 표가 현재 값처럼
            읽혔다 — 사용자는 표만 캡처해 옮기고, 옮겨진 표에는 각주가 안 따라간다.
          */}
          <span className="rounded-full bg-[var(--color-surface-low)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--hb-text-body)]">
            {block.asOf}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[var(--hb-text-body)]/80">{block.caption}</p>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[var(--color-rose-600)]">
          <span className="font-semibold">이 숫자가 말하지 않는 것 · </span>
          {block.limits}
        </p>
        {block.unsourced ? (
          <p className="mt-1.5 text-[12px] font-medium text-[#B4785F]">
            공개된 1차 자료를 아직 찾지 못한 표예요.
          </p>
        ) : refs.length > 0 ? (
          <p className="mt-2 text-[12px] leading-5 text-[var(--hb-text-muted)]">
            {refs.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? " · " : ""}
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-[var(--color-rose-600)] underline underline-offset-2"
                >
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
            <tr className="border-b border-[var(--hb-hairline)]">
              {block.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-bold text-[var(--hb-text-muted)]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")} className="border-b border-[var(--hb-hairline)] last:border-0">
                {row.map((cell, index) => (
                  <td
                    key={cell}
                    className={`px-4 py-2.5 align-top text-[12.5px] leading-[1.6] ${
                      index === 0
                        ? "font-semibold text-[var(--hb-text-strong)]"
                        : "text-[var(--hb-text-body)]"
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

      {/* 좁은 화면에서는 표가 가로로 넘친다. 행을 세로 목록으로 편다. */}
      <div className="divide-y divide-[var(--hb-hairline)] sm:hidden">
        {block.rows.map((row) => (
          <dl key={row.join("|")} className="px-4 py-3.5">
            {row.map((cell, index) => (
              <div key={cell} className={index === 0 ? "" : "mt-2 flex justify-between gap-3"}>
                {index === 0 ? (
                  <dt className="text-[13px] font-semibold text-[var(--hb-text-strong)]">{cell}</dt>
                ) : (
                  <>
                    <dt className="shrink-0 text-[11.5px] text-[var(--hb-text-muted)]">
                      {block.columns[index]}
                    </dt>
                    <dd className="m-0 text-right text-[12.5px] leading-[1.5] text-[var(--hb-text-body)]">
                      {cell}
                    </dd>
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

/**
 * 대상 배지. 시안은 대상마다 색을 달리한다 — 한 갈래뿐인 글에 역할 탭을 두지 않고
 * 배지 하나로 말한다(`설계 패턴에 대해 써놓은 문서.html`).
 */
const AUDIENCE_BADGE = {
  both: { label: "모두에게", className: "bg-[var(--color-surface-low)] text-[var(--hb-text-strong)]" },
  guest: { label: "초대받은 분께", className: "bg-[var(--color-paper-pen)] text-white" },
  couple: { label: "준비하는 두 분께", className: "bg-[var(--hb-primary)] text-white" },
} as const;

/** 편 순서. 목차(`MANNERS_CATEGORIES`)에 적힌 순서가 읽는 순서다. */
function neighbourParts(slug: string) {
  const order = MANNERS_CATEGORIES.flatMap((category) => category.slugs);
  const at = order.indexOf(slug);
  const find = (target: string | undefined) =>
    target ? MANNERS_PARTS.find((part) => part.slug === target) : undefined;
  return at < 0
    ? { previous: undefined, next: undefined }
    : { previous: find(order[at - 1]), next: find(order[at + 1]) };
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
  const audience = AUDIENCE_BADGE[part.audience];
  const { previous, next } = neighbourParts(part.slug);

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
        className="sticky top-0 z-20 -mx-4 border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-page)]/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:top-[92px] lg:z-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none"
        aria-label="이 글의 목차"
      >
        <p className="hidden text-[12px] font-bold text-[var(--color-rose-600)] lg:block">
          이 글에서 바로 찾기
        </p>
        <nav className="flex gap-2 overflow-x-auto pb-1 lg:mt-3 lg:flex-col lg:overflow-visible lg:pb-2">
          {part.sections.map((section, index) => (
            <a
              key={section.heading}
              href={`#section-${index + 1}`}
              className="shrink-0 rounded-[8px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-3 py-2 text-[12.5px] font-medium text-[var(--hb-text-body)] hover:border-[var(--color-rose-500)] hover:text-[var(--color-rose-600)] lg:rounded-[8px] lg:border-0 lg:border-l lg:bg-transparent lg:px-3 lg:py-1.5"
            >
              <span aria-hidden className="mr-1.5 text-[var(--color-rose-600)]">
                {index + 1}
              </span>
              {sectionLabel(section.heading)}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0">
        <header>
          <h1 className="text-[26px] font-semibold leading-snug text-[var(--hb-text-strong)] sm:text-[32px]">
            {part.title}
          </h1>
          <p className="mt-2 text-[14px] leading-[1.7] text-[var(--hb-text-muted)]">
            {part.description}
          </p>

          {/*
            시안의 배지 줄. 이 글이 **누구를 위한 것인지 · 얼마나 걸리는지 · 출처를
            확인했는지**를 한 줄로 말한다. 출처 배지는 확인한 글과 아직인 글을 모양으로
            가른다(초록 채움 / 점선) — 사이트 원문의 정직성 표시를 그대로 옮긴 것이다.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={`rounded-full px-4 py-2 text-[13px] font-semibold ${audience.className}`}
            >
              {audience.label}
            </span>
            <span className="text-[12.5px] text-[var(--hb-text-muted)]">
              예상 읽기 {readingMinutes}분 · {part.sections.length}개 절
            </span>
            {lastCheckedAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-sage-pale)] px-3 py-1.5 text-[11.5px] font-semibold text-[#3d4d3e]">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-3 w-3 shrink-0 fill-none stroke-current stroke-[1.7]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4 4 10-10" />
                </svg>
                {lastCheckedAt} 출처 확인
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-dashed border-[var(--hb-hairline)] px-3 py-1.5 text-[11.5px] text-[var(--hb-text-muted)]">
                관행 중심 편집 · 공개 자료 확인 전
              </span>
            )}
          </div>
          {/*
            긴 편은 **한 번은 세로로 전부** 보여준다.

            상단 sticky 칩 띠는 실폭 1,776px 에 창 343px — 11개 중 2.3개만 보인다.
            첫 화면 812px 중 본문이 59px(7%)뿐이라, 머리에서 한 번 펼쳐 준다.
          */}
          {part.sections.length >= 4 ? (
            <nav
              aria-label="이 글의 차례"
              className="mt-5 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-5 py-4 lg:hidden"
            >
              <p className="text-[12px] font-bold text-[var(--color-rose-600)]">
                {part.sections.length}개 절 · 예상 {readingMinutes}분
              </p>
              {/*
                행을 촘촘하게 둔다. 11절짜리(축의금)에서 이 카드 하나가 389px 이고 본문 첫
                카드가 1,028px 아래로 밀렸다 — 이 화면이 예전에 겪은 문제("첫 화면 본문
                59px")와 같은 갈래다.
                **2단으로 접는 것은 시도했다가 되돌렸다** — 375px 에서 한 칸이 135px 이라
                「받는 쪽 준비 — 정산과 양가 분배」 같은 제목이 세 줄로 깨진다. 읽을 수 없는
                차례는 없는 것만 못하다. 그래서 단은 하나로 두고 줄 간격만 줄인다.
              */}
              <ol className="mt-2.5 space-y-1.5">
                {part.sections.map((section, index) => (
                  <li key={section.heading} className="min-w-0">
                    <a
                      href={`#section-${index + 1}`}
                      className="flex gap-2.5 text-[14px] leading-[1.6] text-[var(--hb-text-body)]"
                    >
                      {/* 두 자리 수가 오는 편이 있다(축의금 11절) — `w-4` 면 10·11 이
                          두 줄로 쪼개진다. 실제로 그렇게 나왔다. */}
                      <span
                        aria-hidden
                        className="w-5 shrink-0 whitespace-nowrap text-right tabular-nums text-[var(--color-rose-600)]"
                      >
                        {index + 1}
                      </span>
                      <span className="underline decoration-[var(--hb-hairline)] underline-offset-4">
                        {sectionLabel(section.heading)}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
        </header>

        <div className="mt-6 space-y-4">
          {/* 「정답이 아니라 관행」 고지. 모든 편이 갖고 있고 본문보다 먼저 온다. */}
          <div className="flex gap-3 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--color-ivory-warm)] px-4 py-4">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="mt-0.5 h-5 w-5 shrink-0 fill-none stroke-[var(--color-gold)] stroke-[1.7]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <p className="text-[13px] leading-[1.65] text-[var(--hb-text-body)]">{part.caveat}</p>
          </div>

          {part.sections.map((section, index) => {
            /*
              절의 **첫 문단**이 시안의 TL;DR 자리다. 뒤에 다른 블록이 있을 때만 뽑는다 —
              문단 하나뿐인 절에서 그것을 강조 줄로 올리면 본문이 통째로 사라진다.
            */
            const [head, ...rest] = section.blocks;
            const lead = head?.kind === "paragraph" && rest.length > 0 ? head : undefined;
            const body = lead ? rest : section.blocks;

            return (
              <section
                key={section.heading}
                id={`section-${index + 1}`}
                className="scroll-mt-28 rounded-[16px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-5 py-6 sm:px-7"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-rose-pale)] text-[13px] font-bold text-[var(--color-rose-600)]"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="min-w-0 flex-1 text-[20px] font-semibold leading-snug text-[var(--hb-text-strong)]">
                    {sectionLabel(section.heading)}
                  </h2>
                  <span className="shrink-0 text-[12px] text-[var(--hb-text-muted)]">
                    {index + 1}/{part.sections.length}
                  </span>
                </div>

                {lead ? (
                  <p className="mt-3.5 rounded-r-[8px] border-l-[3px] border-[var(--color-rose-500)] bg-[var(--color-ivory-warm)] px-4 py-3 text-[14px] font-semibold leading-[1.6] text-[var(--hb-text-strong)]">
                    {lead.text}
                  </p>
                ) : null}

                <div className={`space-y-4 ${lead ? "mt-4" : "mt-3.5"}`}>
                  {body.map((block, blockIndex) => (
                    <Block
                      key={`${section.heading}-${blockIndex}`}
                      block={block}
                      sources={part.sources}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/*
          「읽은 뒤 준비하기」는 **읽은 뒤에** 있어야 한다.

          모바일 375×812 첫 화면에서 이 블록이 134px(16.5%)를 먹고 있었고, 정작 본문은
          59px(7%)만 남았다. 자기 문구가 「읽은 뒤」인데 읽기 전에 서 있었다. 그리고 편 맨
          아래에는 나가는 링크가 0개라, 20화면을 내려온 사람이 갈 곳이 없었다.
          옮기면 두 문제가 같이 풀린다.
        */}
        <div className="mt-5 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--color-ivory-warm)] px-5 py-5">
          <p className="text-[12px] font-bold text-[var(--color-rose-600)]">읽은 뒤 준비하기</p>
          <p className="mt-1.5 text-[14px] leading-6 text-[var(--hb-text-body)]">
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
            className="mt-3.5 inline-flex min-h-11 items-center rounded-[8px] bg-[var(--hb-primary)] px-5 text-[13px] font-semibold text-white hover:bg-[var(--hb-primary-hover)]"
          >
            {checklistLabel ? `${checklistLabel} 체크리스트 열기` : "아모라에게 물어보기"}
          </Link>
        </div>

        <footer className="mt-4 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-5 py-5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold text-[var(--hb-text-strong)]">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 fill-none stroke-[var(--color-paper-pen)] stroke-[1.7]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12l4 4 10-10" />
            </svg>
            어디서 확인한 내용인가요
          </h2>
          {part.sources.length === 0 ? (
            <p className="mt-3 text-[13px] leading-[1.7] text-[var(--hb-text-body)]">
              이 페이지에는 공개된 1차 자료로 확인한 수치가 아직 없어요. 금액이나 법적 절차는
              해당 기관 안내를 직접 확인해 주세요.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-[var(--hb-hairline)]">
              {part.sources.map((source) => (
                <li key={source.url} className="py-3 last:pb-0">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[12.5px] font-semibold text-[var(--color-paper-pen)] underline underline-offset-2"
                  >
                    {source.label}
                  </a>
                  <span className="text-[12.5px] text-[var(--hb-text-muted)]">
                    {" · "}
                    {source.scope}
                    {" · "}
                    {source.checkedAt} 확인
                  </span>
                  <p className="mt-1 text-[12px] leading-[1.6] text-[var(--hb-text-muted)]">
                    뒷받침하는 내용 · {source.supports}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </footer>

        {/*
          이웃 편으로 가는 길. 시안은 절 사이 이동을 그렸는데, 이 화면은 절을 **전부**
          펼쳐 보여주므로 절 단위 이동은 목차가 이미 한다. 그래서 같은 자리를 **편 단위**
          이동이 쓴다 — 여기까지 내려온 사람에게 필요한 것이 그것이다.
          순서는 목차(`MANNERS_CATEGORIES`)의 순서다.
        */}
        {previous || next ? (
          <nav className="mt-4 flex flex-col gap-3 sm:flex-row" aria-label="다른 편">
            {previous ? (
              <Link
                {...weddingLinkProps(`/manners/${previous.slug}`)}
                className="flex-1 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-5 py-4 text-[12.5px] text-[var(--hb-text-muted)]"
              >
                이전
                <span className="mt-1 block text-[14px] font-semibold text-[var(--hb-text-strong)]">
                  {previous.title}
                </span>
              </Link>
            ) : null}
            {next ? (
              <Link
                {...weddingLinkProps(`/manners/${next.slug}`)}
                className="flex-1 rounded-[12px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-5 py-4 text-right text-[12.5px] text-[var(--hb-text-muted)]"
              >
                다음
                <span className="mt-1 block text-[14px] font-semibold text-[var(--hb-text-strong)]">
                  {next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>
    </div>
  );
}
