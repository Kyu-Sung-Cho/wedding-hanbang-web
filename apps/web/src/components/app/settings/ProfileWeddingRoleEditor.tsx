"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { CHAT_BUBBLE_TONES } from "@/components/app/chat/chatBubbleStyles";

type Role = "bride" | "groom" | null;
const options = [
  { value: "groom", label: "신랑", tone: "sky" },
  { value: "bride", label: "신부", tone: "rose" },
  { value: null, label: "미선택", tone: "neutral" },
] as const;

function isRevision(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}
function parseRole(value: unknown, ownerId: string): { confirmed_role: Role; revision: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  return data.user_id === ownerId && (data.confirmed_role === null || data.confirmed_role === "bride" || data.confirmed_role === "groom")
    && isRevision(data.revision) && (data.confirmed_role === null || data.revision !== null)
    ? { confirmed_role: data.confirmed_role, revision: data.revision } : null;
}

function RoleChoices({ ownerId, coupleId, isDemo, initialRole }: { ownerId: string; coupleId: string | null; isDemo: boolean; initialRole: Role }) {
  const [baseline, setBaseline] = useState<Role>(initialRole);
  const [baselineRevision, setBaselineRevision] = useState<string | null>(null);
  const [selection, setSelection] = useState<Role>(initialRole);
  const [ready, setReady] = useState(isDemo);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const active = useRef(false);
  const inFlight = useRef(false);
  const bindingEpoch = useRef(0);
  const owns = useCallback(() => {
    const current = useAuthStore.getState();
    return active.current && current.isDemo === isDemo && current.profile?.id === ownerId
      && (current.profile.couple_id ?? null) === coupleId && (isDemo || current.user?.id === ownerId);
  }, [ownerId, coupleId, isDemo]);

  useEffect(() => {
    active.current = true;
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.user?.id !== previous.user?.id || state.profile?.id !== previous.profile?.id
        || state.profile?.couple_id !== previous.profile?.couple_id || state.isDemo !== previous.isDemo) bindingEpoch.current += 1;
    });
    return () => { active.current = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const epoch = bindingEpoch.current;
    const roleAtRead = useAuthStore.getState().profile?.confirmed_role;
    const revisionAtRead = useAuthStore.getState().profile?.confirmed_role_revision;
    fetch("/api/profile/wedding-role", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = parseRole(await response.json().catch(() => null), ownerId);
        if (cancelled || controller.signal.aborted || !owns() || epoch !== bindingEpoch.current) return;
        if (!response.ok || !data) throw new Error("unavailable");
        const current = useAuthStore.getState();
        if (current.profile?.confirmed_role_revision !== revisionAtRead || current.profile?.confirmed_role !== roleAtRead) {
          // 대기 중 다른 저장이 완료됐다면 오래된 GET을 초안의 기준으로 삼지 않는다.
          setReady(false); setRetry(value => value + 1); return;
        }
        if (current.profile?.id === ownerId) useAuthStore.setState({ profile: { ...current.profile, confirmed_role: data.confirmed_role, confirmed_role_revision: data.revision } });
        setBaseline(data.confirmed_role); setBaselineRevision(data.revision); setSelection(data.confirmed_role); setReady(true); setError("");
      })
      .catch(() => { if (!cancelled && active.current && epoch === bindingEpoch.current) setError("역할을 불러오지 못했어요. 다시 불러와 주세요."); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [ownerId, isDemo, retry, owns]);

  async function save() {
    if (inFlight.current || !ready || !owns() || selection === baseline) return;
    const epoch = bindingEpoch.current;
    const revisionAtSave = useAuthStore.getState().profile?.confirmed_role_revision;
    inFlight.current = true; setSaving(true); setSaved(false); setError("");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      let savedRevision: string | null = null;
      if (!isDemo) {
        const response = await fetch("/api/profile/wedding-role", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed_role: selection, expected_revision: baselineRevision, expected_user_id: ownerId }), signal: controller.signal });
        const data = parseRole(await response.json().catch(() => null), ownerId);
        if (controller.signal.aborted || !response.ok || !data || data.confirmed_role !== selection || data.revision === null || data.revision === baselineRevision) throw new Error("unconfirmed");
        savedRevision = data.revision;
      }
      if (!owns() || epoch !== bindingEpoch.current) return;
      const latest = useAuthStore.getState().profile;
      if (latest?.confirmed_role_revision !== revisionAtSave && latest?.confirmed_role_revision !== savedRevision) throw new Error("newer-choice");
      useAuthStore.setState(current => current.profile?.id === ownerId ? { profile: { ...current.profile, confirmed_role: selection, confirmed_role_revision: savedRevision } } : {});
      setBaseline(selection); setBaselineRevision(savedRevision); setSaved(true);
    } catch {
      if (owns() && epoch === bindingEpoch.current) { setReady(false); setError("역할 저장 결과를 확인하지 못했어요. 다시 불러온 뒤 시도해 주세요."); }
    } finally { clearTimeout(timer); inFlight.current = false; if (active.current) setSaving(false); }
  }

  return <section className="mt-5 border-t border-[var(--hb-hairline)] pt-5" aria-label="나의 역할">
    <h3 className="text-sm font-semibold text-[var(--hb-text-strong)]">나의 역할</h3>
    <p className="mt-1 text-xs leading-5 text-[var(--hb-text-muted)]">신랑은 하늘색, 신부는 핑크색 말풍선으로 보여요. 나와 연결된 상대에게 같은 색으로 표시돼요.</p>
    {!ready && !error && <p role="status" className="mt-3 text-sm text-[var(--hb-text-muted)]">역할을 불러오는 중이에요.</p>}
    {ready && <>
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="나의 역할 선택">
        {options.map(option => <button key={option.label} type="button" aria-pressed={selection === option.value} disabled={saving}
          className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 disabled:opacity-60 ${selection === option.value ? CHAT_BUBBLE_TONES[option.tone] : "border-[var(--hb-hairline)] bg-white text-[var(--hb-text-body)]"}`}
          onClick={() => { setSelection(option.value); setSaved(false); setError(""); }}>{selection === option.value && <Check size={15} aria-hidden="true" />}{option.label}</button>)}
      </div>
      {selection !== baseline && <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={saving} className="min-h-11 rounded-lg px-4 text-sm text-[var(--hb-text-muted)]" onClick={() => { setSelection(baseline); setError(""); }}>취소</button>
        <button type="button" disabled={saving} className="min-h-11 rounded-lg bg-[var(--hb-accent)] px-4 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void save()}>{saving ? "저장 중…" : "역할 저장"}</button>
      </div>}
    </>}
    {error && <div className="mt-3"><p role="alert" className="text-sm leading-6 text-[var(--hb-text-body)]">{error}</p><button type="button" disabled={saving} className="min-h-11 text-sm font-medium underline underline-offset-4" onClick={() => { setReady(false); setError(""); setRetry(value => value + 1); }}>역할 다시 불러오기</button></div>}
    {saved && <p role="status" className="mt-3 text-sm text-[var(--hb-success)]">{isDemo ? "체험 화면에 적용했어요." : "역할을 저장했어요."}</p>}
  </section>;
}

export default function ProfileWeddingRoleEditor() {
  const { user, profile, isDemo } = useAuthStore();
  if (!profile || (!isDemo && user?.id !== profile.id)) return null;
  return <RoleChoices key={`${isDemo}:${user?.id}:${profile.id}:${profile.couple_id}`} ownerId={profile.id}
    coupleId={profile.couple_id} isDemo={isDemo} initialRole={profile.confirmed_role ?? null} />;
}
