"use client";

import { ArrowLeft, ArrowRight, Check, HeartHandshake, ListChecks, Paintbrush } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import {
  WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_SPENDING, WEDDING_CODE_V30_TASTES,
  WEDDING_CODE_V30_TOPICS, WEDDING_CODE_V30_VERSION,
  type V30Choice, type V30Draft, type V30Response,
} from "@/constants/weddingCodeV30";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { createV30Draft, getV30PriorityOptions, normalizeV30Draft } from "@/lib/weddingCode/v30";
import { V30ChoiceInput, V30RatingInput, v30Body, v30Surface, v30Title } from "./WeddingCodeV30Inputs";
import WeddingCodeV30Results from "./WeddingCodeV30Results";

const coreCount = WEDDING_CODE_V30_QUESTIONS.length;
const priorityIndex = coreCount + WEDDING_CODE_V30_TASTES.length;
const totalQuestions = priorityIndex + 2;
const missingAnswerNotice = "선택이 비어 있는 질문으로 돌아왔어요. 답을 고르거나, 아직 모르거나 답하지 않겠다는 상태를 골라 주세요.";

function responseCounts(draft: V30Draft) {
  const responses = Object.values(draft.answers);
  const choices = [...Object.values(draft.tastes), draft.priorities, draft.spending];
  return {
    answered_count: responses.filter(value => typeof value === "number").length + choices.filter(choice => choice?.status === "answered" || choice?.status === "no_preference" || choice?.status === "no_match").length,
    skipped_count: responses.filter(value => value === "skipped").length + choices.filter(choice => choice?.status === "skipped").length,
  };
}

export default function WeddingCodeV30Client({ shareOrigin, partnerDraft = null, bothDrafts = null, onRestart }: {
  shareOrigin: string; partnerDraft?: V30Draft | null;
  bothDrafts?: { first: V30Draft; second: V30Draft } | null; onRestart?: () => void;
}) {
  const screenRef = useRef<HTMLElement>(null);
  const [screen, setScreen] = useState<"intro" | "questions" | "result">(bothDrafts ? "result" : "intro");
  const [draft, setDraft] = useState<V30Draft>(() => bothDrafts?.second ?? createV30Draft());
  const [context, setContext] = useState({ first: bothDrafts?.first ?? partnerDraft, received: Boolean(bothDrafts) });
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [needsPriorityReview, setNeedsPriorityReview] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const question = index < coreCount ? WEDDING_CODE_V30_QUESTIONS[index] : null;
  const taste = index >= coreCount && index < priorityIndex ? WEDDING_CODE_V30_TASTES[index - coreCount] : null;
  const choice = taste ? draft.tastes[taste.key] : index === priorityIndex ? draft.priorities : draft.spending;
  const currentResponse = question ? draft.answers[question.id] : choice;
  const started = Object.keys(draft.answers).length > 0 || Object.keys(draft.tastes).length > 0;
  const hasPartnerLink = Boolean(context.first);

  useEffect(() => {
    screenRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [index, screen]);
  useEffect(() => {
    if (screen === "result" && context.first) captureWeddingCodeEvent("wedding_code_comparison_viewed", { version: WEDDING_CODE_V30_VERSION, scene_total: totalQuestions });
  }, [context.first, screen]);
  useEffect(() => {
    if (screen === "intro") captureWeddingCodeEvent("wedding_code_intro_viewed", {
      version: WEDDING_CODE_V30_VERSION, scene_total: totalQuestions, has_partner_link: hasPartnerLink,
    });
    if (screen === "questions") captureWeddingCodeEvent("wedding_code_scene_reached", {
      version: WEDDING_CODE_V30_VERSION, scene_index: index + 1, scene_total: totalQuestions, has_partner_link: hasPartnerLink,
    });
  }, [hasPartnerLink, index, screen]);

  function update(nextDraft: V30Draft, staleTastePriority?: string) {
    const normalized = normalizeV30Draft(nextDraft);
    if (staleTastePriority && normalized.priorities?.status === "answered") {
      const kept = normalized.priorities.values.filter(value => value !== staleTastePriority);
      normalized.priorities = kept.length ? { status: "answered", values: kept } : undefined;
    }
    const previousPriorities = nextDraft.priorities?.status === "answered" ? nextDraft.priorities.values : [];
    const nextPriorities = normalized.priorities?.status === "answered" ? normalized.priorities.values : [];
    if (previousPriorities.some(value => !nextPriorities.includes(value))) {
      setNotice("앞의 답이 바뀌어 더 이상 맞지 않는 우선순위를 뺐어요. 결과에서 우선순위를 다시 확인해 주세요.");
      if (normalized.priorities === undefined) setNeedsPriorityReview(true);
    }
    setDraft(normalized);
    setRevision(value => value + 1);
  }
  function changeRating(value: V30Response) {
    if (question) update({ ...draft, answers: { ...draft.answers, [question.id]: value } });
  }
  function changeChoice(value: V30Choice | undefined) {
    if (taste) {
      const previous = draft.tastes[taste.key];
      const changed = previous?.status === "answered" && (value?.status !== "answered"
        || [...previous.values].sort().join("|") !== [...value.values].sort().join("|"));
      // 같은 취향 항목이어도 고른 내용이 바뀌면 이전 우선순위를 새 선택에 넘기지 않는다.
      update({ ...draft, tastes: { ...draft.tastes, [taste.key]: value } }, changed ? `taste.${taste.key}` : undefined);
    }
    else if (index === priorityIndex) {
      update({ ...draft, priorities: value });
      if (value !== undefined) { setNeedsPriorityReview(false); setNotice(""); }
    }
    else update({ ...draft, spending: value });
  }
  function finish() {
    if (needsPriorityReview && draft.priorities === undefined) {
      setIndex(priorityIndex);
      setNotice("앞의 답이 바뀌어 이전 우선순위를 뺐어요. 지키고 싶은 것을 다시 고르거나, 아직 정하지 않았다고 답해 주세요.");
      return;
    }
    const missingCore = WEDDING_CODE_V30_QUESTIONS.findIndex(item => draft.answers[item.id] === undefined);
    const missingTaste = WEDDING_CODE_V30_TASTES.findIndex(item => draft.tastes[item.key] === undefined);
    const missingIndex = missingCore >= 0 ? missingCore : missingTaste >= 0 ? coreCount + missingTaste
      : draft.priorities === undefined ? priorityIndex : draft.spending === undefined ? priorityIndex + 1 : -1;
    if (missingIndex >= 0) { setIndex(missingIndex); setNotice(missingAnswerNotice); return; }
    if (notice === missingAnswerNotice) setNotice("");
    if (!editing) captureWeddingCodeEvent("wedding_code_completed", { version: WEDDING_CODE_V30_VERSION, scene_total: totalQuestions, ...responseCounts(draft), result_kind: context.first ? "couple" : "solo" });
    setScreen("result");
    setEditing(false);
  }
  function next() {
    if (index === totalQuestions - 1) finish();
    else setIndex(value => value + 1);
  }
  function start() {
    if (!started) captureWeddingCodeEvent("wedding_code_started", { version: WEDDING_CODE_V30_VERSION, scene_total: totalQuestions, has_partner_link: Boolean(context.first) });
    setScreen("questions");
  }
  function restart() {
    // Entry의 key가 그대로여도 로컬 답과 받은 링크 맥락을 먼저 비운다.
    setDraft(createV30Draft()); setContext({ first: null, received: false }); setIndex(0);
    setScreen("intro"); setEditing(false); setNeedsPriorityReview(false); setNotice(""); setRevision(value => value + 1);
    window.history.replaceState(null, "", window.location.pathname);
    captureWeddingCodeEvent("wedding_code_restarted", { version: WEDDING_CODE_V30_VERSION });
    onRestart?.();
  }
  function edit(id?: string) {
    const questionIndex = WEDDING_CODE_V30_QUESTIONS.findIndex(item => item.id === id);
    const tasteIndex = WEDDING_CODE_V30_TASTES.findIndex(item => `taste.${item.key}` === id);
    const target = questionIndex >= 0 ? questionIndex : tasteIndex >= 0 ? coreCount + tasteIndex
      : id === "priorities" ? priorityIndex : id === "spending" ? priorityIndex + 1 : 0;
    setIndex(target); setEditing(true); setScreen("questions");
  }
  function markTopicNotApplicable() {
    if (!question) return;
    const topicQuestions = WEDDING_CODE_V30_QUESTIONS.filter(item => item.topic === question.topic);
    const answers = { ...draft.answers };
    for (const item of topicQuestions) answers[item.id] = "not_applicable";
    update({ ...draft, answers });
    const lastIndex = WEDDING_CODE_V30_QUESTIONS.findLastIndex(item => item.topic === question.topic);
    setIndex(lastIndex + 1);
  }

  const shell = (children: ReactNode) => <main className="min-h-dvh bg-[var(--hb-surface-page)] px-4 pb-16 pt-5 sm:px-6">
    <div className="mx-auto max-w-2xl">
      <nav aria-label="웨딩코드 탐색" className="mb-6 flex items-center justify-between gap-3"><Button href="/landing" variant="ghost" size="sm" className="px-0!">웨딩한방</Button><span className="text-xs font-semibold tracking-wide text-[var(--hb-text-muted)]">WEDDING CODE</span></nav>
      <section ref={screenRef} tabIndex={-1} aria-label={screen === "intro" ? "웨딩코드 소개" : screen === "result" ? "웨딩코드 결과" : `웨딩코드 ${index + 1}번째 질문`} className="outline-none">
        {notice ? <p role="status" className="mb-5 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-strong)]">{notice}</p> : null}
        {children}
      </section>
    </div>
  </main>;

  if (screen === "intro") return shell(<>
    <section className={`${v30Surface} overflow-hidden`}>
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
          ].map(item => <div key={item.title} className="flex gap-3"><item.icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--hb-success)]" /><div><h2 className={`text-base ${v30Title}`}>{item.title}</h2><p className={`mt-1 ${v30Body}`}>{item.body}</p></div></div>)}
        </div>
        <div className="mt-7 border-t border-[var(--hb-hairline)] pt-5">
          <p className={`text-sm ${v30Title}`}>전체 {totalQuestions}개 질문 · 로그인 없이 시작</p>
          <p className={`mt-2 ${v30Body}`}>{coreCount}개 문장에 다섯 단계로 답하고, {WEDDING_CODE_V30_TASTES.length}가지 취향과 우선순위·지출 희망을 직접 골라요. 아직 모르거나 계획에 없는 것은 따로 표시할 수 있어요.</p>
          <p className={`mt-3 ${v30Body}`}>답은 서버나 계정에 저장하지 않아요. 새로고침하면 진행 중인 답은 사라져요. 결과에서 동의하고 만든 공유 링크에는 답 전체가 담겨요.</p>
          {context.first ? <p className={`mt-3 ${v30Body}`}>이 링크를 열었다고 상대의 답이 내 답으로 저장되지는 않아요. 내 응답은 직접 공유하기 전까지 이 화면에서만 볼 수 있어요.</p> : null}
          <details className={`mt-3 ${v30Body}`}><summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">어디까지 알아볼 수 있나요?</summary><p>지금 내가 원하는 결혼식과 준비 방식을 살펴봐요. 성격 진단이나 공식 MBTI 검사가 아니고, 결혼에 관한 모든 가치관을 판단하지 않아요. 신혼집·여행·혼수와 실제 예산 금액은 별도로 정해야 해요.</p></details>
        </div>
      </div>
    </section>
    <Button variant="primary" size="lg" fullWidth onClick={start} className="mt-5 min-h-14! whitespace-normal!">{started ? "이어서 답하기" : context.first ? "나도 답해보기" : "내 웨딩코드 시작하기"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
  </>);

  if (screen === "result") return shell(<WeddingCodeV30Results key={revision} draft={draft} first={context.first} received={context.received} shareOrigin={shareOrigin} onEdit={edit} onRestart={restart} />);

  const topic = question ? WEDDING_CODE_V30_TOPICS.find(item => item.key === question.topic) : null;
  const title = question?.statement ?? taste?.question ?? (index === priorityIndex ? "이번 결혼식에서 특히 지키고 싶은 것은 무엇인가요?" : "다른 곳의 비용을 줄여서라도 더 쓰고 싶은 곳이 있나요?");
  return shell(<>
    <div className="mb-5 flex items-center gap-3">
      <Button variant="icon" label="이전 질문" onClick={() => index > 0 ? setIndex(value => value - 1) : setScreen("intro")}><ArrowLeft aria-hidden="true" className="size-5" /></Button>
      <progress value={index + 1} max={totalQuestions} aria-label="현재 질문" aria-valuetext={`${totalQuestions}개 중 ${index + 1}번째 질문`}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hb-hairline)] accent-[var(--hb-success)] [&::-webkit-progress-bar]:bg-[var(--hb-hairline)] [&::-webkit-progress-value]:bg-[var(--hb-success)]" />
      <span className="text-sm font-semibold tabular-nums text-[var(--hb-text-body)]">{index + 1} / {totalQuestions}</span>
    </div>
    <section className={`${v30Surface} p-5 sm:p-7`} data-question={question?.id ?? (taste ? `taste.${taste.key}` : index === priorityIndex ? "priorities" : "spending")}>
      <p className="text-xs font-semibold text-[var(--hb-success)]">{topic?.title ?? (taste ? `구체 취향 · ${taste.title}` : "마지막으로, 내 기준 확인")}</p>
      <h1 className={`mb-5 mt-3 text-2xl leading-relaxed ${v30Title}`}>{title}</h1>
      {question ? <V30RatingInput key={question.id} value={draft.answers[question.id]} onChange={changeRating} /> : <>
        {!taste ? <p className={`mb-4 ${v30Body}`}>{index === priorityIndex ? "앞에서 원한다고 답한 내용과 직접 고른 취향만 모았어요. 높은 점수라고 자동으로 중요해지는 건 아니에요. 정말 지키고 싶은 것을 직접 골라 주세요." : "총액을 늘리겠다는 뜻은 아니에요. 더 쓰고 싶은 곳이 없다면 아래에서 ‘더 쓰고 싶은 곳은 지금 없어요’를 골라도 돼요."}</p> : null}
        <V30ChoiceInput key={taste?.key ?? index} value={choice} options={taste?.options ?? (index === priorityIndex ? getV30PriorityOptions(draft) : WEDDING_CODE_V30_SPENDING)}
          max={taste?.max ?? (index === priorityIndex ? 3 : 2)} onChange={changeChoice} tasteKey={taste?.key} kind={taste ? "taste" : index === priorityIndex ? "priorities" : "spending"} />
      </>}
      {question && ["vision", "records", "family"].includes(question.topic) ? <details className={`mt-4 border-t border-[var(--hb-hairline)] pt-2 ${v30Body}`}>
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">이 주제 전체가 이번 계획에 없다면</summary>
        <p className="mt-2">‘{topic?.title}’의 {WEDDING_CODE_V30_QUESTIONS.filter(item => item.topic === question.topic).length}문장을 모두 ‘이번 계획에는 없어요’로 바꿔요. 이미 고른 답도 바뀌며, 되돌아오면 한 문장씩 다시 답할 수 있어요.</p>
        <Button variant="secondary" fullWidth onClick={markTopicNotApplicable} className="mt-3 whitespace-normal!">이 주제는 계획에 없어요</Button>
      </details> : null}
    </section>
    <Button variant="primary" size="lg" fullWidth disabled={currentResponse === undefined} onClick={next} className="mt-5 min-h-14! whitespace-normal!">{index === totalQuestions - 1 ? "결과 보기" : "다음 질문"}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Button>
    {editing ? <Button variant="secondary" size="lg" fullWidth disabled={currentResponse === undefined} onClick={finish} className="mt-3 whitespace-normal!"><Check aria-hidden="true" className="size-4 shrink-0" />수정한 결과 보기</Button> : null}
    <p className="mt-3 text-center text-xs leading-relaxed text-[var(--hb-text-muted)]">앞으로 돌아가 답을 바꿔도 괜찮아요. 새로고침하면 진행 중인 답은 사라져요.</p>
  </>);
}
