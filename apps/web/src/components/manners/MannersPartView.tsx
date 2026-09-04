import Link from "next/link";
import type { MannersBlock, MannersPart, MannersSource } from "@/lib/manners/types";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { readingMinutesOf } from "@/lib/manners/readingTime";
import { weddingLinkProps } from "@/lib/weddingPaths";

/**
 * 결혼 예절 안내 본문. 서버 전용이고 클라이언트 JS가 0이다.
 *
 * ## 2026-09-04 — 시안 그대로 옮겼다
 *
 * 파운더 지시: 「디자인 내가 준 것들로 싹 다 물갈이하라고. 정말 완전히 비슷해야 해.」
 * 시안 여덟 장(`MannersGiftMoney.dc.html` 외)의 값을 **숫자 그대로** 옮긴다.
 *
 * ### 시안이 상자를 두르는 것 / 두르지 않는 것 — 이번 변경의 핵심
 *
 *   테두리를 갖는 것   절 카드 · 안내 상자(caveat) · 각주 상자 — **셋뿐**
 *   바탕만 갖는 것     TL;DR · 문장 카드 · 표 읽는 법 · 법령 인용
 *   아무것도 없는 것   점 목록 · 소제목 · **경고**
 *
 * 예전에는 팁·경고가 테두리+틴트 상자였다. 시안은 경고를 상자에서 꺼내 **빨간 점
 * 목록**으로 그린다. 경고와 일반 목록을 가르는 신호는 넷이다 — 점 색(로즈→위험 60%),
 * 글자 0.5px 작음, 행간 1.65→1.6, 바로 위 소제목. 아이콘은 시안에 없다.
 *
 * ### 없앤 것
 *
 * **목차(왼쪽 사이드바 + 머리 세로 차례).** 시안 여덟 장에 목차가 0개다. 절로 가는
 * 앵커(`id="section-N"`)는 남는다 — 체크리스트의 근거 칩이 그 주소로 들어온다.
 *
 * ### 색은 시안 값이 정본이다
 *
 * 대부분 저장소 토큰에 같은 값이 있다. 없는 둘만 리터럴로 적었고 그 사실을 적어 둔다:
 * `#E5DDC9`(시안 hairline · 저장소 `--hb-hairline` 은 #E2DED2)와
 * `#8A876F`(시안 ink-muted · 저장소 `--hb-text-muted` 는 #605E54).
 * 토큰을 바꾸면 제품 전체가 따라 바뀌므로 이 화면에서만 쓴다.
 */

/** 시안 hairline. 저장소 토큰(#E2DED2)보다 한 톤 따뜻하다. */
const HAIRLINE = "#E5DDC9";
/** 시안 ink-muted. 저장소 토큰(#605E54)보다 밝다. */
const INK_MUTED = "#8A876F";

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
    dot: "bg-[var(--color-rose-500)]",
    text: "text-[13px] leading-[1.65] sm:text-[13.5px]",
    gap: "mb-[9px] sm:mb-2.5",
  },
  warning: {
    label: "이건 조심하세요",
    dot: "bg-[var(--color-danger-500)]/60",
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
  dot = "bg-[var(--color-rose-500)]",
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
          className={`flex gap-2.5 text-[var(--color-paper-ink-soft)] ${text} ${
            index === items.length - 1 ? "" : gap
          }`}
        >
          <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** 시안 `.sub-h` — 상자도 배경도 없는 로즈 소제목. */
function SubHeading({ children }: { children: string }) {
  return (
    <h4 className="mb-2 mt-3.5 text-[11.5px] font-bold text-[var(--color-rose-600)] sm:mt-4 sm:text-[12.5px]">{children}</h4>
  );
}

function Block({ block, sources }: { block: MannersBlock; sources: MannersSource[] }) {
  if (block.kind === "paragraph") {
    if (block.law) {
      /*
        법령·판례 인용. 시안은 이것을 본문과 다른 상자(`law-box`)로 그리고 「법적 근거
        자세히 보기」 뒤에 접어 둔다 — 근거는 읽고 나서 확인하는 것이지 먼저 읽는 것이
        아니다. 혼인신고 편의 한 문단은 629자라 펼쳐 두면 절이 그 문단 하나가 된다.

        `<details>` 로 접는다. 이 화면은 클라이언트 JS 가 0이고, `<button>` 으로 만들면
        768px 이하에서 전역 CSS 의 44px 최소 탭 규칙이 알약을 정사각형으로 만든다.
      */
      return (
        <details className="mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-semibold text-[var(--hb-accent)]">
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
          <div className="mt-2.5 flex gap-3 rounded-[12px] bg-[var(--color-surface-low)] px-[18px] py-[15px]">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-[var(--hb-accent)] stroke-[1.7]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5h16M4 12h16M4 19h10" />
            </svg>
            <p className="text-[12.5px] leading-[1.65] text-[var(--color-paper-ink-soft)]">
              {block.text}
            </p>
          </div>
        </details>
      );
    }
    return (
      <p className="text-[13.5px] leading-[1.7] text-[var(--color-paper-ink-soft)]">{block.text}</p>
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

          시안 카드는 라벨과 문장 두 줄뿐인데, 자료의 `note`(「언제 쓰는 말인지」)는
          294건이 있다. 지우지 않고 카드 안 셋째 줄로 둔다 — 없애면 그 문장을 언제
          쓰는지가 화면에서 사라진다.
        */}
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {block.lines.map((line) => (
            <div key={line.say} className="rounded-[12px] bg-[var(--color-ivory-warm)] px-4 py-4">
              <p className="relative pl-4 text-[13px] font-medium leading-[1.6] text-[var(--color-paper-ink)]">
                <span
                  aria-hidden
                  className="absolute left-0 top-0 font-serif-kr text-[18px] leading-none text-[var(--color-rose-500)]"
                >
                  “
                </span>
                {line.say}
              </p>
              {line.note ? (
                <p className="mt-2 text-[11.5px] leading-[1.55]" style={{ color: INK_MUTED }}>
                  {line.note}
                </p>
              ) : null}
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
        붙어 있어 통째로 바꿀 수 없다. 요약을 위에 얹고 표는 접어 둔다.

        말은 표의 첫 열에서 줄여 온 것이다. 없는 숫자를 만들지 않았다
        (「예식 두세 시간 전」을 「-3h」로 바꾸면 정밀도를 지어내는 것이다).
      */}
      {block.timeline ? (
        <div className="mb-4 -mx-1 overflow-x-auto pb-1">
          <div className="relative flex min-w-max items-start pt-2.5">
            <span
              aria-hidden
              className="absolute left-[22px] right-[22px] top-6 h-0.5"
              style={{ backgroundColor: HAIRLINE }}
            />
            {block.timeline.map((node) => (
              <div key={node.at} className="relative w-[104px] shrink-0 px-1 text-center">
                <span
                  aria-hidden
                  className="mx-auto mb-2.5 block h-3.5 w-3.5 rounded-full border-[2.5px] border-[var(--color-rose-500)] bg-white"
                />
                <span className="mb-[3px] block text-[11.5px]" style={{ color: INK_MUTED }}>
                  {node.at}
                </span>
                <span className="block text-[12.5px] font-semibold leading-[1.4] text-[var(--color-paper-ink)]">
                  {node.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-[13px] font-bold text-[var(--color-rose-600)]">{block.title}</p>
        {/*
          기준 시점은 **표 안에** 있어야 한다. 각주에만 적었더니 표가 현재 값처럼
          읽혔다 — 사용자는 표만 캡처해 옮기고, 옮겨진 표에는 각주가 안 따라간다.
        */}
        <span
          className="rounded-full bg-[var(--color-surface-low)] px-2 py-0.5 text-[11px] font-medium"
          style={{ color: INK_MUTED }}
        >
          {block.asOf}
        </span>
      </div>

      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              {block.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 pb-2 pt-0 text-[11px] font-bold"
                  style={{ color: INK_MUTED }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                {row.map((cell, index) => (
                  <td
                    key={cell}
                    className={`px-3 py-[11px] align-top ${
                      index === 0
                        ? "whitespace-nowrap text-[12.5px] font-medium text-[var(--color-paper-ink)]"
                        : compare
                          ? "text-[12.5px] leading-[1.6]"
                          : index === row.length - 1 && row.length >= 3
                            ? "text-[11.5px] leading-[1.5]"
                            : "text-[12.5px] leading-[1.6] text-[var(--color-paper-ink-soft)]"
                    }`}
                    style={
                      /*
                        두 갈래 표는 **글자색**으로 갈린다(시안 `td.ok` / `td.no`) —
                        무난한 쪽은 세이지, 다시 생각할 쪽은 진한 로즈. 색만으로 말하지
                        않는다: 머리글이 이미 어느 쪽인지 글자로 말한다.
                      */
                      compare && index === 1
                        ? { color: "var(--color-sage-500)" }
                        : compare && index === 2
                          ? { color: "var(--color-rose-600)" }
                          : index === row.length - 1 && row.length >= 3
                            ? { color: INK_MUTED }
                            : undefined
                    }
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
            className="m-0 py-3"
            style={{ borderBottom: `1px solid ${HAIRLINE}` }}
          >
            {row.map((cell, index) => (
              <div key={cell} className={index === 0 ? "" : "mt-1.5 flex justify-between gap-3"}>
                {index === 0 ? (
                  <dt className="text-[12.5px] font-medium text-[var(--color-paper-ink)]">{cell}</dt>
                ) : (
                  <>
                    <dt className="shrink-0 text-[11px]" style={{ color: INK_MUTED }}>
                      {block.columns[index]}
                    </dt>
                    <dd className="m-0 text-right text-[12px] leading-[1.5] text-[var(--color-paper-ink-soft)]">
                      {cell}
                    </dd>
                  </>
                )}
              </div>
            ))}
          </dl>
        ))}
      </div>

      {/*
        시안 `.read-tip` — 표 **아래에 붙는** 따뜻한 띠(위 두 모서리가 0이라 표와 한
        덩어리로 읽힌다). 「이 숫자가 말하지 않는 것」이 여기 산다. 표만 캡처해 옮겨도
        한계가 같이 가야 한다는 계약(`types.ts`)이 이 자리를 요구한다.
      */}
      <div className="mt-0.5 flex gap-2.5 rounded-b-[10px] bg-[var(--color-ivory-warm)] px-3.5 py-3">
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
        <p className="text-[12px] leading-[1.6] text-[var(--color-paper-ink-soft)]">
          {block.caption} <span className="font-medium">이 숫자가 말하지 않는 것 · </span>
          {block.limits}
          {block.unsourced ? " 공개된 1차 자료를 아직 찾지 못한 표예요." : null}
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
                    className="font-medium text-[var(--hb-accent)]"
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
  both: { label: "모두에게", className: "bg-[var(--color-surface-low)] text-[var(--color-paper-ink)]" },
  guest: { label: "초대받은 분께", className: "bg-[var(--hb-accent)] text-white" },
  couple: { label: "준비하는 두 분께", className: "bg-[var(--color-paper-ink)] text-white" },
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

/** 「공통」 절은 어느 탭에서도 보인다. */
const SHARED_ROLE = "공통";

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
  const lastCheckedAt = part.sources
    .map((source) => source.checkedAt)
    .sort()
    .at(-1);
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
  const countFor = (match: string | null) =>
    part.sections.filter(
      (section) => !match || section.role === match || section.role === SHARED_ROLE,
    ).length;

  const shownSources = part.sources.slice(0, SOURCES_SHOWN);
  const hiddenSources = part.sources.slice(SOURCES_SHOWN);

  return (
    <div className="mx-auto w-full max-w-[1092px] px-4 pb-14 pt-6 sm:px-6 lg:px-0">
      <article className="min-w-0">
        <header>
          {/* 시안 `.crumb` — 파란 글자, 밑줄 없음, 현재 편 이름까지. */}
          <p className="mb-3.5 text-[12.5px] text-[var(--hb-accent)]">
            <Link {...weddingLinkProps("/manners")}>결혼 예절 안내</Link>
            {" > "}
            {part.title}
          </p>

          {/* 시안 h1 — 32px / **400** / 디스플레이 서체. 굵지 않다. */}
          <h1 className="font-serif-kr text-[26px] font-normal text-[var(--color-paper-ink)] sm:text-[32px]">
            {part.title}
          </h1>
          {/*
            부제는 `subtitle` 이다. 예전에는 `description`(중앙 84자)을 썼는데 시안 부제
            자리는 한 줄이고, `subtitle` 이 9~27자로 딱 맞는다. 자료는 이미 있었다.
          */}
          <p className="mb-4 mt-2 text-[14px]" style={{ color: INK_MUTED }}>
            {part.subtitle}
          </p>

          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={`rounded-full px-4 py-2 text-[13px] font-semibold ${audience.className}`}>
              {audience.label}
            </span>
            <span className="text-[12.5px]" style={{ color: INK_MUTED }}>
              예상 읽기 {readingMinutes}분 · {part.sections.length}개 절
            </span>
            {lastCheckedAt ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold"
                style={{ backgroundColor: "#DBE3D6", color: "#3d4d3e" }}
              >
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
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-[11px] py-[5px] text-[11.5px]"
                style={{ borderColor: HAIRLINE, color: INK_MUTED }}
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
            이 글이 **무엇을 다루는지** 한 줄. 시안의 `.excerpt-note` 와 같은 자리·같은
            모양(배지 줄 아래 12px 흐린 글씨)이다.

            2026-09-04 에 부제를 `description` 에서 `subtitle` 로 바꾸면서 이 문장이
            화면에서 통째로 사라졌었다. 검색으로 들어온 사람에게는 이 한 줄이 「이 글을
            읽어야 하나」를 가르는 유일한 문장이라 되살린다.
          */}
          <p className="text-[12px] leading-[1.6]" style={{ color: INK_MUTED }}>
            {part.description}
          </p>
        </header>

        {/*
          역할 탭. 숨긴 라디오와 CSS 형제 선택자로만 움직인다 — 이 화면은 클라이언트
          JS 가 0이고 정적으로 미리 만들어진다(`globals.css` 의 「예절 안내 — 역할 탭」).
        */}
        <div className={hasRoles ? "manners-roles" : undefined}>
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
            <div className="manners-role-tabs mb-5 flex flex-wrap gap-2" role="group" aria-label="역할 고르기">
              {ROLE_TABS.map((tab) => (
                <label
                  key={tab.key}
                  htmlFor={roleId(tab.key)}
                  className="rounded-full border bg-white px-[18px] py-[9px] text-[13.5px] text-[var(--color-paper-ink-soft)]"
                  style={{ borderColor: HAIRLINE }}
                >
                  {tab.label}
                </label>
              ))}
            </div>
          ) : null}

          {hasRoles ? (
            <div className="manners-role-dots mb-6">
              {ROLE_TABS.map((tab) => (
                <div
                  key={tab.key}
                  className="manners-dots items-center gap-1.5"
                  data-for={tab.key}
                >
                  {Array.from({ length: countFor(tab.match) }, (_, index) => (
                    <span
                      key={index}
                      aria-hidden
                      className="h-[5px] w-[26px] rounded-full"
                      style={{ backgroundColor: index === 0 ? "var(--color-rose-500)" : HAIRLINE }}
                    />
                  ))}
                  <span className="ml-2 whitespace-nowrap text-[12px]" style={{ color: INK_MUTED }}>
                    {countFor(tab.match)}개 절 · {tab.caption}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

        <div className="manners-sections mt-6 space-y-[12px] sm:space-y-[18px]">
          {/* 「정답이 아니라 관행」 고지. 시안 `.notice` — 테두리 있는 따뜻한 상자. */}
          <div
            className="flex gap-3 rounded-[12px] bg-[var(--color-ivory-warm)] p-3.5 sm:rounded-[14px] sm:px-[18px] sm:py-4"
            style={{ border: `1px solid ${HAIRLINE}` }}
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
            <p className="text-[13px] leading-[1.65] text-[var(--color-paper-ink-soft)]">
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
            const lead =
              head?.kind === "paragraph" && !head.law && rest.length > 0 ? head : undefined;
            const body = lead ? rest : section.blocks;

            return (
              <section
                key={section.heading}
                id={`section-${index + 1}`}
                data-role={section.role}
                className="scroll-mt-28 rounded-[16px] bg-white px-[18px] py-5 sm:rounded-[18px] sm:px-7 sm:py-[26px]"
                style={{ border: `1px solid ${HAIRLINE}` }}
              >
                <div className="mb-3.5 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[var(--color-rose-pale)] text-[12px] font-bold text-[var(--color-rose-600)] sm:h-[34px] sm:w-[34px] sm:rounded-[10px] sm:text-[13px]"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="min-w-0 flex-1 text-[15.5px] font-semibold leading-[1.4] text-[var(--color-paper-ink)] sm:text-[18px]">
                    {sectionLabel(section.heading)}
                  </h2>
                  <span className="shrink-0 text-[11px] sm:text-[12px]" style={{ color: INK_MUTED }}>
                    {index + 1}/{part.sections.length}
                  </span>
                </div>

                {lead ? (
                  <p className="mb-4 rounded-r-[9px] border-l-[3px] sm:rounded-r-[10px] border-[var(--color-rose-500)] bg-[var(--color-ivory-warm)] px-4 py-3 text-[13.5px] font-semibold leading-[1.6] text-[var(--color-paper-ink)] sm:text-[14px]">
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
        </div>

        {/*
          각주 `cite-foot`. **출처가 없는 편에는 아예 안 그린다** — 시안 신혼여행 편이
          그렇고, 실제로 25편 중 14편이 출처 0개다. 예전에는 그 14편에 「아직 없어요」
          상자만 남아 있었다.
        */}
        {part.sources.length > 0 ? (
          <footer
            className="mt-3 rounded-[14px] bg-white p-4 sm:mt-[18px] sm:rounded-[16px] sm:px-6 sm:py-5"
            style={{ border: `1px solid ${HAIRLINE}` }}
          >
            <h2 className="flex items-center gap-2 text-[13px] font-bold text-[var(--color-paper-ink)]">
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
                    className="text-[12.5px] font-semibold text-[var(--hb-accent)]"
                  >
                    {source.label}
                  </a>
                  <span className="text-[12.5px]" style={{ color: INK_MUTED }}>
                    {" · "}
                    {source.checkedAt} 확인
                  </span>
                  <p className="mt-1 text-[12px] leading-[1.6]" style={{ color: INK_MUTED }}>
                    {source.scope} · {source.supports}
                  </p>
                </li>
              ))}
            </ul>
            {/*
              접기는 `<details>` 로 한다. 이 화면은 클라이언트 JS 가 0이고
              (`manners/layout.tsx`), `<button>` 으로 만들면 768px 이하에서 전역 CSS 의
              44px 최소 탭 규칙이 알약을 정사각형으로 만든다.
            */}
            {hiddenSources.length > 0 ? (
              <details className="mt-1 group">
                <summary
                  className="cursor-pointer list-none text-[12px] font-semibold text-[var(--hb-accent)]"
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
                        className="text-[12.5px] font-semibold text-[var(--hb-accent)]"
                      >
                        {source.label}
                      </a>
                      <span className="text-[12.5px]" style={{ color: INK_MUTED }}>
                        {" · "}
                        {source.checkedAt} 확인
                      </span>
                      <p className="mt-1 text-[12px] leading-[1.6]" style={{ color: INK_MUTED }}>
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
        <div className="mt-[18px] rounded-[14px] bg-[var(--color-ivory-warm)] px-5 py-5" style={{ border: `1px solid ${HAIRLINE}` }}>
          <p className="text-[12.5px] font-bold text-[var(--color-rose-600)]">읽은 뒤 준비하기</p>
          <p className="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--color-paper-ink-soft)]">
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
            className="mt-3.5 inline-flex min-h-11 items-center rounded-[11px] bg-[var(--color-paper-ink)] px-5 text-[13px] font-semibold text-white"
          >
            {checklistLabel ? `${checklistLabel} 체크리스트 열기` : "아모라에게 물어보기"}
          </Link>
        </div>

        {/* 이웃 편으로. 시안의 이전/다음 버튼 — 화살표 아이콘이 붙는다. */}
        {previous || next ? (
          <nav className="mt-[18px] flex flex-col gap-3 sm:flex-row" aria-label="다른 편">
            {previous ? (
              <Link
                {...weddingLinkProps(`/manners/${previous.slug}`)}
                className="flex flex-1 items-center gap-2.5 rounded-[14px] bg-white px-5 py-4"
                style={{ border: `1px solid ${HAIRLINE}` }}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 fill-none stroke-current stroke-[1.7]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: INK_MUTED }}
                >
                  <path d="M15 5l-7 7 7 7" />
                </svg>
                <span className="min-w-0">
                  <span className="block text-[12px]" style={{ color: INK_MUTED }}>
                    이전
                  </span>
                  <span className="block text-[13.5px] font-semibold text-[var(--color-paper-ink)]">
                    {previous.title}
                  </span>
                </span>
              </Link>
            ) : null}
            {next ? (
              <Link
                {...weddingLinkProps(`/manners/${next.slug}`)}
                className="flex flex-1 items-center justify-end gap-2.5 rounded-[14px] bg-white px-5 py-4 text-right"
                style={{ border: `1px solid ${HAIRLINE}` }}
              >
                <span className="min-w-0">
                  <span className="block text-[12px]" style={{ color: INK_MUTED }}>
                    다음
                  </span>
                  <span className="block text-[13.5px] font-semibold text-[var(--color-paper-ink)]">
                    {next.title}
                  </span>
                </span>
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 fill-none stroke-current stroke-[1.7]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: INK_MUTED }}
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>
    </div>
  );
}
