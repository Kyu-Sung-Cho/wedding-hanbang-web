import Link from "next/link";
import { HOME_COPY, type DecisionItem, type PersonChip } from "@hanbang/shared/invitation";

import Button from "@/components/ui/Button";

import { BackChevronIcon } from "./InvitationIcons";
import {
  INVITATION_BUTTON_TEXT,
  INVITATION_FOCUS_RING,
  INVITATION_LINK_TONE,
  cx,
  type InvitationRouteResolver,
} from "./invitationScreen";

/**
 * 청첩장 디자인(2026-11-17) 화면들이 함께 쓰는 작은 조각.
 * 값은 아티팩트(`Home`·`Web`·`Chat`·`Journey`·`Compare`·`Status`)의 인라인 스타일 그대로다.
 */

// ── 두 사람 머리글자 ─────────────────────────────────────────────

const CHIP_TONE = {
  /** 홈 보케 위: 34px, 첫 사람은 흰 90%, 둘째는 흰색에 흰 50% 둘레. */
  home: {
    size: "size-[34px]",
    first: "bg-[rgba(255,255,255,0.9)]",
    rest: "-ml-2 bg-inv-white shadow-[0_0_0_2px_rgba(255,255,255,0.5)]",
  },
  /** 웹 대화 칸: 32px, 첫 사람은 분홍, 둘째는 돌빛에 흰 둘레. */
  web: {
    size: "size-8",
    first: "bg-inv-blush",
    rest: "-ml-2 bg-inv-stone shadow-[0_0_0_2px_#FFFFFF]",
  },
} as const;

export function PersonChips({
  people,
  variant,
}: {
  people: readonly PersonChip[];
  variant: keyof typeof CHIP_TONE;
}) {
  if (people.length === 0) return null;
  const tone = CHIP_TONE[variant];
  return (
    <div className="flex">
      {people.map((person, index) => (
        <span
          key={`${person.initial}-${index}`}
          className={cx(
            "flex items-center justify-center rounded-full text-[12px] font-bold",
            tone.size,
            index === 0 ? tone.first : tone.rest,
          )}
        >
          <span aria-hidden="true">{person.initial}</span>
          <span className="sr-only">{person.name}</span>
        </span>
      ))}
    </div>
  );
}

// ── 뒤로 가기 ───────────────────────────────────────────────────

/**
 * 44px 정사각 뒤로 가기 링크. 위치와 면(상담 확정의 흰 원)은 `className` 으로 준다.
 * `onClick` 은 이동하기 전에 할 일(실제 커플의 첫 대화: 건너뛴 것을 기억하기)이다. 이동은 링크가 한다.
 */
export function InvitationBackLink({
  href,
  label,
  className,
  iconSize = 22,
  onClick,
}: {
  href: string;
  label: string;
  className?: string;
  iconSize?: number;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      onClick={onClick}
      className={cx("flex size-11 items-center justify-center", INVITATION_LINK_TONE, INVITATION_FOCUS_RING, className)}
    >
      <BackChevronIcon size={iconSize} />
    </Link>
  );
}

// ── 아모라 소식 아래 알약 ──────────────────────────────────────

/**
 * 먹색은 굵게 좌우 20, 테두리는 보통 굵기에 좌우 18. 상담 확정(`Status.dc`)과
 * 웹 대화(`Web.dc`)가 같은 값을 쓴다.
 */
export function UpdateActionPill({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "ink" | "outline";
  onClick?: () => void;
}) {
  return tone === "ink" ? (
    <Button variant="ink" size="pill-46" weight="bold" className="px-5" onClick={onClick}>
      {label}
    </Button>
  ) : (
    <Button variant="outline" size="pill-46" className={cx("px-[18px]", INVITATION_BUTTON_TEXT)} onClick={onClick}>
      {label}
    </Button>
  );
}

// ── 두 분이 정할 것 ─────────────────────────────────────────────

/**
 * 홈(`Home.dc`)과 웹 오늘 칸(`Web.dc`)은 같은 목록을 다른 간격으로 그린다.
 *   - 홈: 줄 위아래 13px, 글자 사이 3px, 나눔선 `divider`, 글자 칸이 남는 폭을 채운다.
 *   - 웹: 줄 위아래 10px, 글자 사이 2px, 나눔선 `rowLine`, 양 끝 정렬.
 */
const DECISION_TONE = {
  home: {
    row: "flex items-center gap-3 py-[13px]",
    rule: "border-b border-inv-divider",
    text: "flex flex-1 flex-col gap-[3px]",
  },
  web: {
    row: "flex items-center justify-between gap-2.5 py-2.5",
    rule: "border-b border-inv-row-line",
    text: "flex flex-col gap-0.5",
  },
} as const;

function OwnerTag({ owner }: { owner: DecisionItem["owner"] }) {
  const together = owner.kind === "together";
  return (
    <span className={cx("rounded-full px-2.5 py-[5px] text-[12px]", together ? "bg-inv-blush" : "bg-inv-stone")}>
      {together ? HOME_COPY.together : owner.name}
    </span>
  );
}

/**
 * 실제 커플 화면이 목록 맨 앞에 더하는 한 줄(조건이 비어 있을 때의 "희망 시기와 지역 알려 주기").
 * 화면 하나가 아니라 정해진 주소(첫 대화를 다시 여는 주소)로 가므로 주소를 따로 든다.
 */
export type InvitationLeadDecision = { decision: DecisionItem; href: string };

/** 앞줄을 더한 목록. 앞줄이 없으면 목록 그대로다(예시 커플). */
export function withLeadDecision(
  decisions: readonly DecisionItem[],
  lead: InvitationLeadDecision | undefined,
): readonly DecisionItem[] {
  return lead ? [lead.decision, ...decisions] : decisions;
}

export function DecisionRows({
  decisions,
  variant,
  resolveRoute,
  lead,
}: {
  decisions: readonly DecisionItem[];
  variant: keyof typeof DECISION_TONE;
  resolveRoute: InvitationRouteResolver;
  /** `decisions` 안에 든 앞줄. 이 줄만 자기 주소로 간다. */
  lead?: InvitationLeadDecision;
}) {
  const tone = DECISION_TONE[variant];
  const hrefOf = (decision: DecisionItem, target: NonNullable<DecisionItem["target"]>) =>
    lead && decision.id === lead.decision.id ? lead.href : resolveRoute(target);
  return (
    <>
      {decisions.map((decision, index) => {
        const last = index === decisions.length - 1;
        const rowClass = cx(tone.row, !last && tone.rule);
        const body = (
          <>
            <div className={tone.text}>
              <span className="text-[15px] font-medium">{decision.title}</span>
              {decision.sub ? <span className="text-[13px] text-inv-muted">{decision.sub}</span> : null}
            </div>
            <OwnerTag owner={decision.owner} />
          </>
        );
        if (decision.target === null) {
          return (
            <div key={decision.id} className={rowClass} data-decision={decision.id}>
              {body}
            </div>
          );
        }
        return (
          <Link
            key={decision.id}
            href={hrefOf(decision, decision.target)}
            className={cx(rowClass, INVITATION_LINK_TONE, INVITATION_FOCUS_RING)}
            data-decision={decision.id}
          >
            {body}
          </Link>
        );
      })}
    </>
  );
}
