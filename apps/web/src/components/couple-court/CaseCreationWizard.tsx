"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, FilePenLine, HeartHandshake, LockKeyhole, MessagesSquare, Save, ShieldCheck, Sparkles, X } from "lucide-react";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { COURT_CATEGORY_CATALOG } from "@/lib/coupleCourt/catalog";
import Link from "next/link";
import { createCase, submitStatement } from "./api";
import { captureCourtEvent } from "./analytics";
import {
  clearLegacyCourtDrafts,
  courtCaseDraftKey,
  readScopedCourtDraft,
  writeScopedCourtDraft,
} from "./draftStorage";
import type { CourtMode, CourtTone } from "./types";
import { COURT_CATEGORIES, CourtButton, CourtPage, SafetyNotice } from "./CourtPrimitives";

const hurtActionOptions = [
  { value: "delayed_response", label: "답변을 미뤘다" },
  { value: "decided_alone", label: "상의 없이 결정했다" },
  { value: "ignored_opinion", label: "내 의견을 무시했다" },
  { value: "missed_task", label: "맡은 일을 하지 않았다" },
  { value: "prioritized_parents", label: "부모님 의견을 우선했다" },
  { value: "late_cost_notice", label: "비용을 숨기거나 늦게 알렸다" },
  { value: "hurtful_tone", label: "말투가 상처였다" },
  { value: "other", label: "기타" },
] as const;

const agreementTypeOptions = [
  { value: "roles_defined", label: "역할을 정해 두었다" },
  { value: "budget_defined", label: "예산을 정해 두었다" },
  { value: "no_specific_agreement", label: "구체적인 약속은 없었다" },
  { value: "remembered_differently", label: "서로 다르게 기억한다" },
  { value: "other", label: "기타" },
] as const;

const desiredOutcomeOptions = [
  { value: "apology", label: "사과" },
  { value: "explanation", label: "설명" },
  { value: "role_split", label: "역할 분담" },
  { value: "schedule", label: "일정 확정" },
  { value: "budget", label: "예산 합의" },
  { value: "respect_taste", label: "내 취향 존중" },
  { value: "parent_boundary", label: "부모님과 경계 정하기" },
  { value: "prevention", label: "다시 같은 일이 생기지 않을 약속" },
  { value: "unsure", label: "잘 모르겠다" },
] as const;

type HurtAction = typeof hurtActionOptions[number]["value"];
type AgreementType = typeof agreementTypeOptions[number]["value"];
type DesiredOutcome = typeof desiredOutcomeOptions[number]["value"];

interface DraftState {
  creationRequestId: string;
  submissionRequestId: string;
  mode: CourtMode | "";
  category: string;
  title: string;
  facts: string;
  hurtAction: HurtAction | "";
  hurtActionOther: string;
  feelings: string;
  agreementType: AgreementType | "";
  agreementTypeOther: string;
  expectations: string;
  attempts: string;
  desiredOutcomes: DesiredOutcome[];
  desiredAgreement: string;
  selfChange: string;
  tone: CourtTone;
  createdCaseId?: string;
}

const EMPTY_DRAFT: DraftState = {
  creationRequestId: "",
  submissionRequestId: "",
  mode: "",
  category: "",
  title: "",
  facts: "",
  hurtAction: "",
  hurtActionOther: "",
  feelings: "",
  agreementType: "",
  agreementTypeOther: "",
  expectations: "",
  attempts: "",
  desiredOutcomes: [],
  desiredAgreement: "",
  selfChange: "",
  tone: "gentle",
};

const modeOptions: Array<{ value: CourtMode; icon: typeof MessagesSquare; title: string; description: string; notes: string[] }> = [
  {
    value: "couple",
    icon: MessagesSquare,
    title: "둘이 중재받기",
    description: "각자 따로 진술하고 함께 판결받아요.",
    notes: ["각자 독립적으로 작성하고 서로의 원문은 공개하지 않아요.", "결과는 기본 비공개예요."],
  },
  {
    value: "solo",
    icon: FilePenLine,
    title: "혼자 임시판결",
    description: "지금은 혼자 마음과 결정을 정리하고 싶을 때 좋아요.",
    notes: ["1인 진술에 따른 임시판결로 표시돼요.", "나중에 상대방을 초대할 수 있어요."],
  },
];

const toneOptions: Array<{ value: CourtTone; title: string; description: string }> = [
  { value: "gentle", title: "다정맛", description: "마음은 살피고, 할 말은 부드럽게 정리해요." },
  { value: "practical", title: "현실맛", description: "누가 무엇을 언제까지 할지 선명하게 정리해요." },
  { value: "spicy", title: "매운맛", description: "웃기지만 선은 넘지 않아요. 해결책의 기준은 같아요." },
];

function ChoiceButton({ selected, onClick, children, className = "", disabled = false }: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string; disabled?: boolean }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} disabled={disabled} className={`min-h-11 rounded-[18px] border p-4 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-[#36534E] bg-[#EEF4F1] shadow-[0_8px_24px_rgba(54,83,78,0.08)]" : "border-[#DDD2C6] bg-white hover:border-[#A9BDB5]"} ${className}`}>{children}</button>;
}

function Field({ id, label, hint, value, onChange, minLength, maxLength = 1200, rows = 5, error }: { id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; minLength?: number; maxLength?: number; rows?: number; error?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return <div><label htmlFor={id} className="block text-base font-bold text-[#263832]">{label}</label>{hint && <p id={`${id}-hint`} className="mt-1 text-sm leading-6 text-[#65716C]">{hint}</p>}<textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={rows} minLength={minLength} maxLength={maxLength} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="mt-3 w-full resize-y rounded-[16px] border border-[#D8CDC1] bg-white px-4 py-3 text-base leading-7 text-[#263832] outline-none placeholder:text-[#65716C] focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15" /><div className="mt-1 flex min-h-6 items-start justify-between gap-3"><span id={`${id}-error`} className="text-sm font-medium text-[#9B3F3F]">{error}</span><span className="ml-auto shrink-0 text-xs text-[#65716C]">{value.length}/{maxLength}</span></div></div>;
}

function RadioChoiceGroup<T extends string>({ id, legend, options, value, onChange, error }: { id: string; legend: string; options: ReadonlyArray<{ value: T; label: string }>; value: T | ""; onChange: (value: T) => void; error?: string }) {
  const errorId = `${id}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="text-base font-bold text-[#263832]">{legend}</legend>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map((option, index) => {
          const selected = value === option.value;
          const spansFullRow = options.length % 2 === 1 && index === options.length - 1;
          return (
            <label key={option.value} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-[14px] border px-3 py-2 text-sm font-semibold leading-5 transition-colors motion-reduce:transition-none ${spansFullRow ? "col-span-2" : ""} ${selected ? "border-[#36534E] bg-[#EEF4F1] text-[#263832]" : "border-[#D8CDC1] bg-white text-[#5E6C66] hover:border-[#A9BDB5]"}`}>
              <input id={`${id}-${option.value}`} type="radio" name={id} value={option.value} checked={selected} onChange={() => onChange(option.value)} required aria-describedby={error ? errorId : undefined} className="h-5 w-5 shrink-0 accent-[#36534E] outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2" />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-1 min-h-6">{error && <p id={errorId} className="text-sm font-medium text-[#9B3F3F]">{error}</p>}</div>
    </fieldset>
  );
}

function CheckboxChoiceGroup<T extends string>({ id, legend, hint, options, values, onToggle, error }: { id: string; legend: string; hint?: string; options: ReadonlyArray<{ value: T; label: string }>; values: readonly T[]; onToggle: (value: T) => void; error?: string }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy}>
      <legend className="text-base font-bold text-[#263832]">{legend}</legend>
      {hint && <p id={hintId} className="mt-1 text-sm leading-6 text-[#65716C]">{hint}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map((option, index) => {
          const selected = values.includes(option.value);
          const spansFullRow = options.length % 2 === 1 && index === options.length - 1;
          return (
            <label key={option.value} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-[14px] border px-3 py-2 text-sm font-semibold leading-5 transition-colors motion-reduce:transition-none ${spansFullRow ? "col-span-2" : ""} ${selected ? "border-[#36534E] bg-[#EEF4F1] text-[#263832]" : "border-[#D8CDC1] bg-white text-[#5E6C66] hover:border-[#A9BDB5]"}`}>
              <input id={`${id}-${option.value}`} type="checkbox" checked={selected} onChange={() => onToggle(option.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="h-5 w-5 shrink-0 accent-[#36534E] outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2" />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-1 min-h-6">{error && <p id={errorId} className="text-sm font-medium text-[#9B3F3F]">{error}</p>}</div>
    </fieldset>
  );
}

function optionLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T | "") {
  return options.find((option) => option.value === value)?.label ?? "선택하지 않음";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function CaseCreationWizard({ draftOwnerId }: { draftOwnerId: string }) {
  const router = useRouter();
  const draftStorageKey = courtCaseDraftKey(draftOwnerId);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const [saveMessage, setSaveMessage] = useState("이 화면을 떠나기 전까지 안전하게 임시 보관해요.");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startTracked = useRef(false);
  const stepPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode");
    const requestedCategory = params.get("category");
    const categoryFromQuery = COURT_CATEGORIES.some((option) => option.value === requestedCategory)
      ? requestedCategory
      : null;
    try {
      clearLegacyCourtDrafts(window.sessionStorage);
      const parsed = readScopedCourtDraft<Partial<DraftState>>(
        window.sessionStorage,
        draftStorageKey,
        draftOwnerId,
      ) ?? {};
      const savedMode = parsed.mode === "solo" || parsed.mode === "couple" ? parsed.mode : "";
      const savedCategory = COURT_CATEGORIES.some((option) => option.value === parsed.category) ? parsed.category ?? "" : "";
      const savedTitle = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const savedCreatedCaseId = isUuid(parsed.createdCaseId) && savedMode && savedCategory && savedTitle
        ? parsed.createdCaseId
        : undefined;
      const creationRequestId = isUuid(parsed.creationRequestId)
        ? parsed.creationRequestId
        : window.crypto.randomUUID();
      const submissionRequestId = isUuid(parsed.submissionRequestId)
        ? parsed.submissionRequestId
        : window.crypto.randomUUID();
      const resolvedCategory = savedCreatedCaseId ? savedCategory : categoryFromQuery ?? savedCategory;
      const resolvedCategoryLabel = COURT_CATEGORY_CATALOG.find((category) => category.id === resolvedCategory)?.label;
      const savedHurtAction = hurtActionOptions.find((option) => option.value === parsed.hurtAction)?.value ?? "";
      const savedAgreementType = agreementTypeOptions.find((option) => option.value === parsed.agreementType)?.value ?? "";
      const savedDesiredOutcomes = Array.isArray(parsed.desiredOutcomes)
        ? parsed.desiredOutcomes.filter((value) => desiredOutcomeOptions.some((option) => option.value === value))
        : [];
      setDraft({
        ...EMPTY_DRAFT,
        ...parsed,
        creationRequestId,
        submissionRequestId,
        mode: savedCreatedCaseId
          ? savedMode
          : requestedMode === "solo" || requestedMode === "couple" ? requestedMode : savedMode,
        category: resolvedCategory,
        title: savedCreatedCaseId
          ? savedTitle
          : categoryFromQuery && categoryFromQuery !== savedCategory
            ? `${resolvedCategoryLabel ?? "기타"} 의견 차이 사건`
            : savedTitle || (resolvedCategoryLabel ? `${resolvedCategoryLabel} 의견 차이 사건` : ""),
        hurtAction: savedHurtAction,
        agreementType: savedAgreementType,
        desiredOutcomes: savedDesiredOutcomes,
        createdCaseId: savedCreatedCaseId,
      });
      if (savedCreatedCaseId) setStep(6);
    } catch {
      const queryCategoryLabel = COURT_CATEGORY_CATALOG.find((category) => category.id === categoryFromQuery)?.label;
      setDraft({
        ...EMPTY_DRAFT,
        creationRequestId: window.crypto.randomUUID(),
        submissionRequestId: window.crypto.randomUUID(),
        mode: requestedMode === "solo" || requestedMode === "couple" ? requestedMode : "",
        category: categoryFromQuery ?? "",
        title: queryCategoryLabel ? `${queryCategoryLabel} 의견 차이 사건` : "",
      });
    }
    setHydrated(true);
    if (!startTracked.current) {
      startTracked.current = true;
      captureCourtEvent("couple_court_case_start", {
        mode: requestedMode === "solo" || requestedMode === "couple" ? requestedMode : undefined,
      });
    }
  }, [draftOwnerId, draftStorageKey]);

  useEffect(() => {
    if (!hydrated) return;
    setSaveMessage("임시 저장 중…");
    const timer = window.setTimeout(() => {
      try {
        writeScopedCourtDraft(window.sessionStorage, draftStorageKey, draftOwnerId, draft);
        setSaveMessage("이 탭에 임시 저장됨");
      } catch {
        setSaveMessage("임시 저장을 사용할 수 없어요. 이 페이지를 닫지 마세요.");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, draftOwnerId, draftStorageKey, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    stepPanelRef.current?.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [step, hydrated]);

  const categoryQuestions = COURT_CATEGORY_CATALOG.find((category) => category.id === draft.category)?.questionPrompts ?? [];
  const progress = Math.round(step / 6 * 100);

  const stepError = useMemo(() => {
    if (step === 1 && !draft.mode) return "판결 방식을 하나 선택해 주세요.";
    if (step === 2 && !draft.category) return "사건 카테고리를 선택해 주세요.";
    if (step === 3 && draft.facts.trim().length < 40) return "무슨 일이 있었는지 40자 이상 적어 주세요.";
    if (step === 3 && !draft.hurtAction) return "가장 서운했던 행동을 하나 선택해 주세요.";
    if (step === 3 && draft.hurtAction === "other" && draft.hurtActionOther.trim().length < 2) return "기타 행동을 2자 이상 적어 주세요.";
    if (step === 3 && draft.feelings.trim().length < 10) return "그때 느낀 마음을 10자 이상 적어 주세요.";
    if (step === 4 && !draft.agreementType) return "당시 약속에 가장 가까운 항목을 선택해 주세요.";
    if (step === 4 && draft.agreementType === "other" && draft.agreementTypeOther.trim().length < 2) return "기타 약속 유형을 2자 이상 적어 주세요.";
    if (step === 4 && draft.expectations.trim().length < 10) return "원래 기대하거나 약속한 내용을 10자 이상 적어 주세요.";
    if (step === 4 && draft.attempts.trim().length < 10) return "이미 해본 대화를 10자 이상 적어 주세요.";
    if (step === 5 && draft.desiredOutcomes.length === 0) return "바라는 결과를 하나 이상 선택해 주세요.";
    if (step === 5 && !draft.desiredOutcomes.includes("unsure") && draft.desiredAgreement.trim().length < 10) return "원하는 합의를 10자 이상 적어 주세요.";
    if (step === 5 && draft.selfChange.trim().length < 5) return "내가 바꿀 수 있는 행동을 5자 이상 적어 주세요.";
    return null;
  }, [draft, step]);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function selectMode(mode: CourtMode) {
    update("mode", mode);
    captureCourtEvent("couple_court_mode_select", { mode });
  }

  function selectCategory(category: string) {
    const categoryLabel = COURT_CATEGORY_CATALOG.find(
      (definition) => definition.id === category,
    )?.label;
    setDraft((current) => ({
      ...current,
      category,
      title: categoryLabel ? `${categoryLabel} 의견 차이 사건` : "",
    }));
    setError(null);
    captureCourtEvent("couple_court_category_select", { mode: draft.mode, category });
  }

  function toggleDesiredOutcome(outcome: DesiredOutcome) {
    setDraft((current) => {
      if (outcome === "unsure") {
        return { ...current, desiredOutcomes: current.desiredOutcomes.includes("unsure") ? [] : ["unsure"] };
      }
      const withoutUnsure = current.desiredOutcomes.filter((value) => value !== "unsure");
      return {
        ...current,
        desiredOutcomes: withoutUnsure.includes(outcome)
          ? withoutUnsure.filter((value) => value !== outcome)
          : [...withoutUnsure, outcome],
      };
    });
    setError(null);
  }

  function goNext() {
    if (stepError) {
      setError(stepError);
      window.requestAnimationFrame(() => {
        const firstInvalidId = step === 3
          ? draft.facts.trim().length < 40
            ? "facts"
            : !draft.hurtAction
              ? `hurt-action-${hurtActionOptions[0].value}`
              : draft.hurtAction === "other" && draft.hurtActionOther.trim().length < 2
                ? "hurt-action-other-text"
                : "feelings"
          : step === 4
            ? !draft.agreementType
              ? `agreement-type-${agreementTypeOptions[0].value}`
              : draft.agreementType === "other" && draft.agreementTypeOther.trim().length < 2
                ? "agreement-type-other-text"
                : draft.expectations.trim().length < 10
                  ? "expectations"
                  : "attempts"
            : step === 5
              ? draft.desiredOutcomes.length === 0
                ? `desired-outcome-${desiredOutcomeOptions[0].value}`
                : !draft.desiredOutcomes.includes("unsure") && draft.desiredAgreement.trim().length < 10
                  ? "desired-agreement"
                  : "self-change"
              : null;
        const firstInvalid = firstInvalidId
          ? document.getElementById(firstInvalidId)
          : stepPanelRef.current?.querySelector<HTMLElement>("button[aria-pressed]");
        firstInvalid?.focus();
      });
      return;
    }
    setError(null);
    setStep((current) => Math.min(6, current + 1));
  }

  async function submit() {
    if (stepError || !draft.mode) {
      setError(stepError ?? "필수 내용을 확인해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    let caseId = draft.createdCaseId;
    try {
      if (!caseId) {
        const courtCase = await createCase({
          creationRequestId: draft.creationRequestId,
          mode: draft.mode,
          category: draft.category,
          tone: draft.tone,
          title: draft.title.trim(),
        });
        if (!isUuid(courtCase.id)) throw new Error("사건 번호를 안전하게 확인하지 못했어요. 다시 시도해 주세요.");
        caseId = courtCase.id;
        const persistedDraft = { ...draft, createdCaseId: courtCase.id };
        setDraft(persistedDraft);
        try {
          writeScopedCourtDraft(window.sessionStorage, draftStorageKey, draftOwnerId, persistedDraft);
          setSaveMessage("사건 번호와 작성 내용을 이 탭에 저장함");
        } catch {
          setSaveMessage("사건 번호가 만들어졌어요. 제출이 끝날 때까지 이 페이지를 닫지 마세요.");
        }
      }
      const hurtAction = draft.hurtAction === "other"
        ? `기타: ${draft.hurtActionOther.trim()}`
        : optionLabel(hurtActionOptions, draft.hurtAction);
      const agreementType = draft.agreementType === "other"
        ? `기타: ${draft.agreementTypeOther.trim()}`
        : optionLabel(agreementTypeOptions, draft.agreementType);
      const desiredOutcomes = draft.desiredOutcomes
        .map((outcome) => optionLabel(desiredOutcomeOptions, outcome))
        .join(", ");
      await submitStatement(caseId, {
        submissionRequestId: draft.submissionRequestId,
        facts: draft.facts.trim(),
        feelings: `[가장 서운했던 행동]\n${hurtAction}\n\n[그때 느낀 마음]\n${draft.feelings.trim()}`,
        expectations: `[사전 약속 유형]\n${agreementType}\n\n[원래 약속하거나 기대한 내용]\n${draft.expectations.trim()}`,
        attempts: draft.attempts.trim(),
        desiredAgreement: `[바라는 결과]\n${desiredOutcomes}\n\n[내가 바꿀 수 있는 행동]\n${draft.selfChange.trim()}\n\n[구체적인 합의]\n${draft.desiredAgreement.trim() || "아직 구체적인 합의를 정하지 못했어요."}`,
      });
      captureCourtEvent("couple_court_statement_submit", {
        mode: draft.mode,
        category: draft.category,
        tone: draft.tone,
        status: "initial",
      });
      try {
        window.sessionStorage.removeItem(draftStorageKey);
      } catch {
        // Submission already succeeded; blocked storage must not stop navigation.
      }
      router.push(weddingPath(`/couple-court/cases/${caseId}`));
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "진술을 제출하지 못했어요.";
      setError(caseId
        ? `사건 번호는 저장되어 있어요. ${message} 설정을 바꾸지 않고 다시 제출해 주세요.`
        : `${message} 작성한 내용은 이 탭에 남아 있어요.`);
    } finally {
      setSubmitting(false);
    }
  }

  if (!hydrated) return <CourtPage><div className="min-h-[420px]" role="status" aria-live="polite"><span className="sr-only">작성 화면을 준비하는 중입니다.</span></div></CourtPage>;

  return (
    <CourtPage className="max-w-[760px]">
      <header className="mb-6 flex items-center justify-between gap-3">
        <button type="button" onClick={() => step > 1 ? setStep((current) => current - 1) : router.back()} disabled={Boolean(draft.createdCaseId)} aria-describedby={draft.createdCaseId ? "case-settings-lock-notice" : undefined} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#36534E] outline-none hover:bg-[#EEF4F1] focus-visible:ring-2 focus-visible:ring-[#36534E] disabled:cursor-not-allowed disabled:opacity-40" aria-label={draft.createdCaseId ? "사건 번호 생성 후에는 이전 단계로 돌아갈 수 없음" : step > 1 ? "이전 단계" : "이전 화면"}><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>
        <div className="min-w-0 flex-1 text-center"><p className="text-sm font-bold text-[#36534E]">사건 접수 {step}/6</p><div className="mx-auto mt-2 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-[#E7E0D6]" role="progressbar" aria-label="사건 접수 진행률" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step}><div className="h-full rounded-full bg-[#36534E] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div></div>
        <Link {...weddingLinkProps("/couple-court")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#5E6C66] outline-none hover:bg-[#F5F1EB] focus-visible:ring-2 focus-visible:ring-[#36534E]" aria-label="사건 접수 닫기"><X className="h-5 w-5" aria-hidden="true" /></Link>
      </header>

      <div className="mb-4 flex min-h-7 items-center justify-center gap-2 text-xs font-medium text-[#65716C]" role="status" aria-live="polite"><Save className="h-3.5 w-3.5" aria-hidden="true" />{saveMessage}</div>

      <form onSubmit={(event) => { event.preventDefault(); if (step === 6) void submit(); else goNext(); }} noValidate>
        <section ref={stepPanelRef} tabIndex={-1} className="rounded-[24px] border border-[#E1D7CB] bg-white p-5 shadow-[0_16px_44px_rgba(38,56,50,0.06)] outline-none sm:p-8" aria-labelledby={`step-${step}-title`}>
          {step === 1 && <><p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">판결 방식</p><h1 id="step-1-title" className="mt-2 text-[28px] font-bold leading-tight text-[#263832]">지금 두 분에게 맞는 방법은?</h1><p className="mt-3 text-base leading-7 text-[#65716C]">둘 중 어느 방법도 더 좋은 답은 아니에요. 지금 편한 방식으로 시작하세요.</p><fieldset className="mt-6"><legend className="sr-only">판결 방식 선택</legend><div className="grid gap-4">{modeOptions.map((option) => <ChoiceButton key={option.value} selected={draft.mode === option.value} onClick={() => selectMode(option.value)}><div className="flex gap-4"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${draft.mode === option.value ? "bg-[#36534E] text-white" : "bg-[#F2EEE8] text-[#65716C]"}`}><option.icon className="h-5 w-5" aria-hidden="true" /></span><span><span className="block text-lg font-bold text-[#263832]">{option.title}</span><span className="mt-1 block text-base leading-7 text-[#5E6C66]">{option.description}</span>{option.notes.map((note) => <span key={note} className="mt-2 flex gap-2 text-sm leading-6 text-[#65716C]"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-[#36534E]" aria-hidden="true" />{note}</span>)}</span></div></ChoiceButton>)}</div></fieldset></>}

          {step === 2 && <><p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">사건 분류</p><h1 id="step-2-title" className="mt-2 text-[28px] font-bold leading-tight text-[#263832]">무슨 사건인가요?</h1><p className="mt-3 text-base leading-7 text-[#65716C]">정답을 찾기보다 갈등의 중심에 가장 가까운 주제를 골라주세요.</p><fieldset className="mt-6"><legend className="text-base font-bold text-[#263832]">카테고리</legend><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{COURT_CATEGORIES.map((category) => <ChoiceButton key={category.value} selected={draft.category === category.value} onClick={() => selectCategory(category.value)} className="flex min-h-[72px] items-center justify-center p-3 text-center text-sm font-semibold">{category.label}</ChoiceButton>)}</div></fieldset>{draft.title && <div className="mt-7 rounded-[16px] border border-[#D7E1DC] bg-[#F2F7F4] p-4"><p className="text-sm font-bold text-[#36534E]">상대에게 보이는 중립 사건명</p><p className="mt-1 text-base font-semibold text-[#263832]">{draft.title}</p><p className="mt-2 text-sm leading-6 text-[#65716C]">블라인드 진술을 지키기 위해 구체적인 사연이나 실명은 제목에 넣지 않아요.</p></div>}</>}

          {step === 3 && <>
            <p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">내가 기억하는 일</p>
            <h1 id="step-3-title" className="mt-2 text-[28px] font-bold leading-tight text-[#263832]">무슨 일이 있었나요?</h1>
            <p className="mt-3 text-base leading-7 text-[#65716C]">판사님께 말하듯 편하게 적어주세요. 상대방을 설득하려고 과장하지 않아도 괜찮아요.</p>
            {categoryQuestions[0] && <div className="mt-4 rounded-[14px] border border-[#D7E1DC] bg-[#F2F7F4] px-4 py-3"><p className="text-xs font-bold text-[#36534E]">이 주제에서 생각해 볼 질문</p><p className="mt-1 text-sm leading-6 text-[#5E6C66]">{categoryQuestions[0]}</p></div>}
            <div className="mt-6 space-y-6">
              <Field id="facts" label="확인 가능한 사실부터 적어주세요" hint="언제, 어떤 결정이나 대화가 있었는지 적어주세요. 최소 40자" value={draft.facts} onChange={(value) => update("facts", value)} minLength={40} error={error && draft.facts.trim().length < 40 ? "무슨 일이 있었는지 40자 이상 적어 주세요." : undefined} />
              <RadioChoiceGroup id="hurt-action" legend="가장 서운했던 행동은 무엇인가요?" options={hurtActionOptions} value={draft.hurtAction} onChange={(value) => update("hurtAction", value)} error={error && !draft.hurtAction ? "가장 서운했던 행동을 하나 선택해 주세요." : undefined} />
              {draft.hurtAction === "other" && <Field id="hurt-action-other-text" label="기타 행동을 짧게 적어주세요" value={draft.hurtActionOther} onChange={(value) => update("hurtActionOther", value)} minLength={2} maxLength={120} rows={2} error={error && draft.hurtActionOther.trim().length < 2 ? "기타 행동을 2자 이상 적어 주세요." : undefined} />}
              <Field id="feelings" label="그때 어떤 마음이었나요?" hint="상대방을 평가하기보다 내 감정을 중심으로 적어주세요. 최소 10자" value={draft.feelings} onChange={(value) => update("feelings", value)} minLength={10} maxLength={600} rows={3} error={error && draft.feelings.trim().length < 10 ? "그때 느낀 마음을 10자 이상 적어 주세요." : undefined} />
            </div>
            <div className="mt-5"><SafetyNotice /></div>
          </>}

          {step === 4 && <>
            <p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">약속과 시도</p>
            <h1 id="step-4-title" className="mt-2 text-[28px] font-bold leading-tight text-[#263832]">원래 무엇을 기대했나요?</h1>
            <p className="mt-3 text-base leading-7 text-[#65716C]">명확한 약속이 없었다면 그대로 적어도 괜찮아요. 서로 다르게 기억하는지도 중요한 단서예요.</p>
            {categoryQuestions[1] && <div className="mt-4 rounded-[14px] border border-[#E4D9CC] bg-[#FCFAF6] px-4 py-3"><p className="text-xs font-bold text-[#8F6662]">합의를 구체화하는 질문</p><p className="mt-1 text-sm leading-6 text-[#5E6C66]">{categoryQuestions[1]}</p></div>}
            <div className="mt-6 space-y-6">
              <RadioChoiceGroup id="agreement-type" legend="당시 약속은 어느 쪽에 가까웠나요?" options={agreementTypeOptions} value={draft.agreementType} onChange={(value) => update("agreementType", value)} error={error && !draft.agreementType ? "당시 약속에 가장 가까운 항목을 선택해 주세요." : undefined} />
              {draft.agreementType === "other" && <Field id="agreement-type-other-text" label="기타 약속 유형을 짧게 적어주세요" value={draft.agreementTypeOther} onChange={(value) => update("agreementTypeOther", value)} minLength={2} maxLength={120} rows={2} error={error && draft.agreementTypeOther.trim().length < 2 ? "기타 약속 유형을 2자 이상 적어 주세요." : undefined} />}
              <Field id="expectations" label="원래 약속하거나 기대한 내용" value={draft.expectations} onChange={(value) => update("expectations", value)} minLength={10} maxLength={800} rows={4} error={error && draft.expectations.trim().length < 10 ? "원래 기대하거나 약속한 내용을 10자 이상 적어 주세요." : undefined} />
              <Field id="attempts" label="해결하려고 이미 해본 대화나 행동" hint="아직 이야기하지 못했다면 그 이유를 적어주세요." value={draft.attempts} onChange={(value) => update("attempts", value)} minLength={10} maxLength={800} rows={4} error={error && draft.attempts.trim().length < 10 ? "이미 해본 대화를 10자 이상 적어 주세요." : undefined} />
            </div>
          </>}

          {step === 5 && <>
            <p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">원하는 합의</p>
            <h1 id="step-5-title" className="mt-2 text-[28px] font-bold leading-tight text-[#263832]">판결 뒤 무엇이 달라지면 좋을까요?</h1>
            <p className="mt-3 text-base leading-7 text-[#65716C]">사과만으로 끝내기보다 두 사람이 확인할 수 있는 행동 하나를 포함해 보세요.</p>
            <div className="mt-6 space-y-6">
              <CheckboxChoiceGroup id="desired-outcome" legend="사실은 어떤 결과를 바랐나요?" hint="여러 개 선택할 수 있어요. ‘잘 모르겠다’를 고르면 다른 선택은 해제돼요." options={desiredOutcomeOptions} values={draft.desiredOutcomes} onToggle={toggleDesiredOutcome} error={error && draft.desiredOutcomes.length === 0 ? "바라는 결과를 하나 이상 선택해 주세요." : undefined} />
              <Field id="desired-agreement" label="우리가 만들었으면 하는 구체적인 합의" hint={draft.desiredOutcomes.includes("unsure") ? "아직 잘 모르겠다면 비워도 괜찮아요." : "예: 추가 비용은 결제 전에 서로 확인하고, 오늘 저녁까지 예산 상한을 함께 정한다."} value={draft.desiredAgreement} onChange={(value) => update("desiredAgreement", value)} minLength={draft.desiredOutcomes.includes("unsure") ? undefined : 10} maxLength={500} rows={5} error={error && !draft.desiredOutcomes.includes("unsure") && draft.desiredAgreement.trim().length < 10 ? "원하는 합의를 10자 이상 적어 주세요." : undefined} />
              <Field id="self-change" label="내가 바꿀 수 있는 행동 하나를 고른다면?" hint="상대방이 먼저 달라져야 한다는 답 대신, 내가 바로 시작할 수 있는 작은 행동을 적어주세요." value={draft.selfChange} onChange={(value) => update("selfChange", value)} minLength={5} maxLength={300} rows={3} error={error && draft.selfChange.trim().length < 5 ? "내가 바꿀 수 있는 행동을 5자 이상 적어 주세요." : undefined} />
            </div>
            <div className="mt-5 rounded-[16px] bg-[#F7F1E8] p-4"><p className="flex gap-2 text-sm font-semibold leading-6 text-[#705E48]"><HeartHandshake className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />좋은 화해 처방은 담당자, 기한, 완료 기준이 분명해요.</p></div>
          </>}

          {step === 6 && <>
            <p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">판결 설정</p>
            <h1 id="step-6-title" className="mt-2 text-[28px] font-bold leading-tight text-[#263832]">아모라가 어떻게 말해드릴까요?</h1>
            <p className="mt-3 text-base leading-7 text-[#65716C]">말투만 달라지고 사실 판단, 안전 기준, 해결책의 품질은 모두 같아요.</p>
            <fieldset className="mt-6" aria-describedby={draft.createdCaseId ? "case-settings-lock-notice" : undefined}><legend className="sr-only">판결 말투</legend><div className="grid gap-3">{toneOptions.map((tone) => <ChoiceButton key={tone.value} selected={draft.tone === tone.value} onClick={() => update("tone", tone.value)} disabled={Boolean(draft.createdCaseId)}><span className="flex items-start justify-between gap-4"><span><span className="block text-lg font-bold text-[#263832]">{tone.title}</span><span className="mt-1 block text-base leading-7 text-[#65716C]">{tone.description}</span></span>{draft.tone === tone.value && <Check className="mt-1 h-5 w-5 shrink-0 text-[#36534E]" aria-hidden="true" />}</span></ChoiceButton>)}</div></fieldset>
            <div className="mt-6 rounded-[18px] border border-[#9DB5AC]/35 bg-[#F2F7F4] p-4"><p className="flex items-center gap-2 font-bold text-[#263832]"><LockKeyhole className="h-5 w-5 text-[#36534E]" aria-hidden="true" />처음에는 비공개로 접수돼요</p><p className="mt-2 text-sm leading-6 text-[#5E6C66]">원문은 공개되지 않아요. 공개재판을 원할 때는 판결 뒤 익명화된 별도 미리보기를 확인하고 다시 동의해야 해요.</p></div>
            <div className="mt-4 rounded-[18px] border border-[#E4D9CC] p-4">
              <p className="flex items-center gap-2 font-bold text-[#263832]"><ShieldCheck className="h-5 w-5 text-[#36534E]" aria-hidden="true" />접수 전 확인</p>
              <dl className="mt-3 space-y-2 text-sm leading-6">
                <div><dt className="font-bold text-[#263832]">사건</dt><dd className="text-[#65716C]">{draft.title}</dd></div>
                <div><dt className="font-bold text-[#263832]">방식·말투</dt><dd className="text-[#65716C]">{draft.mode === "couple" ? "둘이 중재받기" : "혼자 임시판결"} · {toneOptions.find((tone) => tone.value === draft.tone)?.title}</dd></div>
                <div><dt className="font-bold text-[#263832]">가장 서운했던 행동</dt><dd className="break-words text-[#65716C]">{draft.hurtAction === "other" ? draft.hurtActionOther : optionLabel(hurtActionOptions, draft.hurtAction)}</dd></div>
                <div><dt className="font-bold text-[#263832]">바라는 결과</dt><dd className="break-words text-[#65716C]">{draft.desiredOutcomes.map((outcome) => optionLabel(desiredOutcomeOptions, outcome)).join(", ")}</dd></div>
                <div><dt className="font-bold text-[#263832]">내가 먼저 바꿀 행동</dt><dd className="whitespace-pre-wrap break-words text-[#65716C]">{draft.selfChange}</dd></div>
              </dl>
            </div>
          </>}
        </section>

        <div className="sticky bottom-2 z-20 mt-5 rounded-[20px] border border-[#E1D7CB] bg-[#FFFDF8]/95 p-3 shadow-[0_14px_40px_rgba(38,56,50,0.14)] backdrop-blur sm:p-4" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {draft.createdCaseId && <p id="case-settings-lock-notice" className="mb-3 rounded-[12px] bg-[#EEF4F1] px-3 py-2 text-sm font-semibold leading-6 text-[#36534E]" role="status">사건 번호가 이미 만들어져 설정을 잠갔어요. 같은 사건에 진술 제출만 다시 시도합니다.</p>}
          {error && <p className="mb-3 rounded-[12px] bg-[#FFF3F1] px-3 py-2 text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}
          <div className="flex gap-2">
            {step > 1 && !draft.createdCaseId && <CourtButton onClick={() => { setError(null); setStep((current) => current - 1); }} variant="secondary" className="shrink-0 px-4"><ArrowLeft className="h-4 w-4" aria-hidden="true" />이전</CourtButton>}
            <CourtButton type="submit" disabled={submitting} className="flex-1">
              {submitting ? <><Sparkles className="h-4 w-4 animate-pulse motion-reduce:animate-none" aria-hidden="true" />사건을 안전하게 접수하는 중…</> : step === 6 ? <>{draft.createdCaseId ? "진술 제출 다시 시도" : "사건 접수하기"} <Check className="h-4 w-4" aria-hidden="true" /></> : <>다음 <ChevronRight className="h-4 w-4" aria-hidden="true" /></>}
            </CourtButton>
          </div>
        </div>
      </form>
    </CourtPage>
  );
}
