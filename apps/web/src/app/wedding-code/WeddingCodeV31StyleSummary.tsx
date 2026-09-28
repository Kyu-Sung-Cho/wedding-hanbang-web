"use client";

import { useId } from "react";
import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import {
  V31_STYLE_BORDERLINE_TAG,
  V31_STYLE_DIMENSIONS,
  V31_STYLE_DOTS_LEGEND,
  V31_STYLE_LETTER_RULE,
  buildV31StyleSummary,
  v31StyleShowsLetterRule,
  type V31StatementScale,
  type V31StyleLetter,
} from "@/lib/weddingCode/v31StyleSummary";
import { V31RatingAnswer, v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";

type EditHandler = (id?: string) => void;

function Statement({ item, onEdit }: { item: V31StatementScale; onEdit?: EditHandler }) {
  return <div className="min-w-0 py-4 first:pt-0 last:pb-0" data-statement-scale={item.id}>
    <p className={v31Body}>{item.statement}</p>
    <p className="mt-2 text-sm"><V31RatingAnswer item={item} /></p>
    {onEdit ? <Button variant="ghost" size="sm" onClick={() => onEdit(item.id)} aria-label={`${item.shortLabel} 답 수정`} className="mt-2">답 수정</Button> : null}
  </div>;
}

/** 글자를 소리 내어 읽는 이름. ‘?’는 기호 대신 ‘물음표’로 읽는다. */
function spoken(letter: V31StyleLetter) {
  return letter === "?" ? "물음표" : letter;
}

/**
 * 한 사람의 코드 카드(혼자 결과와 사람별 탭). 두 사람을 함께 보는 탭은 이 카드를 두 장 두지 않고
 * 아래 WeddingCodeV31PairSummary 표 하나로 보여준다(2026-09-28 결과 되풀이 걷기).
 */
export default function WeddingCodeV31StyleSummary({ draft, label, onEdit }: {
  draft: V31Draft;
  label?: string;
  onEdit?: EditHandler;
}) {
  const summary = buildV31StyleSummary(draft);
  const coreGroups = summary.dimensions
    .map(dimension => ({ ...dimension, items: dimension.items.filter(item => item.response !== undefined) }))
    .filter(dimension => dimension.items.length > 0);
  const spokenCode = summary.dimensions.map(dimension => spoken(dimension.letter)).join(", ");
  const headingId = useId();
  // 카드의 첫 제목은 누구의 코드인지다. 그 아래 (아슬한 글자 안내)·다시 답하면 달라질 수 있다는 한 줄 → 코드 →
  // 주제 순서 설명 → (‘?’ 안내) → 주제별 줄 순서로 읽힌다.
  // 2026-09-27 파운더 결정으로 ‘~스타일’ 이름·이름 출처 줄·헤드라인은 두지 않는다.
  const heading = !label || label === "나" ? "내 웨딩코드" : `${label}의 웨딩코드`;
  const change = summary.changeNotice;

  return <section
    aria-labelledby={headingId}
    data-style-summary={summary.code}
    data-summary-version={summary.version}
    data-borderline-count={summary.borderlineCount}
    className={`${v31Surface} min-w-0 p-5 sm:p-7`}
  >
    <h2 id={headingId} className="text-xs font-semibold text-[var(--hb-success)]">{heading}</h2>
    {summary.borderlineNotice || change ? <p className={`mt-3 ${v31Body}`} data-code-notice>
      {summary.borderlineNotice ? <span data-borderline-notice>{summary.borderlineNotice}</span> : null}
      {summary.borderlineNotice && change ? " " : null}
      {change ? <span data-change-notice>{change}</span> : null}
    </p> : null}
    <p className={`mt-3 break-words font-mono text-4xl leading-tight tracking-widest ${v31Title}`} data-code>
      <span aria-hidden="true">{summary.dimensions.map(dimension => <span key={dimension.key} data-code-letter={dimension.key}
        data-borderline={dimension.borderline || undefined}>{dimension.letter}</span>)}</span>
      <span className="sr-only">{`네 글자 코드 ${spokenCode}`}</span>
    </p>
    <p className={`mt-3 ${v31Body}`} data-topic-order>{summary.dimensions.map(dimension => dimension.topicName).join(", ")} 순서로 주제마다 한 글자씩 붙였어요.</p>
    {summary.pendingNotice ? <p className={`mt-2 ${v31Body}`} data-pending-notice>{summary.pendingNotice}</p> : null}
    <p className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">결혼식 취향은 아래에 따로 모았어요.</p>

    {/* 글자가 정해진 자리의 근거는 주제마다 되풀이하지 않고 칠한 칸 설명 뒤에 규칙으로 한 번 말한다(2026-09-28). */}
    <p className={`mt-5 ${v31Body}`}>{V31_STYLE_DOTS_LEGEND}{v31StyleShowsLetterRule(summary) ? ` ${V31_STYLE_LETTER_RULE}` : null}</p>
    <dl className="mt-3 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
      {summary.dimensions.map(dimension => <div key={dimension.key} className="py-4" data-summary-topic={dimension.key}
        data-borderline={dimension.borderline || undefined} data-pending={dimension.pending ?? undefined}>
        <dt className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={`text-sm ${v31Title}`}>{dimension.title}</span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-mono text-sm ${v31Title}`}>{dimension.letter}</span>
            {/* 카드 위 안내와 같은 뜻: 두 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 갈린 한쪽 글자다. 글로 적어 화면 읽기 프로그램도 읽는다. */}
            {dimension.borderline ? <span className="text-xs font-semibold text-[var(--hb-text-body)]" data-borderline-tag>{V31_STYLE_BORDERLINE_TAG}</span> : null}
          </span>
        </dt>
        {/* 한 문장에서 나온 글자는 뜻을 한 줄 더 쓰지 않고 그 문장의 답 줄에 영문 낱말을 붙인다. */}
        {dimension.letterFrom ? null : <dd className={`mt-2 ${v31Body}`} data-letter-meaning>{dimension.label}</dd>}
        <dd className="mt-2">
          <ul className="space-y-1">{dimension.items.map(item => <li key={item.id} data-letter-answer={item.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="text-[var(--hb-text-body)]">{item.shortLabel}{item.id === dimension.letterFrom && dimension.englishLabel
              ? <span className="ml-2 text-xs text-[var(--hb-text-muted)]" data-letter-source={dimension.letter} data-english-label>{dimension.englishLabel}</span> : null}</span>
            <V31RatingAnswer item={item} />
          </li>)}</ul>
        </dd>
      </div>)}
    </dl>

    <details className="mt-4" data-core-statement-scales>
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>코드를 만든 문장 전체 보기</summary>
      <div className="pt-3">
        <p className={v31Body}>‘아직 모르겠어요’, ‘이번 계획에는 없어요’, ‘지금 답하지 않을게요’는 칸 없이 그 답만 적었어요.</p>
        {coreGroups.length ? coreGroups.map(group => <section key={group.key} className="mt-5" aria-label={`${group.title} 문장과 고른 답`}>
          <h3 className={`mb-3 text-sm ${v31Title}`}>{group.title}</h3>
          <div className="divide-y divide-[var(--hb-hairline)]">{group.items.map(item => <Statement key={item.id} item={item} onEdit={onEdit} />)}</div>
        </section>) : <p className={`mt-4 ${v31Body}`}>이 요약에 쓰는 문장은 아직 답하지 않았어요. 답을 남기면 고른 보기를 여기서 볼 수 있어요.</p>}
      </div>
    </details>
    {/* 코드에 쓰지 않은 문장의 칸은 ‘문장별로 내가 고른 답 모두 보기’에서 연다(2026-09-28, 같은 답을 두 입구에 두지 않는다). */}
  </section>;
}

/** 두 사람 표에서 코드 머리에 쓰는 이름. ‘나’는 ‘내 코드’로 읽는다. */
function owner(label: string) {
  return label === "나" ? "내 코드" : `${label}의 코드`;
}

/**
 * 함께 보기 탭의 두 사람 코드 표(2026-09-28 결과 되풀이 걷기). 예전에는 사람별 탭 첫머리와 같은 카드 두 장을 나란히 둬
 * 같은 코드·칸·접기가 한 탭 거리에서 되풀이됐다. 표는 두 코드를 따로 두고(먼저 답한 사람이 먼저, 합치지 않는다),
 * 주제마다 두 사람의 글자와 코드를 만든 두 문장의 칸을 나란히 둔다. 표가 휴대폰 한 화면보다 길어 머리가 밀려 올라가므로
 * 누구의 글자인지는 줄마다 글자 옆에 보이게 적는다. 두 글자가 모두 정해졌고 다를 때만 「글자가 달라요」를 달고,
 * ‘?’는 다르다고 하지 않으며 같다·일치·점수는 쓰지 않는다. B의 뜻 문장·접기·수정 버튼은 사람별 탭의 카드에만 둔다.
 */
export function WeddingCodeV31PairSummary({ first, second, labels, tabNames, changeNotice }: {
  first: V31Draft;
  second: V31Draft;
  labels: { first: string; second: string };
  /** 사람별 탭 이름(탭 목록에서 가져와 탭 이름이 바뀌어도 안내가 어긋나지 않게 한다). */
  tabNames: readonly string[];
  changeNotice: string | null;
}) {
  const headingId = useId();
  const people = [
    { key: "first", label: labels.first, summary: buildV31StyleSummary(first) },
    { key: "second", label: labels.second, summary: buildV31StyleSummary(second) },
  ] as const;
  return <section aria-labelledby={headingId} data-pair-summary className={`${v31Surface} mb-5 p-4 sm:p-6`}>
    <h2 id={headingId} className="text-xs font-semibold text-[var(--hb-success)]">두 사람의 웨딩코드</h2>
    {/* 두 코드에 공통인 「다시 답하면 글자가 달라질 수 있어요.」는 사람마다 되풀이하지 않고 코드보다 먼저 한 번만 말한다. */}
    <p className={`mt-3 ${v31Body}`}>{changeNotice ? <><span data-change-notice>{changeNotice}</span> 코드만 보지 말고 각자 고른 답과 아래 이야기할 거리도 같이 봐요.</> : "각자 고른 답과 아래 이야기할 거리를 같이 봐요."}</p>
    {/* 아슬한 글자·‘?’ 안내는 그 사람의 글자에 대한 사실이라 누구의 코드인지 붙여 코드보다 먼저 둔다. */}
    {people.map(person => person.summary.borderlineNotice || person.summary.pendingNotice ? <p key={person.key} data-pair-notice={person.key} className={`mt-2 ${v31Body}`}>
      <span className={v31Title}>{owner(person.label)}:</span>
      {person.summary.borderlineNotice ? <> <span data-borderline-notice>{person.summary.borderlineNotice}</span></> : null}
      {person.summary.pendingNotice ? <> <span data-pending-notice>{person.summary.pendingNotice}</span></> : null}
    </p> : null)}
    <div className="mt-4 grid grid-cols-2 gap-3">
      {people.map(person => <div key={person.key} data-pair-code={person.summary.code}>
        <p className="text-xs text-[var(--hb-text-muted)]">{owner(person.label)}</p>
        <p data-code className={`mt-1 font-mono text-4xl leading-tight tracking-widest ${v31Title}`}>
          <span aria-hidden="true">{person.summary.code}</span>
          <span className="sr-only">{`네 글자 코드 ${person.summary.dimensions.map(dimension => spoken(dimension.letter)).join(", ")}`}</span>
        </p>
      </div>)}
    </div>
    <p className={`mt-4 ${v31Body}`}>{V31_STYLE_DOTS_LEGEND}{people.some(person => v31StyleShowsLetterRule(person.summary)) ? ` ${V31_STYLE_LETTER_RULE}` : null}</p>
    <dl className="mt-3 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
      {V31_STYLE_DIMENSIONS.map((definition, index) => {
        const cells = people.map(person => ({ key: person.key, label: person.label, dimension: person.summary.dimensions[index] }));
        const [a, b] = cells;
        const differ = a.dimension.letter !== "?" && b.dimension.letter !== "?" && a.dimension.letter !== b.dimension.letter;
        return <div key={definition.key} className="py-3" data-summary-topic={definition.key}>
          <dt className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className={`text-sm ${v31Title}`}>{a.dimension.title}</span>
            {differ ? <span data-letters-differ className="text-xs font-semibold text-[var(--hb-text-body)]">글자가 달라요</span> : null}
          </dt>
          <dd className="mt-1 grid grid-cols-2 gap-3">
            {cells.map(cell => <div key={cell.key} data-pair-letter={cell.key}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span data-pair-owner className="text-xs text-[var(--hb-text-muted)]">{cell.label}</span>
                <span aria-hidden="true" className={`font-mono text-sm ${v31Title}`}>{cell.dimension.letter}</span>
                <span className="sr-only">{spoken(cell.dimension.letter)}</span>
              </p>
              {cell.dimension.borderline ? <p data-borderline-tag className="text-xs font-semibold text-[var(--hb-text-body)]">{V31_STYLE_BORDERLINE_TAG}</p> : null}
              {cell.dimension.letter === "M" || cell.dimension.letter === "N" ? <p data-letter-meaning className="text-xs leading-relaxed text-[var(--hb-text-body)]">{cell.dimension.label}</p> : null}
            </div>)}
          </dd>
          {[definition.first, definition.second].map((statement, position) => <dd key={statement.id} className="mt-2" data-pair-statement={statement.id}>
            <p className="text-xs leading-relaxed text-[var(--hb-text-body)]">{a.dimension.items[position].shortLabel} <span className="text-[var(--hb-text-muted)]">{statement.englishLabel}</span></p>
            <div className="mt-1 grid grid-cols-2 gap-3">
              {cells.map(cell => <p key={cell.key} className="min-w-0 text-sm"><span className="sr-only">{cell.label} </span><V31RatingAnswer item={cell.dimension.items[position]} /></p>)}
            </div>
          </dd>)}
        </div>;
      })}
    </dl>
    <p className={`mt-3 ${v31Body}`} data-pair-pointer>{`코드를 만든 문장 전체와 나머지 답은 ‘${tabNames[0]}’, ‘${tabNames[1]}’ 탭에서 볼 수 있어요.`}</p>
  </section>;
}
