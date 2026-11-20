"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

import Button from "@/components/ui/Button";

/**
 * 아모라 앱 알림(결정 D-86)의 웹 줄. 알림은 폰으로만 가므로 켜기는 앱에서 한다(기기 등록이 필요하다).
 * 웹에서는 지금 상태를 보여 주고, 켜 둔 사람은 여기서도 끌 수 있다. 서버가 보낼 수 없고 켜 둔 적도 없으면
 * 아무것도 그리지 않는다(켜도 오지 않는 알림을 약속하지 않는다). 문장은 파운더가 정한다(18장 D-12).
 */

export const AMORA_PUSH_ROW_COPY = {
  title: "아모라 앱 알림",
  off: "아모라가 정리한 게 있을 때 폰으로 알려 드려요. 켜기는 웨딩한방 앱의 설정에서 해요.",
  on: "켜져 있어요. 하루 두 번까지, 오전 9시부터 오후 8시 전까지만 가요.",
  turnOff: "끄기",
  saveError: "설정을 저장하지 못했어요. 기존 설정은 그대로예요.",
} as const;

type Payload = { available: boolean; enabled: boolean; consentedAt: string | null };

function parse(value: unknown): Payload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.available !== "boolean" || typeof record.enabled !== "boolean") return null;
  if (!(record.consentedAt === null || typeof record.consentedAt === "string")) return null;
  return { available: record.available, enabled: record.enabled, consentedAt: record.consentedAt as string | null };
}

export default function AmoraPushPreferenceRow() {
  const [state, setState] = useState<Payload | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/amora/push-preference", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => (response.ok ? parse(await response.json()) : null))
      .catch(() => null)
      .then((payload) => { if (active) setState(payload); });
    return () => { active = false; };
  }, []);

  async function turnOff() {
    if (!state?.enabled || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/amora/push-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      const payload = response.ok ? parse(await response.json()) : null;
      if (!payload || payload.enabled) throw new Error("save failed");
      setState(payload);
    } catch {
      setError(AMORA_PUSH_ROW_COPY.saveError);
    } finally {
      setSaving(false);
    }
  }

  if (!state || (!state.available && !state.enabled)) return null;
  return (
    <div className="flex items-start gap-3 py-4" data-amora-push-row>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--hb-surface-hover)]">
        <BellRing className="h-4 w-4 text-[var(--hb-text-strong)]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{AMORA_PUSH_ROW_COPY.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-[var(--hb-text-muted)]">
          {state.enabled ? AMORA_PUSH_ROW_COPY.on : AMORA_PUSH_ROW_COPY.off}
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-[#A04A4A]">{error}</p> : null}
      </div>
      {state.enabled ? (
        <Button variant="outline" size="sm" onClick={() => void turnOff()} disabled={saving}>
          {AMORA_PUSH_ROW_COPY.turnOff}
        </Button>
      ) : null}
    </div>
  );
}
