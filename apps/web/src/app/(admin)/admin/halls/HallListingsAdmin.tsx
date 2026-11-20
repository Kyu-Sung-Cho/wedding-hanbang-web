"use client";

import { INVITATION_REGIONS } from "@hanbang/shared/invitation";
import Link from "next/link";
import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";

/**
 * 운영자 웨딩홀 자료 화면. 업체가 가격을 공개한 곳의 주소와 확인한 날을 적어 넣는다.
 * 공개 가격 공시(참가격) 자료는 쓰지 않는다(2026-11-16 파운더 결정). 새 홀은 공개하지 않은 채로 저장된다.
 * 지역은 커플이 첫 대화에서 고르는 것과 같은 목록(`INVITATION_REGIONS`)에서만 고른다.
 */

type Listing = {
  id: string;
  name: string;
  region: string;
  area_label: string;
  kind_label: string;
  meal_price_won: number;
  rental_fee_won: number | null;
  rental_included: boolean;
  minimum_guarantee: number | null;
  station_walk_minutes: number | null;
  transit_note: string | null;
  photo_url: string | null;
  source_url: string;
  checked_on: string;
  active: boolean;
};

type FormState = {
  name: string;
  region: string;
  areaLabel: string;
  kindLabel: string;
  mealPriceWon: string;
  rentalIncluded: boolean;
  rentalFeeWon: string;
  minimumGuarantee: string;
  stationWalkMinutes: string;
  transitNote: string;
  photoUrl: string;
  sourceUrl: string;
  checkedOn: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  region: "",
  areaLabel: "",
  kindLabel: "",
  mealPriceWon: "",
  rentalIncluded: false,
  rentalFeeWon: "",
  minimumGuarantee: "",
  stationWalkMinutes: "",
  transitNote: "",
  photoUrl: "",
  sourceUrl: "",
  checkedOn: "",
  active: false,
};

function toForm(listing: Listing): FormState {
  return {
    name: listing.name,
    region: listing.region,
    areaLabel: listing.area_label,
    kindLabel: listing.kind_label,
    mealPriceWon: String(listing.meal_price_won),
    rentalIncluded: listing.rental_included,
    rentalFeeWon: listing.rental_fee_won === null ? "" : String(listing.rental_fee_won),
    minimumGuarantee: listing.minimum_guarantee === null ? "" : String(listing.minimum_guarantee),
    stationWalkMinutes: listing.station_walk_minutes === null ? "" : String(listing.station_walk_minutes),
    transitNote: listing.transit_note ?? "",
    photoUrl: listing.photo_url ?? "",
    sourceUrl: listing.source_url,
    checkedOn: listing.checked_on,
    active: listing.active,
  };
}

const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));
const optionalText = (value: string) => (value.trim() === "" ? null : value.trim());

function toPayload(form: FormState) {
  return {
    name: form.name.trim(),
    region: form.region.trim(),
    areaLabel: form.areaLabel.trim(),
    kindLabel: form.kindLabel.trim(),
    mealPriceWon: Number(form.mealPriceWon),
    rentalIncluded: form.rentalIncluded,
    rentalFeeWon: form.rentalIncluded ? null : optionalNumber(form.rentalFeeWon),
    minimumGuarantee: optionalNumber(form.minimumGuarantee),
    stationWalkMinutes: optionalNumber(form.stationWalkMinutes),
    transitNote: optionalText(form.transitNote),
    photoUrl: optionalText(form.photoUrl),
    sourceUrl: form.sourceUrl.trim(),
    checkedOn: form.checkedOn,
    active: form.active,
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

const FIELD = "w-full rounded-[6px] border border-[var(--hb-hairline)] px-3 py-2 text-sm";

function TextField({ label, value, onChange, type = "text", placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--hb-text-muted)]">
      {label}
      <input className={FIELD} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function HallListingsAdmin() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  // 응답을 받은 뒤에만 상태를 바꾸고, 화면을 떠났거나 더 새 요청이 있으면 버린다.
  useEffect(() => {
    let active = true;
    fetch("/api/invitation/admin/halls", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "홀 자료를 불러오지 못했어요."));
        const body: unknown = await response.json().catch(() => null);
        if (!active) return;
        setError(null);
        setListings(typeof body === "object" && body !== null && "halls" in body && Array.isArray(body.halls) ? (body.halls as Listing[]) : []);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error && reason.message ? reason.message : "인터넷 연결을 확인해 주세요.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const response = await fetch(editingId ? `/api/invitation/admin/halls/${editingId}` : "/api/invitation/admin/halls", {
      method: editingId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toPayload(form)),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError(response ? await readError(response, "저장하지 못했어요.") : "인터넷 연결을 확인해 주세요.");
      return;
    }
    setNotice(editingId ? "고쳤어요." : "새 홀을 저장했어요.");
    setForm(EMPTY_FORM);
    setEditingId(null);
    reload();
  }

  async function setActive(listing: Listing, active: boolean) {
    setError(null);
    const response = await fetch(`/api/invitation/admin/halls/${listing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response ? await readError(response, "공개 여부를 바꾸지 못했어요.") : "인터넷 연결을 확인해 주세요.");
      return;
    }
    reload();
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <Link href="/admin" className="text-sm text-[var(--hb-text-muted)]">관리자 홈</Link>
        <h1 className="text-xl font-bold">웨딩홀 자료</h1>
        <p className="text-sm leading-6 text-[var(--hb-text-body)]">
          업체가 가격을 공개한 곳의 주소(https)와 그 가격을 확인한 날을 함께 적어요. 한국소비자원 참가격 자료는 쓰지 않아요.
          새 홀은 공개하지 않은 채로 저장되고, 공개해야 커플의 비교 화면에 나와요.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-[6px] border border-[var(--hb-hairline)] p-4" aria-label="홀 자료 입력">
        <h2 className="text-base font-semibold">{editingId ? "홀 고치기" : "새 홀 넣기"}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <TextField label="이름" value={form.name} onChange={(value) => update("name", value)} />
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--hb-text-muted)]">
            지역(커플이 고르는 목록과 같아요)
            <select className={FIELD} value={form.region} onChange={(event) => update("region", event.target.value)}>
              <option value="">지역을 골라 주세요</option>
              {INVITATION_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
          <TextField label="지역 표시(예: 마포구 하우스웨딩)" value={form.areaLabel} onChange={(value) => update("areaLabel", value)} />
          <TextField label="형태(예: 하우스웨딩)" value={form.kindLabel} onChange={(value) => update("kindLabel", value)} />
          <TextField label="1인 식대(원)" type="number" value={form.mealPriceWon} onChange={(value) => update("mealPriceWon", value)} />
          <TextField label="대관료(원)" type="number" value={form.rentalFeeWon} onChange={(value) => update("rentalFeeWon", value)} />
          <TextField label="최소 보증 인원" type="number" value={form.minimumGuarantee} onChange={(value) => update("minimumGuarantee", value)} />
          <TextField label="역에서 걷는 분" type="number" value={form.stationWalkMinutes} onChange={(value) => update("stationWalkMinutes", value)} />
          <TextField label="찾아가기 메모(예: 주차 400대)" value={form.transitNote} onChange={(value) => update("transitNote", value)} />
          <TextField label="사진 주소(사용을 허락받은 사진만)" value={form.photoUrl} onChange={(value) => update("photoUrl", value)} />
          <TextField label="가격을 공개한 곳의 주소" value={form.sourceUrl} onChange={(value) => update("sourceUrl", value)} placeholder="https://" />
          <TextField label="확인한 날" type="date" value={form.checkedOn} onChange={(value) => update("checkedOn", value)} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.rentalIncluded} onChange={(event) => update("rentalIncluded", event.target.checked)} />
            대관료가 식대에 포함돼 있어요
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={(event) => update("active", event.target.checked)} />
            비교 화면에 공개
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            {editingId ? "고친 내용 저장" : "새 홀 저장"}
          </Button>
          {editingId ? (
            <Button variant="secondary" size="sm" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
              고치기 그만두기
            </Button>
          ) : null}
        </div>
        {error ? <p role="alert" className="text-sm text-[#9A3F1C]">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-[var(--hb-text-body)]">{notice}</p> : null}
      </section>

      <section className="flex flex-col gap-2" aria-label="저장된 홀">
        <h2 className="text-base font-semibold">저장된 홀 {loading ? "" : `${listings.length}곳`}</h2>
        {loading ? <p className="text-sm">불러오는 중이에요.</p> : null}
        {!loading && listings.length === 0 ? <p className="text-sm">아직 넣은 홀이 없어요.</p> : null}
        <ul className="flex flex-col divide-y divide-[var(--hb-hairline)]">
          {listings.map((listing) => (
            <li key={listing.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{listing.name} · {listing.region} · {listing.area_label}</span>
                <span className="text-[var(--hb-text-muted)]">
                  식대 {listing.meal_price_won.toLocaleString("ko-KR")}원 · 대관료 {listing.rental_included ? "식대에 포함" : `${(listing.rental_fee_won ?? 0).toLocaleString("ko-KR")}원`}
                  {" "}· 보증 {listing.minimum_guarantee ?? "미확인"} · 확인 {listing.checked_on} · {listing.active ? "공개 중" : "공개 안 함"}
                </span>
                <a className="break-all text-[var(--hb-text-muted)] underline" href={listing.source_url} target="_blank" rel="noreferrer noopener">
                  {listing.source_url}
                </a>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => { setEditingId(listing.id); setForm(toForm(listing)); }}>
                  고치기
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void setActive(listing, !listing.active)}>
                  {listing.active ? "공개 끄기" : "공개하기"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
