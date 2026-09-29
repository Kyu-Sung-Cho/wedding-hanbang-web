"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { providerOfferingSchema, type ProviderOffering } from "@/lib/providers/contracts";
import { providerFailure, providerJson, providerRequest } from "./providerClient";

export default function ProviderOfferingWithdrawal({ offering, onChanged }: { offering: ProviderOffering; onChanged: (message: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function withdraw() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = providerOfferingSchema.parse(await providerRequest(`/api/provider/profiles/${offering.provider_id}/offerings/${offering.id}`, providerJson("PATCH", { action: "withdraw", expected_version: offering.version })));
      if (result.id !== offering.id || result.provider_id !== offering.provider_id || result.is_active) throw new Error("Withdrawal not confirmed");
      await onChanged("이 서비스의 제공을 중단했어요. 공개·추천에서 제외하고 제출 기록은 보관합니다.");
      setConfirming(false);
    } catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!offering.is_active) return null;
  return <div className="mt-3">
    {confirming ? <div className="space-y-3 rounded-md border border-[var(--hb-hairline)] p-4">
      <p className="text-sm leading-7"><strong>{offering.name}</strong> 서비스 제공을 중단할까요? 공개·추천에서 제외하며 제출 기록은 보관합니다. 다시 제공하려면 수정 후 재검토를 요청해야 합니다. 다른 서비스와 프로필은 유지됩니다.</p>
      <div className="flex flex-wrap gap-3"><Button size="sm" loading={busy} onClick={() => void withdraw()}>서비스 제공 중단 확인</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setConfirming(false); setError(""); }}>계속 제공</Button></div>
    </div> : <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>이 서비스 제공 중단</Button>}
    {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
  </div>;
}
