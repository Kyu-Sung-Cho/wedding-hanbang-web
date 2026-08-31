"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import {
  BarChart3,
  Plus,
  X,
  Image as ImageIcon,
  Trash2,
  Loader2,
  CheckSquare,
  EyeOff,
  Eye,
  UserX,
  UserCheck,
  Clock,
} from "lucide-react";
import type { CreatePollInput } from "@/types/community.types";
import { uploadCommunityMedia } from "@/lib/community/uploadMedia";

interface PollEditorProps {
  value: CreatePollInput | null;
  onChange: (next: CreatePollInput | null) => void;
  mediaUploadsEnabled?: boolean;
}

interface DraftOption {
  label: string;
  image_url?: string | null;
}

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;
const QUESTION_MAX = 200;
const OPTION_MAX = 100;
const OPTION_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

const DEADLINE_PRESETS: Array<{ key: string; label: string; hours: number | null }> = [
  { key: "none", label: "마감 없음", hours: null },
  { key: "1d", label: "1일", hours: 24 },
  { key: "3d", label: "3일", hours: 24 * 3 },
  { key: "1w", label: "1주", hours: 24 * 7 },
];

export default function PollEditor({
  value,
  onChange,
  mediaUploadsEnabled = true,
}: PollEditorProps) {
  const enabled = value !== null;

  const [draftQuestion, setDraftQuestion] = useState(value?.question ?? "");
  const [draftOptions, setDraftOptions] = useState<DraftOption[]>(
    value?.options.length
      ? value.options.map((o) => ({ label: o.label, image_url: o.image_url ?? null }))
      : [
          { label: "", image_url: null },
          { label: "", image_url: null },
        ]
  );
  const [allowMultiple, setAllowMultiple] = useState<boolean>(value?.allow_multiple ?? false);
  const [isAnonymous, setIsAnonymous] = useState<boolean>(value?.is_anonymous ?? false);
  const [hideUntilVoted, setHideUntilVoted] = useState<boolean>(value?.hide_results_until_voted ?? false);
  const [deadlinePreset, setDeadlinePreset] = useState<string>(value?.closes_at ? "custom" : "none");

  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // 부모로 동기화
  const sync = useCallback(
    (next: {
      question: string;
      options: DraftOption[];
      allowMultiple: boolean;
      isAnonymous: boolean;
      hideUntilVoted: boolean;
      deadlinePreset: string;
    }) => {
      const validOptions = next.options
        .map((o) => ({
          label: o.label.trim(),
          image_url: mediaUploadsEnabled ? o.image_url || null : null,
        }))
        .filter((o) => o.label.length > 0);

      // 마감일 계산
      let closes_at: string | null = null;
      const preset = DEADLINE_PRESETS.find((p) => p.key === next.deadlinePreset);
      if (preset && preset.hours !== null) {
        const d = new Date();
        d.setHours(d.getHours() + preset.hours);
        closes_at = d.toISOString();
      }

      onChange({
        question: next.question.trim(),
        options: validOptions,
        allow_multiple: next.allowMultiple,
        is_anonymous: next.isAnonymous,
        hide_results_until_voted: next.hideUntilVoted,
        closes_at,
      });
    },
    [mediaUploadsEnabled, onChange]
  );

  const updateAndSync = useCallback(
    (patch: Partial<{
      question: string;
      options: DraftOption[];
      allowMultiple: boolean;
      isAnonymous: boolean;
      hideUntilVoted: boolean;
      deadlinePreset: string;
    }>) => {
      const merged = {
        question: patch.question ?? draftQuestion,
        options: patch.options ?? draftOptions,
        allowMultiple: patch.allowMultiple ?? allowMultiple,
        isAnonymous: patch.isAnonymous ?? isAnonymous,
        hideUntilVoted: patch.hideUntilVoted ?? hideUntilVoted,
        deadlinePreset: patch.deadlinePreset ?? deadlinePreset,
      };
      if (patch.question !== undefined) setDraftQuestion(patch.question);
      if (patch.options !== undefined) setDraftOptions(patch.options);
      if (patch.allowMultiple !== undefined) setAllowMultiple(patch.allowMultiple);
      if (patch.isAnonymous !== undefined) setIsAnonymous(patch.isAnonymous);
      if (patch.hideUntilVoted !== undefined) setHideUntilVoted(patch.hideUntilVoted);
      if (patch.deadlinePreset !== undefined) setDeadlinePreset(patch.deadlinePreset);
      sync(merged);
    },
    [draftQuestion, draftOptions, allowMultiple, isAnonymous, hideUntilVoted, deadlinePreset, sync]
  );

  const enable = () => {
    onChange({
      question: draftQuestion.trim(),
      options: draftOptions
        .map((o) => ({
          label: o.label.trim(),
          image_url: mediaUploadsEnabled ? o.image_url || null : null,
        }))
        .filter((o) => o.label.length > 0),
      allow_multiple: allowMultiple,
      is_anonymous: isAnonymous,
      hide_results_until_voted: hideUntilVoted,
      closes_at: null,
    });
  };

  const disable = () => {
    onChange(null);
  };

  const addOption = () => {
    if (draftOptions.length >= MAX_OPTIONS) return;
    updateAndSync({ options: [...draftOptions, { label: "", image_url: null }] });
  };

  const removeOption = (idx: number) => {
    if (draftOptions.length <= MIN_OPTIONS) return;
    updateAndSync({ options: draftOptions.filter((_, i) => i !== idx) });
  };

  const setOptionLabel = (idx: number, label: string) => {
    const next = draftOptions.slice();
    next[idx] = { ...next[idx], label: label.slice(0, OPTION_MAX) };
    updateAndSync({ options: next });
  };

  const setOptionImage = (idx: number, image_url: string | null) => {
    const next = draftOptions.slice();
    next[idx] = { ...next[idx], image_url };
    updateAndSync({ options: next });
  };

  const handleImageUpload = async (idx: number, file: File) => {
    if (!mediaUploadsEnabled) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > OPTION_IMAGE_MAX_SIZE) {
      setError("이미지는 5MB 이하여야 합니다.");
      return;
    }
    setUploadingIdx(idx);
    try {
      const data = await uploadCommunityMedia(file);
      setOptionImage(idx, data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploadingIdx(null);
    }
  };

  // ─────── UI ───────

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={enable}
        className="flex items-center gap-2 w-full px-4 py-3 text-base font-medium text-[var(--hb-text-body)] bg-white border border-dashed border-[var(--hb-hairline)] rounded-[6px] hover:border-[var(--hb-primary)] hover:text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-page)] transition-colors"
      >
        <BarChart3 className="w-5 h-5" />
        투표 추가하기
        <span className="ml-auto text-xs text-[var(--hb-text-muted)]">선택 사항</span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[var(--hb-text-strong)]" />
          <h3 className="text-[var(--hb-text-strong)]">투표</h3>
        </div>
        <button
          type="button"
          onClick={disable}
          className="flex items-center gap-1 px-2 py-1 text-sm text-[var(--hb-text-muted)] hover:text-red-500 hover:bg-red-50 rounded-[6px] transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          제거
        </button>
      </div>

      {/* 질문 */}
      <div>
        <label className="block text-sm font-medium text-[var(--hb-text-body)] mb-1.5">
          질문 <span className="text-[var(--hb-text-strong)]">*</span>
        </label>
        <input
          type="text"
          value={draftQuestion}
          onChange={(e) => updateAndSync({ question: e.target.value.slice(0, QUESTION_MAX) })}
          placeholder="예: 두 드레스 중 어떤 게 더 어울릴까요?"
          maxLength={QUESTION_MAX}
          className="w-full px-3 py-2.5 text-base text-[var(--hb-text-strong)] bg-[var(--hb-surface-hover)] border border-[var(--hb-hairline)] rounded-[6px] placeholder:text-[var(--hb-text-muted)] focus:outline-none focus:border-[var(--hb-primary)] focus:ring-1 focus:ring-[var(--hb-primary)]/30 transition-colors"
        />
        <p className="mt-1 text-xs text-right text-[var(--hb-text-muted)]">
          {draftQuestion.length} / {QUESTION_MAX}
        </p>
      </div>

      {/* 에러 */}
      {error && (
        <div className="px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-[6px]">
          {error}
        </div>
      )}

      {/* 옵션 리스트 */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--hb-text-body)]">
          선택지 <span className="text-[var(--hb-text-strong)]">*</span>
          <span className="ml-2 text-xs font-normal text-[var(--hb-text-muted)]">
            최소 2개, 최대 {MAX_OPTIONS}개
          </span>
        </label>

        {draftOptions.map((opt, idx) => (
          <div key={idx} className="flex items-stretch gap-2">
            {/* 이미지 미리보기 / 업로드 */}
            {mediaUploadsEnabled && (
            <div className="shrink-0 relative">
              {opt.image_url ? (
                <div className="relative w-14 h-14 rounded-[6px] overflow-hidden border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)]">
                  <Image
                    src={opt.image_url}
                    alt={`옵션 ${idx + 1}`}
                    fill
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setOptionImage(idx, null)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                    aria-label="이미지 삭제"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[idx]?.click()}
                  disabled={uploadingIdx !== null}
                  className="w-14 h-14 flex items-center justify-center rounded-[6px] border border-dashed border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] text-[var(--hb-text-muted)] hover:border-[var(--hb-primary)] hover:text-[var(--hb-text-strong)] hover:bg-white transition-colors disabled:opacity-50"
                  aria-label="이미지 추가"
                  title="이미지 추가 (선택)"
                >
                  {uploadingIdx === idx ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <ImageIcon className="w-5 h-5" />
                  )}
                </button>
              )}
              <input
                ref={(el) => {
                  fileInputRefs.current[idx] = el;
                }}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(idx, file);
                  e.target.value = "";
                }}
              />
            </div>
            )}

            {/* 텍스트 입력 */}
            <div className="flex-1 flex items-center bg-[var(--hb-surface-hover)] border border-[var(--hb-hairline)] rounded-[6px] overflow-hidden focus-within:border-[var(--hb-primary)] focus-within:ring-1 focus-within:ring-[var(--hb-primary)]/30 transition-colors">
              <span className="pl-3 pr-1 text-sm font-medium text-[var(--hb-text-muted)] tabular-nums">
                {idx + 1}.
              </span>
              <input
                type="text"
                value={opt.label}
                onChange={(e) => setOptionLabel(idx, e.target.value)}
                placeholder={
                  idx === 0
                    ? "예: 샘플 드레스 A (라운드넥)"
                    : idx === 1
                      ? "예: 샘플 드레스 B (브이넥)"
                      : `선택지 ${idx + 1}`
                }
                maxLength={OPTION_MAX}
                className="flex-1 px-2 py-2.5 text-base text-[var(--hb-text-strong)] bg-transparent placeholder:text-[var(--hb-text-muted)] focus:outline-none"
              />
            </div>

            {/* 삭제 버튼 */}
            <button
              type="button"
              onClick={() => removeOption(idx)}
              disabled={draftOptions.length <= MIN_OPTIONS}
              className="shrink-0 w-9 self-stretch flex items-center justify-center rounded-[6px] text-[var(--hb-text-muted)] hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="선택지 삭제"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* 옵션 추가 버튼 */}
        {draftOptions.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={addOption}
            className="flex items-center gap-2 w-full px-3 py-2.5 text-sm font-medium text-[var(--hb-text-strong)] bg-white border border-dashed border-[var(--hb-hairline)] rounded-[6px] hover:border-[var(--hb-primary)] hover:bg-[var(--hb-surface-page)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            선택지 추가
          </button>
        )}
      </div>

      {/* 옵션 토글들 */}
      <div className="pt-2 border-t border-[#f0eeec] space-y-2">
        <PollOptionToggle
          icon={CheckSquare}
          label="다중 선택 허용"
          description="여러 개 동시에 고를 수 있어요"
          checked={allowMultiple}
          onChange={(v) => updateAndSync({ allowMultiple: v })}
        />
        <PollOptionToggle
          icon={isAnonymous ? UserX : UserCheck}
          label="익명 투표"
          description="누가 어떤 옵션을 골랐는지 보이지 않아요"
          checked={isAnonymous}
          onChange={(v) => updateAndSync({ isAnonymous: v })}
        />
        <PollOptionToggle
          icon={hideUntilVoted ? EyeOff : Eye}
          label="투표 전 결과 가리기"
          description="투표하기 전에는 결과가 보이지 않아 편향을 줄여요"
          checked={hideUntilVoted}
          onChange={(v) => updateAndSync({ hideUntilVoted: v })}
        />
      </div>

      {/* 마감일 */}
      <div className="pt-2 border-t border-[#f0eeec]">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--hb-text-body)] mb-2">
          <Clock className="w-4 h-4 text-[var(--hb-text-strong)]" />
          마감 시간
        </label>
        <div className="flex flex-wrap gap-2">
          {DEADLINE_PRESETS.map((preset) => {
            const isSelected = deadlinePreset === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => updateAndSync({ deadlinePreset: preset.key })}
                className={`px-3 py-1.5 text-sm font-medium rounded-[6px] border transition-all ${
                  isSelected
                    ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
                    : "border-[var(--hb-hairline)] bg-white text-[var(--hb-text-body)] hover:border-[var(--hb-primary)]"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────── 토글 보조 컴포넌트 ──────────

interface PollOptionToggleProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function PollOptionToggle({ icon: Icon, label, description, checked, onChange }: PollOptionToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 w-full px-3 py-2.5 text-left bg-white border border-[#f0eeec] rounded-[6px] hover:border-[var(--hb-primary)] transition-colors"
    >
      <div
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-[6px] transition-colors ${
          checked ? "bg-[var(--hb-primary)] text-white" : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-muted)]"
        }`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--hb-text-strong)]">{label}</p>
        <p className="text-xs text-[var(--hb-text-muted)] mt-0.5">{description}</p>
      </div>
      <div
        className={`shrink-0 w-9 h-5 rounded-full p-0.5 transition-colors ${
          checked ? "bg-[var(--hb-primary)]" : "bg-[#e5d8ca]"
        }`}
      >
        <div
          className={`w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </div>
    </button>
  );
}
