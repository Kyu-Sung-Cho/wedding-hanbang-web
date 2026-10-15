"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { DEFAULT_SHARE_IDS, INSTRUCTIONS, ITEMS, NOTES, SCALE } from "@/constants/weddingCode36";
import { createSubmission, validateSubmission } from "@/lib/weddingCode36";
import { isRecord, isUuid } from "@/utils/requestValidation";
import {
  clearDraft36, clearPending36, parseResult36, readDraft36, readPending36, readResult36,
  storeDraft36, storePending36, storeResult36, type Pending36, type Result36,
} from "./storage36";

export const wc36Primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#8F6662] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#7D5753] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8F6662] disabled:cursor-not-allowed disabled:opacity-40";
export const wc36Secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#E2DED2] bg-white px-4 py-2 text-sm font-medium text-[#5A4742] hover:bg-[#F8F4EA] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8F6662] disabled:opacity-40";
const REASONS = [
  ["not_applicable", "나에게 해당하지 않아요"], ["cannot_imagine", "상황이 잘 떠오르지 않아요"],
  ["constraint_not_separable", "현실 사정과 원하는 방식을 나누기 어려워요"], ["prefer_not_to_answer", "답하고 싶지 않아요"],
] as const;
type InviteState = "none" | "loading" | "waiting" | "full" | "not_found" | "invalid" | "error";

export default function WeddingCodeClient() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<"intro" | "questions" | "review">("intro");
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [missingReasons, setMissingReasons] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [consent, setConsent] = useState(false);
  const [compare, setCompare] = useState(false);
  const [shareAlias, setShareAlias] = useState(false);
  const [shareNotes, setShareNotes] = useState<string[]>([]);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<InviteState>("none");
  const [previous, setPrevious] = useState<Result36 | null>(null);
  const [pending, setPending] = useState<Pending36 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("ct");
    const token = isUuid(raw) ? raw.toLowerCase() : null;
    setInviteToken(token); setInviteState(raw ? (token ? "loading" : "invalid") : "none");
    setPrevious(readResult36());
    const draft = readDraft36(token);
    const savedPending = readPending36(token);
    if (draft) {
      setAnswers(draft.answers); setMissingReasons(draft.missingReasons); setIndex(draft.index);
      setStep(draft.step); setCompare(draft.compare); setShareAlias(draft.shareAlias); setShareNotes(draft.shareNotes);
    }
    if (savedPending) {
      setPending(savedPending); setAnswers(savedPending.submission.answers);
      setMissingReasons(savedPending.submission.missing_reasons); setStep("review");
      setCompare(savedPending.submission.allow_couple_comparison); setShareAlias(savedPending.submission.share_alias);
      setShareNotes(savedPending.submission.share_item_ids.filter((id) => NOTES.some((n) => n.id === id)));
    }
    setReady(true);
    if (!token) return;
    const controller = new AbortController();
    fetch(`/api/wedding-code/v36/invite?token=${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok || !isRecord(body) || !["waiting", "full", "not_found"].includes(String(body.status))) throw new Error();
        setInviteState(body.status as "waiting" | "full" | "not_found");
      }).catch(() => { if (!controller.signal.aborted) setInviteState("error"); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (ready) storeDraft36(inviteToken, { answers, missingReasons, index, step, compare, shareAlias, shareNotes });
  }, [ready, inviteToken, answers, missingReasons, index, step, compare, shareAlias, shareNotes]);
  useEffect(() => { if (step === "questions") questionHeading.current?.focus(); }, [step, index]);

  function choose(value: number | null, reason?: string) {
    const id = ITEMS[index].id;
    setAnswers((old) => ({ ...old, [id]: value }));
    setMissingReasons((old) => { const next = { ...old }; delete next[id]; if (reason) next[id] = reason; return next; });
  }
  function personalOnly() {
    setInviteToken(null); setInviteState("none"); window.history.replaceState(null, "", "/wedding-code");
  }
  async function joinPrevious() {
    if (!previous || !inviteToken || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/wedding-code/v36/pair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_id: previous.id, access_token: previous.accessToken, invite_token: inviteToken }),
      });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || data.pairingStatus !== "paired" || data.coupleToken !== inviteToken) {
        throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "초대에 연결하지 못했어요. 링크를 다시 확인해 주세요.");
      }
      storeResult36({ ...previous, coupleToken: data.coupleToken, pairingStatus: data.pairingStatus as "waiting" | "paired" });
      router.push(`/wedding-code/result?v=36&rid=${previous.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "연결하지 못했어요."); }
    finally { sending.current = false; setBusy(false); }
  }
  async function submit() {
    if (!consent || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      // 응답을 받지 못한 재시도는 같은 키와 같은 원문으로 저장 여부부터 확인한다.
      const attempt = pending ?? {
        submissionId: crypto.randomUUID(), accessToken: crypto.randomUUID(), inviteToken,
        submission: createSubmission(answers, { comparison: compare, shareIds: [...DEFAULT_SHARE_IDS, ...shareNotes], shareAlias }),
      };
      attempt.submission = validateSubmission({ ...attempt.submission, missing_reasons: pending ? attempt.submission.missing_reasons : missingReasons });
      storePending36(attempt); setPending(attempt);
      const response = await fetch("/api/wedding-code/v36/response", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attempt.submission, consent: true, submission_id: attempt.submissionId,
          access_token: attempt.accessToken, invite_token: attempt.inviteToken ?? undefined }),
      });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || data.success !== true) {
        throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "저장에 실패했어요. 같은 답으로 다시 확인할 수 있어요.");
      }
      const record = parseResult36({ ...data, accessToken: attempt.accessToken, savedAt: new Date().toISOString() });
      if (!record) throw new Error("저장 결과를 확인하지 못했어요. 같은 답으로 다시 확인해 주세요.");
      storeResult36(record); clearPending36(attempt.inviteToken); clearDraft36(attempt.inviteToken);
      router.replace(`/wedding-code/result?v=36&rid=${record.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결이 잠시 끊겼어요. 같은 답으로 다시 확인해 주세요.");
      sending.current = false; setBusy(false);
    }
  }
  const current = ITEMS[index];
  const hasAnswer = Object.hasOwn(answers, current.id);
  const answeredCount = Object.values(answers).filter((v) => v !== null).length;
  const skippedCount = Object.values(answers).filter((v) => v === null).length;
  const inviteBlocked = ["loading", "full", "not_found", "invalid", "error"].includes(inviteState);
  const ownInvite = previous?.coupleToken === inviteToken && inviteToken !== null;

  return <main className="min-h-screen bg-[#FDFCF7] px-5 py-8 text-[#3A2A27] sm:py-12"><div className="mx-auto max-w-xl">
    <Link href="/wedding-code" className="text-xs font-semibold tracking-[0.15em] text-[#8F6662]">WEDDING CODE</Link>
    <h1 className="mt-3 text-2xl font-semibold">우리의 결혼 준비 방식</h1>
    {!ready ? <p className="mt-8" role="status">저장된 답을 확인하고 있어요.</p> : <>
      {step === "intro" && <section className="mt-8 space-y-6">
        <p className="text-base leading-8 text-[#5A4742]">식장을 고를 때, 가족과 의견이 다를 때, 준비할 일을 나눌 때.<br />36개의 장면으로 내가 원하는 방식을 알아봐요.</p>
        <div className="space-y-3 border-y border-[#E2DED2] py-5 text-sm leading-7 text-[#5A4742]">{INSTRUCTIONS.map((text) => <p key={text}>{text}</p>)}</div>
        <p className="text-xs leading-6 text-[#6E5A54]">지금의 답을 정리하는 참고용 테스트예요. 사람을 진단하거나 두 사람의 앞날을 예측하지 않아요.</p>
        {inviteState !== "none" && <div className="rounded-lg border border-[#DEC9BA] bg-[#F3E7DB] p-4 text-sm leading-7" role="status">
          {inviteState === "loading" ? "초대 링크를 확인하고 있어요." : inviteState === "waiting" ?
            ownInvite ? "이 브라우저에는 초대한 사람의 결과가 있어요. 파트너는 자신의 브라우저에서 링크를 열면 돼요." : "파트너가 보낸 초대예요. 답한 뒤 서로 공유에 동의한 내용으로 비교할 수 있어요." :
            inviteState === "full" ? "이 초대에는 이미 두 결과가 연결돼 있어요." : inviteState === "error" ? "초대 상태를 확인하지 못했어요. 잠시 후 다시 열어 주세요." : "사용할 수 있는 36문항 초대가 아니에요. 링크를 다시 확인해 주세요."}
          {inviteBlocked && inviteState !== "loading" && <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={personalOnly} className={wc36Secondary}>개인 테스트로 진행</button>
</div>}
        </div>}
        {previous && <div className="flex flex-wrap gap-3"><Link href={`/wedding-code/result?v=36&rid=${previous.id}`} className={wc36Secondary}>내 결과 다시 보기</Link>
          {inviteState === "waiting" && !ownInvite && previous.pairingStatus !== "paired" && <button type="button" disabled={busy} onClick={joinPrevious} className={wc36Secondary}>이전에 답한 결과로 연결</button>}</div>}
        <button type="button" disabled={inviteBlocked || busy} onClick={() => setStep("questions")} className={`${wc36Primary} w-full`}>{ownInvite ? "다른 사람으로 새로 답하기" : "36문항 시작하기"}<ArrowRight size={17} aria-hidden="true" /></button>
        {ownInvite && <p className="text-xs leading-6 text-[#6E5A54]">같은 기기를 함께 쓰는 경우에만 새로 답해 주세요. 이 테스트는 서로 다른 사람인지 인증하지 않아요.</p>}
      </section>}
      {step === "questions" && <section className="mt-7" aria-label="테스트 문항">
        <div className="mb-6 flex items-center justify-between text-xs text-[#6E5A54]"><span>현재 문항</span><span>{index + 1} / 36</span></div>
        <progress aria-label="문항 진행" max={36} value={index + 1} className="mb-7 h-1.5 w-full accent-[#8F6662]" />
        <p className="rounded-lg bg-[#F8F4EA] px-5 py-4 text-sm leading-7 text-[#5A4742]">{current.context}</p>
        <h2 ref={questionHeading} tabIndex={-1} className="mt-6 text-xl font-semibold leading-8 outline-none">{index + 1}. {current.statement}</h2>
        <fieldset className="mt-6 space-y-2.5"><legend className="sr-only">이 문장에 얼마나 동의하나요?</legend>
          {SCALE.map((option) => <label key={option.value} className={`flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 text-sm transition-colors ${answers[current.id] === option.value ? "border-[#8F6662] bg-[#EADDD8]" : "border-[#E2DED2] bg-white hover:bg-[#F8F4EA]"}`}>
            <input type="radio" name={current.id} value={option.value} checked={answers[current.id] === option.value} onChange={() => choose(option.value)} className="h-4 w-4 accent-[#8F6662]" /><span>{option.label}</span>
            {answers[current.id] === option.value && <Check size={16} className="ml-auto text-[#8F6662]" aria-hidden="true" />}</label>)}
        </fieldset>
        <details className="mt-5 text-sm text-[#6E5A54]" open={hasAnswer && answers[current.id] === null}><summary className="cursor-pointer py-2">답하기 어려워요 · 건너뛰기</summary>
          <fieldset className="mt-2 space-y-2"><legend className="sr-only">건너뛰는 이유</legend>{REASONS.map(([reason, label]) => <label key={reason} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E2DED2] p-3 leading-6">
            <input type="radio" name={`skip-${current.id}`} checked={answers[current.id] === null && missingReasons[current.id] === reason} onChange={() => choose(null, reason)} className="mt-1 h-4 w-4 shrink-0 accent-[#8F6662]" />{label}</label>)}</fieldset>
          <p className="mt-3 text-xs leading-6">건너뛴 답은 중간 점수로 넣지 않아요. 이유는 파트너에게 공유하지 않아요.</p>
        </details>
        <div className="mt-8 flex justify-between gap-4"><button type="button" className={wc36Secondary} onClick={() => index > 0 ? setIndex(index - 1) : setStep("intro")}><ArrowLeft size={16} aria-hidden="true" />이전</button>
          <button type="button" className={wc36Primary} disabled={!hasAnswer} onClick={() => index < 35 ? setIndex(index + 1) : setStep("review")}>{index < 35 ? "다음" : "답변 확인"}<ArrowRight size={16} aria-hidden="true" /></button></div>
      </section>}
      {step === "review" && <section className="mt-8 space-y-6">
        <h2 className="text-xl font-semibold">답을 모두 확인했어요</h2><p className="text-sm leading-7 text-[#5A4742]">답한 문항 {answeredCount}개 · 건너뛴 문항 {skippedCount}개<br />빈 답은 그대로 두고 결과를 정리해요.</p>
        {pending && <p className="rounded-lg bg-[#F3E7DB] p-4 text-sm leading-7" role="status">저장 여부를 확인할 답이 있어요. 다시 제출해도 같은 답을 중복 저장하지 않아요. 먼저 저장 결과를 확인해 주세요.</p>}
        <fieldset disabled={!!pending || busy} className="space-y-5 border-y border-[#E2DED2] py-6 disabled:opacity-60"><legend className="sr-only">커플 공유 설정</legend>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-7"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="mt-1.5 h-4 w-4 shrink-0 accent-[#8F6662]" /><span>커플 비교에서 내가 공유한 답을 비교하는 데 동의해요.<span className="block text-xs text-[#6E5A54]">준비 기준 27문항을 공유해요. 서로 동의한 문항만 비교하며, 아래 장면 메모는 따로 골라야 공유돼요.</span></span></label>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-7"><input type="checkbox" checked={shareAlias} onChange={(e) => setShareAlias(e.target.checked)} className="mt-1.5 h-4 w-4 shrink-0 accent-[#8F6662]" /><span>커플 비교에서 내 결과 이름도 공유해요.<span className="block text-xs text-[#6E5A54]">이름에서 몇 가지 준비 선호를 유추할 수 있어요. 두 사람 모두 허용할 때만 이름을 보여줘요.</span></span></label>
          <details><summary className="cursor-pointer text-sm">장면 메모 공유 선택 · 선택 사항</summary><div className="mt-3 space-y-3">{NOTES.map((note) => <label key={note.id} className="flex cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={shareNotes.includes(note.id)} onChange={(e) => setShareNotes((old) => e.target.checked ? [...old, note.id] : old.filter((id) => id !== note.id))} className="h-4 w-4 accent-[#8F6662]" />{note.label}</label>)}</div></details>
        </fieldset>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-7"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1.5 h-4 w-4 shrink-0 accent-[#8F6662]" /><span>만 14세 이상이며 결과 제공을 위한 답변 저장에 동의해요.<span className="block text-xs text-[#6E5A54]">이름·연락처는 묻지 않아요. 서버의 답은 7일 뒤 조회가 끝나고 하루 안에 삭제돼요. 결과 화면에서 먼저 삭제할 수도 있어요. 내 답과 접근 권한은 이 브라우저에도 보관되므로 공용 기기에서는 사용 후 지워 주세요. <Link href="/privacy" className="underline">개인정보 처리방침</Link></span></span></label>
        <div className="flex flex-wrap justify-between gap-3">{!pending && <button type="button" disabled={busy} onClick={() => { setIndex(35); setStep("questions"); }} className={wc36Secondary}>답 다시 보기</button>}
          <button type="button" disabled={!consent || busy} onClick={submit} className={wc36Primary}>{busy && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}{pending ? "저장 결과 다시 확인" : "내 결과 보기"}</button></div>
      </section>}
      {error && <p role="alert" className="mt-6 rounded-lg border border-[#D8B8B2] bg-[#FFF7F5] p-4 text-sm leading-7 text-[#7D4540]">{error}</p>}
    </>}
  </div></main>;
}
