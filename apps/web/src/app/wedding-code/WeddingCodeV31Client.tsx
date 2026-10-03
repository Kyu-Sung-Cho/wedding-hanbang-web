"use client";

import { ArrowLeft, ArrowRight, Check, HeartHandshake, ListChecks, Paintbrush } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import {
  WEDDING_CODE_V31_AVOIDANCES, WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_SPENDING, WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_TOPICS, WEDDING_CODE_V31_VERSION,
  type V31Choice, type V31Draft, type V31QuestionId, type V31Response, type V31Topic,
} from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV31Draft, getV31PriorityOptions, normalizeV31Draft } from "@/lib/weddingCode/v31";
import { V31ChoiceInput, V31PriorityInput, V31RatingInput, v31Body, v31EscapeFoldLabel, v31RatingGuide, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Results from "./WeddingCodeV31Results";
import { useV31LocalProgress } from "./useV31LocalProgress";
import { LOCAL_TTL_MS, V31_CLEAR_LOCAL_LABEL, hasV31ResumableAnswer, type V31LocalProgressSnapshot } from "@/lib/weddingCode/v31LocalProgress";
import {
  V31_CORE_INDEXES, V31_CORE_RATING_IDS, V31_EXTRA_INDEXES,
  getV31MissingIndex, getV31NextIndex, getV31ResponseAt, getV31ScreenIndexes, type V31Flow,
} from "@/lib/weddingCode/v31Flow";
import { getV31Page, getV31PageMissingIndex, getV31Pages, isV31PageComplete } from "@/lib/weddingCode/v31Pages";
import { readSavedPairSession, subscribePairSession } from "@/lib/weddingCode/pairSessionClient";
import { PAIR_SESSION_RETENTION_DAYS } from "@/lib/weddingCode/pairSessionContract";

const coreCount = WEDDING_CODE_V31_QUESTIONS.length;
const avoidanceIndex = coreCount + WEDDING_CODE_V31_TASTES.length;
const priorityIndex = avoidanceIndex + 1;
/** 소개 화면이 말하는 단위는 사람이 실제로 넘기는 페이지다. 마지막 우선순위 페이지는 고를 보기가 없으면 건너뛴다. */
const CORE_PAGE_COUNT = getV31Pages("core").length;
/** 이 브라우저 자동 저장이 읽히는 기간(일). 마지막으로 저장한 때부터 센다. */
const LOCAL_SAVE_DAYS = LOCAL_TTL_MS / 86_400_000;
const missingAnswerNotice = "선택이 비어 있는 질문으로 돌아왔어요. 답을 고르거나, 아래에서 ‘아직 모르겠어요’나 ‘지금 답하지 않을게요’를 골라 주세요.";
const resetStorageFailureNotice = "현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요. 공용 기기라면 브라우저 설정에서 이 사이트의 데이터를 지워 주세요.";
type Progress = Omit<V31LocalProgressSnapshot, "screen"> & { screen: "intro" | "questions" | "result" };

function v31FlowLabel(flow: V31Flow) {
  return flow === "extra" ? "선택 질문" : flow === "full" ? "이전 전체 질문" : "기본 질문";
}
/**
 * 질문 화면의 진행 단위(묶음 흐름은 페이지, 이전 전체 흐름은 한 문항씩)로 적되, 문장 안에서는 분수 표기 대신
 * 진행 막대의 읽는 이름(aria-valuetext)과 같은 말로 쓴다.
 */
function v31PositionLabel(flow: V31Flow, index: number) {
  if (flow === "full") {
    const indexes = getV31ScreenIndexes(flow);
    return `${v31FlowLabel(flow)} ${indexes.length}개 중 ${indexes.indexOf(index) + 1}번째`;
  }
  const page = getV31Page(flow, index);
  return `${v31FlowLabel(flow)} ${page.total}페이지 중 ${page.position + 1}페이지`;
}
/** 이 페이지에 아직 비어 있는 답이 있을 때 다음 버튼이 알리는 말. 페이지마다 실제로 있는 보기 이름만 가리킨다. */
const PAGE_MISSING_NOTICES = {
  ratingPage: `아직 답을 고르지 않은 문장이 있어요. 모르겠거나 계획에 없는 문장은 그 아래 ‘${v31EscapeFoldLabel}’를 열어 골라요.`,
  rating: "답을 골라 주세요. 모르겠으면 아래 ‘아직 모르겠어요’나 ‘지금 답하지 않을게요’를 골라도 돼요.",
  choice: "보기에서 골라 주세요. 모르겠으면 아래 ‘아직 모르겠어요’나 ‘지금 답하지 않을게요’를 골라도 돼요.",
} as const;
const pageMissingNotices: readonly string[] = Object.values(PAGE_MISSING_NOTICES);
function hasSavedPairAddress() {
  return readSavedPairSession() !== null;
}
function noSubscription() {
  return () => {};
}
function noPairAddress() {
  return false;
}
/** useSyncExternalStore 의 서버 값은 서버와 하이드레이션 첫 그림에서만 쓰인다. 브라우저에서 새로 만든 화면은 client 값(false)을 쓴다. */
function notHydrating() {
  return false;
}
function hydratingOnServer() {
  return true;
}

function responseCounts(draft: V31Draft, indexes: readonly number[]) {
  const responses = indexes.map(index => getV31ResponseAt(draft, index));
  return {
    answered_count: responses.filter(value => typeof value === "number" || (typeof value === "object" && (value.status === "answered" || value.status === "no_preference" || value.status === "no_match"))).length,
    skipped_count: responses.filter(value => value === "skipped" || (typeof value === "object" && value.status === "skipped")).length,
  };
}

export default function WeddingCodeV31Client({ shareOrigin, partnerDraft = null, bothDrafts = null, onRestart, allowLocalProgress = true, initialNotice = "", embedded = false, renderResultActions, pairInvite = false }: {
  shareOrigin: string; partnerDraft?: V31Draft | null;
  bothDrafts?: { first: V31Draft; second: V31Draft } | null; onRestart?: (message?: string) => void; allowLocalProgress?: boolean; initialNotice?: string;
  embedded?: boolean; renderResultActions?: (draft: V31Draft) => ReactNode;
  /** 함께 보기 초대 주소로 들어와 답하는 사람. 상대 답은 동의 전까지 받지 않지만 상대가 보낸 링크로 온 것은 같다. */
  pairInvite?: boolean;
}) {
  const screenRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState<Progress>(() => ({
    screen: bothDrafts ? "result" : "intro", draft: bothDrafts?.second ?? createV31Draft(),
    index: V31_CORE_INDEXES[0], flow: "core", editing: false, needsPriorityReview: false,
  }));
  const { screen, draft, index, flow, editing, needsPriorityReview } = progress;
  const [context, setContext] = useState({ first: bothDrafts?.first ?? partnerDraft, received: Boolean(bothDrafts) });
  const [owned, setOwned] = useState(false);
  const storageActive = allowLocalProgress && !context.received;
  const local = useV31LocalProgress(storageActive);
  // 시작 버튼은 답 없이 위치만 저장한다. 그 기록은 이어 할 답이 아니라서 답이 하나라도 있을 때만 이어 하기를 보여준다.
  const savedHasAnswer = local.saved !== null && hasV31ResumableAnswer(local.saved);
  const resumable = !owned && savedHasAnswer;
  // 받은 결과를 볼 때는 이 브라우저 저장소를 읽지 않는다. 저장 설정을 보여줄 때만 함께 보기 주소가 남았는지 확인한다.
  const pairAddressSaved = useSyncExternalStore(storageActive ? subscribePairSession : noSubscription, storageActive ? hasSavedPairAddress : noPairAddress, noPairAddress);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(initialNotice);
  const question = index < coreCount ? WEDDING_CODE_V31_QUESTIONS[index] : null;
  const taste = index >= coreCount && index < avoidanceIndex ? WEDDING_CODE_V31_TASTES[index - coreCount] : null;
  const choice = taste ? draft.tastes[taste.key] : index === avoidanceIndex ? draft.avoidances : index === priorityIndex ? draft.priorities : draft.spending;
  const currentResponse = question ? draft.answers[question.id] : choice;
  const started = Object.keys(draft.answers).length > 0 || Object.keys(draft.tastes).length > 0;
  const hasPartnerLink = Boolean(context.first) || pairInvite;
  const flowIndexes = getV31ScreenIndexes(flow);
  const ordinal = flowIndexes.indexOf(index) + 1;
  const totalQuestions = flowIndexes.length;
  const flowLabel = v31FlowLabel(flow);
  const page = getV31Page(flow, index, editing);
  const grouped = !editing && flow !== "full";
  const ratingPage = grouped && Boolean(question);
  const priorityOptions = getV31PriorityOptions(draft);
  // 앞에서 고른 것이 없어 우선순위 보기가 0개면 기본 흐름 끝의 우선순위 화면을 건너뛴다. 답은 채우지 않는다.
  const nextIndex = flow === "core" && !editing && page.nextIndex === priorityIndex && priorityOptions.length === 0 ? null : page.nextIndex;
  const previousIndex = page.previousIndex;
  const pageComplete = isV31PageComplete(draft, page.indexes);
  const priorityEmpty = index === priorityIndex && draft.priorities === undefined;
  const firstOrdinal = flowIndexes.indexOf(page.indexes[0]) + 1;
  const screenLabel = screen === "intro" ? "웨딩코드 소개" : screen === "result" ? "웨딩코드 결과"
    : grouped ? `웨딩코드 ${flowLabel} ${page.position + 1}페이지`
      : ordinal > 0 ? `웨딩코드 ${flowLabel} ${ordinal}번째` : "웨딩코드 답 수정";
  const optionalRemaining = V31_EXTRA_INDEXES.filter(item => getV31ResponseAt(draft, item) === undefined).length;

  // 서버가 그린 소개를 이어받는 첫 그림에서는 초점도 스크롤도 옮기지 않는다. 읽던 사람이 하이드레이션 순간 맨 위로 끌려가지 않게 하고,
  // 이미 다른 칸(‘자세히’ 같은)에 둔 초점을 빼앗지 않는다. 브라우저에서 새로 만든 화면(다시 시작, 받은 링크로 바뀜)은 그대로 맨 위로 간다.
  const hydrating = useSyncExternalStore(noSubscription, notHydrating, hydratingOnServer);
  const focusKey = `${screen}:${index}`;
  const settledFocusKey = useRef<string | null>(hydrating ? focusKey : null);
  useEffect(() => {
    if (settledFocusKey.current === focusKey) return;
    settledFocusKey.current = focusKey;
    screenRef.current?.focus({ preventScroll: true });
    if (embedded) screenRef.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, [embedded, focusKey]);
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
  function changeRating(id: V31QuestionId, value: V31Response) {
    update({ ...draft, answers: { ...draft.answers, [id]: value } });
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
  function finish(nextDraft = draft, requested: Partial<Progress> = {}) {
    const reviewRequested = requested.needsPriorityReview ?? needsPriorityReview;
    // 앞의 답이 바뀌어 고를 수 있는 우선순위가 하나도 남지 않았으면 빈 우선순위 화면으로 보내지 않는다.
    // 기본 흐름이 보기 0개일 때 우선순위 화면을 건너뛰는 것과 같다. 우선순위는 채우지 않는다(정리에서 이미 비었다).
    const reviewNeeded = reviewRequested && getV31PriorityOptions(nextDraft).length > 0;
    const reviewDropped = reviewRequested && !reviewNeeded;
    const changes: Partial<Progress> = reviewDropped ? { ...requested, needsPriorityReview: false } : requested;
    if (reviewNeeded && (index !== priorityIndex || nextDraft.priorities === undefined)) {
      commit({ ...changes, draft: nextDraft, index: priorityIndex, editing: true });
      setNotice("앞의 답이 바뀌어 이전 우선순위를 다시 확인해야 해요. 지키고 싶은 것을 다시 고르거나, 아직 정하지 않았다고 답해 주세요.");
      return;
    }
    if (reviewNeeded && nextDraft.priorities !== undefined) setNotice("");
    const missingIndex = getV31MissingIndex(nextDraft, flow === "full" ? "full" : "core");
    if (missingIndex !== null) { commit({ ...changes, draft: nextDraft, index: missingIndex, editing: true }); setNotice(missingAnswerNotice); return; }
    // 결과 화면에는 우선순위를 다시 고를 칸이 없으니(보기가 없다), 결과에서 다시 확인하라는 앞의 안내를 사실로 바꾼다.
    if (reviewDropped) setNotice("앞의 답이 바뀌어 전에 고른 우선순위를 뺐어요.");
    else if (notice === missingAnswerNotice) setNotice("");
    // 결과 종류는 화면에 보이는 결과를 따른다. 함께 보기 초대로 답한 사람도 상대 답을 받기 전에는 혼자 결과를 본다.
    // 초대로 왔다는 사실은 시작·장면 이벤트의 has_partner_link 가 맡는다.
    if (!editing) captureWeddingCodeEvent("wedding_code_completed", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, ...responseCounts(nextDraft, flowIndexes), result_kind: context.first ? "couple" : "solo", placement: flow });
    commit({ ...changes, draft: nextDraft, index: flowIndexes.includes(index) ? index : flowIndexes[flowIndexes.length - 1], screen: "result", editing: false, needsPriorityReview: false });
  }
  function next() {
    const missingIndex = getV31PageMissingIndex(draft, page.indexes);
    if (missingIndex !== null) {
      // 버튼은 누를 수 있게 두고(키보드로도 이유를 들을 수 있게), 비어 있는 곳으로 초점을 옮기며 이유를 알린다.
      setNotice(ratingPage ? PAGE_MISSING_NOTICES.ratingPage : question ? PAGE_MISSING_NOTICES.rating : PAGE_MISSING_NOTICES.choice);
      const missingQuestion = WEDDING_CODE_V31_QUESTIONS[missingIndex];
      const target = missingQuestion ? screenRef.current?.querySelector<HTMLElement>(`[data-question="${missingQuestion.id}"]`) : screenRef.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "start", behavior: "instant" });
      return;
    }
    if ((index === priorityIndex && draft.priorities !== undefined) || pageMissingNotices.includes(notice)) setNotice("");
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
    if (resumable && !local.store.clear()) setNotice(resetStorageFailureNotice);
    if (!started) captureWeddingCodeEvent("wedding_code_started", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, has_partner_link: hasPartnerLink });
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
  function markTopicNotApplicable(topicKey: V31Topic) {
    const topicIndexes = flowIndexes.filter(item => WEDDING_CODE_V31_QUESTIONS[item]?.topic === topicKey);
    if (!topicIndexes.length) return;
    const answers = { ...draft.answers };
    for (const item of topicIndexes) answers[WEDDING_CODE_V31_QUESTIONS[item].id] = "not_applicable";
    const lastIndex = topicIndexes[topicIndexes.length - 1];
    update({ ...draft, answers }, undefined, grouped ? {} : { index: getV31NextIndex(flow, lastIndex) ?? index });
  }
  function topicScope(topicKey: V31Topic) {
    const topicIndexes = flowIndexes.filter(item => WEDDING_CODE_V31_QUESTIONS[item]?.topic === topicKey);
    const topic = WEDDING_CODE_V31_TOPICS.find(item => item.key === topicKey);
    if (editing || !topicIndexes.length || !["vision", "records", "family"].includes(topicKey)) return null;
    return <details className={`mt-4 border-t border-[var(--hb-hairline)] pt-2 ${v31Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">이 주제 전체가 이번 계획에 없다면</summary>
      <p className="mt-2">지금 답하는 {flowLabel}에서 ‘{topic?.title}’에 해당하는 {topicIndexes.length}문장을 ‘이번 계획에는 없어요’로 바꿔요. 이미 고른 답도 바뀌며, 되돌아오면 한 문장씩 다시 답할 수 있어요.</p>
      <Button variant="secondary" fullWidth onClick={() => markTopicNotApplicable(topicKey)} className="mt-3 whitespace-normal!">이 주제는 계획에 없어요</Button>
    </details>;
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
  // 서버가 그린 소개는 저장 상태를 아직 모른다. 그동안 시작 버튼과 저장 켜기·끄기 버튼은 누를 수 없고(서버 HTML 에서도 disabled),
  // 누르면 사라지는 대신 눌러도 되는 때가 곧 온다고 이 줄이 알린다.
  const storageMessage = !local.ready ? "잠깐만요, 저장 상태를 확인하고 있어요. 곧 시작할 수 있어요."
    : local.status === "saved" && savedHasAnswer ? "이 브라우저에 저장됐어요. 나중에 이어 할 수 있어요."
    : local.status === "off" ? "자동 저장을 껐어요. 나가면 지금 답은 사라져요."
    : local.status === "unavailable" ? "이 브라우저에 저장할 수 없어요. 계속 답할 수 있지만, 나가면 지금 답은 사라질 수 있어요."
    : local.status === "conflict" ? "다른 탭에서 저장된 답이 바뀌었어요. 덮어쓰지 않도록 자동 저장을 멈췄어요."
    : local.status === "expired" ? "저장된 답의 이어하기 기간이 지났어요. 새로 답해 주세요."
    : local.status === "invalid" ? "저장된 답을 읽을 수 없어요. 새로 답하면 다시 저장해요."
    : "답하면 이 브라우저에 자동으로 저장돼요. 공용 기기라면 아래 ‘자동 저장 설정’에서 꺼 주세요.";

  const storageControls = context.received ? null : <aside aria-label="이 브라우저의 답 저장" className="mt-6 border-t border-[var(--hb-hairline)] pt-4">
    <p role="status" className={`text-xs leading-relaxed ${local.status === "unavailable" || local.status === "conflict" ? "text-[var(--hb-text-strong)]" : "text-[var(--hb-text-muted)]"}`}>{storageMessage}</p>
    {local.status === "conflict" ? <div className="mt-2 flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => { const saved = local.store.reload(); if (saved) resume(saved); else setNotice("불러올 저장된 답이 없어요. 현재 답은 이 화면에 남아 있어요."); }}>저장된 답 불러오기</Button>
      {owned && screen !== "intro" ? <Button variant="secondary" onClick={() => local.store.takeOver({ ...progress, screen })}>이 화면의 답으로 저장하기</Button> : null}
    </div> : null}
    <details className={`mt-2 ${v31Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">자동 저장 설정</summary>
      <p>자동 저장은 이 브라우저에만 남겨요. 마지막으로 저장한 날부터 30일 동안 같은 브라우저에서 이어 할 수 있어요. 상대의 답·공유 동의·메모는 자동 저장하지 않아요.</p>
      <p className="mt-2">공용 기기라면 자동 저장을 꺼 주세요. 이 브라우저를 쓰는 다른 사람도 저장된 답을 열 수 있어요. 시크릿 모드나 브라우저 데이터 삭제 후에는 이어 하지 못할 수 있어요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" aria-pressed={local.enabled} disabled={!local.ready} onClick={toggleSaving}>{local.enabled ? "자동 저장 끄기" : "자동 저장 켜기"}</Button>
        {local.saved || owned ? <Button variant="ghost" onClick={restart}>{V31_CLEAR_LOCAL_LABEL}</Button> : null}
      </div>
      {/*
        답 지우기는 답만 지운다. 처리방침은 두 사본을 모두 ‘확인 주소’라 부르고, 저장 끄기는 이 브라우저에 저장된
        사본만 지우며 현재 탭의 임시 사본은 남긴다. 같은 이름으로, 지우는 범위를 좁혀 버튼 옆에서 먼저 알린다.
      */}
      {(local.saved || owned) && pairAddressSaved ? <p className="mt-2 text-xs" data-pair-address-note>‘{V31_CLEAR_LOCAL_LABEL}’는 답만 지워요. 이 브라우저에 저장된 함께 보기 확인 주소까지 지우려면 ‘자동 저장 끄기’를 눌러 주세요.</p> : null}
      <p className="mt-2 text-xs">자동 저장을 끄면 저장된 답도 지워져요. 지금 화면에서는 계속 답할 수 있어요.</p>
      <p className="mt-2 text-xs">기기 저장을 꺼도 서버 함께 보기 연결은 남아요. 종료는 연결 결과에서 해주세요.</p>
      <p className="mt-2 text-xs" data-pair-tab-address-note>함께 보기 요청이 처리됐는지 볼 수 있게, 확인 주소는 이 탭에 잠시 남아요.</p>
    </details>
  </aside>;

  const Root = embedded ? "div" : "main";
  const shell = (children: ReactNode) => <Root className={embedded ? "px-4 pb-8 pt-5 sm:px-6" : "min-h-dvh bg-[var(--hb-surface-page)] px-4 pb-16 pt-5 sm:px-6"}>
    <div className="mx-auto max-w-2xl">
      {!embedded && <nav aria-label="웨딩코드 탐색" className="mb-6 flex items-center justify-between gap-3"><Button href="/landing" variant="ghost" size="sm" className="px-0!">웨딩한방</Button><span className="text-xs font-semibold tracking-wide text-[var(--hb-text-muted)]">WEDDING CODE</span></nav>}
      <section ref={screenRef} tabIndex={-1} aria-label={screenLabel} className={embedded ? "scroll-mt-20 outline-none md:scroll-mt-28" : "outline-none"}>
        {notice ? <p role="status" data-screen-notice className="mb-5 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-strong)]">{notice}</p> : null}
        {children}
        {storageControls}
      </section>
    </div>
  </Root>;

  if (screen === "intro") return shell(<>
    <section className={`${v31Surface} overflow-hidden`}>
      <div className="bg-[var(--hb-primary)] px-5 py-8 text-[var(--hb-on-primary)] sm:px-8 sm:py-10">
        <p className="text-xs font-semibold">웨딩코드 · 내가 원하는 결혼 준비</p>
        <h1 className="mt-4 text-3xl font-semibold leading-snug">{context.first ? "같은 질문에, 내 생각으로 답해봐요" : <>나는 어떤 결혼식을<br />바라고 있을까요?</>}</h1>
        {/* 판정이 아니라는 말은 소개 첫 문단에서 한 번만 한다. 받은 링크에는 앞에 ‘정리해’ 문장이 없어 ‘정리해서 보여줘요’까지 이어 쓴다. */}
        <p className="mt-4 text-base leading-relaxed">{context.first ? "상대의 답이 담긴 링크를 받았어요. 나도 답하면 함께 원하는 것과 먼저 맞춰볼 부분을 나란히 볼 수 있어요. 성격을 진단하는 검사가 아니에요. 내가 고른 답을 정리해서 보여줘요." : "취향부터 돈을 쓰는 기준, 함께 준비하는 방식까지. 내가 고른 답을 모아 준비 기준으로 정리해 봐요. 성격을 진단하는 검사가 아니에요."}</p>
      </div>
      <div className="p-5 sm:p-8">
        <div className="space-y-5">
          {[
            { icon: Paintbrush, title: "내가 그리는 결혼식", body: "장소·사진·옷·식사·하객 규모·식순에서 내가 고른 것을 모아 봐요." },
            { icon: ListChecks, title: "네 글자로 보는 준비 방식", body: "예산·일 나누기·가족·도움, 주제마다 두 문장의 답으로 글자를 하나씩 정하고 문장별 답도 보여줘요." },
            { icon: HeartHandshake, title: "둘이 먼저 나눠볼 이야기", body: "혼자 해도 결과를 볼 수 있고, 둘 다 답하고 서로 공유하면 두 사람의 답을 나란히 볼 수 있어요." },
          ].map(item => <div key={item.title} className="flex gap-3"><item.icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--hb-success)]" /><div><h2 className={`text-base ${v31Title}`}>{item.title}</h2><p className={`mt-1 ${v31Body}`}>{item.body}</p></div></div>)}
        </div>
        <div className="mt-7 border-t border-[var(--hb-hairline)] pt-5">
          <p className={`text-sm ${v31Title}`}>기본 {CORE_PAGE_COUNT}페이지 · 로그인 없이 시작</p>
          <p className={`mt-2 ${v31Body}`}>{V31_CORE_RATING_IDS.length}개 문장에 다섯 단계로 답하고, {WEDDING_CODE_V31_TASTES.length}가지 취향과 피하고 싶은 것, 다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳을 골라요. 마지막 ‘꼭 지키고 싶은 것’ 페이지는 고를 것이 없으면 건너뛰어요.</p>
          <p className={`mt-2 ${v31Body}`}>아직 모르거나 이번 계획에 없는 내용은 ‘아직 모르겠어요’ 같은 보기로 따로 표시해도 괜찮아요. 네 글자를 정하는 문장을 이렇게 표시하면 그 글자는 ‘?’로 남아요.</p>
          {/*
            개인정보 안내는 보이는 한 줄과 접힌 ‘자세히’ 두 겹이다. 한 줄이 사람들이 먼저 묻는 두 사실(답은 서버에 보내지 않는다, 이용 통계에는 답이 없다)과
            처리방침 링크를 맡고, 접힌 칸은 옛 세 문단을 그대로 담는다(링크는 소개 안에 하나만 둔다). 시험이 data-intro-privacy 로 두 겹을 함께 본다.
          */}
          <div className="mt-3" data-intro-privacy>
            <p className={v31Body}><span className="font-semibold text-[var(--hb-text-strong)]">답하는 동안 고른 답은 서버에 보내지 않고, 화면 개선을 위해서는 답을 뺀 이용 통계만 기록해요.</span> 자세한 내용은{" "}<a href="/privacy" target="_blank" rel="noopener noreferrer" className="py-2 font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">개인정보 처리방침</a>에서 볼 수 있어요.</p>
            <details className={`mt-1 ${v31Body}`}>
              {/* 보이는 글자는 ‘자세히’ 그대로 두고, 낭독기 목록에서 무엇을 여는지 알리는 이름만 그 글자로 시작해 덧붙인다. */}
              <summary aria-label="자세히, 개인정보 안내" className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">자세히</summary>
              <div className="space-y-2">
                <p className={v31Body}>고른 답과 웨딩코드는 답하는 동안 서버나 계정에 보내지 않아요. 화면 개선을 위해 첫 화면을 열었는지, 몇 번째 장면까지 봤는지, 끝까지 했는지, 답한 장면과 건너뛴 장면의 수 같은 이용 통계만 기록하고, 이 통계에 고른 답·웨딩코드·공유 링크 주소는 넣지 않아요.</p>
                <p className={v31Body}>내 답은 이 브라우저에 자동으로 저장돼요. 마지막으로 저장한 날부터 {LOCAL_SAVE_DAYS}일 동안 이어 할 수 있어요. 공용 기기에서는 시작하기 전에 아래 ‘자동 저장 설정’에서 꺼 주세요.</p>
                <p className={v31Body}>결과에서 ‘함께 보기’에 동의하면 내 답 전체를 서버에 보관하고, 초대로 연결된 상대에게 보여줘요. 초대 링크를 먼저 사용한 사람이 상대가 돼요. 이름이나 계정으로는 확인하지 않아요. 초대 후 {PAIR_SESSION_RETENTION_DAYS}일 동안 볼 수 있고, 만료된 내용은 하루 안에 삭제해요. ‘연결 끝내기’를 누르면 두 사람의 공유 답을 바로 지우지만, 상대가 이미 읽거나 따로 보관한 내용은 회수할 수 없어요.</p>
              </div>
            </details>
          </div>
          {context.first ? <p className={`mt-3 ${v31Body}`}>상대의 답은 이 브라우저에 저장하지 않아요. 내가 직접 답하거나 불러온 내 답만 저장해요. 다만 받은 링크 주소에는 상대의 답이 들어 있어서 브라우저 방문 기록에 남을 수 있어요. 나중에 상대와 비교하려면 이 초대 링크를 다시 열어 주세요.</p> : null}
          {/* 묻지 않는 것의 목록은 시작 버튼 위 범위 줄에 한 번만 둔다. */}
          <details className={`mt-3 ${v31Body}`}>
            <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">무엇을 물어보나요?</summary>
            <p>결혼식 장소, 사진, 옷, 식사, 하객 규모, 식순 같은 취향과 돈을 쓰는 기준, 초대할 사람과 하객의 이동 시간, 후보를 비교하는 방식, 둘이 일을 나누는 방식, 가족과 상의하는 순서와 마지막 선택, 힘들 때 바라는 도움을 물어봐요. 실제 예산 금액은 묻지 않으니 둘이 직접 정해 주세요.</p>
            {/* 우선순위 화면은 고를 보기가 있을 때만 나온다(getV31PriorityOptions: 4점 이상 문장, 답한 취향, 고른 피하고 싶은 것). 그 조건을 그대로 적는다. */}
            <p className="mt-2" data-intro-priority>마지막 ‘꼭 지키고 싶은 것’ 페이지에는 ‘그런 편이에요’나 ‘매우 그래요’로 답한 문장, 직접 고른 취향, 피하고 싶은 것이 보기로 나와요. 이 페이지는 고르지 않고 넘어가도 결과를 볼 수 있어요.</p>
            <p className="mt-2">문장은 한 페이지에 최대 3개씩, 나머지는 한 페이지에 하나씩 물어봐요. 답을 골라도 자동으로 넘어가지 않아요. 더 궁금하면 결과에서 {V31_EXTRA_INDEXES.length}개 선택 질문을 이어서 볼 수 있어요.</p>
          </details>
        </div>
      </div>
    </section>
    {resumable && local.saved ? <section className={`${v31Surface} mt-5 p-5`} aria-label="저장된 내 답 이어하기">
      <h2 className={`text-lg ${v31Title}`}>이 브라우저에 남겨 둔 답이 있어요</h2>
      <p className={`mt-2 ${v31Body}`}>{local.saved.screen === "result" ? "전에 답한 내 결과를 다시 볼 수 있어요." : local.saved.editing ? "수정하던 질문부터 이어 할 수 있어요." : `${v31PositionLabel(local.saved.flow, local.saved.index)}부터 이어 할 수 있어요.`}</p>
      <Button variant="primary" size="lg" fullWidth onClick={() => resume()} className="mt-3 whitespace-normal!">{local.saved.screen === "result" ? context.first ? "저장한 내 답으로 비교하기" : "내 결과 다시 보기" : "이어서 답하기"}</Button>
    </section> : null}
    <div className="mt-5" data-intro-scope>
      <p className={v31Body}>결혼식 모습과 둘이 준비하는 방식만 물어봐요. 신혼집, 예단과 예물, 양쪽 집안이 비용을 어떻게 나눌지는 묻지 않아요.</p>
    </div>
    <Button variant={resumable ? "secondary" : "primary"} size="lg" fullWidth loading={!local.ready} onClick={start} className="mt-5 min-h-14! whitespace-normal!">{resumable ? "저장된 답 지우고 새로 시작" : started ? "이어서 답하기" : context.first ? "나도 답해보기" : "내 웨딩코드 시작하기"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
  </>);

  if (screen === "result") return shell(<WeddingCodeV31Results key={revision} draft={draft} first={context.first} received={context.received} shareOrigin={shareOrigin} onEdit={edit} onRestart={restart} onMore={!context.received && optionalRemaining > 0 ? more : undefined} optionalCount={optionalRemaining} sharingContent={renderResultActions?.(draft)} />);

  const topic = question ? WEDDING_CODE_V31_TOPICS.find(item => item.key === question.topic) : null;
  const title = question?.statement ?? taste?.question ?? (index === avoidanceIndex ? "이번 결혼식에서 피하고 싶은 것이 있나요?" : index === priorityIndex ? "이번 결혼식에서 특히 지키고 싶은 것은 무엇인가요?" : "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳이 있나요?");
  // 진행 표기는 하나만 둔다. 묶음 흐름은 페이지 단위이고, 한 문항씩 보는 이전 흐름과 수정 화면은 그대로다.
  const progressText = grouped ? `${page.position + 1} / ${page.total} 페이지` : ordinal > 0 ? `${flowLabel} ${ordinal} / ${totalQuestions}` : "답 수정";
  return shell(<>
    <div className="mb-5 flex items-center gap-3">
      <Button variant="icon" label="이전 질문" onClick={() => previousIndex !== null ? commit({ index: previousIndex }) : editing || flow === "extra" ? finish() : commit({ screen: "intro" })}><ArrowLeft aria-hidden="true" className="size-5" /></Button>
      <progress value={grouped ? page.position + 1 : ordinal > 0 ? ordinal : 1} max={grouped ? page.total : ordinal > 0 ? totalQuestions : 1} aria-label={grouped ? "현재 페이지" : "현재 질문"} aria-valuetext={grouped ? `${flowLabel} ${page.total}페이지 중 ${page.position + 1}페이지` : ordinal > 0 ? `${flowLabel} ${totalQuestions}개 중 ${ordinal}번째` : "선택한 답 수정"}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hb-hairline)] accent-[var(--hb-success)] [&::-webkit-progress-bar]:bg-[var(--hb-hairline)] [&::-webkit-progress-value]:bg-[var(--hb-success)]" />
      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--hb-text-body)]" data-progress-text>{progressText}</span>
    </div>
    {/* 아래 고정 버튼 뒤로 초점이 숨지 않게, 키보드로 옮겨 간 칸은 버튼 높이만큼 띄워서 보여준다. 앱 안에서는 하단 탭과 안전 영역까지 더해진다. */}
    <div className="**:scroll-mb-[calc(10rem+env(safe-area-inset-bottom))]">
      {ratingPage ? <>
        <p className="text-xs font-semibold text-[var(--hb-success)]">{flowLabel}</p>
        <h1 className={`mt-2 text-xl leading-relaxed ${v31Title} ${page.position === 0 ? "" : "mb-5"}`}>문장마다 가까운 답을 골라 주세요</h1>
        {page.position === 0 ? <p data-rating-guide className={`mb-5 mt-2 rounded-lg bg-[var(--hb-surface-hover)] p-3 ${v31Body}`}>{v31RatingGuide} 아직 모르겠거나 이번 계획에 없는 내용이면 문장 아래 ‘{v31EscapeFoldLabel}’를 눌러 골라 주세요.</p> : null}
        <div className="space-y-5">
          {page.indexes.map((questionIndex, position) => {
            const pageQuestion = WEDDING_CODE_V31_QUESTIONS[questionIndex];
            const pageTopic = WEDDING_CODE_V31_TOPICS.find(item => item.key === pageQuestion.topic);
            const firstOfTopic = page.indexes.findIndex(item => WEDDING_CODE_V31_QUESTIONS[item].topic === pageQuestion.topic) === position;
            return <section key={pageQuestion.id} tabIndex={-1} aria-label={pageQuestion.statement} data-question={pageQuestion.id}
              className={`${v31Surface} scroll-mt-20 p-1.5 outline-none min-[360px]:p-3.5 sm:p-6 md:scroll-mt-28`}>
              <p className="text-xs font-semibold text-[var(--hb-success)]">{firstOrdinal + position}. {pageTopic?.title}</p>
              <h2 className={`mb-4 mt-2 text-base leading-relaxed sm:text-lg ${v31Title}`}>{pageQuestion.statement}</h2>
              <V31RatingInput compact questionLabel={pageQuestion.statement} value={draft.answers[pageQuestion.id]} onChange={value => changeRating(pageQuestion.id, value)} />
              {firstOfTopic ? topicScope(pageQuestion.topic) : null}
            </section>;
          })}
        </div>
      </> : <section className={`${v31Surface} p-5 sm:p-7`} data-question={question?.id ?? (taste ? `taste.${taste.key}` : index === avoidanceIndex ? "avoidances" : index === priorityIndex ? "priorities" : "spending")}>
        <p className="text-xs font-semibold text-[var(--hb-success)]">{topic?.title ?? (taste ? `구체 취향 · ${taste.title}` : "내 기준 확인")}</p>
        <h1 className={`mb-5 mt-3 text-2xl leading-relaxed ${v31Title}`}>{title}</h1>
        {taste?.key === "guests" ? <p className={`mb-4 ${v31Body}`}>두 사람의 가족·지인을 모두 합한 전체 하객 수를 떠올려 주세요.</p> : null}
        {question ? <V31RatingInput key={question.id} value={draft.answers[question.id]} onChange={value => changeRating(question.id, value)} showGuide={ordinal === 1} /> : <>
          {!taste ? <p className={`mb-4 ${v31Body}`}>{index === avoidanceIndex ? "원하는 것만큼 피하고 싶은 것도 준비 기준이 될 수 있어요. 없다면 아래에서 ‘따로 피하고 싶은 것은 없어요’를 골라 주세요." : index === priorityIndex ? "앞에서 고른 답 가운데 꼭 지키고 싶은 것을 골라요. 고르지 않아도 결과를 볼 수 있어요." : "전체 예산을 늘리겠다는 뜻은 아니에요. 지금 없다면 ‘더 쓰고 싶은 곳은 지금 없어요’를 골라도 돼요."}</p> : null}
          {index === priorityIndex ? <V31PriorityInput value={draft.priorities} options={priorityOptions} onChange={changeChoice} /> : <V31ChoiceInput key={taste?.key ?? index} value={choice} options={taste?.options ?? (index === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES : WEDDING_CODE_V31_SPENDING)}
            max={taste?.max ?? (index === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES.length : 2)} onChange={changeChoice} tasteKey={taste?.key} kind={taste ? "taste" : index === avoidanceIndex ? "avoidances" : "spending"} />}
        </>}
        {question ? topicScope(question.topic) : null}
      </section>}
    </div>
    {/* 문장이 길어 버튼이 첫 화면 밖으로 밀리지 않게 화면 아래에 붙인다. 앱 안에서는 하단 탭 위에 둔다. */}
    <div data-question-actions className="sticky bottom-0 z-10 mt-5 border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 max-md:[.amora-workspace_&]:bottom-[calc(75px+env(safe-area-inset-bottom))] max-md:[.amora-workspace_&]:pb-3">
      {/*
        우선순위 화면에서 아직 아무것도 고르지 않았으면 이 버튼이 넘어가기를 맡는다(수정 화면도 같다). 막힌 버튼과
        목록 아래 넘어가기 버튼을 겹쳐 두지 않는다. 고르면 평소처럼 결과 보기나 수정한 결과 보기로 돌아온다.
      */}
      {priorityEmpty ? <Button variant="primary" size="lg" fullWidth onClick={skipPriority} data-skip-priority className="min-h-12! whitespace-normal!">{nextIndex === null ? "고르지 않고 결과 보기" : "고르지 않고 다음 질문"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
        : editing ? <Button variant="primary" size="lg" fullWidth disabled={currentResponse === undefined} onClick={() => finish()} className="min-h-12! whitespace-normal!"><Check aria-hidden="true" className="size-4 shrink-0" />수정한 결과 보기</Button>
          // 비어 있는 답이 있어도 막지 않는다. 막힌 버튼은 키보드 Tab 에서 빠져 이유를 들을 수 없다. 누르면 비어 있는 곳으로 안내한다.
          : <Button variant="primary" size="lg" fullWidth aria-disabled={!pageComplete} onClick={next} className="min-h-12! whitespace-normal! aria-disabled:cursor-not-allowed aria-disabled:opacity-50">{nextIndex === null ? "결과 보기" : "다음 질문"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>}
    </div>
    {flow === "extra" && !editing ? <Button variant="secondary" size="lg" fullWidth onClick={() => finish()} className="mt-3 whitespace-normal!">여기까지 보고 결과 보기</Button> : null}
    <p className="mt-3 text-center text-xs leading-relaxed text-[var(--hb-text-muted)]">앞으로 돌아가 답을 바꿔도 괜찮아요.</p>
  </>);
}
