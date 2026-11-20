import { Fragment } from "react";
import {
  INVITATION_TEXT,
  invitationDateParts,
  invitationNames,
  type InvitationFacts,
} from "@hanbang/shared/invitation";

type InvitationCardVariant = "home" | "web" | "draft";

type InvitationCardProps = {
  facts: InvitationFacts;
  /**
   * - `home`  앱 홈(390 폭) 보케 위 카드. 머리말·시간대 줄이 있다.
   * - `web`   웹 준비 공간 머리 카드. 머리말·시간대 줄 없이 이름 20px.
   * - `draft` 첫 대화의 청첩장 초안. 둥근 카드, 이름 15px, 아래 줄은 `draftLine`.
   */
  variant: InvitationCardVariant;
  /** `draft` 의 마지막 줄(예: "서울 어딘가에서, 200명의 하객과 함께"). */
  draftLine?: string | null;
  className?: string;
};

// 웹 카드의 최대 폭: 아티팩트의 360px 은 안쪽 여백(8씩)을 뺀 값이라(content-box) 바깥 폭은 376px 이다.
const OUTER: Record<InvitationCardVariant, string> = {
  home: "rounded-[6px] bg-inv-white p-2 shadow-[0_18px_40px_rgba(80,40,40,0.18)]",
  web: "relative w-full max-w-[376px] rounded-[6px] bg-inv-white p-2 shadow-[0_18px_40px_rgba(80,40,40,0.18)]",
  draft:
    "rounded-[22px] bg-inv-white p-1.5 shadow-[0_1px_2px_rgba(30,28,34,0.06),0_8px_24px_rgba(30,28,34,0.07)]",
};

const INNER: Record<InvitationCardVariant, string> = {
  home: "flex flex-col items-center gap-2 border border-inv-gold-line px-[18px] pb-[22px] pt-7 text-center",
  web: "flex flex-col items-center gap-1.5 border border-inv-gold-line px-[18px] pb-5 pt-[26px] text-center",
  draft: "flex flex-col items-center gap-1.5 rounded-[17px] border border-inv-gold-line px-4 py-5 text-center",
};

const NAMES: Record<InvitationCardVariant, string> = {
  home: "font-inv-serif text-[22px] leading-[1.4]",
  web: "font-inv-serif text-[20px]",
  draft: "font-inv-serif text-[15px]",
};

const DATE: Record<InvitationCardVariant, string> = {
  home: "font-inv-numeral text-[40px] font-medium leading-[1.1] tracking-[0.04em]",
  web: "font-inv-numeral text-[40px] font-medium leading-[1.1] tracking-[0.04em]",
  draft: "font-inv-numeral text-[34px] font-medium leading-[1.15] tracking-[0.04em]",
};

type DateRun = { text: string; blank: boolean };

/**
 * 날짜 줄을 아티팩트와 같은 글자 덩어리로 나눈다. 아티팩트는 "2027. 05. " 를 한 덩어리 글자로,
 * 빈칸만 흐린 색 조각으로 둔다. 조각마다 따로 감싸면 글자 모양 계산이 끊겨 숫자가 반 픽셀쯤
 * 어긋난다(화면 비교에서 "05" 의 0 이 밀렸다). 그래서 이어지는 채운 칸은 한 덩어리로 합친다.
 */
function dateRuns(parts: ReturnType<typeof invitationDateParts>): readonly DateRun[] {
  const pieces = parts.flatMap((part, index): DateRun[] => {
    const own = { text: part.text, blank: part.blank };
    return index < parts.length - 1 ? [own, { text: ". ", blank: false }] : [own];
  });
  return pieces.reduce<readonly DateRun[]>((runs, piece) => {
    const last = runs[runs.length - 1];
    return last && !last.blank && !piece.blank
      ? [...runs.slice(0, -1), { text: last.text + piece.text, blank: false }]
      : [...runs, piece];
  }, []);
}

/**
 * 청첩장 카드 — 청첩장 디자인(2026-11-17)의 중심 물건.
 * 값은 아티팩트(`Home.dc.html`, `Web.dc.html`, `Chat.dc.html`)의 인라인 스타일을 그대로 옮겼다.
 * 비어 있는 칸은 짐작으로 채우지 않고 흐린 밑줄(`__`)과 "예식장을 고르고 있어요"로 둔다.
 */
export default function InvitationCard({ facts, variant, draftLine, className }: InvitationCardProps) {
  const names = invitationNames(facts);
  const dateParts = invitationDateParts(facts);
  const blankTone = variant === "draft" ? "text-inv-blank-soft" : "text-inv-blank";
  const venuePending = facts.venueName === null || facts.venueName.trim() === "";

  return (
    <article className={[OUTER[variant], className].filter(Boolean).join(" ")} data-invitation-card={variant}>
      <div className={INNER[variant]}>
        {variant === "home" && (
          <span className="text-[11px] tracking-[0.18em] text-inv-gold-ink">{INVITATION_TEXT.eyebrow}</span>
        )}
        <span className={NAMES[variant]}>{names ?? INVITATION_TEXT.eyebrow}</span>
        <span className={DATE[variant]}>
          {dateRuns(dateParts).map((run, index) =>
            run.blank ? (
              <span key={index} className={blankTone}>
                {run.text}
              </span>
            ) : (
              <Fragment key={index}>{run.text}</Fragment>
            ),
          )}
        </span>
        {variant === "home" && facts.timeLabel && (
          <span className="font-inv-serif text-[14px] text-inv-muted">{facts.timeLabel}</span>
        )}
        <span
          aria-hidden="true"
          className={`h-px w-6 bg-inv-gold-rule ${variant === "draft" ? "my-1" : "my-1.5"}`}
        />
        {variant === "draft" ? (
          draftLine ? <span className="text-[13px] text-inv-muted">{draftLine}</span> : null
        ) : venuePending ? (
          <span className="border-b border-dashed border-inv-blank pb-0.5 text-[13px] text-inv-faint">
            {INVITATION_TEXT.venuePending}
          </span>
        ) : (
          <span className="font-inv-serif text-[15px]">{facts.venueName}</span>
        )}
      </div>
    </article>
  );
}
