"use client";

import { Fragment, type ReactNode } from "react";
import {
  COMPARE_COPY,
  type CompareModel,
  type CompareSortId,
  type HallCard,
} from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import { HeartIcon } from "./InvitationIcons";
import { InvitationBackLink } from "./InvitationParts";
import {
  INVITATION_SCREEN_ROOT,
  INVITATION_SCROLL_MIDDLE,
  cx,
  defaultInvitationPhotoSrc,
  type InvitationPhotoResolver,
  type InvitationRouteResolver,
} from "./invitationScreen";

type InvitationCompareProps = {
  model: CompareModel;
  /** 고른 정렬 칩. 카드 순서는 모델이 정한다(아티팩트도 칩만 바뀐다). */
  sort: CompareSortId;
  onSort: (sort: CompareSortId) => void;
  /** 하트(상담 후보에 담기). 값은 부모가 바꾼다. */
  onToggleHall: (id: string) => void;
  resolveRoute: InvitationRouteResolver;
  photoSrc?: InvitationPhotoResolver;
  /**
   * 실제 커플: 비교할 홀이 없을 때(조건이 모자람·확인한 홀이 없음·불러오기 실패) 첫 문장·카드·정렬 자리에 대신
   * 그릴 것. 넘기면 아래 문의 단추도 그리지 않는다(0곳에 보내는 편지는 없다). 예시 커플은 넘기지 않는다.
   */
  empty?: ReactNode;
  /** 실제 커플: 담기 안내나 담기 실패 한 줄. 아래 문의 단추 바로 위에 온다. */
  notice?: ReactNode;
  className?: string;
};

function HallCardView({
  hall,
  photoSrc,
  onToggle,
}: {
  hall: HallCard;
  photoSrc: InvitationPhotoResolver;
  onToggle: () => void;
}) {
  const src = hall.photo ? photoSrc(hall.photo) : null;
  const rows = [
    { label: COMPARE_COPY.rows.meal, value: hall.meal, warn: false },
    { label: COMPARE_COPY.rows.rent, value: hall.rent, warn: false },
    { label: COMPARE_COPY.rows.minimum, value: hall.minimum, warn: hall.minimumWarn },
    { label: COMPARE_COPY.rows.transit, value: hall.transit, warn: false },
  ];

  return (
    <article className="flex w-[290px] flex-none snap-start flex-col" data-hall={hall.id}>
      <div className="relative h-[200px] overflow-hidden rounded-[24px]">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- 카드 폭 290px 에 맞춘 작은 사진이라 원본을 그대로 쓴다
          <img src={src} alt={COMPARE_COPY.photoAlt(hall.name)} className="block h-full! w-full object-cover" />
        ) : null}
        {hall.badge ? (
          <span className="absolute top-3 left-3 rounded-full bg-[rgba(255,255,255,0.88)] px-2.5 py-1.5 text-[12px] font-medium text-inv-ink">
            {hall.badge}
          </span>
        ) : null}
        <Button
          variant="glass"
          size="pill-44"
          className="absolute top-2.5 right-2.5 w-11 p-0"
          aria-pressed={hall.picked}
          aria-label={COMPARE_COPY.heartLabel(hall.name)}
          onClick={onToggle}
        >
          <HeartIcon filled={hall.picked} />
        </Button>
      </div>
      <div className="flex flex-col gap-3 px-1 pt-4">
        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col gap-[3px]">
            <strong className="font-inv-serif text-[20px] font-bold">{hall.name}</strong>
            <span className="text-[13px] text-inv-muted">{hall.area}</span>
          </div>
          {hall.totalManwon ? (
            <div className="flex items-baseline gap-0.5">
              <span className="font-inv-numeral text-[30px] leading-none font-medium">{hall.totalManwon}</span>
              <span className="text-[12px] text-inv-body">{COMPARE_COPY.manwon}</span>
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-inv-divider pt-3 text-[14px]">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt className="text-inv-muted">{row.label}</dt>
              <dd className={cx("text-right", row.warn && "font-medium text-inv-warn")} data-warn={row.warn || undefined}>
                {row.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </article>
  );
}

/**
 * 웨딩홀 비교(`Compare.dc`, 390×960). 290px 카드를 옆으로 넘기며 같은 조건의 총액과 조건을
 * 견준다. 비교 꼬리표는 모델(아티팩트 문구)만 쓰고 화면이 순위나 점수를 만들지 않는다.
 *
 * 카드 줄은 아티팩트 값 그대로다. 그 값이면 크롬이 첫 카드를 화면 끝(x=0)에 붙여 맞추고,
 * 파운더가 캔버스에서 본 모습도 그렇다(2026-11-17 코디네이터 캡처 비교). 스크롤 여백을 더하지 않는다.
 *
 * 아티팩트와 다른 점(이유):
 *   - 담은 곳이 하나도 없으면 문의 단추를 잠근다. 0곳에 보내는 편지는 없다.
 *   - 문의 단추 글자는 15px 이다. 공유 버튼의 56 알약은 16px 라 글자 크기만 덮는다.
 */
export default function InvitationCompare({
  model,
  sort,
  onSort,
  onToggleHall,
  resolveRoute,
  photoSrc = defaultInvitationPhotoSrc,
  empty,
  notice,
  className,
}: InvitationCompareProps) {
  const pickedCount = model.halls.filter((hall) => hall.picked).length;
  const inquire = COMPARE_COPY.inquire(pickedCount);
  const showEmpty = empty !== undefined && empty !== null;

  return (
    <div className={cx(INVITATION_SCREEN_ROOT, className)} data-invitation-screen="compare">
      <header className="flex shrink-0 items-center gap-2 pt-4 pr-4 pb-1 pl-2.5">
        <InvitationBackLink href={resolveRoute("home")} label={COMPARE_COPY.back} />
        <AmoraOrb size={32} mood="calm" decorative />
        <span className="text-[14px] font-medium">{COMPARE_COPY.amora}</span>
      </header>

      {/* 아티팩트는 정렬 칸 뒤의 빈 칸(flex 1)이 문의 단추를 바닥으로 민다. 여기서는 가운데 칸이 그 자리를 채운다. */}
      <div data-invitation-scroll className={cx("flex flex-col", INVITATION_SCROLL_MIDDLE)}>
        {showEmpty ? (
          empty
        ) : (
          <>
        <p className="px-[22px] pt-2.5 pb-[18px] text-[17px] leading-[1.65]">
          {COMPARE_COPY.intro(model.guests, model.month)}
        </p>

        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-[22px] pb-2">
          {model.halls.map((hall) => (
            <HallCardView key={hall.id} hall={hall} photoSrc={photoSrc} onToggle={() => onToggleHall(hall.id)} />
          ))}
        </div>

        <div className="flex flex-col gap-2.5 px-[22px] pt-5">
          <div className="flex flex-wrap gap-2">
            {COMPARE_COPY.sorts.map((option) => {
              const on = option.id === sort;
              return (
                <Button
                  key={option.id}
                  variant={on ? "ink" : "outline"}
                  size="pill-38"
                  className="px-[15px]"
                  aria-pressed={on}
                  onClick={() => onSort(option.id)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          {model.sourceDateLabel ? (
            <span className="text-[12px] leading-[1.5] text-inv-muted">{COMPARE_COPY.sourceNote(model.sourceDateLabel)}</span>
          ) : null}
        </div>
          </>
        )}
      </div>

      {showEmpty ? null : (
      <div className="shrink-0 px-4 pt-3 pb-[26px]">
        {notice}
        {pickedCount > 0 ? (
          <Button href={resolveRoute("letter")} variant="ink" size="pill-56" weight="bold" fullWidth className="text-[15px]!">
            {inquire}
          </Button>
        ) : (
          <Button variant="ink" size="pill-56" weight="bold" fullWidth className="text-[15px]!" disabled>
            {inquire}
          </Button>
        )}
      </div>
      )}
    </div>
  );
}
