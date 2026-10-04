"use client";

import { useId } from "react";
import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import {
  V31_STYLE_BORDERLINE_TAG,
  buildV31StatementScales,
  buildV31StyleSummary,
  formatV31RatingDots,
  type V31StatementScale,
} from "@/lib/weddingCode/v31StyleSummary";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";

type EditHandler = (id?: string) => void;
const COUNT_WORDS = ["한", "두", "세", "네", "다섯"] as const;

/** 고른 보기를 다섯 칸 점과 보기 이름으로 보여준다. 아직 모름·이번 계획에 없음·지금 답하지 않음은 칸 없이 답만 적는다. */
function Answer({ item }: { item: V31StatementScale }) {
  return <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
    {item.rating !== null ? <span role="img" aria-label={`다섯 칸 중 ${COUNT_WORDS[item.rating - 1]} 칸`}
      className="font-mono tracking-widest text-[var(--hb-text-strong)]">{formatV31RatingDots(item.rating)}</span> : null}
    <span className={v31Title}>{item.responseLabel}</span>
  </span>;
}

function Statement({ item, onEdit }: { item: V31StatementScale; onEdit?: EditHandler }) {
  return <div className="min-w-0 py-4 first:pt-0 last:pb-0" data-statement-scale={item.id}>
    <p className={v31Body}>{item.statement}</p>
    <p className="mt-2 text-sm"><Answer item={item} /></p>
    {onEdit ? <Button variant="ghost" size="sm" onClick={() => onEdit(item.id)} aria-label={`${item.shortLabel} 답 수정`} className="mt-2">답 수정</Button> : null}
  </div>;
}

export default function WeddingCodeV31StyleSummary({ draft, label, onEdit, compact = false, showChangeNotice = true }: {
  draft: V31Draft;
  label?: string;
  onEdit?: EditHandler;
  compact?: boolean;
  /**
   * 「아래 글자는 다시 답하면 달라질 수 있어요.」를 이 카드에 둘지. 두 사람 카드를 나란히 둘 때는 두 코드에 공통인 이 말을
   * 카드 묶음 위에서 한 번만 하므로 끈다.
   */
  showChangeNotice?: boolean;
}) {
  const summary = buildV31StyleSummary(draft);
  const coreIds = new Set(summary.dimensions.flatMap(dimension => dimension.items.map(item => item.id)));
  const extraGroups = buildV31StatementScales(draft)
    .map(group => ({ ...group, items: group.items.filter(item => !coreIds.has(item.id)) }))
    .filter(group => group.items.length > 0);
  const coreGroups = summary.dimensions
    .map(dimension => ({ ...dimension, items: dimension.items.filter(item => item.response !== undefined) }))
    .filter(dimension => dimension.items.length > 0);
  const spokenCode = summary.dimensions.map(dimension => dimension.letter === "?" ? "물음표" : dimension.letter).join(", ");
  const headingId = useId();
  // 카드의 첫 제목은 누구의 코드인지다. 그 아래 (아슬한 글자 안내)·다시 답하면 달라질 수 있다는 한 줄 → 코드 →
  // 주제 순서 설명 → (‘?’ 안내) → 주제별 줄 순서로 읽힌다. 두 사람 카드를 나란히 두면 그 한 줄은 카드 묶음 위에서 한 번만 한다.
  // 2026-09-27 파운더 결정으로 ‘~스타일’ 이름·이름 출처 줄·헤드라인은 두지 않는다.
  const heading = !label || label === "나" ? "내 웨딩코드" : `${label}의 웨딩코드`;
  const change = showChangeNotice ? summary.changeNotice : null;

  return <section
    aria-labelledby={headingId}
    data-style-summary={summary.code}
    data-summary-version={summary.version}
    data-borderline-count={summary.borderlineCount}
    className={`${v31Surface} min-w-0 ${compact ? "p-4 sm:p-5" : "p-5 sm:p-7"}`}
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
    <p className={`mt-3 ${v31Body}`} data-topic-order>{summary.dimensions.map(dimension => dimension.topicName).join(", ")} 순서로 왼쪽부터 글자를 하나씩 정했어요.</p>
    {summary.pendingNotice ? <p className={`mt-2 ${v31Body}`} data-pending-notice>{summary.pendingNotice}</p> : null}
    {!compact ? <p className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">결혼식 취향은 아래에 따로 모았어요.</p> : null}

    <p className={`mt-5 ${v31Body}`}>주제마다 두 문장에 따로 답했어요. 칠한 칸이 많을수록 그 문장에 더 동의했다는 거예요.</p>
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
            <Answer item={item} />
          </li>)}</ul>
        </dd>
        {dimension.basis ? <dd className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">{dimension.basis}</dd> : null}
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

    {extraGroups.length ? <details className="mt-3 border-t border-[var(--hb-hairline)] pt-3" data-extra-statement-scales>
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>다른 문장에 고른 답도 보기</summary>
      <p className={`mt-3 ${v31Body}`}>이 답들은 네 글자에는 넣지 않았어요. 취향이나 함께 준비하는 방식을 더 살펴볼 때 참고해 주세요.</p>
      {extraGroups.map(group => <section key={group.key} className="mt-5" aria-label={`${group.title}의 다른 문장과 고른 답`}>
        <h3 className={`mb-3 text-sm ${v31Title}`}>{group.title}</h3>
        <div className="divide-y divide-[var(--hb-hairline)]">{group.items.map(item => <Statement key={item.id} item={item} onEdit={onEdit} />)}</div>
      </section>)}
    </details> : null}
  </section>;
}
