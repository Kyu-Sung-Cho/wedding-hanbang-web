"use client";

import { ArrowRight, Pencil, RotateCcw } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { buildV31Profile, compareV31, getV31PriorityOptions, splitV31InsightsBySummary, v31ChoiceLabels, type V31Insight, type V31PairItem, type V31Profile } from "@/lib/weddingCode/v31";
import { V31_STYLE_DIMENSIONS } from "@/lib/weddingCode/v31StyleSummary";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Sharing from "./WeddingCodeV31Sharing";
import WeddingCodeV31StyleSummary from "./WeddingCodeV31StyleSummary";

type EditHandler = (id?: string) => void;
type PairLabels = { first: string; second: string };
type ResultTab = "together" | "first" | "second";

function hasResponse(draft: V31Draft, id: string) {
  const question = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === id);
  if (question) return draft.answers[question.id] !== undefined;
  const taste = WEDDING_CODE_V31_TASTES.find(item => `taste.${item.key}` === id);
  if (taste) return draft.tastes[taste.key] !== undefined;
  return id === "avoidances" ? draft.avoidances !== undefined
    : id === "priorities" ? draft.priorities !== undefined
      : id === "spending" ? draft.spending !== undefined : false;
}

/**
 * 네 글자 요약이 칸과 함께 먼저 보여주는 여덟 문장. 이 문장들만 근거인 설명은 요약을 되풀이하므로
 * 개인 결과에서 뒤로 보내 접는다(정렬 원칙은 splitV31InsightsBySummary 주석).
 */
const SUMMARY_STATEMENT_IDS: readonly string[] = V31_STYLE_DIMENSIONS.flatMap(dimension => [dimension.first.id, dimension.second.id]);

/** 설명 카드의 근거 보기·답 수정·접기 사용법. 카드마다 쓰지 않고 카드 목록 위에 한 번만 쓴다. */
function insightNote(onEdit?: EditHandler) {
  return onEdit
    ? "설명이 내 생각과 다르면 ‘어떤 답에서 나온 설명인가요?’를 열어 답을 고치거나 설명을 접어 두세요."
    : "설명이 맞지 않으면 ‘어떤 답에서 나온 설명인가요?’를 열어 설명을 접어 둘 수 있어요.";
}

function Insight({ item, onEdit }: { item: V31Insight; onEdit?: EditHandler }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return <p className={`${v31Body} border-b border-[var(--hb-hairline)] py-3`}>이 설명을 접었어요. <Button variant="ghost" onClick={() => setHidden(false)}>다시 보기</Button></p>;
  return <article className="border-b border-[var(--hb-hairline)] py-5 first:pt-0 last:border-0 last:pb-0" data-insight={item.id}>
    <h3 className={`text-lg leading-relaxed ${v31Title}`}>{item.title}</h3>
    {item.body ? <p className={`mt-2 ${v31Body}`}>{item.body}</p> : null}
    <div className="mt-4 flex gap-2 rounded-lg bg-[var(--hb-surface-hover)] p-4">
      <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--hb-success)]" />
      <div><p className="text-xs font-semibold text-[var(--hb-success)]">준비할 때 이렇게 해봐요</p><p className={`mt-1 ${v31Body}`}>{item.nextStep}</p></div>
    </div>
    <details className={`mt-3 ${v31Body}`} data-insight-evidence>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">어떤 답에서 나온 설명인가요?</summary>
      <ul className="space-y-3 pt-2">{item.evidence.map(answer => <li key={answer.id}>
        <p>{answer.text}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-[var(--hb-text-strong)]">{answer.answer}</p>
          {onEdit ? <Button variant="ghost" size="sm" onClick={() => onEdit(answer.id)} aria-label={`${answer.text} 답 수정`}>
            <Pencil aria-hidden="true" className="size-4 shrink-0" />답 수정
          </Button> : null}
        </div>
      </li>)}</ul>
      <Button variant="ghost" onClick={() => setHidden(true)} className="mt-2">이 설명 접기</Button>
    </details>
  </article>;
}

function RawAnswers({ profile, draft, onEdit, personLabel }: { profile: V31Profile; draft: V31Draft; onEdit?: EditHandler; personLabel?: string }) {
  const topics = profile.topics.map(topic => ({ ...topic, responses: topic.responses.filter(response => hasResponse(draft, response.id)) }))
    .filter(topic => topic.responses.length > 0);
  return <details className={`${v31Surface} mt-5 p-5 sm:p-7`}>
    <summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>{personLabel ? `${personLabel}의 문장별 답 모두 보기` : "문장별로 내가 고른 답 모두 보기"}</summary>
    <p className={`mt-2 ${v31Body}`}>중간 응답, 아직 모름, 계획 없음, 답하지 않음은 각각 그대로 남겨요.</p>
    {topics.map(topic => <section key={topic.key} className="mt-5">
      <h3 className={`text-sm ${v31Title}`}>{topic.title}</h3>
      <ul className="mt-2 divide-y divide-[var(--hb-hairline)]">{topic.responses.map(response => <li key={response.id} className="py-3">
        <p className={v31Body}>{response.text}</p><div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{response.answer}</p>
          {onEdit ? <Button variant="ghost" onClick={() => onEdit(response.id)} aria-label={`${response.text} 답 수정`} size="sm">수정</Button> : null}
        </div>
      </li>)}</ul>
    </section>)}
  </details>;
}

function PersonalProfile({ draft, onEdit, nested = false, personLabel }: { draft: V31Draft; onEdit?: EditHandler; nested?: boolean; personLabel?: string }) {
  const profile = buildV31Profile(draft);
  const unresolved = profile.unresolved.filter(item => hasResponse(draft, item.id));
  const [memo, setMemo] = useState("");
  const priorityInsightIds = new Set(profile.priorityGuides.flatMap(item => item.coveredInsightIds ?? [item.sourceInsightId]));
  // 우선순위 안내 카드가 가져간 취향·피하고 싶은 것의 다음 행동은 아래 영역에서 다시 쓰지 않는다.
  const guidedSteps = new Set(profile.priorityGuides.map(item => item.sourceInsightId));
  // 요약에 없는 답이 섞인 설명을 앞에 세 개까지 펼치고, 네 글자 요약과 같은 여덟 문장만 근거인 설명은 따로 접는다.
  const { fresh, summaryOnly } = splitV31InsightsBySummary(profile.insights.filter(item => !priorityInsightIds.has(item.id)), SUMMARY_STATEMENT_IDS);
  const insightCount = fresh.length + summaryOnly.length;
  // 참여 방식 안내 카드(무대로 부르지 않고 자리에서 함께하는 방식)가 펼친 채 보이면, 무대 참여를 피하고 싶다는 줄은
  // 같은 이야기를 다시 하지 않는다. 카드가 ‘다른 설명 더 보기’ 안에 접혀 있으면 줄의 다음 행동을 그대로 둔다.
  const participationShown = profile.priorityGuides.some(item => item.sourceInsightId === "participation-format")
    || fresh.slice(0, 3).some(item => item.id === "participation-format");
  const who = personLabel ? "이 사람이" : "내가";
  const priorityStatus = draft.priorities?.status === "skipped" ? "우선순위는 이번에 고르지 않았어요."
    : draft.priorities?.status === "no_preference" ? "꼭 지키고 싶은 건 따로 없다고 답했어요."
      : draft.priorities?.status === "undecided" ? "우선순위는 아직 정하지 않았어요."
        : v31ChoiceLabels(draft.priorities, []).join(" · ");
  const foldSummary = `flex min-h-11 cursor-pointer items-center text-sm ${v31Title}`;
  // 우선순위를 한 번도 묻지 않은 결과(예전 기본 흐름을 마친 저장본)나, 고를 보기가 없어 건너뛴 뒤 취향을 고친 결과에서도
  // 결과 화면에서 우선순위를 고를 수 있게 한다. 받은 결과·상대 탭처럼 수정할 수 없는 화면에서는 그리지 않는다.
  const priorityEntry = draft.priorities === undefined && onEdit !== undefined && getV31PriorityOptions(draft).length > 0;
  return <div>
    {priorityEntry ? <section className={`${v31Surface} p-5 sm:p-7`} data-priority-entry>
      <h2 className={`text-lg ${v31Title}`}>꼭 지키고 싶은 것도 골라볼 수 있어요</h2>
      <Button variant="secondary" onClick={() => onEdit("priorities")} className="mt-3 whitespace-normal!">꼭 지키고 싶은 것 고르기</Button>
    </section> : null}
    {draft.priorities !== undefined ? <section className={`${v31Surface} p-5 sm:p-7`}>
      <p className="text-xs font-semibold text-[var(--hb-success)]">{personLabel ? `${personLabel}의 우선순위` : "내가 직접 고른 우선순위"}</p>
      <h2 className={`mt-2 text-xl ${v31Title}`}>이번 결혼식에서 지키고 싶은 것</h2>
      {profile.priorityLabels.length ? <ul className="mt-4 space-y-2">{profile.priorityLabels.map((label, index) => <li key={`${label}-${index}`} className={`flex gap-2 ${v31Body}`}><span aria-hidden="true" className="text-[var(--hb-success)]">·</span>{label}</li>)}</ul>
        : <p className={`mt-4 ${v31Body}`}>{priorityStatus}</p>}
      {profile.priorityLabels.length ? <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">직접 고른 것만, 고른 순서대로 적었어요.</p> : null}
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("priorities")} className="mt-2">우선순위 수정</Button> : null}
      {profile.priorityGuides.length ? <div className="mt-5 border-t border-[var(--hb-hairline)] pt-5" data-priority-guides>
        <p className={`text-base ${v31Title}`}>이 기준으로 준비를 시작해 봐요</p>
        <p className={`mb-4 mt-1 ${v31Body}`} data-insight-note>{insightNote(onEdit)}</p>
        {profile.priorityGuides.map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}
      </div> : null}
    </section> : null}
    {insightCount || !profile.priorityGuides.length ? <section className={`${v31Surface} mt-5 p-5 sm:p-7`} data-personal-insights>
      <h2 className={`text-xl ${v31Title}`}>{personLabel ? `${personLabel}의 답을 함께 보면` : "내 답을 함께 보면"}</h2>
      {insightCount ? <>
        {/* 카드 사용법은 화면에 한 번만 쓴다. 우선순위 안내가 있으면 그쪽에 이미 적었다. */}
        {profile.priorityGuides.length ? null : <p className={`mb-5 mt-2 ${v31Body}`} data-insight-note>{insightNote(onEdit)}</p>}
        <div className={profile.priorityGuides.length ? "mt-5" : undefined}>{fresh.slice(0, 3).map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}</div>
        {fresh.length > 3 ? <details className="mt-5 border-t border-[var(--hb-hairline)] pt-4" data-insight-group="more"><summary className={foldSummary}>다른 설명 {fresh.length - 3}개 더 보기</summary><div className="pt-4">{fresh.slice(3).map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}</div></details> : null}
        {summaryOnly.length ? <details className="mt-5 border-t border-[var(--hb-hairline)] pt-4" data-insight-group="summary"><summary className={foldSummary}>위 네 글자에 쓴 답으로 만든 설명 {summaryOnly.length}개 보기</summary><div className="pt-4">{summaryOnly.map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}</div></details> : null}
      </> : <p className={`mt-2 rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>아래에 {who} 고른 답을 그대로 정리했어요. 낮게 답하거나 아직 정하지 않은 것을 반대 취향으로 바꾸지 않아요. 생각이 달라지면 다시 답해도 괜찮아요.</p>}
    </section> : null}
    <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-lg ${v31Title}`}>이번 결혼식에서 피하고 싶은 것</h2>
      {profile.avoidanceSteps.length ? <ul className="mt-3 divide-y divide-[var(--hb-hairline)]" data-avoidance-summary>{profile.avoidanceSteps.map(step => <li key={step.value} className="py-3" data-avoidance-step={step.value}>
        <p className={`text-sm ${v31Title}`}>{step.label}</p>
        {guidedSteps.has(`avoid-${step.value}`) || (step.value === "stage_participation" && participationShown) ? null : <p className={`mt-1 flex gap-2 ${v31Body}`} data-next-step><ArrowRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-[var(--hb-success)]" />{step.nextStep}</p>}
      </li>)}</ul> : <p className={`mt-3 ${v31Body}`} data-avoidance-summary>{profile.avoidanceLabels.join(" · ")}</p>}
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("avoidances")} className="mt-2">피하고 싶은 것 수정</Button> : null}
    </section>
    <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-xl ${v31Title}`}>{personLabel ? `${personLabel}의 결혼식 취향` : "내가 그려본 결혼식"}</h2>
      <p className={`mt-2 ${v31Body}`}>예약 조건은 후보를 보면서 따로 정해요.</p>
      <dl className="mt-4 divide-y divide-[var(--hb-hairline)]">{profile.tastes.map(taste => <div key={taste.key} className="py-3" data-taste={taste.key}>
        <div className="flex items-center justify-between gap-3"><dt className={`text-sm ${v31Title}`}>{taste.title}</dt>{onEdit ? <Button variant="ghost" onClick={() => onEdit(`taste.${taste.key}`)} size="sm" aria-label={`${taste.title} 취향 수정`}>수정</Button> : null}</div>
        <dd className={`mt-1 ${v31Body}`}>{taste.labels.join(" · ")}</dd>
        {taste.nextStep && !guidedSteps.has(`direct-${taste.key}`) ? <dd className={`mt-1 flex gap-2 ${v31Body}`} data-next-step><ArrowRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-[var(--hb-success)]" />{taste.nextStep}</dd> : null}
      </div>)}</dl>
    </section>
    <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-lg ${v31Title}`}>다른 곳을 줄여서라도 더 쓰고 싶은 곳</h2>
      <p className={`mt-3 ${v31Body}`}>{draft.spending?.status === "no_preference" ? "더 쓰고 싶은 곳은 지금 없어요." : profile.spendingLabels.join(" · ")}</p>
      <p className={`mt-3 ${v31Body}`}>{draft.spending?.status === "no_preference" ? "상대가 더 쓰고 싶은 곳이 있다면 이유를 듣고, 전체 예산 안에서 가능한지 같이 살펴봐요." : draft.spending?.status === "answered" ? "더 쓸 곳마다 대신 줄일 곳을 같이 정해 보세요. 전체 예산을 늘릴지는 따로 정해요." : "더 쓰고 싶은 곳이 생기면 다시 답해도 괜찮아요."}</p>
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("spending")} className="mt-2">더 쓰고 싶은 곳 수정</Button> : null}
    </section>
    {unresolved.length ? <details className={`${v31Surface} mt-5 p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>모름·계획 없음·답하지 않음·맞는 보기 없음</summary>
      <p className={`mt-2 ${v31Body}`}>각각 다른 뜻의 답으로 남겨요. ‘맞는 보기가 없어요’는 취향이 아직 정해지지 않았다는 뜻은 아니에요. 보기 밖의 생각이 있다면 대화할 때 직접 들려주세요.</p>
      <ul className="mt-3 divide-y divide-[var(--hb-hairline)]">{unresolved.map(item => <li key={item.id} className="py-3"><p className={v31Body}>{item.text}</p><p className={`mt-1 text-sm ${v31Title}`}>{item.answer}</p>{onEdit ? <Button variant="ghost" onClick={() => onEdit(item.id)} className="mt-1" aria-label={`${item.text} 답 수정`}>다시 답하기</Button> : null}</li>)}</ul>
    </details> : null}
    <RawAnswers profile={profile} draft={draft} onEdit={onEdit} personLabel={personLabel} />
    {!nested ? <details className={`${v31Surface} mt-5 p-5 sm:p-7`} data-optional-personal-note>
      <summary className={`flex min-h-11 cursor-pointer items-center text-base ${v31Title}`}>내 메모 남기기 (선택)</summary>
      <label htmlFor="wedding-code-personal-note" className={`mt-3 block text-sm ${v31Title}`}>보기에는 없지만, 내가 남기고 싶은 것</label>
      <p className={`mb-3 mt-2 ${v31Body}`}>쓰지 않아도 결과를 보는 데는 문제가 없어요. 메모는 이 화면에서만 볼 수 있고, 자동 저장이나 공유 링크에는 포함되지 않아요. 새로고침하거나 답을 수정하면 지워져요.</p>
      <textarea id="wedding-code-personal-note" maxLength={500} value={memo} onChange={event => setMemo(event.target.value)} rows={3}
        className="w-full resize-y rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] p-3 text-sm leading-relaxed text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--hb-focus-ring)]" placeholder="예: 입장할 때는 우리 둘이 같이 걷고 싶어요." />
    </details> : null}
  </div>;
}

function PairItem({ item, labels, level = 3 }: { item: V31PairItem; labels: PairLabels; level?: 3 | 4 }) {
  const Heading = level === 4 ? "h4" : "h3";
  const overlap = item.kind === "partial_overlap" ? [
    { key: "shared", label: "함께 고른 보기", values: item.sharedLabels ?? [] },
    { key: "first", label: `${labels.first}만 고른 보기`, values: item.firstOnlyLabels ?? [] },
    { key: "second", label: `${labels.second}만 고른 보기`, values: item.secondOnlyLabels ?? [] },
  ].filter(row => row.values.length) : [];
  return <article className="border-b border-[var(--hb-hairline)] py-5 first:pt-0 last:border-0 last:pb-0" data-comparison={item.id} data-pair-kind={item.kind}>
    {item.isPriority ? <p className="mb-2 text-xs font-semibold text-[var(--hb-success)]">둘 중 한 사람이 우선순위로 고른 내용</p> : null}
    <Heading className={`text-base leading-relaxed ${v31Title}`}>{item.title}</Heading>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      {[{ label: labels.first, value: item.first }, { label: labels.second, value: item.second }].map(answer => <div key={answer.label} className="rounded-lg bg-[var(--hb-surface-hover)] p-3"><dt className="text-xs text-[var(--hb-text-muted)]">{answer.label}</dt><dd className={`mt-1 text-sm font-semibold leading-relaxed ${v31Title}`}>{answer.value}</dd></div>)}
    </dl>
    {overlap.length ? <ul className="mt-3 space-y-1" data-overlap>{overlap.map(row => <li key={row.key} className={v31Body} data-overlap-row={row.key}><span className={v31Title}>{row.label}:</span> {row.values.join(" · ")}</li>)}</ul> : null}
    <p className={`mt-3 ${v31Body}`}>{item.followUp}</p>
  </article>;
}

/** 우선순위로 고른 항목은 몇 개든 펼친 곳에 두고, 나머지만 limit 을 넘으면 접는다. */
function splitFolded(items: V31PairItem[], limit: number) {
  const pinned = items.filter(item => item.isPriority);
  const rest = items.filter(item => !item.isPriority);
  const visibleRest = rest.slice(0, Math.max(0, limit - pinned.length));
  return { shown: [...pinned, ...visibleRest], folded: rest.slice(visibleRest.length) };
}

function PairSection({ title, description, items, empty, labels, limit = 3 }: { title: string; description: string; items: V31PairItem[]; empty: string; labels: PairLabels; limit?: number }) {
  const { shown, folded } = splitFolded(items, limit);
  return <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
    <h2 className={`text-xl ${v31Title}`}>{title}</h2><p className={`mb-5 mt-2 ${v31Body}`}>{description}</p>
    {items.length ? <>{shown.map(item => <PairItem key={item.id} item={item} labels={labels} />)}{folded.length ? <details className="mt-4"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v31Title}`}>나머지 {folded.length}개 보기</summary><div className="pt-3">{folded.map(item => <PairItem key={item.id} item={item} labels={labels} />)}</div></details> : null}</> : <p className={`rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>{empty}</p>}
  </section>;
}

function PairGroup({ id, title, items, labels }: { id: string; title: string; items: V31PairItem[]; labels: PairLabels }) {
  if (!items.length) return null;
  return <div className="mt-6 first:mt-0" data-pair-group={id}>
    <h3 className={`text-sm ${v31Title}`}>{title}</h3>
    <div className="mt-3">{items.map(item => <PairItem key={item.id} item={item} labels={labels} level={4} />)}</div>
  </div>;
}

/**
 * 문장의 서로 반대편에 선 답을 전부 펼쳐 맨 먼저 둔다. 장소·하객 규모·지출 같은 구체 선택의 차이도
 * 펼친 채 그 뒤에 둔다. 정도만 다른 답(1 대 3)은 접되, 우선순위로 고른 것은 접지 않는다.
 */
function DifferenceSection({ items, labels, empty }: { items: V31PairItem[]; labels: PairLabels; empty: string }) {
  const priorityFirst = (list: V31PairItem[]) => [...list.filter(item => item.isPriority), ...list.filter(item => !item.isPriority)];
  const opposite = priorityFirst(items.filter(item => item.kind === "opposite"));
  const chosen = priorityFirst(items.filter(item => item.kind === "different"));
  const degree = priorityFirst(items.filter(item => item.kind === "degree"));
  const pinnedDegree = degree.filter(item => item.isPriority);
  const foldedDegree = degree.filter(item => !item.isPriority);
  const hasPriority = [...opposite, ...chosen, ...degree].some(item => item.isPriority);
  const hasOpen = opposite.length + chosen.length + pinnedDegree.length > 0;
  return <section className={`${v31Surface} mt-5 p-5 sm:p-7`} data-pair-section="difference">
    <h2 className={`text-xl ${v31Title}`}>먼저 이야기해 볼 차이</h2>
    <p className={`mb-5 mt-2 ${v31Body}`}>누가 맞는지 정하지 않아요. {hasPriority ? "아래 묶음마다 둘 중 한 사람이 우선순위로 고른 것을 앞에 뒀어요." : "아래 묶음마다 질문 순서대로 뒀어요."}</p>
    {hasOpen ? <>
      <PairGroup id="opposite" title="서로 반대로 답한 문장" items={opposite} labels={labels} />
      <PairGroup id="different" title="서로 다르게 고른 것" items={chosen} labels={labels} />
      <PairGroup id="degree" title="정도가 다른 답" items={pinnedDegree} labels={labels} />
    </> : <p className={`rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>{foldedDegree.length ? "서로 반대로 답하거나 다르게 고른 것은 없어요. 정도가 다른 답은 아래에서 볼 수 있어요." : empty}</p>}
    {foldedDegree.length ? <details className="mt-4" data-pair-group="degree-folded"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v31Title}`}>정도가 다른 답 {foldedDegree.length}개 보기</summary>
      <p className={`mb-4 mt-2 ${v31Body}`}>한 사람은 ‘전혀 그렇지 않아요’, 다른 사람은 ‘어느 쪽도 아니에요’라고 답한 문장이에요.</p>
      {/* 펼친 묶음처럼 묶음 제목 아래 항목을 둔다. 제목은 바로 위 접기 버튼과 같은 말이라 화면에는 한 번만 보인다. */}
      <h3 className="sr-only">정도가 다른 답</h3>
      {foldedDegree.map(item => <PairItem key={item.id} item={item} labels={labels} level={4} />)}
    </details> : null}
  </section>;
}

/** 접어 두는 묶음. 우선순위로 고른 항목이 섞여 있으면 그것만은 펼쳐서 보여준다. */
function FoldedPairs({ title, description, items, labels }: { title: string; description: string; items: V31PairItem[]; labels: PairLabels }) {
  if (!items.length) return null;
  const pinned = items.filter(item => item.isPriority);
  const rest = items.filter(item => !item.isPriority);
  if (!pinned.length) return <details className={`${v31Surface} mt-5 p-5 sm:p-7`}><summary className={`flex min-h-11 cursor-pointer text-base ${v31Title}`}>{title}</summary><p className={`my-3 ${v31Body}`}>{description}</p>{rest.map(item => <PairItem key={item.id} item={item} labels={labels} />)}</details>;
  return <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
    <h2 className={`text-xl ${v31Title}`}>{title}</h2><p className={`mb-5 mt-2 ${v31Body}`}>{description}</p>
    {pinned.map(item => <PairItem key={item.id} item={item} labels={labels} />)}
    {rest.length ? <details className="mt-4"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v31Title}`}>나머지 {rest.length}개 보기</summary><div className="pt-3">{rest.map(item => <PairItem key={item.id} item={item} labels={labels} />)}</div></details> : null}
  </section>;
}

/**
 * 두 사람 결과의 묶음 순서. 함께 동의한 내용 다음에 서로 다른 답을 바로 둔다(차이가 이 화면의 핵심이라
 * 여러 묶음 아래로 밀리지 않게). 둘 다 바라는 도움·일부 겹침·함께 피하기·열린 답·한 사람만 동의한 문장은 그 뒤에 둔다.
 */
function CoupleResults({ items, labels }: { items: V31PairItem[]; labels: PairLabels }) {
  const ofKind = (...kinds: V31PairItem["kind"][]) => items.filter(item => kinds.includes(item.kind));
  const partial = ofKind("partial_overlap");
  return <>
    <PairSection labels={labels} title="함께 동의하거나 고른 내용" description="문장에 둘 다 ‘그런 편’ 이상으로 답했거나, 구체 선택을 같게 고른 내용이에요. ‘맡겨도 괜찮다’는 허용과 ‘하고 싶다’는 바람은 각 문장의 뜻대로 읽어요." items={ofKind("shared_wish")} empty={partial.some(item => item.id !== "avoidances") ? "일부 보기는 함께 골랐어요. 아래 ‘일부만 겹치게 고른 것’에서 둘 다 고른 보기를 볼 수 있어요." : "이번 답에서는 함께 동의하거나 같게 고른 내용이 확인되지 않았어요. 한 사람의 답부터 이유를 들어보세요."} />
    <DifferenceSection labels={labels} items={items} empty={items.every(item => item.kind === "unavailable") ? "두 사람이 같은 항목에 답한 내용이 없어 아직 차이를 비교할 수 없어요." : "지금 비교할 수 있는 답에서는 뚜렷한 차이가 나오지 않았어요. 그래도 실제 후보와 금액은 함께 정해야 해요."} />
    {ofKind("shared_request").length ? <PairSection labels={labels} limit={Infinity} title="둘 다 바라는 도움" description="둘 다 상대에게 받고 싶다고 답한 도움이에요." items={ofKind("shared_request")} empty="" /> : null}
    {partial.length ? <PairSection labels={labels} limit={Infinity} title="일부만 겹치게 고른 것" description="둘 다 고른 보기와 한 사람만 고른 보기를 나눠 보여줘요. 둘 다 고른 것부터 이야기하면 쉬워요." items={partial} empty="" /> : null}
    {ofKind("shared_avoidance").length ? <PairSection labels={labels} title="함께 피하고 싶은 것" description="둘 다 같은 것을 피하고 싶다고 골랐어요." items={ofKind("shared_avoidance")} empty="" /> : null}
    {ofKind("open_preference").length ? <PairSection labels={labels} title="열어 두고 있는 답" description="둘 중 한 사람이라도 어느 쪽도 괜찮다고 했거나, 따로 없다고 답한 내용이에요." items={ofKind("open_preference")} empty="" /> : null}
    {ofKind("one_sided").length ? <PairSection labels={labels} limit={Infinity} title="한 사람만 동의한 문장" description="한 사람은 ‘그런 편’ 이상으로 답했고, 다른 사람은 ‘어느 쪽도 아니에요’라고 답한 문장이에요. 동의한 사람의 이유부터 들어보세요." items={ofKind("one_sided")} empty="" /> : null}
    <FoldedPairs labels={labels} title="낮게 답하거나 특별히 고르지 않은 내용" description="둘 다 낮게 답하거나 중간으로 답한 문장, 둘 다 따로 고르지 않은 답을 모았어요. 낮게 답한 이유는 서로 다를 수 있어요." items={ofKind("shared_distance", "middle")} />
    <FoldedPairs labels={labels} title="아직 함께 비교하지 않은 내용" description="한 사람만 답했거나, 모름·계획 없음·답하지 않음·맞는 보기 없음으로 남긴 내용이에요. 보기 밖의 생각이 있는 답을 미정으로 바꾸거나, 의견 차이로 단정하지 않아요." items={ofKind("unavailable")} />
  </>;
}

export default function WeddingCodeV31Results({ draft, first, received, shareOrigin, onEdit, onRestart, onMore, optionalCount = 0, readOnly = false, sharingContent }: {
  draft: V31Draft; first: V31Draft | null; received: boolean; shareOrigin: string;
  onEdit: EditHandler; onRestart: () => void;
  onMore?: () => void; optionalCount?: number;
  readOnly?: boolean; sharingContent?: ReactNode;
}) {
  const tabId = useId();
  const [activeTab, setActiveTab] = useState<ResultTab>("together");
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const sharingRef = useRef<HTMLDivElement>(null);
  const profile = buildV31Profile(draft);
  const items = first ? compareV31(first, draft).filter(item => hasResponse(first, item.id) || hasResponse(draft, item.id)) : [];
  const editable = received || readOnly ? undefined : onEdit;
  const labels: PairLabels = received ? { first: "먼저 답한 사람", second: "나중에 답한 사람" } : { first: "상대", second: "나" };
  const tabs: { id: ResultTab; label: string }[] = received
    ? [{ id: "together", label: "함께 보기" }, { id: "first", label: labels.first }, { id: "second", label: labels.second }]
    : [{ id: "together", label: "함께 보기" }, { id: "second", label: "내 결과" }, { id: "first", label: "상대 결과" }];
  const ownActionsVisible = !first || activeTab !== "first";
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    tabButtons.current[nextIndex]?.focus();
  }
  return <div data-result={first ? "couple-v31" : "solo-v31"} data-empty={!profile.hasContent || undefined}>
    <header className="mb-6">
      <p className="text-xs font-semibold text-[var(--hb-success)]">웨딩코드 · {first ? "두 사람의 결과" : "내 결과"}</p>
      <h1 className={`mt-3 text-3xl leading-snug ${v31Title}`}>{first ? "우리, 어디부터 맞춰볼까요?" : profile.hasContent ? "내가 바라는 결혼식과 준비 방식" : "이번에 남긴 답을 살펴봐요"}</h1>
      <p className={`mt-3 ${v31Body}`}>{first ? "함께 동의하거나 고른 내용부터, 서로 다르게 답한 것까지 나란히 봐요. 같은 답도 이유는 다를 수 있으니, 각자 떠올린 장면을 이야기해 보세요." : profile.hasContent ? editable ? "지금 직접 고른 취향과 답을 정리했어요." : "공유된 취향과 답을 정리했어요. 이 화면에서는 답을 수정할 수 없어요." : "모름·계획 없음·답하지 않음·맞는 보기 없음은 서로 다른 답이에요. 이 답들로 구체적인 취향을 만들지는 않았어요. 원할 때 다시 답해도 괜찮아요."}</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{received ? "받은 링크에 담긴 답이에요. 이름이나 본인 여부는 확인하지 않아요." : `답을 남긴 질문은 ${profile.respondedCount}개예요. 동의 정도를 고른 문장은 ${profile.ratedCount}개예요.`} 취향과 바람은 달라질 수 있어요. 성격 진단이나 궁합 점수는 아니에요.</p>
      {!first && editable && profile.hasContent ? <Button variant="secondary" className="mt-4 whitespace-normal!" onClick={() => { sharingRef.current?.scrollIntoView({ block: "start" }); sharingRef.current?.focus({ preventScroll: true }); }}>상대와 함께 보는 방법</Button> : null}
    </header>
    {first ? <>
      <div role="tablist" aria-label="두 사람 결과 보기" className="mb-5 grid grid-cols-3 gap-1 rounded-xl border border-paper-outline bg-[var(--hb-surface-hover)] p-1">
        {tabs.map((tab, index) => <Button key={tab.id} variant="ghost" ref={element => { tabButtons.current[index] = element; }} type="button" role="tab"
          id={`${tabId}-tab-${tab.id}`} aria-controls={`${tabId}-panel`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => setActiveTab(tab.id)} onKeyDown={event => handleTabKey(event, index)}
          className={`min-h-12! min-w-0 rounded-lg! border px-2! py-3 text-sm! font-semibold whitespace-normal! leading-snug ${activeTab === tab.id ? "border-[var(--hb-action)] bg-[var(--hb-surface-raised)] text-[var(--hb-text-strong)] underline decoration-2 underline-offset-4" : "border-transparent text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-raised)]!"}`}>
          {tab.label}
        </Button>)}
      </div>
      <div key={activeTab} role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-tab-${activeTab}`} tabIndex={0}
        className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-focus-ring)]">
        {activeTab === "together" ? <>
    <section aria-label="두 사람의 웨딩코드 요약" className="mb-5">
      <p className={`mb-4 ${v31Body}`}>같은 코드여도 구체적인 취향과 답은 다를 수 있어요. 각자 고른 답과 아래 이야기할 거리를 같이 봐요.</p>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <WeddingCodeV31StyleSummary draft={first} label={labels.first} compact />
        <WeddingCodeV31StyleSummary draft={draft} label={labels.second} onEdit={editable} compact />
      </div>
    </section>
      <CoupleResults items={items} labels={labels} />
        </> : <>
          <p className={`mb-4 ${v31Body}`}>{received ? `${labels[activeTab]}의 답을 정리했어요. 누가 본인인지는 확인하지 않으며, 이곳에서 답을 수정할 수는 없어요.` : activeTab === "second" ? readOnly ? "내가 공유한 답이에요. 이 화면에서는 답을 수정할 수 없어요." : "내가 직접 답한 내용이에요. 생각과 다른 부분은 답을 수정할 수 있어요." : "상대가 공유한 답이에요. 상대의 답을 대신 수정할 수는 없어요."}</p>
          <WeddingCodeV31StyleSummary draft={activeTab === "first" ? first : draft} label={labels[activeTab]} onEdit={activeTab === "second" ? editable : undefined} />
          <PersonalProfile draft={activeTab === "first" ? first : draft} onEdit={activeTab === "second" ? editable : undefined} personLabel={!received && activeTab === "second" ? undefined : labels[activeTab]} nested />
        </>}
      </div>
    </> : <><WeddingCodeV31StyleSummary draft={draft} onEdit={editable} /><PersonalProfile draft={draft} onEdit={editable} /></>}
    {!received && !readOnly && ownActionsVisible && onMore && optionalCount > 0 ? <section className={`${v31Surface} mt-5 p-5 sm:p-7`} aria-label="선택 질문">
      <h2 className={`text-lg ${v31Title}`}>궁금한 부분이 더 있다면</h2>
      <p className={`mt-2 ${v31Body}`}>꽃 장식이나 세부 준비 방식까지 더 살펴볼 수 있어요. 남은 {optionalCount}개를 전부 답할 필요는 없고, 언제든 결과로 돌아올 수 있어요.</p>
      <Button variant="secondary" fullWidth onClick={onMore} className="mt-4 whitespace-normal!">원하면 더 알아보기 (선택)</Button>
    </section> : null}
    <p className={`mt-6 rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>예약 전에는 추가 비용을 포함한 총액과 취소·변경 조건을 서면으로 확인해 주세요.</p>
    <div ref={sharingRef} tabIndex={-1} className="scroll-mt-6 outline-none">{sharingContent !== undefined ? sharingContent : <WeddingCodeV31Sharing shareOrigin={shareOrigin} first={first ?? draft} second={first ? draft : undefined} received={received} />}</div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {editable && ownActionsVisible ? <Button variant="secondary" onClick={() => onEdit()} className="whitespace-normal!"><Pencil aria-hidden="true" className="size-4 shrink-0" />{first ? "내가 방금 답한 내용 수정" : "내 답 수정하기"}</Button> : null}
      <Button variant="ghost" onClick={onRestart} className="whitespace-normal!"><RotateCcw aria-hidden="true" className="size-4 shrink-0" />{readOnly ? "내 웨딩코드로 돌아가기" : received ? "내 답으로 새로 시작하기" : "처음부터 다시 답하기"}</Button>
    </div>
  </div>;
}
