import {
  WEDDING_CODE_TALK_FIRST_HEADING,
  WEDDING_CODE_TALK_FIRST_SHARE_JUMP,
} from "@/constants/weddingCodeTalkFirst";
import type { WeddingCodeTalkFirst, WeddingCodeTalkFirstItem } from "@/lib/weddingCode/profile/talkFirst";
import { WeddingCodePoleChip } from "./WeddingCodeBadge";

const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";
const shareJumpClass =
  "mt-2 inline-flex min-h-[44px] items-center text-[14px] font-semibold text-[var(--hb-text-strong)]"
  + " underline underline-offset-4 transition-colors hover:text-[var(--hb-action)] focus-visible:outline-none"
  + " focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2";

/**
 * 혼자 결과의 「이번 주엔 뭐부터 같이 얘기해 볼까요?」.
 *
 * 「내가 이번에 고른 것」 카드 **아래**에 둔다. 코드 바로 옆에는 고른 문장 인용과 글자 뜻
 * 한 줄만 온다(CLAUDE.md 웨딩코드 계약). 글자로 고른 제안은 그 근거인 인용 다음에 와야
 * 코드가 조언을 내주는 판정처럼 읽히지 않는다.
 *
 * 칩·굳기 라벨은 배지 범례와 같은 것을 써서 같은 것을 두 이름으로 부르지 않는다.
 * 공유로 옮겨 가는 것은 버튼이다 — `href="#…"` 는 `hashchange` 를 일으켜 결과를 지운다.
 */
export default function WeddingCodeTalkFirstSection({
  talkFirst,
  onShareJump,
}: {
  talkFirst: WeddingCodeTalkFirst;
  /** 공유 버튼이 없는 화면에서는 넘기지 않는다. 그때는 옮겨 가는 버튼도 그리지 않는다. */
  onShareJump?: () => void;
}) {
  return (
    <section className={`${surface} mt-4 overflow-hidden`} data-talk-first="">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
          {WEDDING_CODE_TALK_FIRST_HEADING}
        </h2>
        <p data-talk-summary="" className="mt-2 text-[13px] font-medium leading-[1.6] text-[var(--hb-text-body)]">
          {talkFirst.summary}
        </p>
        {talkFirst.more ? (
          <p data-talk-more="" className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--hb-text-body)]">
            {talkFirst.more}
          </p>
        ) : null}
        {talkFirst.leftOut ? (
          <p data-talk-left-out="" className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
            {talkFirst.leftOut}
          </p>
        ) : null}
        {talkFirst.thinNote ? (
          <p data-talk-thin="" className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
            {talkFirst.thinNote}
          </p>
        ) : null}
      </div>

      {/* 순서가 곧 먼저 꺼낼 순서다. 번호는 그리지 않는다 — 순위표로 읽히지 않게. */}
      <ol className="list-none divide-y divide-[var(--hb-hairline)]">
        {talkFirst.items.map((item) => (
          <li key={item.axis} data-talk-item={item.axis} data-talk-kind={item.kind} className="px-5 py-4 sm:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <TalkTag item={item} />
              <span className="text-[12px] font-medium text-[var(--hb-text-muted)]">{item.tagLabel}</span>
            </div>
            <p className="mt-2.5 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
              {item.lead}
            </p>
            <p className="mt-1 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-body)]">
              {item.detail}
            </p>
          </li>
        ))}
      </ol>

      <div className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-4 sm:px-8">
        <p data-talk-partner="" className="text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
          {talkFirst.partnerLine}
        </p>
        {onShareJump ? (
          <button type="button" data-talk-share-jump="" onClick={onShareJump} className={shareJumpClass}>{WEDDING_CODE_TALK_FIRST_SHARE_JUMP}</button>
        ) : null}
      </div>
    </section>
  );
}

/** 한쪽이 많으면 그쪽 칩 하나, 하나 차이면 양쪽 칩을 모두 — 어느 쪽이 하나 더 많았는지도 보인다. */
function TalkTag({ item }: { item: WeddingCodeTalkFirstItem }) {
  const { slot } = item;
  if (item.kind === "lean" && slot.chosen) {
    return <WeddingCodePoleChip side={slot.chosen} pole={slot[slot.chosen]} chosen />;
  }
  return (
    <>
      <WeddingCodePoleChip side="left" pole={slot.left} chosen={slot.chosen === "left"} />
      <WeddingCodePoleChip side="right" pole={slot.right} chosen={slot.chosen === "right"} />
    </>
  );
}
