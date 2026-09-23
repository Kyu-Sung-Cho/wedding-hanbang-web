"use client";

import { ArrowLeft, ArrowRight, Check, HeartHandshake, ListChecks, Paintbrush } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import {
  WEDDING_CODE_V31_AVOIDANCES, WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_SPENDING, WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_TOPICS, WEDDING_CODE_V31_VERSION,
  type V31Choice, type V31Draft, type V31Response,
} from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV31Draft, getV31PriorityOptions, normalizeV31Draft } from "@/lib/weddingCode/v31";
import { V31ChoiceInput, V31PriorityInput, V31RatingInput, v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Results from "./WeddingCodeV31Results";
import { useV31LocalProgress } from "./useV31LocalProgress";
import type { V31LocalProgressSnapshot } from "@/lib/weddingCode/v31LocalProgress";
import {
  V31_CORE_INDEXES, V31_CORE_RATING_IDS, V31_EXTRA_INDEXES,
  getV31FlowIndexes, getV31MissingIndex, getV31NextIndex, getV31PreviousIndex, getV31ResponseAt,
} from "@/lib/weddingCode/v31Flow";

const coreCount = WEDDING_CODE_V31_QUESTIONS.length;
const avoidanceIndex = coreCount + WEDDING_CODE_V31_TASTES.length;
const priorityIndex = avoidanceIndex + 1;
const missingAnswerNotice = "선택이 비어 있는 질문으로 돌아왔어요. 답을 고르거나, 아래에서 ‘아직 모르겠어요’나 ‘지금 답하지 않을게요’를 골라 주세요.";
const resetStorageFailureNotice = "현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요. 공용 기기라면 브라우저 설정에서 이 사이트의 데이터를 지워 주세요.";
type Progress = Omit<V31LocalProgressSnapshot, "screen"> & { screen: "intro" | "questions" | "result" };

function responseCounts(draft: V31Draft, indexes: readonly number[]) {
  const responses = indexes.map(index => getV31ResponseAt(draft, index));
  return {
    answered_count: responses.filter(value => typeof value === "number" || (typeof value === "object" && (value.status === "answered" || value.status === "no_preference" || value.status === "no_match"))).length,
    skipped_count: responses.filter(value => value === "skipped" || (typeof value === "object" && value.status === "skipped")).length,
  };
}

export default function WeddingCodeV31Client({ shareOrigin, partnerDraft = null, bothDrafts = null, onRestart, allowLocalProgress = true, initialNotice = "" }: {
  shareOrigin: string; partnerDraft?: V31Draft | null;
  bothDrafts?: { first: V31Draft; second: V31Draft } | null; onRestart?: (message?: string) => void; allowLocalProgress?: boolean; initialNotice?: string;
}) {
  const screenRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState<Progress>(() => ({
    screen: bothDrafts ? "result" : "intro", draft: bothDrafts?.second ?? createV31Draft(),
    index: V31_CORE_INDEXES[0], flow: "core", editing: false, needsPriorityReview: false,
  }));
  const { screen, draft, index, flow, editing, needsPriorityReview } = progress;
  const [context, setContext] = useState({ first: bothDrafts?.first ?? partnerDraft, received: Boolean(bothDrafts) });
  const [owned, setOwned] = useState(false);
  const local = useV31LocalProgress(allowLocalProgress && !context.received);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(initialNotice);
  const question = index < coreCount ? WEDDING_CODE_V31_QUESTIONS[index] : null;
  const taste = index >= coreCount && index < avoidanceIndex ? WEDDING_CODE_V31_TASTES[index - coreCount] : null;
  const choice = taste ? draft.tastes[taste.key] : index === avoidanceIndex ? draft.avoidances : index === priorityIndex ? draft.priorities : draft.spending;
  const currentResponse = question ? draft.answers[question.id] : choice;
  const started = Object.keys(draft.answers).length > 0 || Object.keys(draft.tastes).length > 0;
  const hasPartnerLink = Boolean(context.first);
  const flowIndexes = getV31FlowIndexes(flow);
  const ordinal = flowIndexes.indexOf(index) + 1;
  const totalQuestions = flowIndexes.length;
  const flowLabel = flow === "extra" ? "선택 질문" : flow === "full" ? "이전 전체 질문" : "기본 질문";
  const nextIndex = getV31NextIndex(flow, index);
  const previousIndex = getV31PreviousIndex(flow, index);
  const optionalRemaining = V31_EXTRA_INDEXES.filter(item => getV31ResponseAt(draft, item) === undefined).length;
  const topicIndexes = question ? flowIndexes.filter(item => WEDDING_CODE_V31_QUESTIONS[item]?.topic === question.topic) : [];

  useEffect(() => {
    screenRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [index, screen]);
  useEffect(() => {
    if (screen === "result" && context.first) captureWeddingCodeEvent("wedding_code_comparison_viewed", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions });
  }, [context.first, screen, totalQuestions]);
  useEffect(() => {
    if (screen === "intro") captureWeddingCodeEvent("wedding_code_intro_viewed", {
      version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, has_partner_link: hasPartnerLink, placement: flow,
    });
    if (screen === "questions") captureWeddingCodeEvent("wedding_code_scene_reached", {
      version: WEDDING_CODE_V31_VERSION, scene_index: ordinal > 0 ? ordinal : 1, scene_total: totalQuestions, has_partner_link: hasPartnerLink, placement: editing ? "edit" : flow,
    });
  }, [editing, flow, hasPartnerLink, ordinal, screen, totalQuestions]);

  function commit(next: Partial<Progress>, persist = owned) {
    const changed = { ...progress, ...next };
    setProgress(changed);
    if (persist && changed.screen !== "intro") local.store.save({ ...changed, screen: changed.screen });
  }
  function update(nextDraft: V31Draft, staleTastePriority?: string, extra: Partial<Progress> = {}) {
    const normalized = normalizeV31Draft(nextDraft);
    if (staleTastePriority && normalized.priorities?.status === "answered") {
      const kept = normalized.priorities.values.filter(value => value !== staleTastePriority);
      normalized.priorities = kept.length ? { status: "answered", values: kept } : undefined;
    }
    const previousPriorities = nextDraft.priorities?.status === "answered" ? nextDraft.priorities.values : [];
    const nextPriorities = normalized.priorities?.status === "answered" ? normalized.priorities.values : [];
    if (previousPriorities.some(value => !nextPriorities.includes(value))) {
      setNotice("앞의 답이 바뀌어 더 이상 맞지 않는 우선순위를 뺐어요. 결과에서 우선순위를 다시 확인해 주세요.");
      extra.needsPriorityReview = true;
    }
    commit({ draft: normalized, ...extra });
    setRevision(value => value + 1);
  }
  function changeRating(value: V31Response) {
    if (question) update({ ...draft, answers: { ...draft.answers, [question.id]: value } });
  }
  function changeChoice(value: V31Choice | undefined) {
    if (taste) {
      const previous = draft.tastes[taste.key];
      const changed = previous?.status === "answered" && (value?.status !== "answered"
        || [...previous.values].sort().join("|") !== [...value.values].sort().join("|"));
      // 같은 취향 항목이어도 고른 내용이 바뀌면 이전 우선순위를 새 선택에 넘기지 않는다.
      update({ ...draft, tastes: { ...draft.tastes, [taste.key]: value } }, changed ? `taste.${taste.key}` : undefined);
    }
    else if (index === avoidanceIndex) update({ ...draft, avoidances: value });
    else if (index === priorityIndex) {
      update({ ...draft, priorities: value }, undefined, value === undefined ? {} : { needsPriorityReview: false });
      if (value !== undefined) setNotice("");
    }
    else update({ ...draft, spending: value });
  }
  function finish(nextDraft = draft, changes: Partial<Progress> = {}) {
    const reviewNeeded = changes.needsPriorityReview ?? needsPriorityReview;
    if (reviewNeeded && (index !== priorityIndex || nextDraft.priorities === undefined)) {
      commit({ ...changes, draft: nextDraft, index: priorityIndex, editing: true });
      setNotice("앞의 답이 바뀌어 이전 우선순위를 다시 확인해야 해요. 지키고 싶은 것을 다시 고르거나, 아직 정하지 않았다고 답해 주세요.");
      return;
    }
    if (reviewNeeded && nextDraft.priorities !== undefined) setNotice("");
    const missingIndex = getV31MissingIndex(nextDraft, flow === "full" ? "full" : "core");
    if (missingIndex !== null) { commit({ ...changes, draft: nextDraft, index: missingIndex, editing: true }); setNotice(missingAnswerNotice); return; }
    if (notice === missingAnswerNotice) setNotice("");
    if (!editing) captureWeddingCodeEvent("wedding_code_completed", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, ...responseCounts(nextDraft, flowIndexes), result_kind: context.first ? "couple" : "solo", placement: flow });
    commit({ ...changes, draft: nextDraft, index: flowIndexes.includes(index) ? index : flowIndexes[flowIndexes.length - 1], screen: "result", editing: false, needsPriorityReview: false });
  }
  function next() {
    if (index === priorityIndex && draft.priorities !== undefined) setNotice("");
    if (nextIndex === null) finish();
    else commit({ index: nextIndex, needsPriorityReview: index === priorityIndex ? false : needsPriorityReview });
  }
  function skipPriority() {
    const nextDraft = { ...draft, priorities: { status: "skipped" as const } };
    if (nextIndex === null) finish(nextDraft, { needsPriorityReview: false });
    else update(nextDraft, undefined, { index: nextIndex, needsPriorityReview: false });
    setNotice("");
  }
  function start() {
    if (!owned && local.saved && !local.store.clear()) setNotice(resetStorageFailureNotice);
    if (!started) captureWeddingCodeEvent("wedding_code_started", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, has_partner_link: Boolean(context.first) });
    setOwned(true);
    commit({ screen: "questions" }, true);
  }
  function resume(saved = local.store.restore()) {
    if (!saved) return;
    setOwned(true); setProgress(saved); setRevision(value => value + 1);
    setNotice(saved.needsPriorityReview ? "앞의 답이 바뀌어 우선순위를 다시 확인해야 해요." : "저장된 내 답을 불러왔어요.");
  }
  function restart() {
    const cleared = local.store.clear();
    const restartNotice = cleared ? "" : resetStorageFailureNotice;
    // Entry의 key가 그대로여도 로컬 답과 받은 링크 맥락을 먼저 비운다.
    setProgress({ draft: createV31Draft(), index: V31_CORE_INDEXES[0], flow: "core", screen: "intro", editing: false, needsPriorityReview: false });
    setContext({ first: null, received: false }); setOwned(false); setNotice(restartNotice); setRevision(value => value + 1);
    window.history.replaceState(null, "", window.location.pathname);
    captureWeddingCodeEvent("wedding_code_restarted", { version: WEDDING_CODE_V31_VERSION });
    onRestart?.(restartNotice);
  }
  function edit(id?: string) {
    const questionIndex = WEDDING_CODE_V31_QUESTIONS.findIndex(item => item.id === id);
    const tasteIndex = WEDDING_CODE_V31_TASTES.findIndex(item => `taste.${item.key}` === id);
    const target = questionIndex >= 0 ? questionIndex : tasteIndex >= 0 ? coreCount + tasteIndex
      : id === "avoidances" || id?.startsWith("avoid.") ? avoidanceIndex : id === "priorities" ? priorityIndex : id === "spending" ? priorityIndex + 1 : V31_CORE_INDEXES[0];
    commit({ index: target, editing: true, screen: "questions" });
  }
  function more() {
    const target = V31_EXTRA_INDEXES.find(item => getV31ResponseAt(draft, item) === undefined) ?? V31_EXTRA_INDEXES[0];
    commit({ flow: "extra", index: target, editing: false, screen: "questions" });
    setNotice("");
  }
  function markTopicNotApplicable() {
    if (!question) return;
    const answers = { ...draft.answers };
    for (const item of topicIndexes) answers[WEDDING_CODE_V31_QUESTIONS[item].id] = "not_applicable";
    const lastIndex = topicIndexes[topicIndexes.length - 1];
    update({ ...draft, answers }, undefined, { index: getV31NextIndex(flow, lastIndex) ?? index });
  }
  function toggleSaving() {
    const enabled = !local.enabled;
    if (!local.store.setEnabled(enabled)) {
      setNotice("저장 설정을 바꾸지 못했어요. 저장된 답을 지우려면 브라우저의 사이트 데이터를 확인해 주세요.");
      return;
    }
    setNotice("");
    if (enabled && owned && screen !== "intro") local.store.save({ ...progress, screen });
  }
  const storageMessage = !local.ready ? "저장 상태를 확인하고 있어요."
    : local.status === "saved" ? "이 브라우저에 저장됐어요. 나중에 이어 할 수 있어요."
    : local.status === "off" ? "자동 저장을 껐어요. 나가면 지금 답은 사라져요."
    : local.status === "unavailable" ? "이 브라우저에 저장할 수 없어요. 계속 답할 수 있지만, 나가면 지금 답은 사라질 수 있어요."
    : local.status === "conflict" ? "다른 탭에서 저장된 답이 바뀌었어요. 덮어쓰지 않도록 자동 저장을 멈췄어요."
    : local.status === "expired" ? "저장된 답의 이어하기 기간이 지났어요. 새로 답해 주세요."
    : local.status === "invalid" ? "저장된 답을 읽을 수 없어요. 새로 답하면 다시 저장해요."
    : "답하면 이 브라우저에 자동으로 저장돼요.";

  const storageControls = context.received ? null : <aside aria-label="이 브라우저의 답 저장" className="mt-6 border-t border-[var(--hb-hairline)] pt-4">
    <p role="status" className={`text-xs leading-relaxed ${local.status === "unavailable" || local.status === "conflict" ? "text-[var(--hb-text-strong)]" : "text-[var(--hb-text-muted)]"}`}>{storageMessage}</p>
    {local.status === "conflict" ? <div className="mt-2 flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => { const saved = local.store.reload(); if (saved) resume(saved); else setNotice("불러올 저장된 답이 없어요. 현재 답은 이 화면에 남아 있어요."); }}>저장된 답 불러오기</Button>
      {owned && screen !== "intro" ? <Button variant="secondary" onClick={() => local.store.takeOver({ ...progress, screen })}>이 화면의 답으로 저장하기</Button> : null}
    </div> : null}
    <details className={`mt-2 ${v31Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">자동 저장 설정</summary>
      <p>마지막으로 저장한 날부터 30일 동안 같은 브라우저에서 이어 할 수 있어요. 서버나 계정에는 보내지 않아요. 상대의 답·공유 동의·메모는 저장하지 않아요.</p>
      <p className="mt-2">공용 기기라면 자동 저장을 꺼 주세요. 이 브라우저를 쓰는 다른 사람도 저장된 답을 열 수 있어요. 시크릿 모드나 브라우저 데이터 삭제 후에는 이어 하지 못할 수 있어요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" aria-pressed={local.enabled} onClick={toggleSaving}>{local.enabled ? "자동 저장 끄기" : "자동 저장 켜기"}</Button>
        {local.saved || owned ? <Button variant="ghost" onClick={restart}>이 브라우저의 답 지우기</Button> : null}
      </div>
      <p className="mt-2 text-xs">자동 저장을 끄면 저장된 답도 지워져요. 지금 화면에서는 계속 답할 수 있어요.</p>
    </details>
  </aside>;

  const shell = (children: ReactNode) => <main className="min-h-dvh bg-[var(--hb-surface-page)] px-4 pb-16 pt-5 sm:px-6">
    <div className="mx-auto max-w-2xl">
      <nav aria-label="웨딩코드 탐색" className="mb-6 flex items-center justify-between gap-3"><Button href="/landing" variant="ghost" size="sm" className="px-0!">웨딩한방</Button><span className="text-xs font-semibold tracking-wide text-[var(--hb-text-muted)]">WEDDING CODE</span></nav>
      <section ref={screenRef} tabIndex={-1} aria-label={screen === "intro" ? "웨딩코드 소개" : screen === "result" ? "웨딩코드 결과" : ordinal > 0 ? `웨딩코드 ${flowLabel} ${ordinal}번째` : "웨딩코드 답 수정"} className="outline-none">
        {notice ? <p role="status" className="mb-5 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-strong)]">{notice}</p> : null}
        {children}
        {storageControls}
      </section>
    </div>
  </main>;

  if (screen === "intro") return shell(<>
    <section className={`${v31Surface} overflow-hidden`}>
      <div className="bg-[var(--hb-primary)] px-5 py-8 text-[var(--hb-on-primary)] sm:px-8 sm:py-10">
        <p className="text-xs font-semibold">웨딩코드 · 내가 원하는 결혼 준비</p>
        <h1 className="mt-4 text-3xl font-semibold leading-snug">{context.first ? "같은 질문에, 내 생각으로 답해봐요" : <>나는 어떤 결혼식을<br />바라고 있을까요?</>}</h1>
        <p className="mt-4 text-base leading-relaxed">{context.first ? "상대의 답이 담긴 링크를 받았어요. 나도 답하면 함께 원하는 것과 먼저 맞춰볼 부분을 나란히 볼 수 있어요." : "취향부터 돈을 쓰는 기준, 함께 준비하는 방식까지. 따로 생각했던 답을 모아 나만의 준비 기준을 찾아봐요."}</p>
      </div>
      <div className="p-5 sm:p-8">
        <div className="space-y-5">
          {[
            { icon: Paintbrush, title: "내가 그리는 결혼식", body: "장소·사진·옷·식사·하객·식순, 구체적인 취향을 한눈에 봐요." },
            { icon: ListChecks, title: "꼭 지키고 싶은 기준", body: "선택과 비용, 분담과 도움에 관한 답을 연결해 설명해요." },
            { icon: HeartHandshake, title: "둘이 먼저 나눠볼 이야기", body: "혼자 해도 결과를 받고, 상대도 답하면 함께 비교할 수 있어요." },
          ].map(item => <div key={item.title} className="flex gap-3"><item.icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--hb-success)]" /><div><h2 className={`text-base ${v31Title}`}>{item.title}</h2><p className={`mt-1 ${v31Body}`}>{item.body}</p></div></div>)}
        </div>
        <div className="mt-7 border-t border-[var(--hb-hairline)] pt-5">
          <p className={`text-sm ${v31Title}`}>기본 {V31_CORE_INDEXES.length}개 질문 · 로그인 없이 시작</p>
          <p className={`mt-2 ${v31Body}`}>{V31_CORE_RATING_IDS.length}개 문장에 다섯 단계로 답하고, {WEDDING_CODE_V31_TASTES.length}가지 취향과 피하고 싶은 것·더 쓰고 싶은 곳을 골라요. 여기까지 답하면 결과를 볼 수 있어요.</p>
          <p className={`mt-2 ${v31Body}`}>더 궁금하면 결과에서 {V31_EXTRA_INDEXES.length}개 선택 질문을 이어서 볼 수 있어요. 아직 모르거나 계획에 없는 것은 따로 표시해도 괜찮아요.</p>
          <p className={`mt-3 ${v31Body}`}>답은 서버나 계정에 저장하지 않아요. 이 브라우저에 자동 저장해 나중에 이어 할 수 있어요. 공용 기기에서는 아래 ‘자동 저장 설정’에서 꺼 주세요. 결과에서 동의하고 만든 공유 링크에는 답 전체가 담겨요.</p>
          {context.first ? <p className={`mt-3 ${v31Body}`}>상대의 답은 이 브라우저에 저장하지 않아요. 내가 직접 답하거나 불러온 내 답만 저장해요. 나중에 상대와 비교하려면 이 초대 링크를 다시 열어 주세요.</p> : null}
          <details className={`mt-3 ${v31Body}`}><summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">어디까지 알아볼 수 있나요?</summary><p>지금 내가 원하는 결혼식과 준비 방식을 살펴봐요. 성격 진단이나 공식 MBTI 검사가 아니고, 결혼에 관한 모든 가치관을 판단하지 않아요. 신혼집·여행·혼수와 실제 예산 금액은 별도로 정해야 해요.</p></details>
        </div>
      </div>
    </section>
    {!owned && local.saved ? <section className={`${v31Surface} mt-5 p-5`} aria-label="저장된 내 답 이어하기">
      <h2 className={`text-lg ${v31Title}`}>이 브라우저에 남겨 둔 답이 있어요</h2>
      <p className={`mt-2 ${v31Body}`}>{local.saved.screen === "result" ? "전에 답한 내 결과를 다시 볼 수 있어요." : local.saved.editing ? "수정하던 질문부터 이어 할 수 있어요." : `${local.saved.flow === "extra" ? "선택" : local.saved.flow === "full" ? "이전 전체" : "기본"} 질문 ${getV31FlowIndexes(local.saved.flow).indexOf(local.saved.index) + 1} / ${getV31FlowIndexes(local.saved.flow).length}부터 이어 할 수 있어요.`}</p>
      <Button variant="primary" size="lg" fullWidth onClick={() => resume()} className="mt-3 whitespace-normal!">{local.saved.screen === "result" ? context.first ? "저장한 내 답으로 비교하기" : "내 결과 다시 보기" : "이어서 답하기"}</Button>
    </section> : null}
    <Button variant={!owned && local.saved ? "secondary" : "primary"} size="lg" fullWidth onClick={start} className="mt-5 min-h-14! whitespace-normal!">{!owned && local.saved ? "저장된 답 지우고 새로 시작" : started ? "이어서 답하기" : context.first ? "나도 답해보기" : "내 웨딩코드 시작하기"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
  </>);

  if (screen === "result") return shell(<WeddingCodeV31Results key={revision} draft={draft} first={context.first} received={context.received} shareOrigin={shareOrigin} onEdit={edit} onRestart={restart} onMore={!context.received && optionalRemaining > 0 ? more : undefined} optionalCount={optionalRemaining} />);

  const topic = question ? WEDDING_CODE_V31_TOPICS.find(item => item.key === question.topic) : null;
  const title = question?.statement ?? taste?.question ?? (index === avoidanceIndex ? "이번 결혼식에서 피하고 싶은 것이 있나요?" : index === priorityIndex ? "이번 결혼식에서 특히 지키고 싶은 것은 무엇인가요?" : "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳이 있나요?");
  return shell(<>
    <div className="mb-5 flex items-center gap-3">
      <Button variant="icon" label="이전 질문" onClick={() => previousIndex !== null ? commit({ index: previousIndex }) : editing || flow === "extra" ? finish() : commit({ screen: "intro" })}><ArrowLeft aria-hidden="true" className="size-5" /></Button>
      <progress value={ordinal > 0 ? ordinal : 1} max={ordinal > 0 ? totalQuestions : 1} aria-label="현재 질문" aria-valuetext={ordinal > 0 ? `${flowLabel} ${totalQuestions}개 중 ${ordinal}번째` : "선택한 답 수정"}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hb-hairline)] accent-[var(--hb-success)] [&::-webkit-progress-bar]:bg-[var(--hb-hairline)] [&::-webkit-progress-value]:bg-[var(--hb-success)]" />
      <span className="text-sm font-semibold tabular-nums text-[var(--hb-text-body)]">{ordinal > 0 ? `${flowLabel} ${ordinal} / ${totalQuestions}` : "답 수정"}</span>
    </div>
    <section className={`${v31Surface} p-5 sm:p-7`} data-question={question?.id ?? (taste ? `taste.${taste.key}` : index === avoidanceIndex ? "avoidances" : index === priorityIndex ? "priorities" : "spending")}>
      <p className="text-xs font-semibold text-[var(--hb-success)]">{topic?.title ?? (taste ? `구체 취향 · ${taste.title}` : "마지막으로, 내 기준 확인")}</p>
      <h1 className={`mb-5 mt-3 text-2xl leading-relaxed ${v31Title}`}>{title}</h1>
      {question ? <V31RatingInput key={question.id} value={draft.answers[question.id]} onChange={changeRating} showScopeHint={ordinal === 1} /> : <>
        {!taste ? <p className={`mb-4 ${v31Body}`}>{index === avoidanceIndex ? "원하는 것만큼 피하고 싶은 것도 준비 기준이 될 수 있어요. 없다면 아래에서 ‘따로 피하고 싶은 것은 없어요’를 골라 주세요." : index === priorityIndex ? "앞의 답만으로도 결과를 볼 수 있어요. 특히 지키고 싶은 것이 떠오를 때만 골라 주세요. 결과를 본 뒤 골라도 괜찮아요." : "전체 예산을 늘리겠다는 뜻은 아니에요. 지금 없다면 ‘더 쓰고 싶은 곳은 지금 없어요’를 골라도 돼요."}</p> : null}
        {index === priorityIndex ? <V31PriorityInput value={draft.priorities} options={getV31PriorityOptions(draft)} onChange={changeChoice} onSkip={skipPriority} /> : <V31ChoiceInput key={taste?.key ?? index} value={choice} options={taste?.options ?? (index === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES : WEDDING_CODE_V31_SPENDING)}
          max={taste?.max ?? (index === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES.length : 2)} onChange={changeChoice} tasteKey={taste?.key} kind={taste ? "taste" : index === avoidanceIndex ? "avoidances" : "spending"} />}
      </>}
      {!editing && question && topicIndexes.length > 0 && ["vision", "records", "family"].includes(question.topic) ? <details className={`mt-4 border-t border-[var(--hb-hairline)] pt-2 ${v31Body}`}>
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">이 주제 전체가 이번 계획에 없다면</summary>
        <p className="mt-2">지금 답하는 {flowLabel}에서 ‘{topic?.title}’에 해당하는 {topicIndexes.length}문장을 ‘이번 계획에는 없어요’로 바꿔요. 이미 고른 답도 바뀌며, 되돌아오면 한 문장씩 다시 답할 수 있어요.</p>
        <Button variant="secondary" fullWidth onClick={markTopicNotApplicable} className="mt-3 whitespace-normal!">이 주제는 계획에 없어요</Button>
      </details> : null}
    </section>
    {index !== priorityIndex || draft.priorities !== undefined ? <Button variant="primary" size="lg" fullWidth disabled={currentResponse === undefined} onClick={next} className="mt-5 min-h-14! whitespace-normal!">{nextIndex === null ? "결과 보기" : "다음 질문"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button> : null}
    {editing ? <Button variant="secondary" size="lg" fullWidth disabled={currentResponse === undefined} onClick={() => finish()} className="mt-3 whitespace-normal!"><Check aria-hidden="true" className="size-4 shrink-0" />수정한 결과 보기</Button> : null}
    {flow === "extra" && !editing ? <Button variant="secondary" size="lg" fullWidth onClick={() => finish()} className="mt-3 whitespace-normal!">여기까지 보고 결과 보기</Button> : null}
    <p className="mt-3 text-center text-xs leading-relaxed text-[var(--hb-text-muted)]">앞으로 돌아가 답을 바꿔도 괜찮아요.</p>
  </>);
}
