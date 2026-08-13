"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Eye, ShieldCheck } from "lucide-react";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import { applyPlanningChecklistProfile } from "@/utils/checklist";
import { CHECKLIST_ITEM_GUIDANCE } from "@hanbang/shared/constants";
import {
  DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
  PLANNING_CHECKLIST_PROFILE_KEY,
  isCanonicalPlanningChecklistProfile,
  normalizePlanningChecklistProfile,
  type PlanningChecklistProfileAnswers,
} from "@hanbang/shared/utils";

const DEFAULT_ANSWERS: PlanningChecklistProfileAnswers = {
  ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
};

const EXTERNAL_PROFILE_CHANGE_MESSAGE =
  "다른 화면이나 파트너가 준비 설정을 변경했어요. 최신 설정을 다시 불러온 뒤 변경 미리보기를 다시 확인해 주세요.";

type TriChoice = { value: boolean | null; label: string };
const TRI_CHOICES: TriChoice[] = [
  { value: true, label: "해당해요" },
  { value: false, label: "해당 없어요" },
  { value: null, label: "아직 모르겠어요" },
];

function RadioGroup<T extends string>({
  legend,
  help,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  help?: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const helpId = `${name}-help`;
  return (
    <fieldset
      aria-describedby={help ? helpId : undefined}
      className="border-b border-[#e7e0d5] py-5"
    >
      <legend className="text-[14px] font-semibold text-[#243832]">{legend}</legend>
      {help && (
        <p id={helpId} className="mt-1.5 text-[12.5px] leading-5 text-[#65706d]">
          {help}
        </p>
      )}
      <div className={help ? "mt-2.5 flex flex-wrap gap-2" : "mt-3 flex flex-wrap gap-2"}>
        {options.map((option) => (
          <label key={option.value} className={`cursor-pointer rounded-full border px-3.5 py-2 text-[12.5px] font-semibold ${value === option.value ? "border-[#36534e] bg-[#36534e] text-white" : "border-[#d9d1c2] bg-white text-[#5d6864]"}`}>
            <input className="sr-only" type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BooleanGroup({
  legend,
  name,
  value,
  onChange,
}: {
  legend: string;
  name: keyof PlanningChecklistProfileAnswers;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <fieldset className="border-b border-[#e7e0d5] py-5">
      <legend className="text-[14px] font-semibold text-[#243832]">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {TRI_CHOICES.map((option) => {
          const rawValue = option.value === null ? "undecided" : String(option.value);
          return (
            <label key={rawValue} className={`cursor-pointer rounded-full border px-3.5 py-2 text-[12.5px] font-semibold ${value === option.value ? "border-[#36534e] bg-[#36534e] text-white" : "border-[#d9d1c2] bg-white text-[#5d6864]"}`}>
              <input className="sr-only" type="radio" name={name} value={rawValue} checked={value === option.value} onChange={() => onChange(option.value)} />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function WeddingProfilePage() {
  const { journey, profile, updateJourney, refreshJourney, isDemo, user } = useAuthStore();
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress],
  );
  const rawStoredProfile = progress[PLANNING_CHECKLIST_PROFILE_KEY];
  const storedProfile = useMemo(
    () => normalizePlanningChecklistProfile(rawStoredProfile) ?? null,
    [rawStoredProfile],
  );
  const storedProfileIsCanonical = isCanonicalPlanningChecklistProfile(rawStoredProfile);
  const storedRevision = journey?.state_revision ?? 0;
  const storedProfileIdentity = useMemo(
    () => JSON.stringify(rawStoredProfile ?? null),
    [rawStoredProfile],
  );
  const [answers, setAnswers] = useState<PlanningChecklistProfileAnswers>(storedProfile?.answers ?? DEFAULT_ANSWERS);
  const [draftBase, setDraftBase] = useState(() => ({
    revision: storedRevision,
    profileIdentity: storedProfileIdentity,
  }));
  const [draftDirty, setDraftDirty] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof applyPlanningChecklistProfile> | null>(null);
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [previewProfileIdentity, setPreviewProfileIdentity] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const draftBaseIsStale = draftBase.revision !== storedRevision
    || draftBase.profileIdentity !== storedProfileIdentity;

  useEffect(() => {
    if (saving) return;
    if (draftDirty) {
      if (!draftBaseIsStale) return;
      setPreview(null);
      setPreviewRevision(null);
      setPreviewProfileIdentity(null);
      setError(EXTERNAL_PROFILE_CHANGE_MESSAGE);
      setNotice("");
      return;
    }

    setAnswers({ ...(storedProfile?.answers ?? DEFAULT_ANSWERS) });
    setDraftBase((current) => (
      current.revision === storedRevision
        && current.profileIdentity === storedProfileIdentity
        ? current
        : { revision: storedRevision, profileIdentity: storedProfileIdentity }
    ));
    setPreview(null);
    setPreviewRevision(null);
    setPreviewProfileIdentity(null);
  }, [
    draftBaseIsStale,
    draftDirty,
    saving,
    storedProfile,
    storedProfileIdentity,
    storedRevision,
  ]);
  const previewItems = useMemo(() => {
    if (!preview) return { excluded: [], restored: [] };
    const excludedIds = new Set(preview.profile.autoExcludedItemIds);
    const restoredIds = new Set(preview.restoredItemIds);
    const all = CATEGORY_CHECKLISTS.flatMap((category) => category.items.map((item) => ({
      categoryLabel: category.label,
      itemId: item.id,
      label: item.label,
    })));
    return {
      excluded: all.filter((item) => excludedIds.has(item.itemId)),
      restored: all.filter((item) => restoredIds.has(item.itemId)),
    };
  }, [preview]);

  const updateAnswer = <K extends keyof PlanningChecklistProfileAnswers>(
    key: K,
    value: PlanningChecklistProfileAnswers[K],
  ) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setDraftDirty(true);
    setPreview(null);
    setPreviewRevision(null);
    setPreviewProfileIdentity(null);
    setNotice("");
  };

  const reloadLatestProfile = () => {
    setAnswers({ ...(storedProfile?.answers ?? DEFAULT_ANSWERS) });
    setDraftBase({
      revision: storedRevision,
      profileIdentity: storedProfileIdentity,
    });
    setDraftDirty(false);
    setPreview(null);
    setPreviewRevision(null);
    setPreviewProfileIdentity(null);
    setError("");
    setNotice("최신 설정을 불러왔어요. 내용을 다시 확인해 주세요.");
  };

  const buildPreview = () => {
    if (draftBaseIsStale) {
      setPreview(null);
      setPreviewRevision(null);
      setPreviewProfileIdentity(null);
      setError(EXTERNAL_PROFILE_CHANGE_MESSAGE);
      setNotice("");
      return;
    }
    setError("");
    const reviewedAt = new Date().toISOString();
    const nextPreview = applyPlanningChecklistProfile(
      CATEGORY_CHECKLISTS,
      progress,
      {
        version: 2,
        reviewedAt,
        answers,
        autoExcludedItemIds: storedProfileIsCanonical
          ? storedProfile?.autoExcludedItemIds ?? []
          : [],
      },
      CHECKLIST_ITEM_GUIDANCE,
      profile?.id,
    );
    const sameAnswers = storedProfileIsCanonical
      && storedProfile !== null
      && JSON.stringify(storedProfile.answers) === JSON.stringify(answers);
    const sameAutoExclusions = storedProfileIsCanonical
      && storedProfile !== null
      && [...storedProfile.autoExcludedItemIds].sort().join("\n")
        === [...nextPreview.profile.autoExcludedItemIds].sort().join("\n");
    if (
      sameAnswers
      && sameAutoExclusions
      && Object.keys(nextPreview.categoryProgressPatch).length === 0
    ) {
      setPreview(null);
      setPreviewRevision(null);
      setPreviewProfileIdentity(null);
      setDraftDirty(false);
      setNotice("이미 같은 상황 설정이 반영되어 있어 저장할 변경이 없어요.");
      return;
    }
    setPreview(nextPreview);
    setPreviewRevision(draftBase.revision);
    setPreviewProfileIdentity(draftBase.profileIdentity);
    setDraftDirty(true);
  };

  const confirmSave = async () => {
    if (!preview || saving) return;
    if (
      storedRevision !== previewRevision
      || storedProfileIdentity !== previewProfileIdentity
      || draftBaseIsStale
    ) {
      setPreview(null);
      setPreviewRevision(null);
      setPreviewProfileIdentity(null);
      setError(EXTERNAL_PROFILE_CHANGE_MESSAGE);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = isDemo
        ? await updateJourney({
            progress: {
              ...progress,
              ...preview.progressPatch,
            } as Record<string, ProgressItem>,
          })
        : await (async () => {
            const response = await fetch("/api/journey", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expected_revision: previewRevision,
                progress_patch: preview.progressPatch,
              }),
            });
            const payload = await response.json().catch(() => null) as {
              status?: unknown;
              error?: unknown;
            } | null;
            if (!response.ok) {
              throw new Error(
                typeof payload?.error === "string"
                  ? payload.error
                  : "상황 설정을 저장하지 못했어요.",
              );
            }
            if (payload?.status !== "applied" && payload?.status !== "pending_partner") {
              throw new Error("저장 결과를 안전하게 확인하지 못했어요.");
            }
            if (payload.status === "applied") {
              await refreshJourney(user?.id);
            }
            return { status: payload.status } as const;
          })();
      setNotice(result.status === "pending_partner"
        ? "파트너에게 확인 요청을 보냈어요. 승인 전에는 현재 설정이 유지돼요."
        : "우리 상황 설정과 확인한 제외 항목을 함께 저장했어요.");
      if (result.status === "applied") {
        setPreview(null);
        setPreviewRevision(null);
        setPreviewProfileIdentity(null);
        setDraftDirty(false);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "상황 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-7 sm:px-6 sm:py-10">
      <Link {...weddingLinkProps("/checklist")} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#36534e] hover:underline hover:underline-offset-4">
        <ArrowLeft className="h-4 w-4" /> 체크리스트로 돌아가기
      </Link>

      <header className="mt-5 border-b border-[#ded6c8] pb-7">
        <p className="text-[11.5px] font-semibold tracking-[0.14em] text-[#9d6f36]">PERSONALIZE THE PLAN</p>
        <h1 className="mt-1.5 text-[30px] font-semibold text-[#172a27] sm:text-[36px]">우리 상황 설정</h1>
        <p className="mt-3 max-w-[700px] text-[14px] leading-7 text-[#53615c]">
          결혼 준비 방식만 간단히 알려주면 해당 없는 항목을 미리 찾아드려요. 바로 제외하지 않고, 바뀌는 내용을 먼저 보여드린 뒤 확인을 받아요.
        </p>
      </header>

      <div className="mt-5 flex gap-3 border border-[#e0d2bd] bg-[#fffaf0] px-4 py-3.5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#8f6331]" />
        <p className="text-[12.5px] leading-6 text-[#665a46]">
          민감한 건강 정보나 가족 사정의 상세 내용은 적지 마세요. ‘지원 필요 여부’처럼 체크리스트에 필요한 최소 선택만 저장합니다.
        </p>
      </div>

      <section aria-labelledby="profile-questions-heading" className="mt-5">
        <h2 id="profile-questions-heading" className="text-[20px] font-semibold text-[#243832]">우리에게 해당하는 준비</h2>
        <RadioGroup legend="예식 여부" name="ceremony" value={answers.ceremony} options={[{ value: "yes", label: "예식 있어요" }, { value: "no", label: "무예식이에요" }, { value: "undecided", label: "아직 미정" }]} onChange={(value) => updateAnswer("ceremony", value)} />
        <RadioGroup
          legend="축하 식사·모임"
          help="예식과 별개예요. 가장 큰 모임 기준으로 골라 주세요."
          name="gathering"
          value={answers.gathering}
          options={[
            { value: "none", label: "따로 없음" },
            { value: "family_meal", label: "가족 식사만" },
            { value: "reception", label: "하객 피로연·축하 모임" },
            { value: "undecided", label: "아직 미정" },
          ]}
          onChange={(value) => updateAnswer("gathering", value)}
        />
        <RadioGroup legend="법률혼 계획" name="legalMarriage" value={answers.legalMarriage} options={[{ value: "yes", label: "혼인신고 예정" }, { value: "no", label: "계획 없음" }, { value: "undecided", label: "아직 미정" }]} onChange={(value) => updateAnswer("legalMarriage", value)} />
        <RadioGroup legend="신혼여행 범위" name="travel" value={answers.travel} options={[{ value: "domestic", label: "국내" }, { value: "international", label: "해외" }, { value: "none", label: "여행 없음" }, { value: "undecided", label: "아직 미정" }]} onChange={(value) => updateAnswer("travel", value)} />
        <RadioGroup legend="주거 형태" name="housing" value={answers.housing} options={[{ value: "rent", label: "임차" }, { value: "buy", label: "매수" }, { value: "other", label: "기타·이미 마련" }, { value: "undecided", label: "아직 미정" }]} onChange={(value) => updateAnswer("housing", value)} />
        <BooleanGroup legend="국제혼인" name="internationalMarriage" value={answers.internationalMarriage} onChange={(value) => updateAnswer("internationalMarriage", value)} />
        <BooleanGroup legend="종교식" name="religiousCeremony" value={answers.religiousCeremony} onChange={(value) => updateAnswer("religiousCeremony", value)} />
        <BooleanGroup legend="재혼" name="remarriage" value={answers.remarriage} onChange={(value) => updateAnswer("remarriage", value)} />
        <BooleanGroup legend="자녀 동반" name="childrenParticipating" value={answers.childrenParticipating} onChange={(value) => updateAnswer("childrenParticipating", value)} />
        <BooleanGroup legend="접근성 지원" name="accessibilitySupport" value={answers.accessibilitySupport} onChange={(value) => updateAnswer("accessibilitySupport", value)} />
        <BooleanGroup legend="건강 지원" name="healthSupport" value={answers.healthSupport} onChange={(value) => updateAnswer("healthSupport", value)} />
        <BooleanGroup legend="반려동물 참여" name="petParticipation" value={answers.petParticipation} onChange={(value) => updateAnswer("petParticipation", value)} />
        <BooleanGroup legend="전통 의례" name="familyTradition" value={answers.familyTradition} onChange={(value) => updateAnswer("familyTradition", value)} />
      </section>

      <button type="button" onClick={buildPreview} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#36534e] px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541]">
        <Eye className="h-4 w-4" /> 변경 미리보기
      </button>

      {preview && (
        <section aria-labelledby="profile-preview-heading" className="mt-6 border-t border-[#ded6c8] pt-6">
          <h2 id="profile-preview-heading" className="text-[20px] font-semibold text-[#243832]">저장 전 확인</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#65706d]">아직 자동으로 저장되지 않았어요. 아래 내용을 확인한 뒤 저장해 주세요.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="border-l-2 border-[#b06b55] bg-[#fff8f4] px-4 py-3.5">
              <p className="text-[12px] font-semibold text-[#8c493e]">제외 예정</p>
              <strong className="mt-1 block text-[25px] text-[#5e352d]">{previewItems.excluded.length}개</strong>
              <p className="mt-1 text-[11.5px] leading-5 text-[#765b54]">명확히 해당 없다고 답한 항목만 ‘해당 없음’ 처리해요.</p>
              {previewItems.excluded.length > 0 && (
                <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto border-t border-[#ead7d0] pt-3">
                  {previewItems.excluded.map((item) => (
                    <li key={item.itemId} className="text-[12px] leading-5 text-[#5e443e]">
                      <strong className="font-semibold">{item.label}</strong>
                      <span className="ml-1.5 text-[11px] text-[#856f68]">{item.categoryLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-l-2 border-[#55716a] bg-[#f5f8f4] px-4 py-3.5">
              <p className="text-[12px] font-semibold text-[#36534e]">다시 포함 예정</p>
              <strong className="mt-1 block text-[25px] text-[#243832]">{previewItems.restored.length}개</strong>
              <p className="mt-1 text-[11.5px] leading-5 text-[#5d6864]">이전 설정 때문에 제외됐던 항목을 필요하면 복원해요.</p>
              {previewItems.restored.length > 0 && (
                <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto border-t border-[#d9e2dc] pt-3">
                  {previewItems.restored.map((item) => (
                    <li key={item.itemId} className="text-[12px] leading-5 text-[#3f5650]">
                      <strong className="font-semibold">{item.label}</strong>
                      <span className="ml-1.5 text-[11px] text-[#6b7a75]">{item.categoryLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="mt-4 flex gap-2 text-[12px] leading-5 text-[#7a625b]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />이미 직접 제외한 항목은 건드리지 않으며, 선택을 ‘미정’으로 두면 임의로 제외하지 않아요.</p>
          <button type="button" disabled={saving} onClick={() => void confirmSave()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#36534e] px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541] disabled:cursor-wait disabled:opacity-50">
            <Check className="h-4 w-4" /> {saving ? "저장 중" : "확인하고 저장"}
          </button>
        </section>
      )}

      {error && (
        <div className="mt-4 border border-[#e3bcbc] bg-[#fff7f6] px-4 py-3 text-[13px] text-[#8c3e3e]">
          <p id="profile-save-error" role="alert">{error}</p>
          {draftDirty && draftBaseIsStale && (
            <button
              type="button"
              aria-describedby="profile-save-error"
              onClick={reloadLatestProfile}
              className="mt-2 min-h-11 rounded-full border border-[#b97878] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#7b3434] hover:bg-[#fff1ef]"
            >
              최신 설정 다시 불러오기
            </button>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-4 min-h-6 text-[12.5px] leading-6 text-[#5d746d]">{notice}</p>
    </div>
  );
}
