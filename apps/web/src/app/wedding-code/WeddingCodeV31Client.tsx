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
import { V31_CLEAR_LOCAL_LABEL, type V31LocalProgressSnapshot } from "@/lib/weddingCode/v31LocalProgress";
import {
  V31_ALL_STEP_IDS, V31_CORE_INDEXES, V31_CORE_PAGES, V31_EXTRA_INDEXES,
  getV31MissingIndex, getV31NextIndex, getV31ResponseAt, getV31ScreenIndexes, type V31Flow,
} from "@/lib/weddingCode/v31Flow";
import { getV31Page, getV31PageMissingIndex, getV31Pages, getV31ResumeIndex, isV31PageComplete } from "@/lib/weddingCode/v31Pages";
import { readSavedPairSession, subscribePairSession } from "@/lib/weddingCode/pairSessionClient";

const coreCount = WEDDING_CODE_V31_QUESTIONS.length;
const avoidanceIndex = coreCount + WEDDING_CODE_V31_TASTES.length;
const priorityIndex = avoidanceIndex + 1;
const missingAnswerNotice = "선택이 비어 있는 질문으로 돌아왔어요. 답을 고르거나, 아래에서 ‘아직 모르겠어요’나 ‘지금 답하지 않을게요’를 골라 주세요.";
const resetStorageFailureNotice = "현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요. 공용 기기라면 브라우저 설정에서 이 사이트의 데이터를 지워 주세요.";
const RESUMED_NOTICE = "저장된 내 답을 불러왔어요.";
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
/** 고르기 칸의 취향 정의. 취향이 아닌 칸(피하고 싶은 것·우선순위·더 쓰고 싶은 곳)이면 null. */
function choiceTaste(itemIndex: number) {
  return itemIndex >= coreCount && itemIndex < avoidanceIndex ? WEDDING_CODE_V31_TASTES[itemIndex - coreCount] : null;
}
function choiceTitle(itemIndex: number) {
  return choiceTaste(itemIndex)?.question ?? (itemIndex === avoidanceIndex ? "이번 결혼식에서 피하고 싶은 것이 있나요?"
    : itemIndex === priorityIndex ? "이번 결혼식에서 특히 지키고 싶은 것은 무엇인가요?" : "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳이 있나요?");
}
function choiceHelper(itemIndex: number): string | null {
  const itemTaste = choiceTaste(itemIndex);
  if (itemTaste) return itemTaste.key === "guests" ? "두 사람의 가족·지인을 모두 합한 전체 하객 수를 떠올려 주세요." : null;
  return itemIndex === avoidanceIndex ? "원하는 것만큼 피하고 싶은 것도 준비 기준이 될 수 있어요. 없다면 아래에서 ‘따로 피하고 싶은 것은 없어요’를 골라 주세요."
    : itemIndex === priorityIndex ? "앞에서 고른 답 가운데 꼭 지키고 싶은 것을 골라요. 고르지 않아도 결과를 볼 수 있어요."
      : "전체 예산을 늘리겠다는 뜻은 아니에요. 지금 없다면 ‘더 쓰고 싶은 곳은 지금 없어요’를 골라도 돼요.";
}
function hasSavedPairAddress() {
  return readSavedPairSession() !== null;
}
function noSubscription() {
  return () => {};
}
function noPairAddress() {
  return false;
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
  // 받은 결과를 볼 때는 이 브라우저 저장소를 읽지 않는다. 저장 설정을 보여줄 때만 함께 보기 주소가 남았는지 확인한다.
  const pairAddressSaved = useSyncExternalStore(storageActive ? subscribePairSession : noSubscription, storageActive ? hasSavedPairAddress : noPairAddress, noPairAddress);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(initialNotice);
  // 처음 화면의 ‘내 결과 다시 보기’로 연 결과는 결과가 뜨는 것 자체가 확인이라, 불러왔다는 상자를 화면 읽기용으로만 남긴다.
  const [quietResumeNotice, setQuietResumeNotice] = useState(false);
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
  // 한 문항씩 순번을 세는 건 이전 전체 흐름뿐이다. 답 수정 화면은 한 문항만 고치므로 "1 / 24" 같은 분수를 두지 않는다.
  const countedSingle = !editing && ordinal > 0;
  // 여러 칸을 한 페이지에 보여주는 화면. 기본 흐름은 주제별 페이지라 동의 문장과 고르기가 한 페이지에 섞일 수 있다.
  // 고르기 하나만 있는 페이지(장소·사진 등)와 답 수정 화면은 전처럼 한 칸짜리 화면이다.
  const sectionPage = grouped && (page.indexes.length > 1 || Boolean(question));
  const coreSection = sectionPage && flow === "core" ? V31_CORE_PAGES[page.position] : null;
  const pageHasChoice = page.indexes.some(item => item >= coreCount);
  const pageHasChoiceOnly = page.indexes.every(item => item >= coreCount);
  const priorityOptions = getV31PriorityOptions(draft);
  // 앞에서 고른 것이 없어 우선순위 보기가 0개면 기본 흐름 끝의 우선순위 화면을 건너뛴다. 답은 채우지 않는다.
  const nextIndex = flow === "core" && !editing && page.nextIndex === priorityIndex && priorityOptions.length === 0 ? null : page.nextIndex;
  const previousIndex = page.previousIndex;
  const pageComplete = isV31PageComplete(draft, page.indexes);
  const priorityEmpty = index === priorityIndex && draft.priorities === undefined;
  const screenLabel = screen === "intro" ? "웨딩코드 소개" : screen === "result" ? "웨딩코드 결과"
    : grouped ? `웨딩코드 ${flowLabel} ${page.position + 1}페이지`
      : countedSingle ? `웨딩코드 ${flowLabel} ${ordinal}번째` : "웨딩코드 답 수정";
  const optionalRemaining = V31_EXTRA_INDEXES.filter(item => getV31ResponseAt(draft, item) === undefined).length;
  // 결과의 선택 질문 안내도 시작 화면처럼 페이지로 센다. 일부만 답한 페이지는 남은 페이지다.
  const optionalPagesRemaining = getV31Pages("extra").filter(extraPage => !isV31PageComplete(draft, extraPage)).length;

  useEffect(() => {
    screenRef.current?.focus({ preventScroll: true });
    if (embedded) screenRef.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, [embedded, index, screen]);
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
  // 어느 칸의 답인지는 화면의 첫 칸(index)이 아니라 고른 칸(itemIndex)으로 정한다. 한 페이지에 여러 칸이 있다.
  function changeChoiceAt(itemIndex: number, value: V31Choice | undefined) {
    const itemTaste = choiceTaste(itemIndex);
    if (itemTaste) {
      const previous = draft.tastes[itemTaste.key];
      const changed = previous?.status === "answered" && (value?.status !== "answered"
        || [...previous.values].sort().join("|") !== [...value.values].sort().join("|"));
      // 같은 취향 항목이어도 고른 내용이 바뀌면 이전 우선순위를 새 선택에 넘기지 않는다.
      update({ ...draft, tastes: { ...draft.tastes, [itemTaste.key]: value } }, changed ? `taste.${itemTaste.key}` : undefined);
    }
    else if (itemIndex === avoidanceIndex) update({ ...draft, avoidances: value });
    else if (itemIndex === priorityIndex) {
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
    // 불러왔다는 말은 이어 답하기 시작할 때의 일이다. 답을 마쳐 새로 만든 결과 위에 지난 말로 남기지 않는다.
    else if (notice === missingAnswerNotice || notice === RESUMED_NOTICE) setNotice("");
    // 결과 종류는 화면에 보이는 결과를 따른다. 함께 보기 초대로 답한 사람도 상대 답을 받기 전에는 혼자 결과를 본다.
    // 초대로 왔다는 사실은 시작·장면 이벤트의 has_partner_link 가 맡는다.
    if (!editing) captureWeddingCodeEvent("wedding_code_completed", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, ...responseCounts(nextDraft, flowIndexes), result_kind: context.first ? "couple" : "solo", placement: flow });
    commit({ ...changes, draft: nextDraft, index: flowIndexes.includes(index) ? index : flowIndexes[flowIndexes.length - 1], screen: "result", editing: false, needsPriorityReview: false });
  }
  function next() {
    const missingIndex = getV31PageMissingIndex(draft, page.indexes);
    if (missingIndex !== null) {
      // 버튼은 누를 수 있게 두고(키보드로도 이유를 들을 수 있게), 비어 있는 곳으로 초점을 옮기며 이유를 알린다.
      const missingIsRating = missingIndex < coreCount;
      setNotice(missingIsRating ? sectionPage ? PAGE_MISSING_NOTICES.ratingPage : PAGE_MISSING_NOTICES.rating : PAGE_MISSING_NOTICES.choice);
      // 여러 칸 페이지에서는 비어 있는 그 칸으로 초점을 옮긴다(고르기 칸도 초점을 받는다). 한 칸짜리 고르기 화면은 화면 전체로.
      const itemTarget = sectionPage || missingIsRating ? screenRef.current?.querySelector<HTMLElement>(`[data-question="${V31_ALL_STEP_IDS[missingIndex]}"]`) : null;
      const target = itemTarget ?? screenRef.current;
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
    if (!owned && local.saved && !local.store.clear()) setNotice(resetStorageFailureNotice);
    if (!started) captureWeddingCodeEvent("wedding_code_started", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, has_partner_link: hasPartnerLink });
    setOwned(true);
    commit({ screen: "questions" }, true);
  }
  function resume(saved = local.store.restore(), fromIntro = false) {
    if (!saved) return;
    // 예전 묶음에서 저장한 사람은 앞 페이지에 빈 칸이 있을 수 있다. 그 페이지부터 연다(저장본은 다음 답을 고를 때 새로 쓴다).
    const index = saved.screen === "questions" ? getV31ResumeIndex(saved.draft, saved.flow, saved.index, saved.editing) : saved.index;
    setOwned(true); setProgress({ ...saved, index }); setRevision(value => value + 1);
    setNotice(saved.needsPriorityReview ? "앞의 답이 바뀌어 우선순위를 다시 확인해야 해요." : RESUMED_NOTICE);
    // 다른 탭과 부딪혀 ‘저장된 답 불러오기’로 부른 것은 누른 사람이 결과를 확인해야 하니 그대로 보인다.
    setQuietResumeNotice(fromIntro);
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
    // 불러왔다는 말은 결과를 열 때의 일이다. 수정 화면까지 따라가 지난 일처럼 남지 않게 지운다.
    if (notice === RESUMED_NOTICE) setNotice("");
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
      <p>자동 저장은 이 브라우저에만 남겨요. 마지막으로 저장한 날부터 30일 동안 같은 브라우저에서 이어 할 수 있어요. 상대의 답·공유 동의·메모는 자동 저장하지 않아요.</p>
      <p className="mt-2">공용 기기라면 자동 저장을 꺼 주세요. 이 브라우저를 쓰는 다른 사람도 저장된 답을 열 수 있어요. 시크릿 모드나 브라우저 데이터 삭제 후에는 이어 하지 못할 수 있어요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" aria-pressed={local.enabled} onClick={toggleSaving}>{local.enabled ? "자동 저장 끄기" : "자동 저장 켜기"}</Button>
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
        {notice ? <p role="status" data-screen-notice className={quietResumeNotice && screen === "result" && notice === RESUMED_NOTICE ? "sr-only" : "mb-5 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-strong)]"}>{notice}</p> : null}
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
        <p className="mt-4 text-base leading-relaxed">{context.first ? "상대의 답이 담긴 링크를 받았어요. 나도 답하면 함께 원하는 것과 먼저 맞춰볼 부분을 나란히 볼 수 있어요." : "취향부터 돈을 쓰는 기준, 함께 준비하는 방식까지. 따로 생각했던 답을 모아 나만의 준비 기준을 찾아봐요."}</p>
      </div>
      <div className="p-5 sm:p-8">
        <div className="space-y-5">
          {[
            { icon: Paintbrush, title: "내가 그리는 결혼식", body: "장소·사진·옷·식사·하객·식순, 구체적인 취향을 한눈에 봐요." },
            { icon: ListChecks, title: "네 글자로 보는 준비 방식", body: "예산·분담·가족·도움에 관한 답을 코드로 묶고, 문장별 동의 정도도 보여줘요." },
            { icon: HeartHandshake, title: "둘이 먼저 나눠볼 이야기", body: "혼자 해도 결과를 받고, 상대도 답하면 함께 비교할 수 있어요." },
          ].map(item => <div key={item.title} className="flex gap-3"><item.icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--hb-success)]" /><div><h2 className={`text-base ${v31Title}`}>{item.title}</h2><p className={`mt-1 ${v31Body}`}>{item.body}</p></div></div>)}
        </div>
        <div className="mt-7 border-t border-[var(--hb-hairline)] pt-5">
          {/*
            분량은 진행 표시와 같은 페이지 하나로만 센다. 2026-09-27 테스터가 제목줄의 질문 수와 본문의 문장 수를 함께 보고
            "15문제라더니 더 많다"고 했다. 문장·취향 개수는 다시 적지 않는다.
          */}
          <p className={`text-sm ${v31Title}`}>기본 질문 {getV31Pages("core").length}페이지 · 로그인 없이 시작</p>
          {/* 우선순위 화면은 고를 보기가 있을 때만 나온다(그렇다는 문장, 직접 고른 취향, 피하고 싶은 것). 그 조건을 그대로 적는다. */}
          <p className={`mt-2 ${v31Body}`} data-intro-priority>짧은 문장에 다섯 단계로 답하고, 결혼식 취향과 피하고 싶은 것, 더 쓰고 싶은 곳을 골라요. 그렇다고 답한 문장이나 직접 고른 취향, 피하고 싶은 것이 있으면 마지막에 그중 꼭 지키고 싶은 것을 골라요. 고르지 않고 넘어가도 결과를 볼 수 있어요.</p>
          <p className={`mt-2 ${v31Body}`}>답을 골라도 자동으로 넘어가지 않아요.</p>
          <p className={`mt-2 ${v31Body}`}>더 궁금하면 결과에서 선택 질문 {getV31Pages("extra").length}페이지를 이어서 볼 수 있어요. 아직 모르거나 계획에 없는 것은 따로 표시해도 괜찮아요.</p>
          <p className={`mt-3 ${v31Body}`}>답하는 동안에는 서버나 계정에 보내지 않아요. 이 브라우저에 자동 저장해 나중에 이어 할 수 있어요. 공용 기기에서는 아래 ‘자동 저장 설정’에서 꺼 주세요. 결과에서 함께 보기에 동의하면 선택한 답을 7일간 서버에 보관해요.</p>
          {context.first ? <p className={`mt-3 ${v31Body}`}>상대의 답은 이 브라우저에 저장하지 않아요. 내가 직접 답하거나 불러온 내 답만 저장해요. 나중에 상대와 비교하려면 이 초대 링크를 다시 열어 주세요.</p> : null}
          {/* 묻지 않는 것의 목록은 시작 버튼 위 범위 줄에 한 번만 둔다. */}
          <details className={`mt-3 ${v31Body}`}><summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">어디까지 알아볼 수 있나요?</summary><p>결혼식 장소, 사진, 옷, 식사, 하객 수, 식순 같은 취향과 돈을 쓰는 기준, 둘이 일을 나누는 방식, 가족과 상의하는 순서, 힘들 때 바라는 도움을 물어봐요. 실제 예산 금액은 묻지 않으니 둘이 따로 정해 주세요.</p></details>
        </div>
      </div>
    </section>
    {!owned && local.saved ? <section className={`${v31Surface} mt-5 p-5`} aria-label="저장된 내 답 이어하기">
      <h2 className={`text-lg ${v31Title}`}>이 브라우저에 남겨 둔 답이 있어요</h2>
      <p className={`mt-2 ${v31Body}`}>{local.saved.screen === "result" ? "전에 답한 내 결과를 다시 볼 수 있어요." : local.saved.editing ? "수정하던 질문부터 이어 할 수 있어요." : `${v31PositionLabel(local.saved.flow, getV31ResumeIndex(local.saved.draft, local.saved.flow, local.saved.index, local.saved.editing))}부터 이어 할 수 있어요.`}</p>
      <Button variant="primary" size="lg" fullWidth onClick={() => resume(undefined, true)} className="mt-3 whitespace-normal!">{local.saved.screen === "result" ? context.first ? "저장한 내 답으로 비교하기" : "내 결과 다시 보기" : "이어서 답하기"}</Button>
    </section> : null}
    <div className="mt-5 space-y-1" data-intro-scope>
      <p className={v31Body}>결혼식 모습과 둘이 준비하는 방식만 물어봐요. 신혼집, 예단과 예물, 양쪽 집안이 비용을 어떻게 나눌지는 묻지 않아요.</p>
      <p className={v31Body}>성격을 진단하는 검사가 아니에요. 내가 고른 답을 정리해서 보여줘요.</p>
    </div>
    <Button variant={!owned && local.saved ? "secondary" : "primary"} size="lg" fullWidth onClick={start} className="mt-5 min-h-14! whitespace-normal!">{!owned && local.saved ? "저장된 답 지우고 새로 시작" : started ? "이어서 답하기" : context.first ? "나도 답해보기" : "내 웨딩코드 시작하기"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
  </>);

  if (screen === "result") return shell(<WeddingCodeV31Results key={revision} draft={draft} first={context.first} received={context.received} shareOrigin={shareOrigin} onEdit={edit} onRestart={restart} onMore={!context.received && optionalRemaining > 0 ? more : undefined} optionalPages={optionalPagesRemaining} sharingContent={renderResultActions?.(draft)} />);

  const topic = question ? WEDDING_CODE_V31_TOPICS.find(item => item.key === question.topic) : null;
  const title = question?.statement ?? choiceTitle(index);
  const helper = question ? null : choiceHelper(index);
  function choiceInput(itemIndex: number) {
    const itemTaste = choiceTaste(itemIndex);
    const value = getV31ResponseAt(draft, itemIndex) as V31Choice | undefined;
    const onChange = (next: V31Choice | undefined) => changeChoiceAt(itemIndex, next);
    if (itemIndex === priorityIndex) return <V31PriorityInput value={draft.priorities} options={priorityOptions} onChange={onChange} />;
    return <V31ChoiceInput key={itemTaste?.key ?? itemIndex} value={value} options={itemTaste?.options ?? (itemIndex === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES : WEDDING_CODE_V31_SPENDING)}
      max={itemTaste?.max ?? (itemIndex === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES.length : 2)} onChange={onChange} tasteKey={itemTaste?.key}
      kind={itemTaste ? "taste" : itemIndex === avoidanceIndex ? "avoidances" : "spending"} />;
  }
  // 진행 표기는 하나만 둔다. 묶음 흐름은 페이지 단위, 한 문항씩 보는 이전 흐름은 순번, 수정 화면은 분수 없이 ‘답 수정’이다.
  const progressText = grouped ? `${page.position + 1} / ${page.total} 페이지` : countedSingle ? `${flowLabel} ${ordinal} / ${totalQuestions}` : "답 수정";
  return shell(<>
    <div className="mb-5 flex items-center gap-3">
      <Button variant="icon" label="이전 질문" onClick={() => previousIndex !== null ? commit({ index: previousIndex }) : editing || flow === "extra" ? finish() : commit({ screen: "intro" })}><ArrowLeft aria-hidden="true" className="size-5" /></Button>
      <progress value={grouped ? page.position + 1 : countedSingle ? ordinal : 1} max={grouped ? page.total : countedSingle ? totalQuestions : 1} aria-label={grouped ? "현재 페이지" : "현재 질문"} aria-valuetext={grouped ? `${flowLabel} ${page.total}페이지 중 ${page.position + 1}페이지` : countedSingle ? `${flowLabel} ${totalQuestions}개 중 ${ordinal}번째` : "선택한 답 수정"}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hb-hairline)] accent-[var(--hb-success)] [&::-webkit-progress-bar]:bg-[var(--hb-hairline)] [&::-webkit-progress-value]:bg-[var(--hb-success)]" />
      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--hb-text-body)]" data-progress-text>{progressText}</span>
    </div>
    {/* 아래 고정 버튼 뒤로 초점이 숨지 않게, 키보드로 옮겨 간 칸은 버튼 높이만큼 띄워서 보여준다. 앱 안에서는 하단 탭과 안전 영역까지 더해진다. */}
    <div className="**:scroll-mb-[calc(10rem+env(safe-area-inset-bottom))]">
      {sectionPage ? <>
        <p className="text-xs font-semibold text-[var(--hb-success)]">{flowLabel}</p>
        {/* 기본 흐름은 페이지 하나가 주제 하나라 페이지 제목이 주제 이름이다. 선택 흐름은 주제가 섞여 카드마다 주제를 적는다. */}
        <h1 className={`mt-2 text-xl leading-relaxed ${v31Title} ${page.position === 0 && !pageHasChoiceOnly ? "" : "mb-5"}`}>{coreSection?.title ?? "문장마다 가까운 답을 골라 주세요"}</h1>
        {page.position === 0 && !pageHasChoiceOnly ? <p data-rating-guide className={`mb-5 mt-2 rounded-lg bg-[var(--hb-surface-hover)] p-3 ${v31Body}`}>{v31RatingGuide} 아직 모르겠거나 이번 계획에 없는 내용이면 문장 아래 ‘{v31EscapeFoldLabel}’를 눌러 골라 주세요.</p> : null}
        <div className="space-y-5">
          {page.indexes.map((itemIndex, position) => {
            const pageQuestion = WEDDING_CODE_V31_QUESTIONS[itemIndex];
            if (!pageQuestion) {
              const stepId = V31_ALL_STEP_IDS[itemIndex];
              const itemHelper = choiceHelper(itemIndex);
              return <section key={stepId} tabIndex={-1} aria-labelledby={`${stepId}-title`} data-question={stepId}
                className={`${v31Surface} scroll-mt-20 p-3.5 outline-none sm:p-6 md:scroll-mt-28`}>
                <h2 id={`${stepId}-title`} className={`mb-4 text-base leading-relaxed sm:text-lg ${v31Title}`}>{choiceTitle(itemIndex)}</h2>
                {itemHelper ? <p className={`mb-4 ${v31Body}`}>{itemHelper}</p> : null}
                {choiceInput(itemIndex)}
              </section>;
            }
            const pageTopic = WEDDING_CODE_V31_TOPICS.find(item => item.key === pageQuestion.topic);
            const firstOfTopic = page.indexes.findIndex(item => WEDDING_CODE_V31_QUESTIONS[item]?.topic === pageQuestion.topic) === position;
            return <section key={pageQuestion.id} tabIndex={-1} aria-label={pageQuestion.statement} data-question={pageQuestion.id}
              className={`${v31Surface} scroll-mt-20 p-1.5 outline-none min-[360px]:p-3.5 sm:p-6 md:scroll-mt-28`}>
              {/* 번호를 붙이지 않는다. 1~15에서 멈추는 번호가 "15문제"로 읽혔다(2026-09-27). 진행은 위 페이지 표시가 맡는다. */}
              {coreSection ? null : <p className="mb-2 text-xs font-semibold text-[var(--hb-success)]">{pageTopic?.title}</p>}
              <h2 className={`mb-4 text-base leading-relaxed sm:text-lg ${v31Title}`}>{pageQuestion.statement}</h2>
              <V31RatingInput compact questionLabel={pageQuestion.statement} value={draft.answers[pageQuestion.id]} onChange={value => changeRating(pageQuestion.id, value)} />
              {/* 고르기가 같이 있는 페이지(입을 옷)에서는 ‘이 주제 전체’를 문장에만 적용하게 되므로 두지 않는다. */}
              {firstOfTopic && !pageHasChoice ? topicScope(pageQuestion.topic) : null}
            </section>;
          })}
        </div>
      </> : <section className={`${v31Surface} p-5 sm:p-7`} data-question={question?.id ?? (taste ? `taste.${taste.key}` : index === avoidanceIndex ? "avoidances" : index === priorityIndex ? "priorities" : "spending")}>
        <p className="text-xs font-semibold text-[var(--hb-success)]">{topic?.title ?? (taste ? `구체 취향 · ${taste.title}` : "내 기준 확인")}</p>
        <h1 className={`mb-5 mt-3 text-2xl leading-relaxed ${v31Title}`}>{title}</h1>
        {helper ? <p className={`mb-4 ${v31Body}`}>{helper}</p> : null}
        {question ? <V31RatingInput key={question.id} value={draft.answers[question.id]} onChange={value => changeRating(question.id, value)} showGuide={ordinal === 1} /> : choiceInput(index)}
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
