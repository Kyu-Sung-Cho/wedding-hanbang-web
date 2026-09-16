import Link from "next/link";
import { ArrowUp } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS, AMORA_QUIET_CHIP_CLASS, AMORA_QUIET_TARGET_CLASS } from "@/components/ui/amoraActionStyles";
import { FEATURE_SUMMARY_CLASS } from "@/components/ui/featureSummaryStyles";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { readingMinutesOf } from "@/lib/manners/readingTime";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { buildAmoraPreparationHref } from "@/lib/amora/preparationHandoff";
import MannersMobileHeader from "./MannersMobileHeader";
import MannersAnchor from "./MannersAnchor";
import MannersReadingNavigation from "./MannersReadingNavigation";

/**
 * 결혼 예절 안내 본문은 서버에서 전부 렌더하고 검색·목차 이동만 작은 클라이언트로 둔다.
 *
 * 첨부 HTML의 카드·문장·표 패턴을 전체 원문에 적용한다. 시안은 발췌본이므로
 * 본문·각주·표의 한계는 자료 계약 그대로 렌더한다. 좁은 화면에서는 시간 순서와
 * 표의 행을 세로로 편다. 글자색은 planning-workspace의 대비를 보정한 역할 토큰이다.
 */


/**
 * 목차와 제목에 붙일 절 번호는 **위치로 매긴다.**
 *
 * 25편 중 제목에 번호를 직접 적어 둔 것은 5편뿐이다(`invitation-sending`, `cost-saving` 등).
 * 원본 제목에 이미 번호가 있으면 **표시할 때만** 벗긴다. 원본은 그대로 둔다 — 그 문자열이
 * `noteSources` 의 절 조회 키다(벗긴 값을 키로 쓰면 링크가 통째로 깨진다).
 */
function sectionLabel(heading: string): string {
  return heading.replace(/^[0-9]+[.] */, "");
}

/**
 * 「하면 편해요」와 「조심하세요」는 **다르게 보여야 한다.**
 *
 * 예전에는 두 상자의 안쪽 색이 ΔE 1.57 이었다 — 사람이 알아채는 문턱(약 2.3) 아래고,
 * 라벨 색까지 같아서 나란히 붙은 30곳에서 같은 상자 두 개로 보였다.
 *
 * 시안은 상자를 아예 없애고 **네 채널**로 가른다. 색 하나에 기대지 않는다(WCAG 1.4.1) —
 * 점 색이 안 보여도 글자 크기·행간·바로 위 소제목이 남는다.
 */
const BLOCK_TONE = {
  tip: {
    label: "이렇게 하면 편해요",
    dot: "bg-[var(--amora-rose)]",
    text: "text-[13px] leading-[1.65] sm:text-[13.5px]",
    gap: "mb-[9px] sm:mb-2.5",
  },
  warning: {
    label: "이건 조심하세요",
    dot: "bg-[var(--amora-danger)]/60",
    text: "text-[12.5px] leading-[1.6] sm:text-[13px]",
    gap: "mb-[7px] sm:mb-2",
  },
} as const;

/**
 * 시안의 점 목록 `ul.points`.
 *
 * 들여쓰기가 없다 — 점이 글 블록 **바깥**에 있고 둘째 줄부터 점 자리만큼 들어간다.
 * `list-style` 없이 flex 로 만든다.
 */
function List({
  items,
  dot = "bg-[var(--amora-rose)]",
  text = "text-[13px] leading-[1.65] sm:text-[13.5px]",
  gap = "mb-[9px] sm:mb-2.5",
}: {
  items: string[];
  dot?: string;
  text?: string;
  gap?: string;
}) {
  return (
    <ul className="m-0 list-none p-0">
      {items.map((item, index) => (
        <li
          key={item}
          className={`flex gap-[9px] sm:gap-2.5 text-[var(--amora-soft)] ${text} ${
            index === items.length - 1 ? "" : gap
          }`}
        >
          <span aria-hidden className={`mt-[7px] size-[5px] shrink-0 rounded-full sm:size-1.5 ${dot}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** 시안 `.sub-h` — 상자도 배경도 없는 로즈 소제목. */
function SubHeading({ children }: { children: string }) {
  return (
    <h3 className="mb-2 mt-3.5 text-[12px] font-bold text-[var(--amora-rose-deep)] sm:mt-4 sm:text-[12.5px]">{children}</h3>
  );
}

function Block({ block, sources }: { block: MannersBlock; sources: MannersSource[] }) {
  if (block.kind === "paragraph") {
    if (block.law) {
      /*
        법령·판례 인용. 시안은 이것을 본문과 다른 상자(`law-box`)로 그리고 「법적 근거
        자세히 보기」 뒤에 접어 둔다 — 근거는 읽고 나서 확인하는 것이지 먼저 읽는 것이
        아니다. 혼인신고 편의 한 문단은 629자라 펼쳐 두면 절이 그 문단 하나가 된다.

        긴 원문도 접근할 수 있도록 네이티브 details를 쓰고, 키보드 초점과
        44px 터치 영역을 제공한다.
      */
      return (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-full border border-[var(--color-paper-outline)] px-4 text-[12.5px] font-semibold text-[var(--hb-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)] sm:inline-flex">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-[1.7]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            법적 근거 자세히 보기
          </summary>
          <div className="mt-2.5 flex items-start gap-3 rounded-[12px] bg-[var(--amora-low)] px-[18px] py-[15px]">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-[var(--hb-accent)] stroke-[1.7]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5h16M4 12h16M4 19h10" />
            </svg>
            <p className="text-[12.5px] leading-[1.65] text-[var(--amora-soft)]">
              {block.text}
            </p>
          </div>
        </details>
      );
    }
    return (
      <p className="text-[13.5px] leading-[1.7] text-[var(--amora-soft)]">{block.text}</p>
    );
  }

  if (block.kind === "checklist") {
    return (
      <div>
        {block.title ? <SubHeading>{block.title}</SubHeading> : null}
        <List items={block.items} />
      </div>
    );
  }

  if (block.kind === "tip" || block.kind === "warning") {
    const tone = BLOCK_TONE[block.kind];
    return (
      <div>
        <SubHeading>{block.title ?? tone.label}</SubHeading>
        <List items={block.items} dot={tone.dot} text={tone.text} gap={tone.gap} />
      </div>
    );
  }

  if (block.kind === "dialogue") {
    return (
      <div>
        <SubHeading>{block.title ?? "그대로 쓰셔도 되는 말"}</SubHeading>
        {/*
          시안의 `script-grid` — 테두리 없는 따뜻한 바탕 카드가 나란히 선다. 웹은 그리드,
          좁은 화면은 세로 스택(`script-stack`).

          상대 라벨을 새로 만들지 않는다. 자료의 note(언제 쓰는 말인지)를 카드 첫 줄에
          그대로 두어 문장을 쓸 상황도 함께 읽을 수 있다.
        */}
        <div className={`mt-2.5 grid gap-2.5 sm:gap-3 sm:grid-cols-2 ${block.lines.length >= 3 ? "xl:grid-cols-3" : ""}`}>
          {block.lines.map((line) => (
            <div key={line.say} className="rounded-[12px] bg-[var(--amora-warm)] px-[15px] py-3.5 sm:px-4 sm:py-[15px]">
              {line.note ? (
                <p className="mb-1.5 text-[12px] font-semibold leading-[1.55] text-[var(--amora-rose-deep)]">
                  {line.note}
                </p>
              ) : null}
              <p className="relative pl-4 text-[13px] font-medium leading-[1.6] text-[var(--amora-ink)]">
                <span
                  aria-hidden
                  className="planning-display absolute left-0 top-0 text-[18px] leading-none text-[var(--amora-rose)]"
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
  const compare = block.variant === "compare";

  return (
    <figure className="m-0">
      {/*
        시간 순서 요약. 표를 **대체하지 않는다** — 표에는 기준 시점·한계·출처 계약이
        붙어 있어 통째로 바꿀 수 없다. 요약 아래에 원문 표도 함께 남긴다.

        말은 표의 첫 열에서 줄여 온 것이다. 없는 숫자를 만들지 않았다
        (「예식 두세 시간 전」을 「-3h」로 바꾸면 정밀도를 지어내는 것이다).
      */}
      {block.timeline ? (
        <div className="relative mb-4">
            <span
              aria-hidden
              className="absolute bottom-4 left-[6px] top-2 w-0.5 sm:bottom-auto sm:left-[22px] sm:right-[22px] sm:top-4 sm:h-0.5 sm:w-auto bg-[var(--amora-line)]"
            />
          <ol aria-label={`${block.title} 시간 순서`} className="list-none p-0 sm:flex sm:items-start sm:pt-2.5">
            {block.timeline.map((node) => (
              <li key={node.at} className="relative flex min-w-0 items-start gap-[13px] pb-4 last:pb-0 sm:block sm:flex-1 sm:px-1 sm:pb-0 sm:text-center">
                <span
                  aria-hidden
                  className="relative mt-0.5 block size-3.5 shrink-0 rounded-full border-[2.5px] border-[var(--amora-rose)] bg-white sm:mx-auto sm:mb-2.5 sm:mt-0"
                />
                <span className="block w-[82px] shrink-0 text-[12px] sm:mb-[3px] sm:w-auto text-[var(--amora-muted)]">
                  {node.at}
                </span>
                <span className="block text-[13px] font-semibold leading-[1.4] text-[var(--amora-ink)] sm:text-[12.5px]">
                  {node.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-[13px] font-bold text-[var(--amora-rose-deep)]">{block.title}</p>
        {/*
          기준 시점은 **표 안에** 있어야 한다. 각주에만 적었더니 표가 현재 값처럼
          읽혔다 — 사용자는 표만 캡처해 옮기고, 옮겨진 표에는 각주가 안 따라간다.
        */}
        <span
          className="rounded-full bg-[var(--amora-low)] px-2 py-0.5 text-[12px] font-medium text-[var(--amora-muted)]"
        >
          {block.asOf}
        </span>
      </div>

      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--amora-line)]">
              {block.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 pb-2 pt-0 text-[12px] font-bold text-[var(--amora-muted)]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr className="border-b border-[var(--amora-line)]" key={row.join("|")} >
                {row.map((cell, index) => (
                  <td
                    key={cell}
                    className={`px-3 py-[11px] align-top ${
                      index === 0
                        ? "text-[12.5px] font-medium text-[var(--amora-ink)]"
                        : compare
                          ? `text-[12.5px] leading-[1.6] ${index === 1 ? "text-[var(--hb-success)]" : "text-[var(--amora-rose-deep)]"}`
                          : index === row.length - 1 && row.length >= 3
                            ? "text-[12px] leading-[1.5] text-[var(--amora-muted)]"
                            : "text-[12.5px] leading-[1.6] text-[var(--amora-soft)]"
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
      <div className="sm:hidden">
        {block.rows.map((row) => (
          <dl
            key={row.join("|")}
            className="m-0 grid grid-cols-[minmax(0,92px)_minmax(0,1fr)] gap-3 py-3 border-b border-[var(--amora-line)]"
          >
            <dt className="text-[12.5px] font-medium text-[var(--amora-ink)]">{row[0]}</dt>
            <dd className="m-0 min-w-0">
              <dl className="m-0 space-y-2">
                {row.slice(1).map((cell, index) => (
                  <div key={`${index}-${cell}`} className="text-right">
                    <dt className="text-[12px] text-[var(--amora-muted)]">{block.columns[index + 1]}</dt>
                    <dd className={`m-0 text-[12.5px] leading-[1.6] ${compare ? index === 0 ? "text-[var(--hb-success)]" : "text-[var(--amora-rose-deep)]" : "text-[var(--amora-soft)]"}`}>
                      {cell}
                    </dd>
                  </div>
                ))}
              </dl>
            </dd>
          </dl>
        ))}
      </div>

      {/*
        시안 `.read-tip` — 표 **아래에 붙는** 따뜻한 띠(위 두 모서리가 0이라 표와 한
        덩어리로 읽힌다). 표의 적용 한계가 여기 산다. 표만 캡처해 옮겨도
        한계가 같이 가야 한다는 계약(`types.ts`)이 이 자리를 요구한다.
      */}
      <div className="mt-0.5 flex items-start gap-2.5 rounded-b-[10px] bg-[var(--amora-warm)] px-3.5 py-3">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="mt-px h-3.5 w-3.5 shrink-0 fill-none stroke-[var(--color-gold)] stroke-[1.7]"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <p className="text-[12px] leading-[1.6] text-[var(--amora-soft)]">
          {block.caption} <span className="font-medium">이 표의 적용 범위 · </span>
          {block.limits}
          {block.unsourced ? " 선택·확인용 참고표이며, 검증된 가격·통계나 필수 관행을 뜻하지 않습니다." : null}
          {refs.length > 0 ? (
            <>
              {" "}
              {refs.map((source, index) => (
                <span key={source.url}>
                  {index > 0 ? " · " : ""}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center font-medium text-[var(--hb-accent)]"
                  >
                    {source.label}
                  </a>
                </span>
              ))}
            </>
          ) : null}
        </p>
      </div>
    </figure>
  );
}

/**
 * 대상 배지. 시안은 대상마다 색을 달리한다 — 한 갈래뿐인 글에 역할 탭을 두지 않고
 * 배지 하나로 말한다(`설계 패턴에 대해 써놓은 문서.html`).
 */
const AUDIENCE_BADGE = {
  both: { label: "모두에게", className: "bg-[var(--amora-low)] text-[var(--amora-ink)]" },
  guest: { label: "초대받은 분께", className: "bg-[var(--hb-accent)] text-white" },
  couple: { label: "준비하는 두 분께", className: "bg-[var(--amora-ink)] text-white" },
} as const;

/**
 * 역할 탭. 절에 `role` 이 하나라도 있는 편에서만 그린다(지금은 본식 당일 한 편).
 *
 * 값은 자료의 한국어 그대로 쓰고, id 에는 영문 키를 쓴다 — CSS 선택자에 한국어를
 * 넣으면 이스케이프가 필요하고, 이 저장소는 이스케이프에서 여러 번 데였다.
 */
const ROLE_TABS = [
  // `caption` 을 따로 적는다. 「신랑·신부」+「이 볼 항목」처럼 조사를 붙여 만들면
  // 받침에 따라 틀린다 — 실제로 「신랑·신부이 볼 항목」이 화면에 나갔다.
  { key: "all", label: "전체", match: null, caption: "전체" },
  { key: "couple", label: "신랑·신부", match: "두 사람", caption: "신랑·신부가 볼 항목" },
  { key: "elders", label: "양가 어른", match: "양가 어른", caption: "양가 어른이 볼 항목" },
  { key: "guest", label: "하객", match: "하객", caption: "하객이 볼 항목" },
] as const;

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

/** 각주에서 처음부터 펼쳐 두는 출처 수. 나머지는 「근거 자료 N개 더 보기」로 접는다. */
const SOURCES_SHOWN = 2;

export default function MannersPartView({ part }: { part: MannersPart }) {
  const categoryKeys = categoryKeysForMannersPart(part.slug);
  const primaryCategory = categoryKeys[0];
  const checklistLabel = primaryCategory
    ? PLANNING_CATEGORY_LABELS[primaryCategory as keyof typeof PLANNING_CATEGORY_LABELS]
    : null;
  const amoraHref = buildAmoraPreparationHref({ kind: "manners", partSlug: part.slug });
  const readingMinutes = readingMinutesOf(part.sections);
  const audience = AUDIENCE_BADGE[part.audience];
  const { previous, next } = neighbourParts(part.slug);
  /**
   * 역할 탭을 그릴지. 절에 `role` 이 하나라도 있으면 그린다.
   *
   * 지금은 본식 당일 한 편뿐이다. 절 제목의 접두를 정규식으로 읽으면 열세 편이
   * 걸리는데 대부분 역할이 아니라 주제·시기·소유 대상이라 오작동한다.
   */
  const hasRoles = part.sections.some((section) => section.role);
  const roleId = (key: string) => `${part.slug}-role-${key}`;
  const shownSources = part.sources.slice(0, SOURCES_SHOWN);
  const hiddenSources = part.sources.slice(SOURCES_SHOWN);

  return (
    <>
    <MannersMobileHeader />
    <div className="mx-auto w-full max-w-[1220px] px-[18px] pb-14 pt-[22px] md:px-9 xl:px-16 xl:pt-[30px]">
      <article id="manners-top" tabIndex={-1} className="min-w-0 scroll-mt-28 focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]">
        <header>
          {/* 시안 `.crumb` — 파란 글자, 밑줄 없음, 현재 편 이름까지. */}
          <nav aria-label="이동 경로" className="mb-3.5 hidden text-[12.5px] text-[var(--hb-accent)] md:block">
            <Link {...weddingLinkProps("/manners")}>결혼 예절 안내</Link>
            {"> "}
            {part.title}
          </nav>

          {/* 시안 h1 — 32px / **400** / 디스플레이 서체. 굵지 않다. */}
          <h1 className="planning-display text-[26px] leading-[1.35] text-[var(--amora-ink)] sm:text-[32px]">
            {part.title}
          </h1>
          {/*
            부제는 `subtitle` 이다. 예전에는 `description`(중앙 84자)을 썼는데 시안 부제
            자리는 한 줄이고, `subtitle` 이 9~27자로 딱 맞는다. 자료는 이미 있었다.
          */}
          <p className="mb-3.5 mt-2 text-[13px] leading-[1.6] sm:mb-4 sm:text-[14px] text-[var(--amora-muted)]">
            {part.subtitle}
          </p>

          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {!hasRoles && <span className={`rounded-full px-3.5 py-[7px] text-[12px] font-semibold sm:px-4 sm:py-2 sm:text-[13px] ${audience.className}`}>
              {audience.label}
            </span>}
            <span className="text-[12px] sm:text-[12.5px] text-[var(--amora-muted)]">
              예상 읽기 {readingMinutes}분 · {part.sections.length}개 절
            </span>
            {part.sources.length > 0 ? (
              <MannersAnchor href="#manners-sources" className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--amora-sage-pale)] px-[11px] py-[5px] text-[12px] leading-[1.6] text-[var(--amora-ink)] sm:text-[12px]">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-none stroke-current stroke-[1.7]"><path d="M5 12l4 4L19 6" /></svg>
                  출처·확인일 보기
                </span>
                <span className="sr-only"> — 출처별 확인일은 아래 자료에서 확인해 주세요</span>
              </MannersAnchor>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-[11px] py-[5px] text-[12px] border-[var(--amora-line)] text-[var(--amora-muted)]"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-3 w-3 shrink-0 fill-none stroke-current stroke-[1.7]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16h.01" />
                </svg>
                관행 중심 편집 · 공개 자료 확인 전
              </span>
            )}
          </div>
          {/*
            이 글이 **무엇을 다루는지** 한 줄. 시안의 `.excerpt-note` 자리에
            공통 요약 표면을 적용하고 원문 설명은 유지한다.

            2026-09-04 에 부제를 `description` 에서 `subtitle` 로 바꾸면서 이 문장이
            화면에서 통째로 사라졌었다. 검색으로 들어온 사람에게는 이 한 줄이 「이 글을
            읽어야 하나」를 가르는 유일한 문장이라 되살린다.
          */}
          <p className={`${FEATURE_SUMMARY_CLASS} px-4 py-3 text-[13px] leading-[1.6] text-[var(--amora-soft)]`}>
            {part.description}
          </p>
        </header>

        {/* 원문의 역할 필터와 목차가 같은 선택을 따른다. 본문 전체는 서버 HTML에 남는다. */}
        <MannersReadingNavigation key={part.slug} slug={part.slug} hasRoles={hasRoles} sections={part.sections.map((section, index) => ({ id: `section-${index + 1}`, label: sectionLabel(section.heading), role: section.role }))} controls={<>
          {hasRoles
            ? ROLE_TABS.map((tab) => (
                <input
                  key={tab.key}
                  type="radio"
                  name={`${part.slug}-role`}
                  id={roleId(tab.key)}
                  value={tab.key}
                  defaultChecked={tab.key === "all"}
                />
              ))
            : null}

          {hasRoles ? (
            <div className="manners-role-tabs mb-5 mt-4 flex flex-wrap gap-2" role="group" aria-label="역할 고르기">
              {ROLE_TABS.map((tab) => (
                <label
                  key={tab.key}
                  htmlFor={roleId(tab.key)}
                  className="inline-flex min-h-11 items-center rounded-full border border-[var(--color-paper-outline)] bg-white px-3.5 py-[9px] text-[12px] text-[var(--amora-soft)] sm:px-[18px] sm:text-[13.5px]"
                >
                  {tab.label}
                </label>
              ))}
            </div>
          ) : null}

        </>}>

        <div className="manners-sections mt-6 space-y-[12px] sm:space-y-[18px]">
          {/* 「정답이 아니라 관행」 고지. 시안 `.notice` — 테두리 있는 따뜻한 상자. */}
          <div
            className="flex items-start gap-3 rounded-[12px] bg-[var(--amora-warm)] p-3.5 sm:rounded-[14px] sm:px-[18px] sm:py-4 border border-[var(--amora-line)]"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-[var(--color-gold)] stroke-[1.7]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <p className="text-[12.5px] leading-[1.65] text-[var(--amora-soft)] sm:text-[13px]">
              {part.caveat}
            </p>
          </div>

          {part.sections.map((section, index) => {
            /*
              절의 **첫 문단**이 시안의 TL;DR 자리다. 뒤에 다른 블록이 있을 때만 뽑는다 —
              문단 하나뿐인 절에서 그것을 강조 줄로 올리면 본문이 통째로 사라진다.
            */
            const [head, ...rest] = section.blocks;
            /*
              법령 문단은 강조 줄로 뽑지 않는다. 시안은 그것을 카드 **맨 아래** 접힌
              상자로 두는데, 걸린 일곱 문단이 전부 절의 첫 블록이라 그냥 두면 TL;DR
              자리를 차지한다 — 그러면 절의 첫 화면이 법조문으로 시작한다.
            */
            const displayBlocks = head?.kind === "paragraph" && head.law
              ? [...rest, head]
              : section.blocks;
            const [intro, ...following] = displayBlocks;
            const lead =
              intro?.kind === "paragraph" && !intro.law && following.length > 0 ? intro : undefined;
            const body = lead ? following : displayBlocks;
            const sectionAmoraHref = buildAmoraPreparationHref({ kind: "manners", partSlug: part.slug, sectionId: `section-${index + 1}` });

            return (
              <section
                key={section.heading}
                id={`section-${index + 1}`}
                tabIndex={-1}
                data-role={section.role}
                className="scroll-mt-28 rounded-[16px] bg-white px-[18px] py-5 sm:rounded-[18px] sm:px-7 sm:py-[26px] border border-[var(--amora-line)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]"
              >
                <div className="mb-3 flex items-center gap-[11px] sm:mb-3.5 sm:gap-3">
                  <span
                    aria-hidden
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[var(--amora-rose-pale)] text-[12px] font-bold text-[var(--amora-rose-deep)] sm:h-[34px] sm:w-[34px] sm:rounded-[10px] sm:text-[13px]"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="min-w-0 flex-1 text-[15.5px] font-semibold leading-[1.4] text-[var(--amora-ink)] sm:text-[18px]">
                    {sectionLabel(section.heading)}
                  </h2>
                  {sectionAmoraHref && <Link {...weddingLinkProps(sectionAmoraHref)} aria-label={`${sectionLabel(section.heading)} 아모라에 질문하기`} title={`${sectionLabel(section.heading)} 아모라에 질문하기`} className={`${AMORA_QUIET_TARGET_CLASS} -mr-1.5`}><span className={AMORA_QUIET_CHIP_CLASS}><AmoraMark className="size-4" /></span></Link>}
                </div>

                {lead ? (
                  <p className="mb-3.5 rounded-r-[9px] border-l-[3px] sm:rounded-r-[10px] border-[var(--amora-rose)] bg-[var(--amora-warm)] px-[13px] py-[11px] text-[13.5px] font-semibold leading-[1.6] text-[var(--amora-ink)] sm:mb-4 sm:px-4 sm:py-3 sm:text-[14px]">
                    {lead.text}
                  </p>
                ) : null}

                <div className="space-y-4">
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
        </MannersReadingNavigation>

        {/*
          각주 `cite-foot`. **출처가 없는 편에는 아예 안 그린다** — 시안 신혼여행 편이
          그렇고, 실제로 25편 중 14편이 출처 0개다. 예전에는 그 14편에 「아직 없어요」
          상자만 남아 있었다.
        */}
        {part.sources.length > 0 ? (
          <footer
            id="manners-sources"
            tabIndex={-1}
            className="mt-3 scroll-mt-28 rounded-[14px] bg-white p-4 sm:mt-[18px] sm:rounded-[16px] sm:px-6 sm:py-5 border border-[var(--amora-line)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]"
          >
            <h2 className="flex items-center gap-2 text-[13px] font-bold text-[var(--amora-ink)]">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 fill-none stroke-[var(--hb-accent)] stroke-[1.7]"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l4 4 10-10" />
              </svg>
              어디서 확인한 내용인가요
            </h2>
            <p className="mt-2 text-[12px] leading-[1.6] text-[var(--amora-muted)]">각 자료가 뒷받침하는 내용과 범위를 구분했어요. 확인일은 자료별로 다르며, 글 전체를 확인한 날짜가 아니에요.</p>
            {/*
              각주 한 줄은 「이름 · 확인일」과 「덮는 범위 · 뒷받침 내용」이다.
              `scope` 는 이 출처가 무엇을 덮는가다(예: 2025년 4월 전국 14개 지역 370곳
              조사 결과). 없으면 출처를 실제보다 넓게 읽는다 — 2026-09-04 에 시안을
              옮기며 잠깐 빠졌던 것을 되살렸다.
            */}
            <ul className="m-0 mt-3 list-none p-0">
              {shownSources.map((source) => (
                <li key={source.url} className="mb-3 last:mb-0">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center text-[12.5px] font-semibold text-[var(--hb-accent)]"
                  >
                    {source.label}
                  </a>
                  <span className="text-[12.5px] text-[var(--amora-muted)]">
                    {" · "}
                    {source.checkedAt} 확인
                  </span>
                  <p className="mt-1 text-[12px] leading-[1.6] text-[var(--amora-muted)]">
                    {source.scope} · {source.supports}
                  </p>
                </li>
              ))}
            </ul>
            {/*
              나머지 출처도 네이티브 details 안에 서버 렌더되어 키보드로 펼칠 수 있다.
            */}
            {hiddenSources.length > 0 ? (
              <details className="mt-1 group">
                <summary
                  className="flex min-h-11 cursor-pointer list-none items-center rounded-[10px] text-[12px] font-semibold text-[var(--hb-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]"
                >
                  근거 자료 {hiddenSources.length}개 더 보기
                </summary>
                <ul className="m-0 mt-3 list-none p-0">
                  {hiddenSources.map((source) => (
                    <li key={source.url} className="mb-3 last:mb-0">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex min-h-11 items-center text-[12.5px] font-semibold text-[var(--hb-accent)]"
                      >
                        {source.label}
                      </a>
                      <span className="text-[12.5px] text-[var(--amora-muted)]">
                        {" · "}
                        {source.checkedAt} 확인
                      </span>
                      <p className="mt-1 text-[12px] leading-[1.6] text-[var(--amora-muted)]">
                        {source.scope} · {source.supports}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </footer>
        ) : null}

        {/*
          「읽은 뒤 준비하기」는 **읽은 뒤에** 있어야 한다.

          시안 여덟 장에 없지만 남긴다 — 편 맨 아래에 나가는 링크가 0개면 20화면을
          내려온 사람이 갈 곳이 없다. 다만 모양은 시안 어휘로 맞췄다(따뜻한 바탕).
        */}
        <div className="mt-[18px] rounded-[14px] bg-[var(--amora-warm)] px-5 py-5 border border-[var(--amora-line)]">
          <p className="text-[12.5px] font-bold text-[var(--amora-rose-deep)]">읽은 뒤 준비하기</p>
          <p className="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--amora-soft)]">
            {checklistLabel
              ? `${checklistLabel} 준비 항목을 열어 실제로 확인하고 저장할 수 있어요.`
              : "우리 상황에 맞게 적용할 부분만 아모라와 정리해 보세요."}
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            {primaryCategory && <Link
              {...weddingLinkProps(`/checklist?category=${encodeURIComponent(primaryCategory)}`)}
              className="inline-flex min-h-11 items-center rounded-[11px] border border-[var(--amora-line)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--amora-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]"
            >
              {checklistLabel} 체크리스트 열기
            </Link>}
            {amoraHref && <Link {...weddingLinkProps(amoraHref)} aria-label={`${part.title} 아모라에 질문하기`} className={AMORA_ACTION_CLASS}>
              <AmoraMark className="size-5 shrink-0" />아모라에 질문하기
            </Link>}
          </div>
          <p className="mt-2 text-[12px] leading-[1.6] text-[var(--amora-muted)]">질문 초안을 확인한 뒤 직접 보내요. 준비 상태는 바뀌지 않아요.</p>
        </div>

        {/* 이웃 편으로. 시안의 이전/다음 버튼 — 화살표 아이콘이 붙는다. */}
        {previous || next ? (
          <nav className="mt-[18px] grid grid-cols-2 gap-2.5 sm:gap-3" aria-label="다른 편">
            {previous ? (
              <Link
                {...weddingLinkProps(`/manners/${previous.slug}`)}
                className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[var(--amora-line)] bg-white px-3.5 py-3 sm:rounded-[14px] sm:px-5 sm:py-4"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 fill-none stroke-current stroke-[1.7] text-[var(--amora-muted)]"
                  strokeLinecap="round"
                  strokeLinejoin="round"

                >
                  <path d="M15 5l-7 7 7 7" />
                </svg>
                <span className="min-w-0">
                  <span className="block text-[12px] text-[var(--amora-muted)]">
                    이전
                  </span>
                  <span className="block text-[13.5px] font-semibold text-[var(--amora-ink)]">
                    {previous.title}
                  </span>
                </span>
              </Link>
            ) : null}
            {next ? (
              <Link
                {...weddingLinkProps(`/manners/${next.slug}`)}
                className="col-start-2 flex min-w-0 items-center justify-end gap-2.5 rounded-xl border border-[var(--amora-line)] bg-white px-3.5 py-3 text-right sm:rounded-[14px] sm:px-5 sm:py-4"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] text-[var(--amora-muted)]">
                    다음
                  </span>
                  <span className="block text-[13.5px] font-semibold text-[var(--amora-ink)]">
                    {next.title}
                  </span>
                </span>
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 fill-none stroke-current stroke-[1.7] text-[var(--amora-muted)]"
                  strokeLinecap="round"
                  strokeLinejoin="round"

                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : null}
          </nav>
        ) : null}
        <nav aria-label="글 안에서 이동" className="mt-3 flex items-center justify-between gap-3">
          <MannersAnchor href="#manners-toc" className="inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-semibold text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]">목차로 돌아가기</MannersAnchor>
          <MannersAnchor href="#manners-top" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] text-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]"><ArrowUp aria-hidden className="h-4 w-4" />맨 위로</MannersAnchor>
        </nav>
      </article>
    </div>
    </>
  );
}
