"use client";

import { ArrowLeft, ArrowRight, Check, HeartHandshake, ListChecks, Paintbrush } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import LoadStallHint from "@/components/wedding-code/LoadStallHint";
import {
  WEDDING_CODE_V31_AVOIDANCES, WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_SPENDING, WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_TOPICS, WEDDING_CODE_V31_VERSION,
  type V31Choice, type V31Draft, type V31QuestionId, type V31Response, type V31Topic,
} from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV31Draft, encodeV31, getV31PriorityOptions, normalizeV31Draft } from "@/lib/weddingCode/v31";
import { sendV31IntroViewedOnce } from "@/lib/weddingCode/v31IntroAnalytics";
import { V31ChoiceInput, V31PriorityInput, V31RatingInput, v31Body, v31EscapeFoldLabel, v31RatingGuide, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Results from "./WeddingCodeV31Results";
import V31ConfirmDialog from "./WeddingCodeV31Confirm";
import { useV31LocalProgress } from "./useV31LocalProgress";
import { LOCAL_TTL_MS, V31_CLEAR_LOCAL_LABEL, hasV31ResumableAnswer, type V31LocalProgressSnapshot } from "@/lib/weddingCode/v31LocalProgress";
import {
  V31_CORE_INDEXES, V31_CORE_RATING_IDS, V31_EXTRA_INDEXES,
  getV31MissingIndex, getV31NextIndex, getV31ResponseAt, getV31ScreenIndexes, type V31Flow,
} from "@/lib/weddingCode/v31Flow";
import { getV31Page, getV31PageMissingIndex, getV31Pages, isV31PageComplete } from "@/lib/weddingCode/v31Pages";
import { readPairSessionRecovery, readSavedPairSession, subscribePairSession } from "@/lib/weddingCode/pairSessionClient";
import { PAIR_SESSION_RETENTION_DAYS } from "@/lib/weddingCode/pairSessionContract";

const coreCount = WEDDING_CODE_V31_QUESTIONS.length;
const avoidanceIndex = coreCount + WEDDING_CODE_V31_TASTES.length;
const priorityIndex = avoidanceIndex + 1;
/** 소개 화면이 말하는 단위는 사람이 실제로 넘기는 페이지다. 마지막 우선순위 페이지는 고를 보기가 없으면 건너뛴다. */
const CORE_PAGE_COUNT = getV31Pages("core").length;
/** 이 브라우저 자동 저장이 읽히는 기간(일). 마지막으로 저장한 때부터 센다. */
const LOCAL_SAVE_DAYS = LOCAL_TTL_MS / 86_400_000;
/** 이어 하기 직후에 한 번 알리는 말. 페이지를 넘기거나 이전 질문으로 돌아가면 지난 일이라 지운다. */
const resumedNotice = "저장된 내 답을 불러왔어요.";
const missingAnswerNotice = "답을 고르지 않은 질문으로 돌아왔어요. 답을 고르거나 ‘아직 모르겠어요’, ‘해당하지 않아요’, ‘지금 답하지 않을게요’를 골라 주세요.";
/**
 * 받은 링크 속 답이 이 브라우저에 저장된 내 결과와 정확히 같을 때(내가 보낸 링크를 내가 연 경우) 소개 대신 보이는 안내.
 * 그대로 두면 「저장한 내 답으로 비교하기」가 나와 같은 사람끼리 견주는 결과를 만들고 상대에게 보내기까지 열린다.
 * 문구는 웨딩코드 4.0 의 같은 안내(V40_COPY.receive.selfLink)와 같은 뜻이다.
 */
const ownLinkCopy = {
  title: "내가 보낸 링크 같아요",
  body: "이 링크에 든 답이 이 브라우저에 저장된 내 답과 같아요. 내 답이 든 링크라서 상대가 열어야 두 사람 비교를 볼 수 있어요. 상대에게 이 링크를 보내 주세요.",
  backHint: "내가 열어 본 거라면 내 결과로 돌아가면 돼요.",
  backButton: "내 결과로 돌아가기",
  continueButton: "그래도 이 링크로 계속하기",
} as const;
const resetStorageFailureNotice = "현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요. 다른 사람과 같이 쓰는 컴퓨터나 휴대폰이라면 브라우저 설정에서 이 사이트의 데이터를 지워 주세요.";
type Progress = Omit<V31LocalProgressSnapshot, "screen"> & { screen: "intro" | "questions" | "result" };

function v31FlowLabel(flow: V31Flow) {
  return flow === "extra" ? "추가 질문" : flow === "full" ? "예전 전체 질문" : "기본 질문";
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
  ratingPage: `아직 답을 고르지 않은 문장이 있어요. 모르겠거나 해당하지 않는 문장은 그 아래 ‘${v31EscapeFoldLabel}’를 열어서 골라 주세요.`,
  rating: "답을 골라 주세요. 아래 ‘아직 모르겠어요’, ‘해당하지 않아요’, ‘지금 답하지 않을게요’를 골라도 돼요.",
  choice: "보기에서 골라 주세요. ‘아직 모르겠어요’, ‘맞는 보기가 없어요’, ‘해당하지 않아요’ 같은 칸을 골라도 돼요.",
} as const;
const pageMissingNotices: readonly string[] = Object.values(PAGE_MISSING_NOTICES);
function hasSavedPairAddress() {
  return readSavedPairSession() !== null;
}
/** 이 탭에 함께 보기 확인 주소가 잠시 남아 있는지. 함께 보기를 만들어 본 적이 없으면 false 다. */
function hasTabPairAddress() {
  return readPairSessionRecovery() !== null;
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
  const [ownLinkDismissed, setOwnLinkDismissed] = useState(false);
  // 끝낸 저장 결과가 받은 링크의 답과 정확히 같으면 내가 보낸 링크를 내가 연 것이다(끝나지 않은 저장은 링크의 답과 같을 수 없다).
  const openedOwnLink = progress.screen === "intro" && !ownLinkDismissed && resumable && !context.received && context.first !== null
    && local.saved !== null && local.saved.screen === "result" && encodeV31(local.saved.draft) === encodeV31(context.first);
  // 받은 결과를 볼 때는 이 브라우저 저장소를 읽지 않는다. 저장 설정을 보여줄 때만 함께 보기 주소가 남았는지 확인한다.
  const pairAddressSaved = useSyncExternalStore(storageActive ? subscribePairSession : noSubscription, storageActive ? hasSavedPairAddress : noPairAddress, noPairAddress);
  const pairTabAddress = useSyncExternalStore(storageActive ? subscribePairSession : noSubscription, storageActive ? hasTabPairAddress : noPairAddress, noPairAddress);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(initialNotice);
  // 알림은 그것을 낸 화면의 것이다. 아래 효과가 화면 키가 바뀔 때 지나간 화면의 알림(‘아직 답을 고르지 않은 문장이 있어요’ 등)을 지운다.
  // 화면을 옮기면서 옮겨 간 화면에 알리려는 알림(돌아온 질문, 불러온 답, 저장 지우기 실패)은 announce 에 옮겨 갈 화면 키를 함께 적어 남긴다.
  // 처음 알림(initialNotice)은 처음 화면의 것이다.
  const noticeScreen = useRef(`${bothDrafts ? "result" : "intro"}:${V31_CORE_INDEXES[0]}`);
  function announce(text: string, screenKey = focusKey) { noticeScreen.current = screenKey; setNotice(text); }
  // 지우기 확인 창(결과의 처음부터 다시 답하기, 소개의 저장된 답 지우고 새로 시작, 저장 설정의 이 브라우저의 답 지우기와 자동 저장 끄기).
  // 입구마다 제목이 그 단추의 이름과 맞다. 지우는 호출은 확인 뒤에만 일어난다.
  const [confirm, setConfirm] = useState<"restart" | "start" | "clear" | "off" | null>(null);
  const confirmOpener = useRef<HTMLElement | null>(null);
  function askConfirm(kind: "restart" | "start" | "clear" | "off") {
    confirmOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm(kind);
  }
  function cancelConfirm() {
    setConfirm(null);
    const opener = confirmOpener.current; confirmOpener.current = null;
    if (opener?.isConnected) opener.focus();
  }
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
  // 읽어 주는 화면 이름은 눈에 보이는 진행 글자(progressText)와 같은 말을 쓴다. 수정 화면은 보이는 말이 「답 수정」이라 「기본 질문 24번째」라 하지 않는다.
  const screenLabel = screen === "intro" ? "웨딩코드 소개" : screen === "result" ? "웨딩코드 결과"
    : grouped ? `웨딩코드 ${flowLabel} ${page.position + 1}페이지`
      : editing || ordinal <= 0 ? "웨딩코드 답 수정" : `웨딩코드 ${flowLabel} ${ordinal}번째`;
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
  // 지나간 화면의 알림을 지운다. 이전 화살표, 선택 질문 나가기, 답 입력이 알림을 하나씩 지우던 때는 새는 곳이 생겼다(소개, 수정, 결과 맨 위에 남았다).
  // 페이지에 비어 있던 답을 다 채우면 ‘아직 답을 고르지 않은 문장이 있어요’도 더는 맞지 않아 함께 지운다.
  useEffect(() => {
    if (noticeScreen.current !== focusKey || (pageComplete && pageMissingNotices.includes(notice))) setNotice("");
  }, [focusKey, notice, pageComplete]);
  useEffect(() => {
    if (screen === "result" && context.first) captureWeddingCodeEvent("wedding_code_comparison_viewed", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions });
  }, [context.first, screen, totalQuestions]);
  useEffect(() => {
    // 소개 조회는 한 페이지 로드에 한 번만, 주소의 상대 링크 표지까지 읽어 첫 전송부터 맞는 값으로 보낸다(v31IntroAnalytics.ts 머리 설명).
    if (screen === "intro") sendV31IntroViewedOnce({ sceneTotal: totalQuestions, hasPartnerLink, placement: flow });
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
    // 비어 있던 답을 채워 이 페이지가 다 차면, 단추 위의 ‘아직 답을 고르지 않은 문장이 있어요’ 안내를 바로 지운다(다 답했는데 안 답했다고 말하지 않는다).
    // 아래에서 우선순위 안내를 새로 띄우면 그 안내가 이긴다(나중에 setNotice 한다).
    if (pageMissingNotices.includes(notice) && getV31PageMissingIndex(normalized, page.indexes) === null) setNotice("");
    if (staleTastePriority && normalized.priorities?.status === "answered") {
      const kept = normalized.priorities.values.filter(value => value !== staleTastePriority);
      normalized.priorities = kept.length ? { status: "answered", values: kept } : undefined;
    }
    const previousPriorities = nextDraft.priorities?.status === "answered" ? nextDraft.priorities.values : [];
    const nextPriorities = normalized.priorities?.status === "answered" ? normalized.priorities.values : [];
    if (previousPriorities.some(value => !nextPriorities.includes(value))) {
      announce("앞의 답이 바뀌어 더 이상 맞지 않는 ‘꼭 지키고 싶은 것’을 뺐어요.", `${extra.screen ?? screen}:${extra.index ?? index}`);
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
      announce("앞의 답이 바뀌어 ‘꼭 지키고 싶은 것’이 달라졌을 수 있어요. 아래 선택을 확인하고, 필요하면 다시 골라 주세요. 고르지 않고 결과를 봐도 돼요.", `${screen}:${priorityIndex}`);
      return;
    }
    if (reviewNeeded && nextDraft.priorities !== undefined) setNotice("");
    const missingIndex = getV31MissingIndex(nextDraft, flow === "full" ? "full" : "core");
    if (missingIndex !== null) { commit({ ...changes, draft: nextDraft, index: missingIndex, editing: true }); announce(missingAnswerNotice, `${screen}:${missingIndex}`); return; }
    // 결과 화면에는 우선순위를 다시 고를 칸이 없으니(보기가 없다), 다시 고르라는 말 없이 뺐다는 사실만 알린다.
    const resultIndex = flowIndexes.includes(index) ? index : flowIndexes[flowIndexes.length - 1];
    if (reviewDropped) announce("앞의 답이 바뀌어 전에 고른 ‘꼭 지키고 싶은 것’을 뺐어요.", `result:${resultIndex}`);
    else if (notice === missingAnswerNotice) setNotice("");
    // 결과 종류는 화면에 보이는 결과를 따른다. 함께 보기 초대로 답한 사람도 상대 답을 받기 전에는 혼자 결과를 본다.
    // 초대로 왔다는 사실은 시작·장면 이벤트의 has_partner_link 가 맡는다.
    if (!editing) captureWeddingCodeEvent("wedding_code_completed", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, ...responseCounts(nextDraft, flowIndexes), result_kind: context.first ? "couple" : "solo", placement: flow });
    commit({ ...changes, draft: nextDraft, index: resultIndex, screen: "result", editing: false, needsPriorityReview: false });
  }
  function next() {
    const missingIndex = getV31PageMissingIndex(draft, page.indexes);
    if (missingIndex !== null) {
      // 버튼은 누를 수 있게 두고(키보드로도 이유를 들을 수 있게), 비어 있는 곳으로 초점을 옮기며 이유를 알린다.
      announce(ratingPage ? PAGE_MISSING_NOTICES.ratingPage : question ? PAGE_MISSING_NOTICES.rating : PAGE_MISSING_NOTICES.choice);
      const missingQuestion = WEDDING_CODE_V31_QUESTIONS[missingIndex];
      const target = missingQuestion ? screenRef.current?.querySelector<HTMLElement>(`[data-question="${missingQuestion.id}"]`) : screenRef.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "start", behavior: "instant" });
      return;
    }
    if ((index === priorityIndex && draft.priorities !== undefined) || pageMissingNotices.includes(notice) || notice === resumedNotice) setNotice("");
    if (nextIndex === null) finish();
    else commit({ index: nextIndex, needsPriorityReview: index === priorityIndex ? false : needsPriorityReview });
  }
  /** 화면 안 ← 단추. 이어 하기 직후의 안내나 안 채운 문장 안내는 지난 화면의 일이라 함께 지운다. */
  function previous() {
    if (notice === resumedNotice || pageMissingNotices.includes(notice)) setNotice("");
    if (previousIndex !== null) commit({ index: previousIndex });
    else if (editing || flow === "extra") finish();
    else commit({ screen: "intro" });
  }
  function skipPriority() {
    const nextDraft = { ...draft, priorities: { status: "skipped" as const } };
    if (nextIndex === null) finish(nextDraft, { needsPriorityReview: false });
    else update(nextDraft, undefined, { index: nextIndex, needsPriorityReview: false });
    setNotice("");
  }
  function start() {
    if (resumable && !local.store.clear()) announce(resetStorageFailureNotice, `questions:${index}`);
    if (!started) captureWeddingCodeEvent("wedding_code_started", { version: WEDDING_CODE_V31_VERSION, scene_total: totalQuestions, has_partner_link: hasPartnerLink });
    setOwned(true);
    commit({ screen: "questions" }, true);
  }
  function resume(saved = local.store.restore()) {
    if (!saved) return;
    setOwned(true); setProgress(saved); setRevision(value => value + 1);
    announce(saved.needsPriorityReview ? "앞의 답이 바뀌어 ‘꼭 지키고 싶은 것’을 다시 확인해 주세요." : resumedNotice, `${saved.screen}:${saved.index}`);
  }
  /** 내가 보낸 링크 안내에서 내 결과로 돌아간다: 받은 링크를 버리고 저장된 내 결과를 혼자 보는 결과로 연다. */
  function backToOwnResult() {
    const saved = local.store.restore();
    if (!saved) { announce("불러올 저장된 답이 없어요."); return; }
    setContext({ first: null, received: false });
    resume(saved);
  }
  /** 그래도 이 링크로 계속하기: 소개(받은 링크 소개)로 간다. 안내 단추가 사라지므로 초점은 화면으로 돌린다. */
  function continueWithLink() {
    setOwnLinkDismissed(true);
    window.setTimeout(() => screenRef.current?.focus({ preventScroll: true }), 0);
  }
  function restart() {
    const cleared = local.store.clear();
    const restartNotice = cleared ? "" : resetStorageFailureNotice;
    // Entry의 key가 그대로여도 로컬 답과 받은 링크 맥락을 먼저 비운다.
    setProgress({ draft: createV31Draft(), index: V31_CORE_INDEXES[0], flow: "core", screen: "intro", editing: false, needsPriorityReview: false });
    setContext({ first: null, received: false }); setOwned(false); announce(restartNotice, `intro:${V31_CORE_INDEXES[0]}`); setRevision(value => value + 1);
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
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">이 주제 전체가 해당하지 않는다면</summary>
      <p className="mt-2">지금 답하는 {flowLabel}에서 ‘{topic?.title}’ 문장 {topicIndexes.length}개를 ‘해당하지 않아요’로 바꿔요. 이미 고른 답은 지워지고, 나중에 돌아오면 한 문장씩 다시 답할 수 있어요.</p>
      <Button variant="secondary" fullWidth onClick={() => markTopicNotApplicable(topicKey)} className="mt-3 whitespace-normal!">이 주제는 해당하지 않아요</Button>
    </details>;
  }
  // 끄면 저장된 답(과 함께 보기 확인 주소)이 지워진다. 지울 것이 있을 때는 확인 창을 한 번 거친다. 켤 때와 지울 것이 없을 때는 바로 바꾼다.
  const offLosesAnswers = local.saved !== null || local.status === "conflict";
  const offLosesAddress = pairAddressSaved;
  function toggleSaving(confirmed = false) {
    const enabled = !local.enabled;
    if (!enabled && !confirmed && (offLosesAnswers || offLosesAddress)) { askConfirm("off"); return; }
    if (!local.store.setEnabled(enabled)) {
      announce("저장 설정을 바꾸지 못했어요. 저장된 답을 지우려면 브라우저 설정에서 이 사이트의 데이터를 직접 지워 주세요.");
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
    : local.status === "conflict" ? "다른 탭에서 저장된 답이 바뀌었어요. 그 답이 사라지지 않도록 이 탭의 자동 저장을 멈췄어요. 저장된 답을 불러오면 이 탭에서 고른 답은 쓰이지 않고, 이 화면의 답으로 저장하면 다른 탭에서 저장한 답은 사라져요."
    : local.status === "expired" ? "저장된 답의 이어하기 기간이 지났어요. 새로 답해 주세요."
    : local.status === "invalid" ? `저장된 답을 읽을 수 없어요. 새로 답하면 다시 저장해요.${local.clockAhead ? " 폰 날짜와 시간이 맞는지 확인해 보세요." : ""}`
    : "답하면 이 브라우저에 자동으로 저장돼요. 다른 사람과 같이 쓰는 컴퓨터나 휴대폰이라면 아래 ‘자동 저장 설정’에서 꺼 주세요.";

  // 저장소를 쓸 수 없는 브라우저(사생활 보호 모드, 사이트 데이터 차단)에서는 켜고 끌 저장이 없다. 끄기 단추는 아무 일도 하지 못하고 설명은 저장되는 것처럼 읽히므로,
  // 단추를 두지 않고 설명도 저장할 수 없다는 말로 바꾼다. 위쪽 저장 줄과 소개의 접힌 ‘개인정보 자세히 보기’ 문단이 이미 같은 말을 한다.
  const storageBlocked = local.ready && local.status === "unavailable";
  const storageControls = context.received ? null : <aside aria-label="이 브라우저의 답 저장" className="mt-6 border-t border-[var(--hb-hairline)] pt-4">
    <p role="status" className={`text-xs leading-relaxed ${local.status === "unavailable" || local.status === "conflict" ? "text-[var(--hb-text-strong)]" : "text-[var(--hb-text-muted)]"}`}>{storageMessage}</p>
    {/* 화면 조각이 못 내려와 "확인하고 있어요"가 계속 남는 경우를 위한 보강: 12초 뒤에야 보이는 새로고침 한 줄(서버 HTML 에서부터 CSS 로). 확인이 끝나면 함께 사라진다. */}
    {!local.ready ? <LoadStallHint className="mt-2 text-xs leading-relaxed text-[var(--hb-text-strong)]" /> : null}
    {local.status === "conflict" ? <div className="mt-2 flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => { const saved = local.store.reload(); if (saved) resume(saved); else announce("불러올 저장된 답이 없어요. 현재 답은 이 화면에 남아 있어요."); }}>저장된 답 불러오기</Button>
      {owned && screen !== "intro" ? <Button variant="secondary" onClick={() => local.store.takeOver({ ...progress, screen })}>이 화면의 답으로 저장하기</Button> : null}
    </div> : null}
    <details className={`mt-2 ${v31Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">자동 저장 설정</summary>
      {storageBlocked ? <>
        <p>이 브라우저에는 저장할 수 없어요. 그래서 자동 저장을 켜거나 끌 수 없고, 답은 이 화면에만 남아요. 나가거나 새로고침하면 지금 답은 사라질 수 있어요.</p>
        <p className="mt-2">시크릿 모드이거나 브라우저가 이 사이트의 데이터를 막고 있을 수 있어요. 이 브라우저에는 상대의 답·공유 동의·메모를 어느 경우에도 저장하지 않아요.</p>
      </> : <>
        <p>자동 저장은 이 브라우저에만 남겨요. 마지막으로 저장한 날부터 30일 동안 같은 브라우저에서 이어 할 수 있어요. 카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어 할 수 있어요. 상대의 답·공유 동의·메모는 자동 저장하지 않아요.</p>
        <p className="mt-2">이 브라우저를 같이 쓰는 사람이 있다면(상대나 가족 포함) 자동 저장을 꺼 주세요. 저장된 답을 그 사람도 열 수 있어요. 시크릿 모드나 브라우저 데이터를 지운 뒤에는 이어 하지 못할 수 있어요.</p>
      </>}
      <div className="mt-2 flex flex-wrap gap-2">
        {storageBlocked ? null : <Button variant="secondary" aria-pressed={local.enabled} disabled={!local.ready} aria-haspopup={local.enabled && (offLosesAnswers || offLosesAddress) ? "dialog" : undefined} onClick={() => toggleSaving()}>{local.enabled ? "자동 저장 끄기" : "자동 저장 켜기"}</Button>}
        {local.saved || owned ? <Button variant="ghost" aria-haspopup="dialog" onClick={() => askConfirm("clear")}>{V31_CLEAR_LOCAL_LABEL}</Button> : null}
      </div>
      {/*
        답 지우기는 답만 지운다. 처리방침은 두 사본을 모두 ‘확인 주소’라 부르고, 저장 끄기는 이 브라우저에 저장된
        사본만 지우며 현재 탭의 임시 사본은 남긴다. 같은 이름으로, 지우는 범위를 좁혀 버튼 옆에서 먼저 알린다.
      */}
      {(local.saved || owned) && pairAddressSaved ? <p className="mt-2 text-xs" data-pair-address-note>‘{V31_CLEAR_LOCAL_LABEL}’는 답만 지워요. 이 브라우저에 저장된 함께 보기 확인 주소까지 지우려면 ‘자동 저장 끄기’를 눌러 주세요.</p> : null}
      {storageBlocked ? null : <p className="mt-2 text-xs">자동 저장을 끄면 저장된 답도 지워져요. 지금 화면에서는 계속 답할 수 있어요.</p>}
      {/* 함께 보기를 만들어 본 적이 없는 첫 방문에는 아직 쓰지 않은 기능의 서버 연결 이야기를 하지 않는다. 이 브라우저나 이 탭에 확인 주소가 남아 있을 때만 말한다. */}
      {pairAddressSaved || pairTabAddress ? <>
        <p className="mt-2 text-xs">자동 저장을 꺼도 서버에 있는 함께 보기 연결은 그대로 남아요. 끝내려면 끄기 전에 두 사람 결과 화면에서 ‘연결 끝내기’를 눌러 주세요. 이미 껐다면 따로 복사해 둔 ‘나만 보관할 확인 주소’로 열어 끝낼 수 있어요.</p>
        <p className="mt-2 text-xs" data-pair-tab-address-note>함께 보기가 잘 연결됐는지 다시 볼 수 있도록, 확인 주소를 이 탭에 잠시 남겨 둬요.</p>
      </> : null}
    </details>
  </aside>;

  // 확인 단추의 이름도 입구에 맞춘다: 소개에서는 지우기만 하고(처음 화면에 그대로 있다), 질문·결과에서는 지운 뒤 처음부터 다시 답하게 되므로 「지우고 다시 답하기」다.
  // 무엇이 지워지는지는 입구와 지금 보는 화면에 맞춘다. 이미 보낸 링크는 그대로 열리고, 받은 링크로 시작했다면 그 링크를 다시 열어 비교를 다시 볼 수 있다.
  // 「이 브라우저」는 본문에 한 번만 쓴다. 결과의 다시 답하기는 결과 화면에서만 열린다.
  const sentLinkNote = `${context.first ? "받은 링크를 다시 열어 답하면 비교를 다시 볼 수 있어요. " : ""}이미 보낸 링크는 그대로 열려요.`;
  const restartConfirmBody = `지금 고른 답과 이 결과가 이 브라우저에서 지워져요. ${sentLinkNote}`;
  const clearConfirmBody = `이 브라우저에 저장된 답${screen === "result" ? "과 지금 보는 결과가" : screen === "questions" ? "과 지금 고른 답이" : "이"} 지워져요. ${sentLinkNote}`;
  const offConfirmBody = `꺼 두면 지금 저장된 ${offLosesAnswers && offLosesAddress ? "답과 함께 보기 확인 주소가 지워지고" : offLosesAddress ? "함께 보기 확인 주소가 지워지고" : "답이 지워지고"} 이후에는 저장되지 않아요.${offLosesAddress ? " 서버의 함께 보기 연결은 그대로 남으니, 끝내려면 먼저 ‘연결 끝내기’를 눌러 주세요." : ""}`;
  const Root = embedded ? "div" : "main";
  const shell = (children: ReactNode) => <Root className={embedded ? "px-4 pb-8 pt-5 sm:px-6" : "min-h-dvh bg-[var(--hb-surface-page)] px-4 pb-16 pt-5 sm:px-6"}>
    <div className="mx-auto max-w-2xl">
      {!embedded && <nav aria-label="웨딩코드 탐색" className="mb-6 flex items-center justify-between gap-3"><Button href="/landing" variant="ghost" size="sm" className="px-0!">웨딩한방</Button><span className="text-xs font-semibold tracking-wide text-[var(--hb-text-muted)]">WEDDING CODE</span></nav>}
      <section ref={screenRef} tabIndex={-1} aria-label={screenLabel} className={embedded ? "scroll-mt-20 outline-none md:scroll-mt-28" : "outline-none"}>
        {/* 안 채운 문장 안내는 화면 위가 아니라 아래 고정 단추 바로 위에 둔다. 위에 두면 빈 문장으로 화면이 움직인 뒤 안내가 화면 밖에 있어 읽히지 않는다. */}
        {notice && !pageMissingNotices.includes(notice) ? <p role="status" data-screen-notice className="mb-5 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-strong)]">{notice}</p> : null}
        {children}
        {storageControls}
      </section>
      {confirm === "restart" ? <V31ConfirmDialog title="처음부터 다시 답할까요?" body={restartConfirmBody} confirmLabel="지우고 다시 답하기" cancelLabel="그대로 두기"
        onConfirm={() => { setConfirm(null); confirmOpener.current = null; restart(); }} onCancel={cancelConfirm} /> : null}
      {confirm === "clear" ? <V31ConfirmDialog title="저장된 답을 지울까요?" body={clearConfirmBody} confirmLabel={screen === "intro" ? "지우기" : "지우고 다시 답하기"} cancelLabel="그대로 두기"
        onConfirm={() => { setConfirm(null); confirmOpener.current = null; restart(); }} onCancel={cancelConfirm} /> : null}
      {confirm === "off" ? <V31ConfirmDialog title="자동 저장을 끌까요?" body={offConfirmBody} confirmLabel="끄고 지우기" cancelLabel="그대로 두기"
        onConfirm={() => { const opener = confirmOpener.current; confirmOpener.current = null; setConfirm(null); toggleSaving(true); if (opener?.isConnected) opener.focus(); }} onCancel={cancelConfirm} /> : null}
      {confirm === "start" ? <V31ConfirmDialog title="저장된 답을 지우고 새로 시작할까요?" body="이 브라우저에 저장된 답이 지워지고 처음부터 시작해요. 이미 보낸 링크는 그대로 열려요." confirmLabel="지우고 새로 시작" cancelLabel="그대로 두기"
        onConfirm={() => { setConfirm(null); confirmOpener.current = null; start(); }} onCancel={cancelConfirm} /> : null}
    </div>
  </Root>;

  if (openedOwnLink) return shell(<section className={`${v31Surface} p-5 sm:p-8`} data-own-link aria-labelledby="v31-own-link-title">
    <h1 id="v31-own-link-title" className={`text-2xl ${v31Title}`}>{ownLinkCopy.title}</h1>
    <p className={`mt-3 ${v31Body}`}>{ownLinkCopy.body}</p>
    <p className={`mt-2 ${v31Body}`}>{ownLinkCopy.backHint}</p>
    <div className="mt-6 flex flex-col gap-2">
      <Button variant="primary" size="lg" fullWidth onClick={backToOwnResult}>{ownLinkCopy.backButton}</Button>
      <Button variant="secondary" size="lg" fullWidth onClick={continueWithLink}>{ownLinkCopy.continueButton}</Button>
    </div>
  </section>);

  if (screen === "intro") return shell(<>
    {/* 이어 하러 돌아온 사람이 소개를 한 화면 반 넘게 내리지 않아도 이어 하기를 먼저 보게, 저장된 답 카드를 소개 제목보다 위에 둔다. */}
    {resumable && local.saved ? <section className={`${v31Surface} mb-5 p-5`} aria-label="저장된 내 답 이어하기">
      <h2 className={`text-lg ${v31Title}`}>이 브라우저에 남겨 둔 답이 있어요</h2>
      <p className={`mt-2 ${v31Body}`}>{local.saved.screen === "result" ? "전에 답한 내 결과를 다시 볼 수 있어요." : local.saved.editing ? "수정하던 질문부터 이어 할 수 있어요." : `${v31PositionLabel(local.saved.flow, local.saved.index)}부터 이어 할 수 있어요.`}</p>
      <Button variant="primary" size="lg" fullWidth onClick={() => resume()} className="mt-3 whitespace-normal!">{local.saved.screen === "result" ? context.first ? "저장한 내 답으로 비교하기" : "내 결과 다시 보기" : "이어서 답하기"}</Button>
    </section> : null}
    <section className={`${v31Surface} overflow-hidden`}>
      <div className="bg-[var(--hb-primary)] px-5 py-8 text-[var(--hb-on-primary)] sm:px-8 sm:py-10">
        <p className="text-xs font-semibold">웨딩코드 · 내가 원하는 결혼 준비</p>
        <h1 className="mt-4 text-3xl font-semibold leading-snug">{context.first ? "상대와 같은 질문에, 내 생각대로 답해 봐요" : <>나는 어떤 결혼식을<br />바라고 있을까요?</>}</h1>
        {/* 판정이 아니라는 말은 소개 첫 문단에서 한 번만 한다. 받은 링크에서는 같은 점을 나란히 보는 이야기를 아래 ‘둘이 먼저 나눠볼 이야기’ 카드가 한다. */}
        <p className="mt-4 text-base leading-relaxed">{context.first ? "상대의 답이 담긴 링크를 받았어요. 상대에게 맞추지 말고 내 생각대로 답해 주세요. 성격을 진단하는 검사가 아니고, 아직 여러 사람에게 확인해 보지 못한 질문이에요." : "취향부터 돈을 쓰는 기준, 함께 준비하는 방식까지. 내가 고른 답을 모아 준비 기준으로 정리해 봐요. 성격을 진단하는 검사가 아니고, 아직 여러 사람에게 확인해 보지 못한 질문이에요."}</p>
      </div>
      <div className="p-5 sm:p-8">
        <div className="space-y-5">
          {[
            { icon: Paintbrush, title: "내가 그리는 결혼식", body: "장소·사진·옷·식사·하객 규모·식순에서 내가 고른 것을 모아 봐요." },
            { icon: ListChecks, title: "네 글자로 보는 준비 방식", body: "예산, 일 나누기, 가족과 상의, 받고 싶은 도움 네 가지에서 글자를 하나씩 정해요. 글자는 주제마다 두 문장의 답으로 정하고, 문장별 답도 함께 보여줘요." },
            context.first
              // 받은 링크에는 상대의 답이 이미 들어 있어서, 내 답을 마치면 공유할 것이 더 없이 바로 두 사람 결과가 열린다.
              ? { icon: HeartHandshake, title: "둘이 먼저 나눠볼 이야기", body: "내 답을 마치면 받은 링크에 담긴 상대의 답과 바로 나란히 보고, 같은 점과 먼저 이야기해 볼 점을 알 수 있어요. 내 답은 내가 링크를 보내기 전에는 상대에게 가지 않아요." }
              : { icon: HeartHandshake, title: "혼자 해도, 둘이 비교해도 돼요", body: "혼자 해도 결과를 볼 수 있어요. 두 사람의 답을 나란히 보려면, 둘 다 답한 뒤 서로 답을 공유해야 해요." },
          ].map(item => <div key={item.title} className="flex gap-3"><item.icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--hb-success)]" /><div><h2 className={`text-base ${v31Title}`}>{item.title}</h2><p className={`mt-1 ${v31Body}`}>{item.body}</p></div></div>)}
        </div>
        <div className="mt-7 border-t border-[var(--hb-hairline)] pt-5">
          <p className={`text-sm ${v31Title}`}>기본 {CORE_PAGE_COUNT}페이지 · 로그인 없이 시작</p>
          <p className={`mt-2 ${v31Body}`}>{V31_CORE_RATING_IDS.length}개 문장에 다섯 단계로 답해요. 그다음 {WEDDING_CODE_V31_TASTES.length}가지 취향을 고르고, 피하고 싶은 것과 다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳도 골라요. 마지막 ‘꼭 지키고 싶은 것’ 페이지는 고를 것이 없으면 건너뛰어요.</p>
          <p className={`mt-2 ${v31Body}`}>아직 모르거나 해당하지 않는 내용은 억지로 고르지 말고 ‘아직 모르겠어요’ 같은 보기로 표시해 주세요. 글자를 정하는 문장에 그렇게 표시하면 그 주제의 글자만 ‘?’로 남고, 나머지 결과는 그대로 나와요.</p>
          {/*
            개인정보 안내는 보이는 한 줄과 접힌 ‘자세히’ 두 겹이다. 한 줄이 사람들이 먼저 묻는 두 사실(답은 서버에 보내지 않는다, 이용 통계에는 답이 없다)과
            처리방침 링크를 맡고, 접힌 칸은 옛 세 문단을 그대로 담는다(링크는 소개 안에 하나만 둔다). 시험이 data-intro-privacy 로 두 겹을 함께 본다.
          */}
          <div className="mt-3" data-intro-privacy>
            <p className={v31Body}><span className="font-semibold text-[var(--hb-text-strong)]">답하는 동안 고른 답은 서버에 보내지 않아요. 화면을 고치는 데 쓸 이용 통계만 기록하고, 이 통계에는 답이 들어 있지 않아요.</span> 자세한 내용은{" "}<a href="/privacy" target="_blank" rel="noopener noreferrer" className="py-2 font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">개인정보 처리방침</a>에서 볼 수 있어요.</p>
            <details className={`mt-1 ${v31Body}`}>
              {/* 접힘 이름은 무엇의 자세한 안내인지 그 자체로 말한다(보이는 글자와 낭독 이름이 같다). */}
              <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">개인정보 자세히 보기</summary>
              <div className="space-y-2">
                <p className={v31Body}>고른 답과 웨딩코드는 답하는 동안 서버나 계정에 보내지 않아요. 화면 개선을 위해 첫 화면을 열었는지, 몇 번째 장면까지 봤는지, 끝까지 했는지, 답한 장면과 건너뛴 장면의 수 같은 이용 통계만 기록하고, 이 통계에 고른 답·웨딩코드·공유 링크 주소는 넣지 않아요.</p>
                {local.status === "off" ? <p className={v31Body}>자동 저장이 꺼져 있어서 내 답은 이 브라우저에 저장되지 않아요. 나가면 지금 답은 사라져요.</p>
                  : local.status === "unavailable" ? <p className={v31Body}>이 브라우저에 저장할 수 없어서 내 답은 저장되지 않아요. 계속 답할 수 있지만, 나가면 지금 답은 사라질 수 있어요.</p>
                  : <p className={v31Body}>내 답은 이 브라우저에 자동으로 저장돼요. 마지막으로 저장한 날부터 {LOCAL_SAVE_DAYS}일 동안 이어 할 수 있어요. 카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 해요. 다른 사람과 같이 쓰는 컴퓨터나 휴대폰이라면 시작하기 전에 아래 ‘자동 저장 설정’에서 꺼 주세요.</p>}
                {context.first ? <p className={v31Body}>받은 링크로 답할 때는 내 답을 서버에 보관하지 않아요.</p>
                  : <p className={v31Body}>결과에서 ‘상대 초대하고 함께 보기’나 ‘동의하고 두 사람 결과 보기’에 동의하면 내 답 전체를 서버에 보관하고, 초대로 연결된 상대에게 보여줘요. 동의하기 전에는 내 답을 서버에 보내지 않아요. 초대 링크를 먼저 사용한 사람이 상대가 돼요. 이름이나 계정으로는 확인하지 않아요. 초대 후 {PAIR_SESSION_RETENTION_DAYS}일 동안 볼 수 있고, 기간이 끝난 내용은 하루 안에 삭제해요. ‘연결 끝내기’를 누르면 두 사람의 공유 답을 바로 지우지만, 상대가 이미 읽었거나 따로 저장해 둔 내용은 되돌릴 수 없어요.</p>}
              </div>
            </details>
          </div>
          {context.first ? <p className={`mt-3 ${v31Body}`}>상대의 답은 이 브라우저에 저장하지 않아요. 내가 직접 답하거나 불러온 내 답만 저장해요. 다만 받은 링크 주소에는 상대의 답이 들어 있어서 브라우저 방문 기록에 남을 수 있어요. 나중에 상대와 비교하려면 받은 링크를 다시 열어 주세요.</p> : null}
          {context.first && !context.received ? <p className={`mt-3 ${v31Body}`} data-intro-return-step>내 답을 마치면 나오는 두 사람 결과 링크를 상대에게 다시 보내 주어야 상대도 결과를 볼 수 있어요.</p> : null}
          {/* 묻지 않는 것의 목록은 시작 버튼 위 범위 줄에 한 번만 둔다. */}
          <details className={`mt-3 ${v31Body}`}>
            <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">무엇을 물어보나요?</summary>
            <p>취향으로는 결혼식 장소, 사진, 옷, 식사, 하객 규모, 식순을 물어봐요. 준비 방식으로는 돈을 쓰는 기준, 초대할 사람과 하객의 이동 시간, 후보를 비교하는 방식, 둘이 일을 나누는 방식, 가족과 상의하는 순서와 마지막 선택, 힘들 때 바라는 도움을 물어봐요. 실제 예산 금액은 묻지 않아요.</p>
            {/* 우선순위 화면은 고를 보기가 있을 때만 나온다(getV31PriorityOptions: 4점 이상 문장, 답한 취향, 고른 피하고 싶은 것). 그 조건을 그대로 적는다. */}
            <p className="mt-2" data-intro-priority>마지막 ‘꼭 지키고 싶은 것’ 페이지에는 ‘그런 편이에요’나 ‘매우 그래요’로 답한 문장, 직접 고른 취향, 피하고 싶은 것이 보기로 나와요. 이 페이지는 고르지 않고 넘어가도 결과를 볼 수 있어요.</p>
            <p className="mt-2">문장은 한 페이지에 최대 3개씩, 취향과 그 밖의 질문은 한 페이지에 하나씩 물어봐요. 답을 골라도 자동으로 넘어가지 않아요. 더 궁금하면 결과에서 {V31_EXTRA_INDEXES.length}개 문장을 이어서 볼 수 있어요.</p>
          </details>
        </div>
      </div>
    </section>

    <div className="mt-5" data-intro-scope>
      <p className={v31Body}>결혼식 모습과 둘이 준비하는 방식만 물어봐요. 신혼집, 혼수, 예단과 예물, 양쪽 집안이 비용을 어떻게 나눌지는 묻지 않아요. 형편이나 집안 사정이 이미 정해져 있어도, 여기서는 내가 바라는 대로 답해 주세요.</p>
    </div>
    <Button variant={resumable ? "secondary" : "primary"} size="lg" fullWidth loading={!local.ready} aria-haspopup={resumable ? "dialog" : undefined} onClick={resumable ? () => askConfirm("start") : start} className="mt-5 min-h-14! whitespace-normal!">{resumable ? "저장된 답 지우고 새로 시작" : started ? "이어서 답하기" : context.first ? "나도 답해보기" : "내 웨딩코드 시작하기"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
  </>);

  if (screen === "result") return shell(<WeddingCodeV31Results key={revision} draft={draft} first={context.first} received={context.received} shareOrigin={shareOrigin} onEdit={edit} onRestart={context.received ? restart : () => askConfirm("restart")} onMore={!context.received && optionalRemaining > 0 ? more : undefined} optionalCount={optionalRemaining} sharingContent={renderResultActions?.(draft)} />);

  const topic = question ? WEDDING_CODE_V31_TOPICS.find(item => item.key === question.topic) : null;
  const title = question?.statement ?? taste?.question ?? (index === avoidanceIndex ? "이번 결혼식에서 피하고 싶은 것이 있나요?" : index === priorityIndex ? "이번 결혼 준비에서 꼭 지키고 싶은 것이 있나요?" : "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳이 있나요?");
  // 진행 표기는 하나만 둔다. 묶음 흐름은 페이지 단위이고, 한 문항씩 보는 이전 흐름과 수정 화면은 그대로다.
  // 수정 화면은 흐름의 몇 번째인지 말하지 않는다(결과의 한 칸을 고치러 온 것이라, 흐름 속 번호는 본 흐름의 ‘n / 14 페이지’와 맞지 않아 보인다).
  const progressText = grouped ? `${page.position + 1} / ${page.total} 페이지` : editing ? "답 수정" : ordinal > 0 ? `${flowLabel} ${ordinal} / ${totalQuestions}` : "답 수정";
  return shell(<>
    <div className="mb-5 flex items-center gap-3">
      <Button variant="icon" label="이전 질문" onClick={previous}><ArrowLeft aria-hidden="true" className="size-5" /></Button>
      <progress value={grouped ? page.position + 1 : ordinal > 0 ? ordinal : 1} max={grouped ? page.total : ordinal > 0 ? totalQuestions : 1} aria-label={grouped ? "현재 페이지" : "현재 질문"} aria-valuetext={grouped ? `${flowLabel} ${page.total}페이지 중 ${page.position + 1}페이지` : editing ? "선택한 답 수정" : ordinal > 0 ? `${flowLabel} ${totalQuestions}개 중 ${ordinal}번째` : "선택한 답 수정"}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hb-hairline)] accent-[var(--hb-success)] [&::-webkit-progress-bar]:bg-[var(--hb-hairline)] [&::-webkit-progress-value]:bg-[var(--hb-success)]" />
      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--hb-text-body)]" data-progress-text>{progressText}</span>
    </div>
    {/* 아래 고정 버튼 뒤로 초점이 숨지 않게, 키보드로 옮겨 간 칸은 버튼 높이만큼 띄워서 보여준다. 앱 안에서는 하단 탭과 안전 영역까지 더해진다. */}
    <div className="**:scroll-mb-[calc(10rem+env(safe-area-inset-bottom))]">
      {ratingPage ? <>
        <p className="text-xs font-semibold text-[var(--hb-success)]">{flowLabel}</p>
        <h1 className={`mt-2 text-xl leading-relaxed ${v31Title} ${page.position === 0 ? "" : "mb-5"}`}>문장마다 내 생각에 가까운 답을 골라 주세요</h1>
        {page.position === 0 ? <p data-rating-guide className={`mb-5 mt-2 rounded-lg bg-[var(--hb-surface-hover)] p-3 ${v31Body}`}>{v31RatingGuide} 아직 모르겠거나 해당하지 않는 내용이면 문장 아래 ‘{v31EscapeFoldLabel}’를 눌러 골라 주세요.</p> : null}
        <div className="space-y-5">
          {page.indexes.map((questionIndex, position) => {
            const pageQuestion = WEDDING_CODE_V31_QUESTIONS[questionIndex];
            const pageTopic = WEDDING_CODE_V31_TOPICS.find(item => item.key === pageQuestion.topic);
            // ‘이 주제 전체가 해당하지 않는다면’은 그 주제의 마지막 문장 아래에 둔다(첫 문장 아래에 두면 그 문장 하나에만 걸리는 말로 읽힌다).
            const lastOfTopic = page.indexes.map(item => WEDDING_CODE_V31_QUESTIONS[item].topic).lastIndexOf(pageQuestion.topic) === position;
            // 다음 질문을 눌렀는데 아직 답하지 않은 문장은 진한 테두리로 알린다(안내는 아래 고정 단추 위에 있다).
            const unanswered = pageMissingNotices.includes(notice) && draft.answers[pageQuestion.id] === undefined;
            return <section key={pageQuestion.id} tabIndex={-1} aria-label={pageQuestion.statement} data-question={pageQuestion.id} data-unanswered={unanswered || undefined}
              className={`${v31Surface} scroll-mt-20 p-1.5 outline-none min-[360px]:p-3.5 sm:p-6 md:scroll-mt-28 ${unanswered ? "border-2! border-[var(--hb-text-strong)]!" : ""}`}>
              <p className="text-xs font-semibold text-[var(--hb-success)]">{firstOrdinal + position}. {pageTopic?.title}</p>
              <h2 className={`mb-4 mt-2 text-base leading-relaxed sm:text-lg ${v31Title}`}>{pageQuestion.statement}</h2>
              <V31RatingInput compact questionLabel={pageQuestion.statement} value={draft.answers[pageQuestion.id]} onChange={value => changeRating(pageQuestion.id, value)} />
              {lastOfTopic ? topicScope(pageQuestion.topic) : null}
            </section>;
          })}
        </div>
      </> : <section className={`${v31Surface} p-5 sm:p-7`} data-question={question?.id ?? (taste ? `taste.${taste.key}` : index === avoidanceIndex ? "avoidances" : index === priorityIndex ? "priorities" : "spending")}>
        <p className="text-xs font-semibold text-[var(--hb-success)]">{topic?.title ?? (taste ? `내가 그리는 결혼식 · ${taste.title}` : index === avoidanceIndex ? "내 기준 · 피하고 싶은 것" : index === priorityIndex ? "내 기준 · 꼭 지키고 싶은 것" : "내 기준 · 더 쓰고 싶은 곳")}</p>
        <h1 className={`mb-5 mt-3 text-2xl leading-relaxed ${v31Title}`}>{title}</h1>
        {taste?.key === "guests" ? <p className={`mb-4 ${v31Body}`}>두 사람의 가족·지인을 모두 합한 전체 하객 수를 떠올려 주세요.</p> : null}
        {question ? <V31RatingInput key={question.id} value={draft.answers[question.id]} onChange={value => changeRating(question.id, value)} showGuide={ordinal === 1} /> : <>
          {!taste ? <p className={`mb-4 ${v31Body}`}>{index === avoidanceIndex ? "피하고 싶은 것이 있으면 여러 개 골라 주세요. 다시 누르면 선택이 풀려요. 없다면 ‘따로 피하고 싶은 것은 없어요’를, 목록에 없다면 ‘맞는 보기가 없어요’를 골라 주세요." : index === priorityIndex ? "앞에서 고른 답 가운데 꼭 지키고 싶은 것을 골라 주세요. 고르지 않아도 결과를 볼 수 있어요." : "전체 예산은 그대로 두고, 그 안에서 더 쓰고 싶은 곳을 골라 주세요. 지금 없다면 ‘더 쓰고 싶은 곳은 지금 없어요’를 골라도 돼요."}</p> : null}
          {index === priorityIndex ? <V31PriorityInput value={draft.priorities} options={priorityOptions} onChange={changeChoice} /> : <V31ChoiceInput key={taste?.key ?? index} value={choice} options={taste?.options ?? (index === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES : WEDDING_CODE_V31_SPENDING)}
            max={taste?.max ?? (index === avoidanceIndex ? WEDDING_CODE_V31_AVOIDANCES.length : 2)} onChange={changeChoice} tasteKey={taste?.key} kind={taste ? "taste" : index === avoidanceIndex ? "avoidances" : "spending"} />}
        </>}
        {question ? topicScope(question.topic) : null}
      </section>}
    </div>
    {/* 문장이 길어 버튼이 첫 화면 밖으로 밀리지 않게 화면 아래에 붙인다. 앱 안에서는 하단 탭 위에 둔다. */}
    <div data-question-actions className="sticky bottom-0 z-10 mt-5 border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 max-md:[.amora-workspace_&]:bottom-[calc(75px+env(safe-area-inset-bottom))] max-md:[.amora-workspace_&]:pb-3">
      {/* 안 채운 문장 안내. 누른 단추 바로 위에 있어서, 화면이 빈 문장으로 움직인 뒤에도 왜 넘어가지 않았는지 읽힌다. */}
      {pageMissingNotices.includes(notice) ? <p role="status" data-screen-notice data-page-notice className="mb-3 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-3 text-sm leading-relaxed text-[var(--hb-text-strong)]">{notice}</p> : null}
      {/*
        우선순위 화면에서 아직 아무것도 고르지 않았으면 이 버튼이 넘어가기를 맡는다(수정 화면도 같다). 막힌 버튼과
        목록 아래 넘어가기 버튼을 겹쳐 두지 않는다. 고르면 평소처럼 결과 보기나 수정한 결과 보기로 돌아온다.
      */}
      {priorityEmpty ? <Button variant="primary" size="lg" fullWidth onClick={skipPriority} data-skip-priority className="min-h-12! whitespace-normal!">{nextIndex === null ? "고르지 않고 결과 보기" : "고르지 않고 다음 질문"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
        : editing ? <div className="space-y-2">
          {/* 고치는 도중에도 다음 문항으로 넘어가 다른 답을 이어서 고칠 수 있다(수정 상태는 그대로다). 맨 끝 문항이면 단추가 없다. */}
          {nextIndex !== null ? <Button variant="secondary" size="lg" fullWidth onClick={() => commit({ index: nextIndex })} data-edit-next className="min-h-12! whitespace-normal!">다음 질문<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button> : null}
          <Button variant="primary" size="lg" fullWidth disabled={currentResponse === undefined} onClick={() => finish()} className="min-h-12! whitespace-normal!"><Check aria-hidden="true" className="size-4 shrink-0" />수정한 결과 보기</Button>
        </div>
          // 비어 있는 답이 있어도 막지 않는다. 막힌 버튼은 키보드 Tab 에서 빠져 이유를 들을 수 없다. 누르면 비어 있는 곳으로 안내한다.
          : <Button variant="primary" size="lg" fullWidth aria-disabled={!pageComplete} onClick={next} className="min-h-12! whitespace-normal! aria-disabled:cursor-not-allowed aria-disabled:opacity-50">{nextIndex === null ? "결과 보기" : "다음 질문"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>}
    </div>
    {/* 마지막 페이지의 ‘결과 보기’와 같은 곳으로 가는 단추를 둘 두지 않는다. */}
    {flow === "extra" && !editing && nextIndex !== null ? <Button variant="secondary" size="lg" fullWidth onClick={() => finish()} className="mt-3 whitespace-normal!">여기까지만 답하고 결과 보기</Button> : null}
    {/* 이전 페이지가 없는 첫 페이지에서는 돌아갈 곳이 없어 이 말을 하지 않는다. */}
    {previousIndex !== null ? <p className="mt-3 text-center text-xs leading-relaxed text-[var(--hb-text-muted)]">이전 질문으로 돌아가 답을 바꿔도 괜찮아요.</p> : null}
  </>);
}
