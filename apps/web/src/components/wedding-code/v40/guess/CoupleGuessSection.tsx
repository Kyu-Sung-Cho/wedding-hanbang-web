"use client";

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import Button from "@/components/ui/Button";
import { V40_GUESS_REVIEW, V40_GUESS_SET } from "@/constants/weddingCodeV40Guess";
import type { GuessComparison, GuessDiff, GuessLineDirection, GuessScene } from "@/lib/weddingCode/v40/guess/guessCompare";
import { V40_GUESS_COPY, guessRowLabels } from "@/lib/weddingCode/v40/guess/guessCopy";
import { cardAct } from "@/lib/weddingCode/v40/guess/guessPresent";
import type { GuessLayout } from "@/lib/weddingCode/v40/guess/types";
import type { Perspective } from "@/lib/weddingCode/v40/types";
import { bodyText, buttonFocusFix, captionText, card, cx, noteText } from "../styles";

/** 두 사람 결과 구역의 기본 배치: 장면 이름 아래 그 장면의 어긋난 줄(점수판처럼 읽히지 않는다). byDirection 은 방향 소제목 아래 장면들이다. */
export const GUESS_LAYOUT: GuessLayout = "byScene";

/**
 * 두 사람 결과의 「짐작과 답」 구역(빌드 계획 5.5).
 * 위에서 아래로: 제목, 밑줄 한 줄, 출처 문장(링크에 담긴 답을 옮긴 것이지 우리가 확인한 사실이 아니라는 것), 「가리기」와 「보기」 토글, 장면별 목록,
 * 줄 없는 장면을 말하는 정적 한 줄, 끝 줄. 줄이 하나도 없으면 제목과 빈 상태 한 줄만 그린다. 한쪽만 했거나(oneSided) 둘 다 안 했으면(none) 아무것도 그리지 않는다
 * (누가 건너뛰었는지 흔적을 남기지 않는다).
 *
 * 줄은 한 일(act)만 인용 부호 없이 그대로 보이고 성질을 말하지 않는다. 장면 이름 아래에서 사실(실제로 고른 쪽)이 먼저이고 짐작한 쪽이 뒤다. 행 이름표는 누구의 것인지를
 * 스스로 말한다. 나 기준을 알면 내가 짐작한 쪽을 먼저, 모르면 먼저 답한 사람 꼴이다(링크가 직접 만든 것이면 「나」를 정하지 않아 상대의 짐작을 내 말로 붙이지 않는다).
 * 자르지 않는다. 누가 맞혔는지, 몇 개인지, 몇 개 중인지를 어디에도 적지 않는다.
 *
 * 가리기: 열림이 기본이다(상태는 이 화면의 메모리뿐이고 저장하지 않는다). 닫으면 아래 내용이 문서에서 빠진다(숨김 스타일이 아니다).
 * 화면이 숨겨지면(visibilitychange 가 hidden) 그리고 Escape 를 누르면(초점이 어디에 있든) 닫는다. 링크를 열자마자 옆에 상대가 있을 수 있어서 가릴 길을 둔다.
 * 토글 단추는 구역 제목을 설명으로 가진다(같은 화면의 먼저 고른 글자 카드도 같은 이름 「가리기」의 단추라 낭독기가 어느 구역의 것인지 알게).
 * 사람이 읽은 장면이 없는 동안 구역 뿌리에 검토 대기 표시(data-review)를 단다.
 */
export interface CoupleGuessSectionProps {
  readonly comparison: GuessComparison;
  /** 누가 나인지. 모르면 null. */
  readonly perspective: Perspective | null;
  readonly headingLevel: 2 | 3;
  /** 한 화면 안에서 겹치지 않는 접두어. */
  readonly idPrefix: string;
  /** 배치. 기본은 GUESS_LAYOUT(장면별). */
  readonly layout?: GuessLayout;
}

/** 나를 먼저 놓는 방향 순서(peopleInOrder 와 같은 규칙). */
function directionOrder(perspective: Perspective | null): readonly [GuessLineDirection, GuessLineDirection] {
  return perspective === "second" ? ["secondGuessedFirst", "firstGuessedSecond"] : ["firstGuessedSecond", "secondGuessedFirst"];
}

interface DiffRowsProps {
  readonly sceneIndex: number;
  readonly diff: GuessDiff;
  readonly perspective: Perspective | null;
  /** 같은 장면의 앞 방향 아래에 이어지는 둘째 방향이면 가는 선으로 가른다(사실과 짐작 네 줄이 한 덩어리로 읽히지 않게). */
  readonly separated?: boolean;
}

/** 어긋난 방향 하나의 두 행: 실제로 고른 쪽, 짐작한 쪽. 값은 카드의 한 일 그대로다. */
function DiffRows({ sceneIndex, diff, perspective, separated = false }: DiffRowsProps) {
  const item = V40_GUESS_SET[sceneIndex];
  if (item === undefined) return null;
  const labels = guessRowLabels(diff.direction, perspective);
  return (
    <dl data-direction={diff.direction} className={cx("space-y-1", separated ? "mt-3 border-t border-[var(--hb-hairline)] pt-3" : "mt-2")}>
      <div>
        <dt className={captionText}>{labels.actualLabel}</dt>
        <dd className={cx(bodyText, "mt-0.5 text-[var(--hb-text-strong)]")}>{cardAct(item, diff.actual)}</dd>
      </div>
      <div>
        <dt className={captionText}>{labels.guessLabel}</dt>
        <dd className={cx(bodyText, "mt-0.5 text-[var(--hb-text-strong)]")}>{cardAct(item, diff.guessed)}</dd>
      </div>
    </dl>
  );
}

function SceneItem({ scene, perspective, only }: { readonly scene: GuessScene; readonly perspective: Perspective | null; readonly only?: GuessLineDirection }) {
  const item = V40_GUESS_SET[scene.index];
  if (item === undefined) return null;
  const order = directionOrder(perspective);
  const diffs = order
    .map((direction) => scene.diffs.find((diff) => diff.direction === direction))
    .filter((diff): diff is GuessDiff => diff !== undefined && (only === undefined || diff.direction === only));
  if (diffs.length === 0) return null;
  return (
    <li data-scene={item.id} className={cx(card, "list-none p-4")}>
      <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{item.caption}</p>
      {diffs.map((diff, position) => (
        <DiffRows key={diff.direction} sceneIndex={scene.index} diff={diff} perspective={perspective} separated={position > 0} />
      ))}
    </li>
  );
}

export function CoupleGuessSection({ comparison, perspective, headingLevel, idPrefix, layout = GUESS_LAYOUT }: CoupleGuessSectionProps): ReactElement | null {
  const uid = useId();
  const [open, setOpen] = useState(true);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  // 화면이 숨겨지면(탭을 바꾸거나 앱을 내리면) 닫는다. 다시 보이게 되어도 사람이 「보기」를 누를 때까지 닫혀 있다.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setOpen(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 열려 있는 동안 Escape 는 초점이 어디에 있든 닫는다(옆 사람이 같은 화면을 보고 있을 때 키보드로 빨리 가릴 수 있어야 한다.
  // 먼저 고른 글자 카드와 같다). 가릴 내용이 있을 때만 듣는다(줄이 없는 빈 상태에는 가리기가 없다).
  const hasBody = comparison.kind === "both" && comparison.scenes.length > 0;
  useEffect(() => {
    if (!open || !hasBody) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, hasBody]);

  // 닫히면 내용이 사라지므로 초점이 안에 있었다면 토글로 옮긴다(상태를 바꾸지 않는다).
  const wasOpen = useRef(true);
  useEffect(() => {
    if (wasOpen.current && !open) toggleRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  if (comparison.kind !== "both") return null;

  const copy = V40_GUESS_COPY;
  const titleId = `${idPrefix}-guess-title-${uid}`;
  const bodyId = `${idPrefix}-guess-body-${uid}`;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const SubHeading = headingLevel === 2 ? "h3" : "h4";
  const scenes = comparison.scenes;
  const review = V40_GUESS_REVIEW.humanReviewed ? "done" : "pending";

  if (scenes.length === 0) {
    return (
      <section aria-labelledby={titleId} data-part="guess" data-review={review}>
        <Heading id={titleId} className="text-base font-semibold leading-snug text-[var(--hb-text-strong)]">
          {copy.title}
        </Heading>
        <p className={cx(bodyText, "mt-2")} data-guess-empty="">
          {copy.emptyState}
        </p>
      </section>
    );
  }

  const order = directionOrder(perspective);

  return (
    <section
      aria-labelledby={titleId}
      data-part="guess"
      data-review={review}
      data-layout={layout}
    >
      <Heading id={titleId} className="text-base font-semibold leading-snug text-[var(--hb-text-strong)]">
        {copy.title}
      </Heading>
      <p className={cx(bodyText, "mt-2")}>{copy.sub}</p>
      <p className={cx(noteText, "mt-1")} data-guess-source="">
        {copy.sourceNote}
      </p>
      <div className="mt-3">
        <Button
          ref={toggleRef}
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          aria-describedby={titleId}
          onClick={() => setOpen((previous) => !previous)}
          data-guess-toggle=""
          className={buttonFocusFix}
        >
          {open ? copy.hideButton : copy.showButton}
        </Button>
      </div>
      {open ? (
        <div id={bodyId} data-guess-body="">
          {layout === "byDirection" ? (
            order.map((direction) => {
              const withLines = scenes.filter((scene) => scene.diffs.some((diff) => diff.direction === direction));
              if (withLines.length === 0) return null;
              const labels = guessRowLabels(direction, perspective);
              return (
                <div key={direction} data-direction-group={direction} className="mt-4">
                  <SubHeading className="text-sm font-semibold text-[var(--hb-text-strong)]">{labels.subhead}</SubHeading>
                  <ul role="list" className="mt-2 space-y-3">
                    {withLines.map((scene) => (
                      <SceneItem key={scene.index} scene={scene} perspective={perspective} only={direction} />
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <ul role="list" className="mt-4 space-y-3">
              {scenes.map((scene) => (
                <SceneItem key={scene.index} scene={scene} perspective={perspective} />
              ))}
            </ul>
          )}
          {/* 줄이 없는 장면이 있을 때만 그 장면을 말한다. 여섯 장면이 모두 줄로 놓였으면 「여기에 없는 장면」이 가리킬 것이 없다. */}
          {scenes.length < V40_GUESS_SET.length ? (
            <p className={cx(noteText, "mt-3")} data-guess-unlisted="">
              {copy.unlistedNote}
            </p>
          ) : null}
          <p className={cx(noteText, "mt-1")} data-guess-tail="">
            {copy.tail}
          </p>
        </div>
      ) : (
        <p className={cx(noteText, "mt-3")} data-guess-hidden="">
          {copy.hiddenNote}
        </p>
      )}
    </section>
  );
}

export default CoupleGuessSection;
