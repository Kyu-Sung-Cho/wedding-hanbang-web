"use client";

import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import Button from "@/components/ui/Button";
import {
  PROVIDER_CATEGORIES, PROVIDER_CATEGORY_LABELS, PROVIDER_KINDS, PROVIDER_KIND_LABELS,
  type ProviderApplication, type ProviderCategory, type ProviderKind,
} from "@/lib/providers/contracts";

import { providerFailure, providerJson, providerRequest } from "./providerClient";
import { providerFocus, providerInput, providerLabel } from "./ProviderShell";

const submissionSchema = z.object({ provider_id: z.string().uuid(), application_id: z.string().uuid(), status: z.string() });
type Props = { application?: ProviderApplication; onSubmitted?: () => Promise<void> };

export default function ProviderApplicationForm({ application, onSubmitted }: Props) {
  const [kind, setKind] = useState<ProviderKind>(application?.kind ?? "individual");
  const [name, setName] = useState(application?.name ?? "");
  const [categories, setCategories] = useState<string[]>(application?.categories ?? []);
  const [regions, setRegions] = useState(application?.regions.join(", ") ?? "");
  const [contactName, setContactName] = useState(application?.contact_name ?? "");
  const [note, setNote] = useState(application?.application_note ?? "");
  const [consents, setConsents] = useState({ privacy: false, price_transparency: false, extra_charges: false, standard_terms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);

  function toggleCategory(category: ProviderCategory) {
    setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (categories.length === 0) { setError("제공할 웨딩 서비스 분야를 하나 이상 선택해 주세요."); return; }
    if (!Object.values(consents).every(Boolean)) { setError("필수 안내와 공개 기준을 모두 확인해 주세요."); return; }
    const input = {
      kind, name: name.trim(), categories, regions: regions.split(",").map((region) => region.trim()).filter(Boolean),
      contact_name: contactName.trim(), application_note: note.trim(), consents: { ...consents, version: "2026-09-28" },
    };
    if (!input.name || !input.contact_name || input.regions.length === 0) { setError("활동명, 활동 지역, 담당자 이름을 입력해 주세요."); return; }
    if (input.regions.length > 20 || input.regions.some((region) => region.length > 80)) { setError("활동 지역은 각 80자 이내로, 최대 20개까지 입력해 주세요."); return; }
    const payload = JSON.stringify(input);
    if (!request.current || request.current.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await providerRequest(application ? `/api/provider/applications/${application.id}` : "/api/provider/applications", providerJson(application ? "PATCH" : "POST", application ? { ...input, expected_version: application.version } : { ...input, request_id: request.current.id }));
      if (!submissionSchema.safeParse(response).success) throw new Error("INVALID_SUBMISSION_RESULT");
      setSubmitted(true);
      if (onSubmitted) await onSubmitted();
    } catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (submitted) return (
    <div role="status" className="rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-6">
      <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">참여 신청이 접수됐어요</h2>
      <p className="mt-3 text-sm leading-7">제공자 센터에서 심사 상태와 보완 요청을 확인할 수 있어요. 아직 공개되거나 추천되지는 않습니다.</p>
      <Button href="/provider" variant="primary" className="mt-5">제공자 센터에서 확인하기</Button>
      {error ? <p role="alert" className="mt-3 text-sm">접수는 완료됐지만 최신 상태를 불러오지 못했어요. 센터를 다시 열어 주세요.</p> : null}
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-6">
      <fieldset disabled={busy} className="space-y-6 disabled:opacity-70">
        <fieldset><legend className={providerLabel}>활동 형태</legend><div className="flex flex-wrap gap-3">{PROVIDER_KINDS.map((value) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm ${kind === value ? "border-[var(--hb-action)] bg-rose-pale" : "border-[var(--hb-hairline)] bg-white"}`}><input type="radio" name="provider-kind" checked={kind === value} onChange={() => setKind(value)} className={providerFocus} />{PROVIDER_KIND_LABELS[value]}</label>)}</div><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">활동 형태와 사업자 등록 여부는 별도입니다. 개인·팀·업체에 같은 공개 기준을 적용해요.</p></fieldset>
        <div><label className={providerLabel} htmlFor="provider-name">활동명 또는 업체명</label><input id="provider-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required className={providerInput} /></div>
        <fieldset><legend className={providerLabel}>웨딩 서비스 분야 <span className="font-normal">(복수 선택)</span></legend><div className="flex flex-wrap gap-2">{PROVIDER_CATEGORIES.map((value) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${categories.includes(value) ? "border-[var(--hb-action)] bg-rose-pale" : "border-[var(--hb-hairline)] bg-white"}`}><input type="checkbox" checked={categories.includes(value)} onChange={() => toggleCategory(value)} className={providerFocus} />{PROVIDER_CATEGORY_LABELS[value]}</label>)}</div><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">웨딩홀·레스토랑·갤러리 대관은 예식·행사 장소를 선택해 주세요. 미지원 분야는 문의 접수만 가능하며 공개 일정은 미정입니다.</p></fieldset>
        <div><label className={providerLabel} htmlFor="provider-regions">활동 지역</label><input id="provider-regions" value={regions} onChange={(event) => setRegions(event.target.value)} maxLength={300} placeholder="예: 서울, 경기" required className={providerInput} /><p className="mt-2 text-xs text-[var(--hb-text-muted)]">여러 지역은 쉼표로 구분해 주세요. 상세 주소는 입력하지 않아도 됩니다.</p></div>
        <div><label className={providerLabel} htmlFor="provider-contact">담당자 이름</label><input id="provider-contact" value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={80} required className={providerInput} /><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">연락에는 확인된 계정 이메일을 사용합니다. 담당자 이름과 이메일은 공개 프로필에 표시하지 않아요.</p></div>
        <div><label className={providerLabel} htmlFor="provider-note">활동 소개와 참여 내용</label><textarea id="provider-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={5} placeholder="제공하는 서비스와 활동 이력을 알려주세요. 소개 링크가 있으면 함께 적어주세요." required className={providerInput} /><p className="mt-2 text-xs text-[var(--hb-text-muted)]">신분증·계좌번호·고객 개인정보는 적지 마세요.</p></div>
        <fieldset className="space-y-3 border-t border-[var(--hb-hairline)] pt-5"><legend className={providerLabel}>참여를 위해 확인해 주세요</legend>{([
          ["privacy", "아래 안내에 따른 참여 신청 개인정보 수집·이용에 동의합니다."],
          ["price_transparency", "서비스의 가격과 포함 항목을 공개하겠어요."],
          ["extra_charges", "추가 비용과 발생 조건을 명시하겠어요."],
          ["standard_terms", "공개한 서비스 조건을 준수하고, 계약 전에 적용 약관과 취소·환불 기준을 안내하겠어요."],
        ] as const).map(([key, text]) => <label key={key} className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={consents[key]} onChange={(event) => setConsents((current) => ({ ...current, [key]: event.target.checked }))} required className={`mt-1 shrink-0 ${providerFocus}`} /><span>{text} <span className="text-[var(--hb-text-muted)]">(필수)</span></span></label>)}<div className="space-y-2 rounded-md bg-[var(--hb-surface-hover)] p-4 text-xs leading-6"><p>수집·이용 목적: 참여 신청 심사, 관리 권한 확인, 신청·심사 내역 제공과 문의 대응.</p><p>항목: 계정 식별자와 확인된 이메일, 담당자 이름, 활동 형태·활동명·분야·지역·소개와 입력한 링크, 동의 내역, 신청·심사 기록.</p><p>보유: 신청·심사 내역 제공을 위해 계정 유지 중 보관하며, 처리 목적이 끝나거나 삭제 요청·탈퇴가 처리되면 더 이상 필요하지 않은 개인정보를 파기합니다. 삭제·처리정지는 개인정보 처리방침의 고객센터로 요청할 수 있습니다.</p><p>동의를 거부할 수 있으며, 거부하면 참여 신청을 접수할 수 없습니다. 다른 서비스의 이용 동의와는 별개입니다.</p><p><a href="/privacy#provider-participation" target="_blank" rel="noopener noreferrer" className={`underline underline-offset-4 ${providerFocus}`}>제공자 개인정보 처리 안내</a>에서 공개 범위와 삭제 절차를 확인해 주세요. 이 확인으로 고객과의 서비스 계약이 체결되거나 추천 자격이 승인되지는 않습니다.</p></div></fieldset>
      </fieldset>
      {error ? <p role="alert" className="rounded-md border border-rose-700/30 bg-rose-pale/30 p-3 text-sm text-rose-700">{error}</p> : null}
      <Button type="submit" variant="primary" loading={busy}>{application ? "보완 내용 다시 제출하기" : "참여 신청하기"}</Button>
    </form>
  );
}
