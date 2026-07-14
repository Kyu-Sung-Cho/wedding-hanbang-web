"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, FileCheck2, LockKeyhole, Save, ShieldAlert } from "lucide-react";
import { weddingPath } from "@/lib/weddingPaths";
import { captureCourtEvent } from "./analytics";
import { getCase, submitStatement, type CourtStatementSubmissionSafety } from "./api";
import {
  clearLegacyCourtDrafts,
  courtStatementDraftKey,
  readScopedCourtDraft,
  writeScopedCourtDraft,
} from "./draftStorage";
import type { CourtCase, StatementInput } from "./types";
import { ArchivedCaseNotice, CourtButton, CourtLink, CourtPage, ErrorState, LoadingState, SafetyNotice, Surface } from "./CourtPrimitives";

type StatementDraft = Pick<StatementInput, "facts" | "feelings" | "expectations" | "attempts" | "desiredAgreement">;

const EMPTY_STATEMENT: StatementDraft = { facts: "", feelings: "", expectations: "", attempts: "", desiredAgreement: "" };

const fields: Array<{ key: keyof StatementDraft; label: string; hint: string; min: number; max: number }> = [
  { key: "facts", label: "내가 기억하는 사건은 무엇인가요?", hint: "날짜와 행동처럼 확인 가능한 사실부터 적어주세요.", min: 40, max: 1600 },
  { key: "feelings", label: "그때 어떤 마음이었나요?", hint: "상대방의 성격을 평가하기보다 내 감정을 적어주세요.", min: 10, max: 800 },
  { key: "expectations", label: "당시 알고 있던 약속이나 기대는 무엇인가요?", hint: "약속이 없었거나 서로 다르게 기억한다면 그대로 적어도 괜찮아요.", min: 10, max: 1000 },
  { key: "attempts", label: "해결하기 위해 어떤 대화나 행동을 해봤나요?", hint: "아직 이야기하지 못했다면 그 이유를 적어주세요.", min: 10, max: 1000 },
  { key: "desiredAgreement", label: "내가 바꿀 수 있는 행동을 포함해, 어떤 합의를 원하나요?", hint: "담당자, 기한, 완료 기준을 넣으면 화해 처방이 더 구체적이에요.", min: 10, max: 1000 },
];

interface StoredStatementDraft {
  draft: StatementDraft;
  submissionRequestId?: string;
  safetyConcern: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStoredStatementDraft(value: unknown): StoredStatementDraft | null {
  if (!isRecord(value) || !isRecord(value.draft)) return null;
  const normalized = { ...EMPTY_STATEMENT };
  for (const field of fields) {
    const fieldValue = value.draft[field.key];
    if (typeof fieldValue !== "string" || fieldValue.length > field.max) return null;
    normalized[field.key] = fieldValue;
  }
  if (
    value.submissionRequestId !== undefined
    && (
      typeof value.submissionRequestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value.submissionRequestId)
    )
  ) return null;
  if (value.safetyConcern !== undefined && typeof value.safetyConcern !== "boolean") {
    return null;
  }
  return {
    draft: normalized,
    submissionRequestId: value.submissionRequestId,
    safetyConcern: value.safetyConcern === true,
  };
}

export default function StatementForm({ caseId, draftOwnerId, revisionMode = false }: { caseId: string; draftOwnerId: string; revisionMode?: boolean }) {
  const router = useRouter();
  const routerPush = router.push;
  const storageKey = courtStatementDraftKey(draftOwnerId, caseId, revisionMode);
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null);
  const [draft, setDraft] = useState<StatementDraft>(EMPTY_STATEMENT);
  const [submissionRequestId, setSubmissionRequestId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [preview, setPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [safetyConcern, setSafetyConcern] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSafety, setSubmittedSafety] = useState<CourtStatementSubmissionSafety | null>(null);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const hasSavedDraft = useRef(false);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const submissionRequestIdRef = useRef("");
  const draftRef = useRef<StatementDraft>(EMPTY_STATEMENT);
  const safetyConcernRef = useRef(false);
  const submissionAttemptedRef = useRef(false);
  const loadRequestIdRef = useRef(0);

  const isExactRecoveredSubmission = useCallback((result: CourtCase): boolean => {
    const ownStatement = result.ownStatement;
    if (
      !hasSavedDraft.current
      || !ownStatement
      || ownStatement.submissionRequestId !== submissionRequestIdRef.current
    ) return false;
    const currentDraft = draftRef.current;
    if (fields.some((field) => (
      ownStatement[field.key].trim() !== currentDraft[field.key].trim()
    ))) return false;
    return !safetyConcernRef.current || ownStatement.safetyLevel === "high_risk";
  }, []);

  const clearSubmittedDraft = useCallback(() => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // The authoritative server statement is already committed.
    }
    hasSavedDraft.current = false;
  }, [storageKey]);

  const finishRecoveredSubmission = useCallback((result: CourtCase) => {
    clearSubmittedDraft();
    setCourtCase(result);
    if (result.safetyLevel === "high_risk") {
      setSubmittedSafety({
        level: "high_risk",
        categories: [],
        requiresImmediateHelp: true,
        resourceMessage: null,
      });
      return;
    }
    routerPush(weddingPath(`/couple-court/cases/${caseId}`));
  }, [caseId, clearSubmittedDraft, routerPush]);

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setLoadError(null);
    setAutosaveReady(false);
    try {
      const result = await getCase(caseId);
      if (loadRequestIdRef.current !== requestId) return;
      setCourtCase(result);
      const alreadySubmitted = result.viewerRole === "partner"
        ? result.partnerStatementSubmitted
        : result.applicantStatementSubmitted;
      if (!revisionMode && alreadySubmitted && isExactRecoveredSubmission(result)) {
        finishRecoveredSubmission(result);
        return;
      }
      if (result.safetyLevel === "high_risk") {
        // Keep the private draft untouched, but do not expose or autosave a
        // mutation form once the case has crossed the safety boundary.
        return;
      }
      if (result.status === "archived") {
        // Archived cases are terminal. Keep any existing local draft intact,
        // but never expose or autosave a new statement from this deep link.
        return;
      }
      if (!alreadySubmitted && revisionMode) {
        setLoadError("재심 진술은 기존 판결이 있는 사건에서만 작성할 수 있어요.");
        return;
      }
      if (alreadySubmitted && !revisionMode) {
        setLoadError(result.verdictReady
          ? "이미 제출한 진술이에요. 판결 화면의 ‘내 진술 보완하고 재심 요청’에서 새 진술을 작성해 주세요."
          : "이미 제출한 진술은 판결 전까지 수정할 수 없어요.");
        return;
      }
      if (revisionMode) {
        if (!result.verdictReady) {
          setLoadError("현재 판결 절차가 진행 중이어서 새 진술을 제출할 수 없어요.");
          return;
        }
        if (!result.ownStatement) {
          setLoadError("내 기존 진술을 안전하게 불러오지 못해 재심 작성을 시작하지 않았어요.");
          return;
        }
        if (!hasSavedDraft.current) {
          const { facts, feelings, expectations, attempts, desiredAgreement } = result.ownStatement;
          const restoredStatement = { facts, feelings, expectations, attempts, desiredAgreement };
          draftRef.current = restoredStatement;
          setDraft(restoredStatement);
          hasSavedDraft.current = true;
        }
      }
      setAutosaveReady(true);
    } catch (errorValue) {
      if (loadRequestIdRef.current !== requestId) return;
      setLoadError(errorValue instanceof Error ? errorValue.message : "사건을 불러오지 못했어요.");
    } finally {
      if (loadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [caseId, finishRecoveredSubmission, isExactRecoveredSubmission, revisionMode]);

  useEffect(() => {
    setHydratedStorageKey(null);
    hasSavedDraft.current = false;
    const fallbackSubmissionRequestId = window.crypto.randomUUID();
    let restoredSubmissionRequestId = fallbackSubmissionRequestId;
    let restoredDraft = EMPTY_STATEMENT;
    let restoredSafetyConcern = false;
    setCourtCase(null);
    setDraft(EMPTY_STATEMENT);
    setSafetyConcern(false);
    setPreview(false);
    setConfirmed(false);
    setSubmittedSafety(null);
    setError(null);
    setSaveMessage("");
    try {
      clearLegacyCourtDrafts(window.sessionStorage);
      const stored = readScopedCourtDraft<unknown>(
        window.sessionStorage,
        storageKey,
        draftOwnerId,
      );
      const saved = parseStoredStatementDraft(stored);
      if (stored !== null && saved === null) {
        window.sessionStorage.removeItem(storageKey);
      }
      if (saved) {
        hasSavedDraft.current = true;
        restoredDraft = saved.draft;
        restoredSafetyConcern = saved.safetyConcern;
      }
      if (saved?.submissionRequestId) {
        restoredSubmissionRequestId = saved.submissionRequestId;
      }
    } catch {
      // Storage access can be blocked; the form still works in memory.
    }
    submissionRequestIdRef.current = restoredSubmissionRequestId;
    draftRef.current = restoredDraft;
    safetyConcernRef.current = restoredSafetyConcern;
    submissionAttemptedRef.current = false;
    setDraft(restoredDraft);
    setSafetyConcern(restoredSafetyConcern);
    setSubmissionRequestId(restoredSubmissionRequestId);
    setHydratedStorageKey(storageKey);
    void load();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [draftOwnerId, load, storageKey]);

  useEffect(() => {
    if (
      hydratedStorageKey !== storageKey
      || !autosaveReady
      || !submissionRequestId
    ) return;
    setSaveMessage("임시 저장 중…");
    const timer = window.setTimeout(() => {
      try {
        writeScopedCourtDraft(window.sessionStorage, storageKey, draftOwnerId, {
          draft,
          submissionRequestId,
          safetyConcern,
        });
        setSaveMessage("이 탭에 임시 저장됨");
      } catch {
        setSaveMessage("임시 저장을 사용할 수 없어요. 페이지를 닫지 마세요.");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [autosaveReady, draft, draftOwnerId, hydratedStorageKey, safetyConcern, storageKey, submissionRequestId]);

  useEffect(() => {
    if (!preview) return;
    const frame = window.requestAnimationFrame(() => {
      previewHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [preview]);

  function validate() {
    const invalid = fields.find((field) => draft[field.key].trim().length < field.min);
    if (!invalid) return null;
    return `‘${invalid.label}’ 항목을 ${invalid.min}자 이상 적어주세요.`;
  }

  function rotateSubmissionRequestAfterEdit() {
    if (!submissionAttemptedRef.current) return;
    const nextRequestId = window.crypto.randomUUID();
    submissionRequestIdRef.current = nextRequestId;
    setSubmissionRequestId(nextRequestId);
    submissionAttemptedRef.current = false;
  }

  function updateDraftField(key: keyof StatementDraft, value: string) {
    rotateSubmissionRequestAfterEdit();
    const nextDraft = { ...draftRef.current, [key]: value };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setConfirmed(false);
    setError(null);
  }

  function updateSafetyConcern(value: boolean) {
    rotateSubmissionRequestAfterEdit();
    safetyConcernRef.current = value;
    setSafetyConcern(value);
    setConfirmed(false);
    setError(null);
  }

  function editStatement() {
    setConfirmed(false);
    setPreview(false);
  }

  function showPreview() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      const invalid = fields.find((field) => draft[field.key].trim().length < field.min);
      if (invalid) document.getElementById(`statement-${invalid.key}`)?.focus();
      return;
    }
    setError(null);
    setConfirmed(false);
    setPreview(true);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  async function submit() {
    if (!confirmed) {
      setError("제출 후 잠금 안내를 확인해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const attemptedRequestId = submissionRequestIdRef.current || submissionRequestId;
    submissionAttemptedRef.current = true;
    try {
      const submission = await submitStatement(caseId, {
        submissionRequestId: attemptedRequestId,
        ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as StatementDraft,
        ...(safetyConcern ? { safetyLevel: "high_risk" as const } : {}),
      });
      captureCourtEvent("couple_court_statement_submit", {
        mode: courtCase?.mode,
        category: courtCase?.category,
        status: revisionMode ? "revision" : "initial",
      });
      if (courtCase?.viewerRole === "partner") {
        captureCourtEvent("couple_court_partner_statement_submit", {
          mode: courtCase.mode,
          category: courtCase.category,
          status: revisionMode ? "revision" : "initial",
        });
      }
      if (revisionMode) {
        captureCourtEvent("couple_court_appeal_submit", {
          mode: courtCase?.mode,
          category: courtCase?.category,
          status: "revision",
        });
      }
      if (safetyConcern || submission?.safety?.level === "high_risk") {
        captureCourtEvent("couple_court_safety_redirect", {
          mode: courtCase?.mode,
          category: courtCase?.category,
          status: "statement",
        });
      }
      clearSubmittedDraft();
      if (submission?.safety?.level === "high_risk") {
        setSubmittedSafety(submission.safety);
        return;
      }
      router.push(weddingPath(`/couple-court/cases/${caseId}`));
    } catch (submitError) {
      try {
        const authoritative = await getCase(caseId);
        if (
          authoritative.ownStatement?.submissionRequestId === attemptedRequestId
          && fields.every((field) => (
            authoritative.ownStatement?.[field.key].trim()
              === draftRef.current[field.key].trim()
          ))
          && (!safetyConcernRef.current
            || authoritative.ownStatement.safetyLevel === "high_risk")
        ) {
          finishRecoveredSubmission(authoritative);
          return;
        }
      } catch {
        // Keep the original submission failure and the exact retry draft.
      }
      setError(submitError instanceof Error ? submitError.message : "진술을 제출하지 못했어요. 작성한 내용은 이 탭에 남아 있어요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <CourtPage className="max-w-[760px]"><LoadingState label="진술 작성 권한을 확인하는 중이에요." /></CourtPage>;
  if (submittedSafety?.level === "high_risk") return <CourtPage className="max-w-[760px]"><div className="pt-6"><SafetyNotice highRisk />{submittedSafety.resourceMessage && <p className="mt-4 rounded-[16px] border border-[#B45353]/20 bg-white p-4 text-base leading-7 text-[#5E6C66]" role="alert">{submittedSafety.resourceMessage}</p>}<p className="mt-4 text-sm leading-6 text-[#65716C]">진술은 안전하게 저장됐어요. 책임 비율·공개재판보다 현재 안전을 먼저 확인하며, 필요할 때 사건 기록으로 돌아갈 수 있어요.</p><div className="mt-6 flex justify-center"><CourtLink href={`/couple-court/cases/${caseId}`} variant="secondary">안전 안내가 있는 사건 화면으로</CourtLink></div></div></CourtPage>;
  if (courtCase?.safetyLevel === "high_risk") return <CourtPage className="max-w-[760px]"><div className="pt-6"><SafetyNotice highRisk /><p className="mt-4 rounded-[16px] border border-[#B45353]/20 bg-white p-4 text-base leading-7 text-[#5E6C66]" role="alert">이 사건은 진술 보완이나 재심보다 안전 확인을 먼저 안내하고 있어요. 작성 화면과 기존 판결은 더 이상 표시하지 않습니다.</p><div className="mt-6 flex justify-center"><CourtLink href={`/couple-court/cases/${caseId}`} variant="secondary">안전 안내와 사건 상태 확인</CourtLink></div></div></CourtPage>;
  if (courtCase?.status === "archived") return <CourtPage className="max-w-[760px]"><ArchivedCaseNotice caseId={caseId} showVerdictLink={courtCase.verdictReady} className="mt-6" /></CourtPage>;
  if (loadError || !courtCase) return <CourtPage className="max-w-[760px]"><ErrorState message={loadError ?? "사건을 찾지 못했어요."} onRetry={() => void load()} /></CourtPage>;
  const firstInvalidKey = error
    ? fields.find((field) => draft[field.key].trim().length < field.min)?.key
    : undefined;

  return (
    <CourtPage className="max-w-[760px]">
      <button type="button" onClick={() => preview ? editStatement() : router.back()} className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#36534E] outline-none hover:bg-[#EEF4F1] focus-visible:ring-2 focus-visible:ring-[#36534E]" aria-label={preview ? "진술 수정으로 돌아가기" : "사건 화면으로 돌아가기"}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{preview ? "수정하기" : "사건으로"}</button>

      <div className="mb-6"><p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">{revisionMode ? "재심 진술" : courtCase.viewerRole === "partner" ? "상대방 진술" : "신청인 진술"}</p><h1 ref={previewHeadingRef} tabIndex={preview ? -1 : undefined} className="mt-2 break-keep text-[30px] font-bold leading-[1.25] text-[#263832] outline-none">{preview ? "제출 전 마지막으로 확인해 주세요" : revisionMode ? "내 진술을 보완해 새 판결을 요청해요" : "내 입장부터 차분히 적어볼게요"}</h1><p className="mt-3 text-base leading-7 text-[#65716C]">{revisionMode ? "내가 제출한 최신 진술만 불러왔어요. 상대방의 진술 원문은 이 화면에 표시하지 않습니다." : courtCase.viewerRole === "partner" ? "누가 먼저 사건을 접수했는지는 중요하지 않아요. 신청인의 글을 보지 않고 내 입장부터 작성합니다." : "사실과 마음을 나누어 적으면 아모라가 두 사람의 쟁점을 더 선명하게 정리할 수 있어요."}</p></div>

      {revisionMode && <div className="mb-5 rounded-[18px] border border-[#D9CFC3] bg-[#FCFAF6] p-4"><p className="font-bold text-[#263832]">새 진술은 기존 진술을 덮어쓰지 않아요</p><p className="mt-2 text-sm leading-6 text-[#65716C]">새 버전으로 보관되며 기존 판결은 이전 기록으로 남습니다. 제출하면 현재 공개 미리보기와 양측 동의가 무효가 되고, 두 사람의 최신 진술로 새 판결을 요청해야 해요.</p></div>}

      {!preview ? <>
        <div className="mb-4 flex min-h-7 items-center gap-2 text-xs font-medium text-[#65716C]" role="status" aria-live="polite"><Save className="h-3.5 w-3.5" aria-hidden="true" />{saveMessage}</div>
        <Surface>
          <form onSubmit={(event) => { event.preventDefault(); showPreview(); }} noValidate className="space-y-7">
            {fields.map((field) => {
              const invalid = firstInvalidKey === field.key;
              return <div key={field.key}><label htmlFor={`statement-${field.key}`} className="block text-base font-bold leading-7 text-[#263832]">{field.label}</label><p id={`statement-${field.key}-hint`} className="mt-1 text-sm leading-6 text-[#65716C]">{field.hint} 최소 {field.min}자</p><textarea id={`statement-${field.key}`} value={draft[field.key]} onChange={(event) => updateDraftField(field.key, event.target.value)} rows={field.key === "facts" || field.key === "desiredAgreement" ? 6 : 4} minLength={field.min} maxLength={field.max} aria-invalid={invalid} aria-describedby={`statement-${field.key}-hint${invalid ? ` statement-${field.key}-error` : ""}`} className="mt-3 w-full resize-y rounded-[16px] border border-[#D8CDC1] bg-white px-4 py-3 text-base leading-7 text-[#263832] outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15" /><div className="mt-1 flex min-h-6 items-start justify-between gap-3">{invalid && <p id={`statement-${field.key}-error`} className="text-sm font-semibold text-[#9B3F3F]">{error}</p>}<span className="ml-auto shrink-0 text-xs text-[#65716C]">{draft[field.key].length}/{field.max}</span></div></div>;
            })}

            <div className="rounded-[16px] border border-[#D9CFC3] bg-[#FCFAF6] p-4"><label className="flex min-h-11 cursor-pointer items-start gap-3"><input type="checkbox" checked={safetyConcern} onChange={(event) => updateSafetyConcern(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#36534E]" /><span><span className="flex items-center gap-2 font-bold text-[#263832]"><ShieldAlert className="h-4 w-4 text-[#9B3F3F]" aria-hidden="true" />위협·강요·폭력처럼 안전 확인이 필요한 내용이 포함돼요</span><span className="mt-1 block text-sm leading-6 text-[#65716C]">선택하면 책임 비율, 농담, 공개 기능 대신 안전 안내를 우선합니다.</span></span></label></div>

            {error && <p className="rounded-[14px] bg-[#FFF3F1] px-4 py-3 text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}
            <CourtButton type="submit" className="w-full"><FileCheck2 className="h-4 w-4" aria-hidden="true" />제출 전 미리보기</CourtButton>
          </form>
        </Surface>
        <div className="mt-5"><SafetyNotice highRisk={safetyConcern} /></div>
      </> : <>
        <Surface>
          <dl className="space-y-6">{fields.map((field) => <div key={field.key} className="border-b border-[#E9E2DA] pb-5 last:border-0 last:pb-0"><dt className="text-sm font-bold text-[#8F6662]">{field.label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-base leading-7 text-[#263832]">{draft[field.key]}</dd></div>)}</dl>
        </Surface>
        <div className="mt-5 rounded-[18px] border border-[#A77B74]/25 bg-[#FBF5F3] p-4"><label className="flex min-h-11 cursor-pointer items-start gap-3"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setError(null); }} className="mt-1 h-5 w-5 shrink-0 accent-[#36534E]" /><span><span className="flex items-center gap-2 font-bold text-[#263832]"><LockKeyhole className="h-4 w-4 text-[#8F6662]" aria-hidden="true" />{revisionMode ? "새 진술 제출 뒤 새 판결이 필요함을 확인했어요" : "제출하면 판결 전까지 수정할 수 없음을 확인했어요"}</span><span className="mt-1 block text-sm leading-6 text-[#65716C]">{revisionMode ? "기존 공개 미리보기와 동의는 무효가 되며, 상대방의 진술 원문은 계속 표시되지 않아요." : "상대방에게 이 원문은 공개되지 않고, 판결에는 중재된 요약만 표시돼요."}</span></span></label></div>
        {error && <p className="mt-4 rounded-[14px] bg-[#FFF3F1] px-4 py-3 text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}
        <div className="sticky bottom-2 z-20 mt-5 flex gap-2 rounded-[20px] border border-[#E1D7CB] bg-[#FFFDF8]/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_14px_40px_rgba(38,56,50,0.14)] backdrop-blur"><CourtButton onClick={editStatement} variant="secondary" className="shrink-0">수정</CourtButton><CourtButton onClick={() => void submit()} disabled={!confirmed || submitting} className="flex-1">{submitting ? "안전하게 제출하는 중…" : <><Check className="h-4 w-4" aria-hidden="true" />{revisionMode ? "새 진술 제출하기" : "진술 제출하기"}</>}</CourtButton></div>
      </>}
    </CourtPage>
  );
}
