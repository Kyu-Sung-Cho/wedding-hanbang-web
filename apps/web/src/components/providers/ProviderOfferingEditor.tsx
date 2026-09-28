"use client";

import { useRef, useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import { PROVIDER_CATEGORIES, PROVIDER_CATEGORY_LABELS, type ProviderOffering } from "@/lib/providers/contracts";
import { providerFailure, providerJson, providerRequest } from "./providerClient";
import { providerInput, providerLabel } from "./ProviderShell";

type Props = { providerId: string; offering?: ProviderOffering; onChanged: (message: string) => Promise<void>; onCancel: () => void };

export default function ProviderOfferingEditor({ providerId, offering, onChanged, onCancel }: Props) {
  const [name, setName] = useState(offering?.name ?? "");
  const [category, setCategory] = useState(offering?.category ?? "photography");
  const [description, setDescription] = useState(offering?.description ?? "");
  const [price, setPrice] = useState(offering ? String(offering.base_price_krw) : "");
  const [priceUnit, setPriceUnit] = useState(offering?.price_unit ?? "");
  const [includes, setIncludes] = useState(offering?.includes.join("\n") ?? "");
  const [extra, setExtra] = useState(offering?.extra_charges ?? "");
  const [conditions, setConditions] = useState(offering?.conditions ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const included = includes.split("\n").map((item) => item.trim()).filter(Boolean);
    if (!included.length || included.length > 30 || included.some((item) => item.length > 200)) { setError("포함 항목을 한 줄에 하나씩, 각 200자 이내로 1~30개 입력해 주세요."); return; }
    const base = Number(price);
    if (price.trim() === "" || !Number.isSafeInteger(base) || base < 0 || base > 1000000000) { setError("기본금액을 0 이상 10억 원 이하의 원 단위 정수로 입력해 주세요."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      await providerRequest(`/api/provider/profiles/${providerId}/offerings${offering ? `/${offering.id}` : ""}`, providerJson(offering ? "PATCH" : "POST", {
        name: name.trim(), category, description: description.trim(), base_price_krw: base, price_unit: priceUnit.trim(), includes: included, extra_charges: extra.trim(), conditions: conditions.trim(), ...(offering ? { expected_version: offering.version } : {}),
      }));
      await onChanged("서비스를 검토 요청했어요. 승인 전에는 공개·추천되지 않습니다.");
      onCancel();
    } catch (cause) { setError(providerFailure(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-5 space-y-5 border-t border-[var(--hb-hairline)] pt-5"><h3 className="font-semibold text-[var(--hb-text-strong)]">{offering ? "서비스 변경 제출" : "새 서비스 등록"}</h3>{offering?.review_status === "approved" ? <p className="border-l-2 border-[var(--hb-action)] bg-[var(--hb-surface-hover)] px-4 py-3 text-sm leading-7">변경을 제출하면 이 서비스는 다시 검토하는 동안 공개 목록과 추천에서 제외됩니다. 소개글·사진과 다른 승인된 서비스는 유지됩니다.</p> : null}<fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
    <div><label htmlFor="offering-name" className={providerLabel}>서비스 이름</label><input id="offering-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required className={providerInput} /></div>
    <div><label htmlFor="offering-category" className={providerLabel}>분야</label><select id="offering-category" value={category} onChange={(event) => setCategory(event.target.value)} className={providerInput}>{PROVIDER_CATEGORIES.map((value) => <option key={value} value={value}>{PROVIDER_CATEGORY_LABELS[value]}</option>)}</select></div>
    <div><label htmlFor="offering-description" className={providerLabel}>서비스 설명</label><textarea id="offering-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={3000} rows={3} required className={providerInput} /></div>
    <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="offering-price" className={providerLabel}>기본금액 (원)</label><input id="offering-price" type="number" min={0} max={1000000000} step={1} value={price} onChange={(event) => setPrice(event.target.value)} required className={providerInput} /></div><div><label htmlFor="offering-unit" className={providerLabel}>가격 기준</label><input id="offering-unit" value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)} maxLength={60} placeholder="예: 사진가 1명 · 촬영 2시간" required className={providerInput} /></div></div>
    <div><label htmlFor="offering-includes" className={providerLabel}>포함 항목</label><textarea id="offering-includes" value={includes} onChange={(event) => setIncludes(event.target.value)} rows={4} maxLength={6030} required className={providerInput} placeholder="한 줄에 하나씩 입력해 주세요." /></div>
    <div><label htmlFor="offering-extra" className={providerLabel}>추가 비용과 발생 조건</label><textarea id="offering-extra" value={extra} onChange={(event) => setExtra(event.target.value)} maxLength={2000} rows={3} required className={providerInput} placeholder="출장, 연장, 지정 담당자, 원본·보정 등 추가 비용을 명시해 주세요. 없으면 ‘추가 비용 없음’이라고 적어주세요." /></div>
    <div><label htmlFor="offering-conditions" className={providerLabel}>이용·담당자·취소 조건</label><textarea id="offering-conditions" value={conditions} onChange={(event) => setConditions(event.target.value)} maxLength={3000} rows={4} required className={providerInput} placeholder="활동 지역, 실제 담당자, 제공 시간, 취소 조건과 확인할 원문 링크를 적어주세요." /></div>
  </fieldset>{error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}<div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" loading={busy}>서비스·가격 검토 요청</Button><Button onClick={onCancel} disabled={busy}>편집 닫기</Button></div></form>;
}
