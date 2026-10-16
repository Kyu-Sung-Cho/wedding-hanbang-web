"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, HeartHandshake, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { weddingLinkProps } from "@/lib/weddingPaths";
import {
  PREPARATION_STYLE_SAVE_CONSENT_VERSION, PREPARATION_STYLE_SHARE_CONSENT_VERSION,
  type PreparationStyleSavedResponse, type PreparationStyleSnapshot,
} from "@/lib/weddingCode/preparationStyle";
import { buildPreparationStyleGuide } from "@/lib/weddingCode/preparationStyleGuide";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG, resolveWeddingCodeSceneConfig } from "@/lib/weddingCode/scene/config";
import { decodeWeddingCodeV06, encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import PreparationStyleQuestions from "./PreparationStyleQuestions";
import { CoupleStyleResults, PersonalStyleResults } from "./PreparationStyleResults";
import usePreparationStyle, { preparationStyleBindingKey, type PreparationStyleBinding } from "./usePreparationStyle";

const panel = "rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]";

function responseForGuide(response: PreparationStyleSavedResponse) {
  const config = resolveWeddingCodeSceneConfig(response.sceneVersion, true);
  const answers = config && decodeWeddingCodeV06(response.answerCode, config.questions);
  return answers ? { version: response.sceneVersion, answers } : null;
}

export default function PreparationStyleHub({ previousOnly = false }: { previousOnly?: boolean }) {
  const { user, profile, couple, partner, isDemo, isInitialized } = useAuthStore();
  if (!isInitialized || !user) return <Loading />;
  const binding: PreparationStyleBinding = {
    ownerUserId: user.id,
    coupleId: profile?.couple_id === couple?.id ? couple?.id ?? null : null,
    partnerUserId: partner?.couple_id === couple?.id ? partner?.id ?? null : null,
  };
  // 계정뿐 아니라 공유 상대가 바뀌는 순간 개인 초안과 상대 결과도 함께 폐기한다.
  return <BoundStyleHub key={`${preparationStyleBindingKey(binding)}:${isDemo}:${previousOnly}`} binding={binding} demo={isDemo} partnerName={partner?.name || "상대"} previousOnly={previousOnly} />;
}

function Loading() {
  return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-[var(--hb-text-body)]"><Loader2 className="size-4 animate-spin" aria-hidden="true" />준비 스타일을 불러오고 있어요.</div>;
}

type Draft = { answers: WeddingCodeV06Answers; expectedRevision: number | null; stage: "questions" | "review" };

function BoundStyleHub({ binding, demo, partnerName, previousOnly }: { binding: PreparationStyleBinding; demo: boolean; partnerName: string; previousOnly: boolean }) {
  const { snapshot, loading, busy, error, refresh, mutate } = usePreparationStyle(binding, demo);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<"personal" | "couple">("personal");
  const [confirmation, setConfirmation] = useState<"share" | "unshare" | "delete" | null>(null);
  const [confirmationRevision, setConfirmationRevision] = useState<number | null>(null);
  const [noticeState, setNoticeState] = useState<{ message: string; snapshot: PreparationStyleSnapshot | null } | null>(null);
  const [demoOwn, setDemoOwn] = useState<WeddingCodeV06Answers | null>(null);
  const [demoPair, setDemoPair] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
  const notice = noticeState && (demo || noticeState.snapshot === snapshot) ? noticeState.message : null;
  function setNotice(message: string | null, forSnapshot = snapshot) {
    setNoticeState(message ? { message, snapshot: forSnapshot } : null);
  }
  const mine = demo ? demoOwn && { version: config.version, answers: demoOwn } : snapshot?.own && responseForGuide(snapshot.own);
  const other = demo && demoPair ? {
    version: config.version,
    answers: Object.fromEntries(config.questions.map((question, index) => [question.key, question.options[index % question.options.length].value])) as WeddingCodeV06Answers,
  } : snapshot?.partner && responseForGuide(snapshot.partner);
  const guide = mine ? buildPreparationStyleGuide(mine, other) : null;
  const review = draft?.stage === "review" ? buildPreparationStyleGuide({ version: config.version, answers: draft.answers }) : null;
  const personal = review && review.status !== "invalid" ? review.personal : null;
  const draftConflict = Boolean(draft && snapshot && snapshot.stateRevision !== draft.expectedRevision);
  const availablePartnerId = demo ? binding.partnerUserId : snapshot?.partnerUserId ?? null;
  const partnerUnavailable = !demo && binding.partnerUserId !== null && snapshot !== null && availablePartnerId === null;

  // 상대가 사라진 뒤에는 같은 확인번호라도 이전 공유 확인을 다시 사용하지 않는다.
  if (confirmation && confirmation !== "delete" && availablePartnerId === null) {
    setConfirmation(null);
    setConfirmationRevision(null);
  }

  useEffect(() => {
    screenRef.current?.focus({ preventScroll: true });
    screenRef.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [draft?.stage, tab]);

  function start() {
    if (previousOnly) return;
    setNotice(null);
    setConfirmation(null);
    setDraft({ answers: {}, expectedRevision: snapshot?.stateRevision ?? null, stage: "questions" });
  }

  async function save(expectedRevision = draft?.expectedRevision) {
    if (!draft || !personal?.answered) return;
    setNotice(null);
    if (demo) {
      setDemoOwn(draft.answers);
      setDemoPair(false);
      setDraft(null);
      setNotice("체험 중 고른 답이에요. 계정에는 저장하지 않았어요.");
      return;
    }
    const saved = await mutate("PUT", {
      expectedRevision,
      sceneVersion: config.version,
      answerCode: encodeWeddingCodeV06(draft.answers, config.questions),
      saveConsentVersion: PREPARATION_STYLE_SAVE_CONSENT_VERSION,
    });
    if (saved) {
      setDraft(null);
      setTab("personal");
      setNotice(saved.sharing ? `이 답이 저장돼 있어요. ${partnerName}님과의 공유 승인도 유지하고 있어요.` : "내 답을 저장했어요. 상대에게는 아직 공유하지 않았어요.", saved);
    }
  }

  function openConfirmation(action: "share" | "unshare" | "delete") {
    if (action !== "delete" && !availablePartnerId) return;
    setNotice(null);
    setConfirmationRevision(snapshot?.stateRevision ?? null);
    setConfirmation(action);
  }

  async function confirm() {
    if (!snapshot?.own || !confirmation) return;
    if (confirmation !== "delete" && !availablePartnerId) return;
    setNotice(null);
    if (snapshot.stateRevision !== confirmationRevision) {
      setConfirmation(null);
      setNotice("확인하는 동안 내 답이 바뀌었어요. 지금 보이는 답을 확인한 뒤 다시 눌러 주세요.");
      return;
    }
    const action = confirmation;
    const ok = action === "share"
      ? await mutate("PUT", {
        expectedRevision: snapshot.own.revision,
        expectedCoupleId: binding.coupleId,
        expectedPartnerUserId: availablePartnerId,
        shareConsentVersion: PREPARATION_STYLE_SHARE_CONSENT_VERSION,
      }, true)
      : await mutate("DELETE", { expectedRevision: snapshot.own.revision }, action === "unshare");
    if (ok) {
      setConfirmation(null);
      setNotice(action === "delete" ? "저장한 답과 공유 허가를 지웠어요." : action === "unshare" ? "내 답 공유를 중단했어요." : "내 답 공유를 승인했어요. 상대도 공유하면 둘이 함께 볼 수 있어요.", ok);
      if (action === "delete") setTab("personal");
    }
  }

  return <div className="mx-auto max-w-5xl scroll-mt-28 px-4 py-6 sm:px-7 sm:py-8" ref={screenRef} tabIndex={-1} aria-label={previousOnly ? "이전에 계정에 저장한 답" : "우리의 준비 스타일"}>
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--hb-primary)]"><HeartHandshake className="size-4" aria-hidden="true" />{previousOnly ? "웨딩코드 · 이전 기록" : "우리의 준비 스타일"}</p>
        <h1 className="text-[var(--hb-text-strong)]">{previousOnly ? "예전에 계정에 저장한 답" : "결혼 준비, 우리는 어떻게 할까요?"}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--hb-text-body)]">{previousOnly ? "예전 ‘우리의 준비 스타일’에서 저장한 답이에요. 당시 질문과 결과로 다시 볼 수 있고, 공유를 중단하거나 답을 지울 수 있어요. 최신 웨딩코드의 답과는 합치지 않아요." : "돈 쓸 때, 일 나눌 때, 가족과 정할 때. 각자 고른 답을 보면서 미리 이야기해 봐요."}</p>
      </div>
      {!demo && !draft && <Button variant="ghost" onClick={() => void refresh()} disabled={busy || loading}><RefreshCw className="size-4" aria-hidden="true" />새로 불러오기</Button>}
    </header>

    {demo && <p className="mb-5 rounded-[6px] bg-[var(--hb-surface-hover)] p-4 text-sm leading-7 text-[var(--hb-text-body)]">체험 화면이에요. 여기서 고른 답은 계정에 저장하거나 실제 상대에게 공유하지 않아요.</p>}
    {error && <div role="alert" className={`${panel} mb-5 p-4`}><p className="text-sm leading-7 text-[var(--hb-text-strong)]">{error}</p><Button className="mt-2" disabled={busy || loading} onClick={() => void refresh()}>다시 불러오기</Button></div>}
    {notice && <p role="status" className="mb-5 flex items-start gap-2 text-sm leading-7 text-[var(--hb-primary)]"><Check className="mt-1 size-4 shrink-0" aria-hidden="true" />{notice}</p>}

    {draft?.stage === "questions" ? <PreparationStyleQuestions initialAnswers={draft.answers} onReview={answers => setDraft({ ...draft, answers, stage: "review" })} onCancel={() => setDraft(null)} />
      : draft && personal ? <>
        <section className={`${panel} mb-6 p-5 sm:p-6`}>
          <h2 className="text-[var(--hb-text-strong)]">{demo ? "이 답으로 결과를 볼까요?" : "이 답을 저장할까요?"}</h2>
          <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{demo ? "아래에서 고른 답과 결과를 확인해 주세요. 체험 중인 답은 이 화면에만 남고, 계정에 저장하지 않아요." : "아래에서 내 답과 결과를 확인해 주세요. 저장하면 내 계정에서 다시 볼 수 있어요. 상대와 비교하려면 저장 후 따로 공유를 눌러 주세요."}</p>
          {snapshot?.own && <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">이전과 다른 답을 저장하면 이전 공유를 중단해요. 같은 답을 다시 저장하면 지금 공유 설정을 유지해요.</p>}
          {!demo && <p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">문항 판, 고른 답, 저장 시각과 동의 기록을 결과 다시 보기에 사용해요. 이 화면에서 지우거나 회원 탈퇴 요청 접수 시 삭제할 수 있어요. <Link href="/privacy" className="underline underline-offset-4">개인정보 처리방침</Link></p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!personal.answered || (!demo && (!snapshot || loading || draftConflict))} loading={busy} onClick={() => void save()}>{demo ? "이 답으로 체험하기" : "동의하고 내 계정에 저장"}</Button>
            <Button disabled={busy} onClick={() => setDraft({ ...draft, stage: "questions" })}>답 고치기</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>저장하지 않고 나가기</Button>
          </div>
          {!personal.answered && <p className="mt-3 text-sm text-[var(--hb-text-body)]">모든 장면을 건너뛰었어요. 한 장면 이상 답하면 결과를 저장할 수 있어요.</p>}
          {draftConflict && snapshot && <div className="mt-5 border-t border-[var(--hb-hairline)] pt-5" role="status">
            <h3 className="text-[var(--hb-text-strong)]">확인하는 동안 저장된 답이 바뀌었어요</h3>
            <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">다른 화면에서 바꿨거나, 앞선 저장이 완료됐을 수 있어요. 지금 계정에 있는 답을 확인하고 어느 답을 남길지 골라 주세요. 작성 중인 답은 아래에 그대로 있어요.</p>
            {guide && guide.status !== "invalid" ? <details className="mt-3"><summary className="cursor-pointer py-3 text-sm font-semibold">지금 계정에 저장된 답 보기</summary><PersonalStyleResults personal={guide.personal} showTools={false} /></details> : <p className="mt-2 text-sm leading-7">지금 계정에는 저장된 답이 없어요.</p>}
            <div className="mt-3 flex flex-wrap gap-2"><Button disabled={!personal.answered || busy || loading} onClick={() => void save(snapshot.stateRevision)}>확인하고 이 초안으로 바꾸기</Button><Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>현재 저장 상태 유지</Button></div>
          </div>}
        </section>
        <PersonalStyleResults personal={personal} showTools={false} />
      </> : loading ? <Loading /> : previousOnly && !demo && !snapshot ? null : !mine && previousOnly ? <section className={`${panel} p-6 sm:p-8`}>
        <h2 className="text-[var(--hb-text-strong)]">계정에 저장한 이전 답이 없어요</h2>
        <Link {...weddingLinkProps("/preparation-style")} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-primary)]">최신 웨딩코드 열기<ArrowRight className="size-4" aria-hidden="true" /></Link>
      </section> : !mine ? <section className={`${panel} p-6 sm:p-8`}>
        <h2 className="text-[var(--hb-text-strong)]">먼저 내 생각부터 골라 보세요</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--hb-text-body)]">결혼을 준비하면서 겪을 법한 {config.questions.length}장면이에요. 혼자 답해도 내가 고른 답과 챙겨볼 내용을 볼 수 있어요. 둘이 연결하고 각자 공유하면 같은 답과 다른 답을 나란히 볼 수 있어요.</p>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">성격이나 궁합을 판단하는 검사는 아니에요. 아직 겪어 보지 않은 일은 지금 내 생각으로 답하면 돼요.</p>
        <Button variant="primary" className="mt-6" onClick={start} disabled={!demo && !snapshot}>내 답 고르기<ArrowRight className="size-4" aria-hidden="true" /></Button>
        <p className="mt-4 text-xs leading-6 text-[var(--hb-text-muted)]">예전에 공개 웨딩코드에서 답했다면 이곳에서 다시 답해 주세요. 공유 링크만으로는 어느 답이 내 것인지 확인할 수 없어요.</p>
      </section> : guide?.status === "invalid" ? <p role="alert">{guide.message}</p> : guide ? <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hb-hairline)] pb-3">
          <div className="flex gap-2" aria-label="결과 보기 방식">
            <Button variant={tab === "personal" ? "primary" : "ghost"} aria-pressed={tab === "personal"} onClick={() => setTab("personal")}>내 준비 스타일</Button>
            <Button variant={tab === "couple" ? "primary" : "ghost"} aria-pressed={tab === "couple"} onClick={() => setTab("couple")}>둘이 함께 보기</Button>
          </div>
          {!previousOnly && <Button variant="ghost" onClick={start} disabled={busy}>새로 답하기</Button>}
        </div>

        {tab === "personal" ? <PersonalStyleResults personal={guide.personal} />
          : guide.status === "couple" ? <CoupleStyleResults guide={guide} partnerName={demo ? "상대 예시" : partnerName} />
          : guide.status === "version_mismatch" ? <p role="status" className={`${panel} p-5`}>{guide.message}</p>
          : <section className={`${panel} p-6`}>
            <h2 className="text-[var(--hb-text-strong)]">{demo ? "두 사람 화면도 살펴볼까요?" : partnerUnavailable ? "지금은 둘이 함께 볼 수 없어요" : !availablePartnerId ? "함께 준비할 사람을 연결해 주세요" : !snapshot?.sharing ? "서로 공유하면 함께 볼 수 있어요" : "상대가 공유한 결과가 아직 없어요"}</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">{demo ? "가상의 상대 답을 더해 비교 화면을 볼 수 있어요. 실제 상대의 결과가 아니에요." : partnerUnavailable ? "내 결과는 계속 볼 수 있어요. 연결 설정에서 현재 상태를 확인해 주세요." : previousOnly ? "두 사람 모두 예전에 계정에 저장한 답이 있다면, 연결한 뒤 각자 공유해서 비교할 수 있어요. 한 사람이라도 이전 답이 없다면 최신 웨딩코드에서 함께 새로 답해 주세요." : !availablePartnerId ? "연결한 뒤에도 내 답은 바로 공개되지 않아요. 각자 답하고 공유를 눌러 주세요." : `나와 ${partnerName}님이 각자 이 화면에서 답을 저장하고 공유하면, 예산·역할·가족·도움 방식에서 같은 답과 다른 답을 볼 수 있어요.`}</p>
            {demo ? <Button className="mt-4" onClick={() => setDemoPair(true)}>가상의 상대 답으로 비교해 보기</Button>
              : !availablePartnerId ? <Link {...weddingLinkProps("/settings")} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-primary)]">연결 설정으로 가기<ArrowRight className="size-4" aria-hidden="true" /></Link>
              : !snapshot?.sharing ? <Button className="mt-4" onClick={() => openConfirmation("share")} disabled={busy}>내 답 공유하기</Button> : <Button className="mt-4" onClick={() => void refresh()} disabled={busy}>상대가 공유했는지 다시 확인</Button>}
          </section>}

        {!demo && snapshot?.own && <section className="mt-8 border-t border-[var(--hb-hairline)] pt-5">
          <h2 className="flex items-center gap-2 text-[var(--hb-text-strong)]"><ShieldCheck className="size-4" aria-hidden="true" />내 답 보관과 공유</h2>
          <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{snapshot.sharing ? `${partnerName}님과 공유하도록 승인했어요.` : "내 답을 계정에 보관하고 있어요. 지금은 상대에게 공유하지 않아요."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {availablePartnerId && <Button disabled={busy} onClick={() => openConfirmation(snapshot.sharing ? "unshare" : "share")}>{snapshot.sharing ? "공유 중단하기" : "내 답 공유하기"}</Button>}
            <Button variant="ghost" disabled={busy} onClick={() => openConfirmation("delete")}>저장한 답 지우기</Button>
          </div>
        </section>}
      </> : null}

    {confirmation && snapshot?.own && <section role="region" aria-label="저장과 공유 확인" className={`${panel} mt-5 p-5`}>
      <h2 className="text-[var(--hb-text-strong)]">{confirmation === "share" ? `${partnerName}님과 내 답을 공유할까요?` : confirmation === "unshare" ? "내 답 공유를 중단할까요?" : "저장한 답을 지울까요?"}</h2>
      <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">{confirmation === "share" ? "고른 답, 건너뛴 장면과 그 답으로 만든 결과가 보여요. 상대도 공유해야 두 사람의 비교가 열려요. 공유는 여기서 중단할 수 있어요." : confirmation === "unshare" ? "내 결과는 남고, 상대는 내 답을 더 이상 조회할 수 없어요. 두 사람 비교도 닫혀요." : previousOnly ? "내 이전 결과와 공유 허가를 삭제하고 두 사람 비교를 닫아요. 지운 이전 답은 되돌릴 수 없어요. 새 답은 최신 웨딩코드에서 작성할 수 있고, 이 기록에 합쳐지지는 않아요." : "내 결과와 공유 허가를 삭제하고 두 사람 비교를 닫아요. 지운 답은 되돌릴 수 없지만 언제든 새로 답할 수 있어요."}</p>
      <p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">이미 상대가 읽거나 따로 보관한 내용까지 회수할 수는 없어요.</p>
      <div className="mt-4 flex flex-wrap gap-2"><Button variant="primary" loading={busy} onClick={() => void confirm()}>{confirmation === "share" ? "동의하고 이 상대와 공유" : confirmation === "unshare" ? "공유 중단" : "답과 공유 허가 삭제"}</Button><Button disabled={busy} onClick={() => setConfirmation(null)}>취소</Button></div>
    </section>}
  </div>;
}
