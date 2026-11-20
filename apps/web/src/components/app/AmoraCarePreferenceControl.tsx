"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Mail, RotateCcw } from "lucide-react";
import AmoraAvatar from "@/components/ui/AmoraAvatar";
import Button from "@/components/ui/Button";

import {
  fetchCarePreference,
  saveCarePreference,
} from "@/lib/care/carePreferenceClient";
import {
  CARE_WINDOW_MAX_HOUR,
  CARE_WINDOW_MIN_HOUR,
  describeCoupleCadence,
  formatCareHour,
  type CareIntensity,
  type CarePreferencePayload,
  type CarePreferenceUpdate,
} from "@/lib/care/carePreferences";

// 10장 P2 강도. 덜은 전날 확인만, 보통은 하루 한 건, 더는 하루 세 건까지(DB 가 같은 규칙으로 센다).
const INTENSITY_OPTIONS: ReadonlyArray<{ value: CareIntensity; label: string; hint: string }> = [
  { value: "light", label: "덜", hint: "전날 확인만" },
  { value: "normal", label: "보통", hint: "하루 한 건" },
  { value: "more", label: "더", hint: "하루 세 건까지" },
];

function hourOptions(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

// 10장 P1 "아모라가 먼저 알려 주기". 문장은 파운더가 읽고 정한다(18장 D-12).
// 켤 수 있는 경로가 하나도 없으면 아무것도 그리지 않는다. 그때 예전 동의를 거두는 일은
// 설정 화면의 "이전 이메일 수신 동의" 칸이 맡는다(onAvailabilityChange 로 알려 준다).

type View =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "ready"; preference: CarePreferencePayload }
  | { kind: "error"; message: string };

type Props = {
  onAvailabilityChange?: (available: boolean) => void;
};

function partnerLine(preference: CarePreferencePayload): string | null {
  const { chat, partner } = preference;
  if (!partner.connected) {
    return chat.enabled
      ? "혼자 쓰는 동안은 바로 와요. 상대가 연결되면 상대도 켜야 계속 와요."
      : null;
  }
  if (chat.enabled) {
    return partner.chatEnabled ? "두 분 모두 켜 두셨어요." : "상대가 켜면 그날부터 와요.";
  }
  return partner.chatEnabled ? "상대는 켜 두셨어요." : null;
}

function emailDescription(preference: CarePreferencePayload): string {
  if (!preference.email.verified || !preference.email.maskedAddress) {
    return "가입 메일 확인을 마치면 켤 수 있어요.";
  }
  if (!preference.chat.enabled) {
    return "함께 대화 알림을 켜면 고를 수 있어요.";
  }
  return `가입 메일 ${preference.email.maskedAddress}으로 같은 글을 하루 한 통까지 보내요.`;
}

// 켜고 끄는 칸은 버튼이 아니라 입력이라 브라우저 기본 체크박스(role="switch")로 그린다.
// 손으로 만든 버튼 태그는 늘리지 않는다(rawButtonRatchet.test.ts 는 주석 속 태그도 센다). 보이는 크기는 48×28 이고,
// 손가락이 닿는 영역은 .tap-area 가 44px 로 넓힌다(globals.css).
function Switch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <label className="tap-area relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--hb-primary)] ${
          checked ? "bg-[var(--hb-primary)]" : "bg-paper-outline"
        }`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </label>
  );
}

export default function AmoraCarePreferenceControl({ onAvailabilityChange }: Props) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const intensityGroupName = useId();

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchCarePreference>>) => {
    if (!result.ok) {
      setView({ kind: "error", message: result.message });
      onAvailabilityChange?.(false);
      return;
    }
    // 켤 수 있는 경로가 없으면 그리지 않는다(오늘 재현할 수 없는 기능을 보여 주지 않는다).
    // 예전에 켜 둔 사람의 끄기는 설정 화면의 "이전 이메일 수신 동의" 칸이 계속 맡는다.
    if (!result.preference.available) {
      setView({ kind: "hidden" });
      onAvailabilityChange?.(false);
      return;
    }
    setView({ kind: "ready", preference: result.preference });
    onAvailabilityChange?.(true);
  }, [onAvailabilityChange]);

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    setError("");
    apply(await fetchCarePreference());
  }, [apply]);

  useEffect(() => {
    let active = true;
    void fetchCarePreference().then((result) => {
      if (active) apply(result);
    });
    return () => {
      active = false;
    };
  }, [apply]);

  async function update(change: CarePreferenceUpdate) {
    if (view.kind !== "ready" || saving) return;
    setSaving(true);
    setError("");
    const result = await saveCarePreference(change);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setView({ kind: "ready", preference: result.preference });
  }

  if (view.kind === "hidden") return null;
  if (view.kind === "loading") {
    return <p role="status" className="sr-only">아모라 알림 설정 확인 중</p>;
  }
  if (view.kind === "error") {
    return (
      <div className="mt-5 border-t border-[#E8E0D8] px-5 pt-5">
        <p role="alert" className="text-sm text-[#A04A4A]">{view.message}</p>
        <Button variant="secondary" size="sm" onClick={() => void load()} className="mt-2">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          다시 불러오기
        </Button>
      </div>
    );
  }

  const { preference } = view;
  const partner = partnerLine(preference);
  const emailSelectable = preference.emailAvailable
    && preference.chat.enabled
    && preference.email.verified;

  return (
    <section
      aria-labelledby="amora-care-preference-title"
      data-testid="amora-care-preference"
      className="mt-5 border-t border-[#E8E0D8] px-5 pt-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <AmoraAvatar sizeClassName="size-10" />
          <div className="min-w-0">
            {/* 크기·굵기는 globals.css 의 테마 제목 블록이 정한다(themedHeadingsHaveNoDeadTypeClasses.test.ts). */}
            <h4
              id="amora-care-preference-title"
              className="text-[var(--hb-text-strong)]"
            >
              아모라가 먼저 알려 주기
            </h4>
            <p className="mt-1 text-sm font-light leading-6 text-[var(--hb-success)]">
              상견례, 식장 방문, 촬영처럼 일정에 넣은 날과 결혼식 앞뒤에 아모라가 함께 대화에 먼저 글을 남겨요.
            </p>
            <p className="mt-1 text-sm font-light leading-6 text-[var(--hb-text-muted)]">
              두 분이 모두 켜야 와요. 한 분이 끄면 두 분 모두에게 멈춰요.
            </p>
            {partner && (
              <p data-testid="amora-care-partner-state" className="mt-1 text-sm font-medium leading-6 text-[var(--hb-text-strong)]">
                {partner}
              </p>
            )}
          </div>
        </div>
        <Switch
          checked={preference.chat.enabled}
          disabled={saving}
          label="아모라가 함께 대화에 먼저 글 남기기"
          onToggle={() => void update({ chat: !preference.chat.enabled })}
        />
      </div>

      {preference.emailAvailable && (
        <div className="mt-4 flex items-start justify-between gap-4 pl-[52px]">
          <div className="flex min-w-0 items-start gap-2">
            <Mail className="mt-1 h-4 w-4 shrink-0 text-[var(--hb-text-muted)]" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-[var(--hb-text-strong)]">같은 글을 메일로도 받기</p>
              <p className="mt-0.5 break-words text-sm font-light leading-6 text-[var(--hb-text-muted)]">
                {emailDescription(preference)}
              </p>
            </div>
          </div>
          <Switch
            checked={preference.email.enabled}
            disabled={saving || (!preference.email.enabled && !emailSelectable)}
            label="같은 글을 메일로도 받기"
            onToggle={() => void update({ email: !preference.email.enabled })}
          />
        </div>
      )}

      {preference.chat.enabled && (
        <div className="mt-4 space-y-4 pl-[52px]" data-testid="amora-care-cadence">
          <fieldset>
            <legend className="text-[15px] font-medium text-[var(--hb-text-strong)]">얼마나 자주</legend>
            {/* 기본 라디오라 방향키로 고를 수 있다. 바뀐 값만 onChange 로 들어온다. */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {INTENSITY_OPTIONS.map((option) => {
                const selected = preference.cadence.intensity === option.value;
                return (
                  <label
                    key={option.value}
                    className={`relative flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[6px] border px-2 py-1.5 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--hb-primary)] has-[:disabled]:cursor-wait has-[:disabled]:opacity-60 ${
                      selected
                        ? "border-[var(--hb-primary)] bg-[var(--hb-surface-hover)] text-[var(--hb-text-strong)]"
                        : "border-[#E2D3C8] bg-white text-[var(--hb-text-muted)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name={intensityGroupName}
                      value={option.value}
                      checked={selected}
                      disabled={saving}
                      onChange={() => void update({ intensity: option.value })}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="block text-xs">{option.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-[15px] font-medium text-[var(--hb-text-strong)]">받는 시간</legend>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--hb-text-strong)]">
              <select
                aria-label="받기 시작하는 시각"
                value={preference.cadence.windowStartHour}
                disabled={saving}
                onChange={(event) => void update({ windowStartHour: Number(event.target.value) })}
                className="min-h-10 rounded-[6px] border border-[#E2D3C8] bg-white px-2"
              >
                {hourOptions(CARE_WINDOW_MIN_HOUR, preference.cadence.windowEndHour - 1).map((hour) => (
                  <option key={hour} value={hour}>{formatCareHour(hour)}</option>
                ))}
              </select>
              <span>부터</span>
              <select
                aria-label="받기를 멈추는 시각"
                value={preference.cadence.windowEndHour}
                disabled={saving}
                onChange={(event) => void update({ windowEndHour: Number(event.target.value) })}
                className="min-h-10 rounded-[6px] border border-[#E2D3C8] bg-white px-2"
              >
                {hourOptions(preference.cadence.windowStartHour + 1, CARE_WINDOW_MAX_HOUR).map((hour) => (
                  <option key={hour} value={hour}>{formatCareHour(hour)}</option>
                ))}
              </select>
              <span>전까지</span>
            </div>
          </fieldset>
          <p data-testid="amora-care-couple-cadence" className="text-sm leading-6 text-[var(--hb-text-strong)]">
            {describeCoupleCadence(preference.couple)}
          </p>
        </div>
      )}

      {preference.chat.enabled && (
        <p className="mt-3 pl-[52px] text-xs leading-5 text-[var(--hb-text-muted)]">
          끄면 오늘 보내려던 글도 보내지 않아요.
        </p>
      )}
      {saving && (
        <p role="status" className="mt-2 pl-[52px] text-xs text-[var(--hb-success)]">
          저장하는 중이에요.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 pl-[52px] text-sm text-[#A04A4A]">{error}</p>
      )}
    </section>
  );
}
