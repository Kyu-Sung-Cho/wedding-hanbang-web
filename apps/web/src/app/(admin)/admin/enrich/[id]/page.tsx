"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Save, ShieldAlert } from "lucide-react";
import {
  AdminErrorState,
  AdminLoadingState,
  SignedSourceLink,
  VendorWorkspaceHeader,
} from "@/components/admin/VendorWorkspaceHeader";
import {
  getAttributeFieldDefinitions,
  type VendorAttributeCategory,
  type VendorAttributeFieldDefinition,
} from "@/lib/vendors/attributeSchemas";
import { parseEnrichmentSubmission, vendorRegionLabel } from "@/lib/admin/vendorWorkspace";

type VendorDetail = {
  id: string;
  name: string;
  slug: string | null;
  category: VendorAttributeCategory;
  region_code: string | null;
  official_url: string | null;
  instagram_url: string | null;
  naver_place_url: string | null;
  attributes: Record<string, unknown>;
  notes_internal: string;
  enrichment_status: string;
  enriched_at: string | null;
  assigned_to_me: boolean;
  is_assigned: boolean;
};

type Tag = {
  id: string;
  tag_group: string;
  slug: string;
  label: string;
  selected: boolean;
};

type Price = {
  id: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  price_note: string | null;
  source_quote: string | null;
  confidence: number | null;
  source_available: boolean;
  source_count: number;
  source_file_label: string | null;
  agency: { name?: string; region_code?: string } | null;
  snapshot: { period_label?: string } | null;
  options: Array<{
    id: string;
    name: string;
    price_min_krw: number | null;
    price_max_krw: number | null;
    unit: string | null;
    condition: string | null;
    source_quote: string | null;
  }>;
};

type SearchLinks = {
  naverSearch: string;
  naverMap: string;
  instagram: string;
};

type FittingFeeSuggestion = {
  value_krw: number;
  source_quote: string;
  price_id: string;
  option_id: string;
};

const OPTION_LABELS: Record<string, string> = {
  budget: "실속", mid: "중간", premium: "프리미엄", luxury: "럭셔리", unknown: "확인 필요",
  indoor: "실내", outdoor: "야외", hanok: "한옥", garden: "정원", rooftop: "루프톱", beach: "바다", cafe: "카페", night: "야간", underwater: "수중",
  included: "포함", paid: "유료", not_provided: "미제공",
  imported: "수입", domestic: "국내", inhouse: "자체 제작",
  aline: "A라인", mermaid: "머메이드", bell: "벨라인", princess: "프린세스", slim: "슬림", mini: "미니",
  available: "가능", fee_required: "추가금", not_available: "불가",
  hotel: "호텔", convention: "컨벤션", house: "하우스", chapel: "채플", public: "공공", small: "소규모",
  bright: "밝음", dark: "어두움", buffet: "뷔페", course: "코스", semi: "세미 코스",
  ample: "여유", limited: "제한", valet: "발렛",
};

const TAG_GROUP_LABELS: Record<string, string> = {
  shoot_style: "촬영 무드",
  dress_detail: "드레스 디테일",
  makeup_style: "메이크업 스타일",
  hall_mood: "홀 분위기",
};

const CATEGORY_LABELS: Record<VendorAttributeCategory, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "예식장",
};

const ENRICHMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "보강 대기",
  in_progress: "작업 중",
  done: "보강 완료",
  skip: "보강 제외",
};

function optionLabel(value: string) {
  return OPTION_LABELS[value] ?? value;
}

function moneyRange(min: number | null, max: number | null) {
  if (min === null && max === null) return "가격 미확인";
  if (min !== null && max !== null && min !== max) return `${min.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")}원`;
  return `${(min ?? max ?? 0).toLocaleString("ko-KR")}원`;
}

function AttributeField({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: VendorAttributeFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  if (definition.input === "multi_select") {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return (
      <fieldset>
        <legend className="text-sm font-semibold text-[var(--hb-text-strong)]">{definition.label}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {definition.options?.map((option) => {
            const active = selected.includes(option);
            return (
              <label key={option} className={`${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} rounded-full border px-3 py-2 text-sm ${active ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white" : "border-[#C7D1C2] bg-white text-[var(--hb-text-strong)]"}`}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={disabled}
                  onChange={() => onChange(active ? selected.filter((item) => item !== option) : [...selected, option])}
                  className="sr-only"
                />
                {optionLabel(option)}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }
  if (definition.input === "nullable_boolean") {
    return (
      <fieldset>
        <legend className="text-sm font-semibold text-[var(--hb-text-strong)]">{definition.label}</legend>
        <div className="mt-2 inline-flex overflow-hidden rounded-[6px] border border-[#C7D1C2] bg-white">
          {([{ label: "예", value: true }, { label: "아니오", value: false }, { label: "확인 필요", value: null }] as const).map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              aria-pressed={value === item.value}
              onClick={() => onChange(item.value)}
              className={`min-h-10 border-r border-[#C7D1C2] px-3 text-sm last:border-r-0 ${value === item.value ? "bg-[var(--hb-primary)] font-semibold text-white" : "text-[#6D806E]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (definition.input === "select") {
    return (
      <label className="block text-sm font-semibold text-[var(--hb-text-strong)]">
        {definition.label}
        <select disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} className="enrich-input mt-2 disabled:bg-[var(--hb-surface-hover)] disabled:opacity-70">
          <option value="">선택 안 함</option>
          {definition.options?.map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}
        </select>
      </label>
    );
  }
  if (definition.input === "nullable_number") {
    const unitLabel = definition.unit === "krw"
      ? "원"
      : definition.unit === "people"
        ? "명"
        : definition.unit === "minutes"
          ? "분"
          : null;
    return (
      <label className="block text-sm font-semibold text-[var(--hb-text-strong)]">
        {definition.label}
        <span className="relative mt-2 block">
          <input disabled={disabled} type="number" inputMode="numeric" min="0" step={definition.unit === "krw" ? 1000 : 1} value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} className={`enrich-input disabled:bg-[var(--hb-surface-hover)] disabled:opacity-70 ${unitLabel ? "pr-10" : ""}`} />
          {unitLabel && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-[#6D806E]">{unitLabel}</span>}
        </span>
      </label>
    );
  }
  return (
    <label className="block text-sm font-semibold text-[var(--hb-text-strong)]">
      {definition.label}
      <textarea disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} rows={4} className="enrich-input mt-2 resize-y disabled:bg-[var(--hb-surface-hover)] disabled:opacity-70" />
    </label>
  );
}

export default function AdminEnrichEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [searchLinks, setSearchLinks] = useState<SearchLinks | null>(null);
  const [fittingFeeSuggestion, setFittingFeeSuggestion] = useState<FittingFeeSuggestion | null>(null);
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [urls, setUrls] = useState({ official_url: "", instagram_url: "", naver_place_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/enrich/${params.id}`);
      if (response.status === 401) { window.location.assign("/admin/login"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "업체 정보를 불러오지 못했습니다.");
      const loadedVendor = body.vendor as VendorDetail;
      setVendor(loadedVendor);
      setTags(body.tags ?? []);
      setPrices(body.prices ?? []);
      setSearchLinks(body.search_links ?? null);
      setFittingFeeSuggestion(body.attribute_suggestions?.fitting_fee_krw ?? null);
      setAttributes({ ...loadedVendor.attributes, notes_internal: loadedVendor.notes_internal });
      setSelectedTagIds((body.tags ?? []).filter((tag: Tag) => tag.selected).map((tag: Tag) => tag.id));
      setUrls({
        official_url: loadedVendor.official_url ?? "",
        instagram_url: loadedVendor.instagram_url ?? "",
        naver_place_url: loadedVendor.naver_place_url ?? "",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "업체 정보를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        document.getElementById("enrichment-save")?.click();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById("enrichment-complete-next")?.click();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const definitions = useMemo(
    () => vendor ? getAttributeFieldDefinitions(vendor.category) : [],
    [vendor],
  );
  const tagsByGroup = useMemo(() => {
    const grouped = new Map<string, Tag[]>();
    for (const tag of tags) grouped.set(tag.tag_group, [...(grouped.get(tag.tag_group) ?? []), tag]);
    return [...grouped.entries()];
  }, [tags]);
  const canEdit = vendor?.assigned_to_me === true;

  async function save(action: "save" | "complete", advance: boolean) {
    if (!vendor || !canEdit) return;
    setError(""); setNotice("");
    const body = {
      action,
      official_url: urls.official_url || null,
      instagram_url: urls.instagram_url || null,
      naver_place_url: urls.naver_place_url || null,
      attributes,
      tag_ids: selectedTagIds,
    };
    const localValidation = parseEnrichmentSubmission(vendor.category, body);
    if (!localValidation.success) {
      setError("입력값을 확인해 주세요. URL은 https로 시작해야 하며 숫자는 0 이상이어야 합니다.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/enrich/${vendor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "업체 정보를 저장하지 못했습니다.");
      if (!advance) {
        setNotice(action === "complete" ? "보강 완료로 저장했습니다." : "임시 저장했습니다.");
        await load();
        return;
      }
      const queueResponse = await fetch(`/api/admin/enrich?category=${vendor.category}&status=pending`);
      const queueBody = await queueResponse.json();
      const next = queueBody.vendors?.find((item: { id: string }) => item.id !== vendor.id);
      if (queueResponse.ok && next) router.push(`/admin/enrich/${next.id}`);
      else router.push("/admin/enrich");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "업체 정보를 저장하지 못했습니다.");
    } finally { setSaving(false); }
  }

  if (loading) {
    return <div className="min-h-screen bg-[var(--hb-surface-page)]"><VendorWorkspaceHeader active="enrich" /><AdminLoadingState label="업체 근거와 속성 스키마를 불러오는 중입니다…" /></div>;
  }
  if (!vendor) {
    return <div className="min-h-screen bg-[var(--hb-surface-page)]"><VendorWorkspaceHeader active="enrich" /><AdminErrorState message={error || "업체 정보를 찾을 수 없습니다."} onRetry={() => void load()} /></div>;
  }

  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-strong)]">
      <VendorWorkspaceHeader active="enrich" />
      <div className="sticky top-0 z-30 border-y border-[#B89785] bg-[var(--hb-surface-hover)] px-5 py-3 shadow-sm">
        <p className="mx-auto flex max-w-[1500px] items-center gap-2 text-sm font-bold text-[#6A443F]"><ShieldAlert size={18} aria-hidden="true" />업체 사진·소개문 복사 금지 — URL과 직접 작성한 설명만 저장하세요.</p>
      </div>
      <main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/admin/enrich" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6D806E]"><ArrowLeft size={15} />대기열</Link>
            <h2 className="mt-2 text-2xl font-bold">{vendor.name}</h2>
            <p className="mt-1 text-sm text-[#6D806E]">{CATEGORY_LABELS[vendor.category]} · {vendorRegionLabel(vendor.region_code) || "지역 미확인"} · {ENRICHMENT_STATUS_LABELS[vendor.enrichment_status] ?? "상태 미확인"}</p>
          </div>
          <p className="rounded-[6px] bg-white px-3 py-2 text-xs text-[#6D806E]">⌘/Ctrl+S 저장 · ⌘/Ctrl+Enter 완료 후 다음</p>
        </div>
        {notice && <p className="mb-4 rounded-[6px] bg-[#C7D1C2]/45 px-4 py-3 text-sm font-semibold text-[var(--hb-text-strong)]" role="status">{notice}</p>}
        {error && <p className="mb-4 rounded-[6px] bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}
        {!canEdit && <p className="mb-4 rounded-[6px] border border-[#B89785] bg-[var(--hb-surface-hover)] px-4 py-3 text-sm font-semibold text-[#6A443F]" role="status">{vendor.is_assigned ? "다른 담당자가 작업한 업체입니다. 현재는 읽기 전용으로 검토할 수 있습니다." : "편집하려면 대기열에서 먼저 ‘내가 담당’을 선택하세요."}</p>}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(540px,1.05fr)]">
          <section className="overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white">
            <div className="border-b border-[#E2D3C8] bg-[var(--hb-surface-hover)] px-5 py-4"><p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">READ-ONLY EVIDENCE</p><h3 className="mt-1 font-bold">공시 가격과 근거</h3></div>
            {prices.length === 0 ? (
              <div className="px-5 py-14 text-center text-sm text-[#6D806E]">연결된 공시 가격이 없습니다. URL·속성은 입력할 수 있지만 가격 근거는 미확인으로 남습니다.</div>
            ) : (
              <div className="divide-y divide-[var(--hb-hairline)]">
                {prices.map((price) => (
                  <article key={price.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><p className="font-bold text-[var(--hb-text-strong)]">{price.item_name}</p><p className="mt-1 text-sm font-semibold tabular-nums text-[var(--hb-text-strong)]">{moneyRange(price.price_min_krw, price.price_max_krw)}</p></div>
                      {price.source_available && <SignedSourceLink priceId={price.id} label="원본 열기" expectedCount={price.source_count} />}
                    </div>
                    {price.agency?.name && <p className="mt-3 text-xs font-semibold text-[var(--color-rose-700)]">관련 대행사 · {price.agency.name}</p>}
                    {price.base_spec && <p className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]">{price.base_spec}</p>}
                    <div className="mt-3 border-l-4 border-[#A77B74] bg-[var(--hb-surface-page)] px-4 py-3"><p className="text-xs font-bold text-[var(--color-rose-700)]">근거 원문</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{price.source_quote || "근거 원문 없음"}</p></div>
                    {price.options.length > 0 && (
                      <div className="mt-4"><p className="text-xs font-bold text-[#6D806E]">추가금 목록</p><ul className="mt-1 divide-y divide-[var(--hb-hairline)]">{price.options.map((option) => <li key={option.id} className="flex justify-between gap-4 py-2 text-sm"><span>{option.name}</span><span className="shrink-0 tabular-nums">{moneyRange(option.price_min_krw, option.price_max_krw)}</span></li>)}</ul></div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-5">
            <div className="rounded-[6px] border border-[#E2D3C8] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">TEAM-CURATED LINKS</p><h3 className="mt-1 font-bold">URL과 검색 도우미</h3></div><div className="flex flex-wrap gap-2">{searchLinks && [["네이버 검색", searchLinks.naverSearch], ["네이버 지도", searchLinks.naverMap], ["인스타그램 검색", searchLinks.instagram]].map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-semibold text-[var(--hb-text-strong)]">{label}<ExternalLink size={12} /></a>)}</div></div>
              <p className="mt-3 text-xs leading-5 text-[#6D806E]">검색 도우미는 검색 페이지를 새 탭으로 열기만 합니다. 서비스 서버는 외부 사이트를 가져오거나 저장하지 않습니다.</p>
              <div className="mt-4 grid gap-4">
                {[{ key: "official_url", label: "공식 홈페이지" }, { key: "naver_place_url", label: "네이버 플레이스" }, { key: "instagram_url", label: "인스타그램" }].map(({ key, label }) => <label key={key} className="text-sm font-semibold text-[var(--hb-text-strong)]">{label}<input disabled={!canEdit} type="url" placeholder="https://" value={urls[key as keyof typeof urls]} onChange={(event) => setUrls((current) => ({ ...current, [key]: event.target.value }))} className="enrich-input mt-2 disabled:bg-[var(--hb-surface-hover)] disabled:opacity-70" /></label>)}
              </div>
            </div>

            <div className="rounded-[6px] border border-[#E2D3C8] bg-white p-5">
              <p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">SCHEMA-VALIDATED ATTRIBUTES</p><h3 className="mt-1 font-bold">업체 속성</h3>
              {vendor.category === "dress" && fittingFeeSuggestion ? (
                <aside className="mt-4 rounded-[6px] border border-[#B89785] bg-[var(--hb-surface-hover)] p-4" aria-label="승인된 공시 피팅비 제안">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-[var(--color-rose-700)]">승인된 공시 옵션에서 제안</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-[var(--hb-text-strong)]">피팅비 {fittingFeeSuggestion.value_krw.toLocaleString("ko-KR")}원</p>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit || attributes.fitting_fee_krw === fittingFeeSuggestion.value_krw}
                      onClick={() => setAttributes((current) => ({ ...current, fitting_fee_krw: fittingFeeSuggestion.value_krw }))}
                      className="inline-flex min-h-11 items-center rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {attributes.fitting_fee_krw === fittingFeeSuggestion.value_krw ? "제안 적용됨" : "제안 적용"}
                    </button>
                  </div>
                  <p className="mt-3 line-clamp-3 text-xs leading-5 text-[#6D806E]">근거: {fittingFeeSuggestion.source_quote}</p>
                  <p className="mt-1 text-xs text-[#6D806E]">자동 저장되지 않습니다. 원본과 금액을 확인한 뒤 적용하고 저장하세요.</p>
                </aside>
              ) : null}
              <div className="mt-5 grid gap-5 sm:grid-cols-2">{definitions.map((definition) => <AttributeField key={definition.key} definition={definition} value={attributes[definition.key]} disabled={!canEdit} onChange={(value) => setAttributes((current) => ({ ...current, [definition.key]: value }))} />)}</div>
            </div>

            <div className="rounded-[6px] border border-[#E2D3C8] bg-white p-5">
              <p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">CURATED TAGS</p><h3 className="mt-1 font-bold">태그 선택</h3>
              <div className="mt-5 space-y-5">{tagsByGroup.map(([group, groupTags]) => <fieldset key={group}><legend className="text-sm font-semibold text-[var(--hb-text-strong)]">{TAG_GROUP_LABELS[group] ?? group}</legend><div className="mt-2 flex flex-wrap gap-2">{groupTags.map((tag) => { const selected = selectedTagIds.includes(tag.id); return <label key={tag.id} className={`${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-60"} rounded-full border px-3 py-2 text-sm ${selected ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white" : "border-[#C7D1C2] bg-white text-[var(--hb-text-strong)]"}`}><input type="checkbox" disabled={!canEdit} checked={selected} onChange={() => setSelectedTagIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])} className="sr-only" />{tag.label}</label>; })}</div></fieldset>)}</div>
            </div>

            {canEdit ? <div className="sticky bottom-4 z-20 flex flex-wrap justify-end gap-2 rounded-[6px] border border-[#E2D3C8] bg-[var(--hb-surface-page)]/95 p-4 shadow-[var(--shadow-raised)] backdrop-blur">
              <button id="enrichment-save" type="button" disabled={saving || !canEdit} onClick={() => void save("save", false)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50"><Save size={16} />임시 저장</button>
              <button type="button" disabled={saving || !canEdit} onClick={() => void save("complete", false)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[var(--hb-primary)] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50"><Check size={16} />완료</button>
              <button id="enrichment-complete-next" type="button" disabled={saving || !canEdit} onClick={() => void save("complete", true)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white disabled:opacity-50"><Check size={16} />완료 후 다음 업체</button>
            </div> : <div className="sticky bottom-4 z-20 flex justify-end rounded-[6px] border border-[#E2D3C8] bg-[var(--hb-surface-page)]/95 p-4 shadow-[var(--shadow-raised)]"><Link href="/admin/enrich" className="inline-flex min-h-11 items-center rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white">대기열로 돌아가기</Link></div>}
          </section>
        </div>
      </main>
      <style jsx global>{`
        .enrich-input { width: 100%; min-height: 42px; border: 1px solid #c7d1c2; border-radius: 8px; background: #fff; padding: 9px 11px; color: #243832; font-size: 14px; outline: none; }
        .enrich-input:focus { border-color: #36534e; box-shadow: 0 0 0 3px rgba(54,83,78,.12); }
      `}</style>
    </div>
  );
}
