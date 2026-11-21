"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import Button from "@/components/ui/Button";

import {
  fetchCarePreference,
  saveCarePreference,
} from "@/lib/care/carePreferenceClient";
import {
  shouldAskCareConsentInLounge,
  type CarePreferencePayload,
} from "@/lib/care/carePreferences";

// 10장 P1의 "한 번 묻기". 2026-11-13 파운더 결정: 첫 일정이 생긴 뒤 라운지에서 한 번,
// 거절하면 다시 묻지 않는다. 답은 서버(`care_prompt_answered_at`)에 남아 기기가 바뀌어도 같다.
// 문장은 파운더가 읽고 정한다(18장 D-12).

type View =
  | { kind: "idle" }
  | { kind: "asking"; preference: CarePreferencePayload }
  | { kind: "turnedOn"; preference: CarePreferencePayload };

function turnedOnLine(preference: CarePreferencePayload): string {
  if (preference.partner.connected && !preference.partner.chatEnabled) {
    return "켜 두었어요. 상대도 켜면 그날부터 와요.";
  }
  return "켜 두었어요. 설정에서 언제든 끌 수 있어요.";
}

export default function AmoraCareConsentPrompt({
  plannedScheduleCount,
}: {
  plannedScheduleCount: number;
}) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // 일정이 하나도 없으면 물을 이유가 없어서 서버에도 묻지 않는다.
    if (plannedScheduleCount <= 0) return;
    let active = true;
    void fetchCarePreference().then((result) => {
      if (!active || !result.ok) return;
      if (shouldAskCareConsentInLounge({ preference: result.preference, plannedScheduleCount })) {
        setView({ kind: "asking", preference: result.preference });
      }
    });
    return () => {
      active = false;
    };
  }, [plannedScheduleCount]);

  async function answer(turnOn: boolean) {
    if (view.kind !== "asking" || saving) return;
    setSaving(true);
    setError("");
    const result = await saveCarePreference(turnOn ? { chat: true } : { promptAnswered: true });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setView(turnOn ? { kind: "turnedOn", preference: result.preference } : { kind: "idle" });
  }

  if (view.kind === "idle") return null;
  if (view.kind === "turnedOn") {
    return (
      <p
        role="status"
        data-testid="amora-care-consent-prompt-done"
        className="rounded-2xl border border-[var(--amora-line)] bg-white px-5 py-4 text-[13px] font-medium leading-6 text-[var(--amora-soft)]"
      >
        {turnedOnLine(view.preference)}
      </p>
    );
  }

  return (
    <section
      data-testid="amora-care-consent-prompt"
      aria-labelledby="amora-care-consent-prompt-title"
      className="rounded-2xl border border-[var(--amora-sage)] bg-[var(--amora-sage-pale)] p-5 md:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[var(--amora-ink)]">
          <BellRing className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--amora-soft)]">
            <AmoraMark size={12} aria-hidden="true" />
            아모라가 먼저 알려 주기
          </p>
          <h2
            id="amora-care-consent-prompt-title"
            className="mt-1 amora-display text-[17px] text-[var(--amora-ink)]"
          >
            일정 전날, 아모라가 먼저 알려 드릴까요?
          </h2>
          <p className="mt-2 text-[13px] font-medium leading-6 text-[var(--amora-soft)]">
            상견례, 식장 방문, 촬영처럼 일정에 넣은 날이 다가오면 함께 대화에 먼저 글을 남겨요. 두 분이 모두 켜야 오고, 설정에서 언제든 끌 수 있어요.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="primary" disabled={saving} onClick={() => void answer(true)} className="w-full sm:w-auto">
          켜기
        </Button>
        <Button variant="ghost" disabled={saving} onClick={() => void answer(false)} className="w-full sm:w-auto">
          괜찮아요
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[#A04A4A]">{error}</p>
      )}
    </section>
  );
}
