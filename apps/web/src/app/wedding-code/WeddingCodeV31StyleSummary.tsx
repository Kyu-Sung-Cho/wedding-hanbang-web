"use client";

import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import {
  buildV31StatementScales,
  buildV31StyleSummary,
  formatV31RatingDots,
  type V31StatementScale,
} from "@/lib/weddingCode/v31StyleSummary";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";

type EditHandler = (id?: string) => void;
const COUNT_WORDS = ["한", "두", "세", "네", "다섯"] as const;

/** 고른 보기를 다섯 칸 점과 보기 이름으로 보여준다. 모름·계획 없음·건너뜀은 칸 없이 답만 적는다. */
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

export default function WeddingCodeV31StyleSummary({ draft, label, onEdit, compact = false }: {
  draft: V31Draft;
  label?: string;
  onEdit?: EditHandler;
  compact?: boolean;
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

  return <section
    aria-label={label ?? "내 웨딩코드 응답 요약"}
    data-style-summary={summary.code}
    data-summary-version={summary.version}
    data-borderline-count={summary.borderlineCount}
    className={`${v31Surface} min-w-0 ${compact ? "p-4 sm:p-5" : "p-5 sm:p-7"}`}
  >
    <p className="text-xs font-semibold text-[var(--hb-success)]">{label ?? "내 웨딩코드"}</p>
    {summary.borderlineNotice ? <p className={`mt-3 ${v31Body}`} data-borderline-notice>{summary.borderlineNotice}</p> : null}
    <p className={`mt-3 break-words font-mono text-4xl leading-tight tracking-widest ${v31Title}`} data-code>
      <span aria-hidden="true">{summary.dimensions.map(dimension => <span key={dimension.key} data-code-letter={dimension.key}
        data-borderline={dimension.borderline || undefined}
        className={dimension.borderline ? "underline decoration-dotted decoration-2 underline-offset-8" : undefined}>{dimension.letter}</span>)}</span>
      <span className="sr-only">{`네 글자 코드 ${spokenCode}`}</span>
    </p>
    <p className="mt-4 text-xs font-semibold text-[var(--hb-text-muted)]" data-name-source={summary.nameFrom ?? "none"}>{summary.nameSource}</p>
    <h2 className={`mt-1 text-xl leading-snug ${v31Title}`}>{summary.name}</h2>
    <p className={`mt-2 ${v31Body}`}>{summary.headline}</p>
    <p className={`mt-3 ${v31Body}`}>{summary.dimensions.map(dimension => dimension.topicName).join(", ")} 순서로 주제마다 한 글자씩 붙였어요.</p>
    {summary.pendingNotice ? <p className={`mt-2 ${v31Body}`} data-pending-notice>{summary.pendingNotice}</p> : null}
    {!compact ? <p className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">결혼식 취향은 네 글자에 넣지 않았어요. 아래 개인 결과에서 따로 볼 수 있어요.</p> : null}

    <p className={`mt-5 ${v31Body}`}>주제마다 두 문장에 따로 답했어요. 칠한 칸이 많을수록 그 문장에 더 동의한 답이에요.</p>
    <dl className="mt-3 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
      {summary.dimensions.map(dimension => <div key={dimension.key} className="py-4" data-summary-topic={dimension.key}
        data-borderline={dimension.borderline || undefined} data-pending={dimension.pending ?? undefined}>
        <dt className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={`text-sm ${v31Title}`}>{dimension.title}</span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-mono text-sm ${v31Title}`}>{dimension.letter}</span>
            {dimension.borderline ? <span className="text-xs font-semibold text-[var(--hb-text-body)]" data-borderline-tag>바뀔 수 있어요</span> : null}
          </span>
        </dt>
        <dd className={`mt-2 ${v31Body}`}>
          {dimension.label}
          {dimension.englishLabel ? <span className="ml-2 text-xs text-[var(--hb-text-muted)]" data-english-label>{dimension.englishLabel}</span> : null}
        </dd>
        <dd className="mt-2">
          <ul className="space-y-1">{dimension.items.map(item => <li key={item.id} data-letter-answer={item.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="text-[var(--hb-text-body)]">{item.shortLabel}</span>
            <Answer item={item} />
          </li>)}</ul>
        </dd>
        <dd className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">{dimension.basis}</dd>
      </div>)}
    </dl>

    <details className="mt-4" data-core-statement-scales>
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>코드를 만든 문장 전체 보기</summary>
      <div className="pt-3">
        <p className={v31Body}>모름, 계획 없음, 건너뜀은 칸 없이 고른 답만 적었어요.</p>
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
