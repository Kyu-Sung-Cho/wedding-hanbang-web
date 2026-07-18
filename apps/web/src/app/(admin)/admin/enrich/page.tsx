"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, UserPlus } from "lucide-react";
import {
  AdminErrorState,
  AdminLoadingState,
  VendorWorkspaceHeader,
} from "@/components/admin/VendorWorkspaceHeader";

type Category = "all" | "studio" | "dress" | "makeup" | "hall";
type EnrichmentStatus = "all" | "pending" | "in_progress" | "done" | "skip";
type Progress = { done: number; total: number };

type QueueVendor = {
  id: string;
  name: string;
  slug: string | null;
  category: Exclude<Category, "all">;
  region_code: string | null;
  enrichment_status: Exclude<EnrichmentStatus, "all">;
  enriched_at: string | null;
  assigned_to_me: boolean;
  is_assigned: boolean;
};

const CATEGORY_LABELS: Record<Category, string> = {
  all: "전체",
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "예식장",
};

const STATUS_LABELS: Record<EnrichmentStatus, string> = {
  all: "전체 상태",
  pending: "대기",
  in_progress: "작업 중",
  done: "완료",
  skip: "제외",
};

const REGIONS = [
  ["", "전체 지역"], ["seoul_gangnam3", "서울 강남3구"], ["seoul_etc", "서울(강남 외)"],
  ["gyeonggi", "경기"], ["incheon", "인천"], ["gangwon", "강원"],
  ["chungcheong", "충청"], ["daejeon", "대전"], ["jeolla", "전라"],
  ["gwangju", "광주"], ["gyeongsang", "경상"], ["busan", "부산"],
  ["ulsan", "울산"], ["daegu", "대구"], ["jeju", "제주"],
] as const;

function ProgressBlock({ label, value }: { label: string; value: Progress }) {
  const ratio = value.total === 0 ? 0 : Math.round((value.done / value.total) * 100);
  return (
    <div className="min-w-0 border-l-4 border-[#C7D1C2] pl-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-[#36534E]">{label}</p>
        <p className="text-xs tabular-nums text-[#6D806E]">{value.done}/{value.total}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EFE4D7]">
        <span className="block h-full rounded-full bg-[#6D806E]" style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

export default function AdminEnrichPage() {
  const [category, setCategory] = useState<Category>("all");
  const [status, setStatus] = useState<EnrichmentStatus>("pending");
  const [region, setRegion] = useState("");
  const [mine, setMine] = useState(false);
  const [vendors, setVendors] = useState<QueueVendor[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ category, status });
    if (region) params.set("region", region);
    if (mine) params.set("mine", "1");
    try {
      const response = await fetch(`/api/admin/enrich?${params}`);
      if (response.status === 401) { window.location.assign("/admin/login"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "업체 대기열을 불러오지 못했습니다.");
      setVendors(body.vendors ?? []);
      setProgress(body.progress ?? {});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "업체 대기열을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [category, mine, region, status]);

  useEffect(() => { void load(); }, [load]);

  async function assign(vendorId: string) {
    setBusyId(vendorId); setError("");
    try {
      const response = await fetch(`/api/admin/enrich/${vendorId}/assign`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "담당 배정에 실패했습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "담당 배정에 실패했습니다.");
    } finally { setBusyId(null); }
  }

  return (
    <div className="min-h-screen bg-[#FBF8F2] text-[#243832]">
      <VendorWorkspaceHeader active="enrich" />
      <main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold text-[#8F6662]">사람이 확인하고 직접 작성하는 데이터</p>
            <h2 className="mt-1 text-2xl font-bold">업체 정보 보강 대기열</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6D806E]">공시 가격을 바탕으로 URL·속성·태그만 보강합니다. 외부 사이트 내용을 자동으로 가져오지 않습니다.</p>
          </div>
          <div className="rounded-xl bg-[#36534E] px-5 py-3 text-white">
            <p className="text-xs text-white/70">전체 진행률</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{progress.all?.done ?? 0} / {progress.all?.total ?? 0}</p>
          </div>
        </div>

        <section className="mt-6 grid gap-4 border-y border-[#E2D3C8] bg-white px-5 py-5 sm:grid-cols-2 xl:grid-cols-4" aria-label="카테고리별 진행률">
          {(["studio", "dress", "makeup", "hall"] as const).map((key) => (
            <ProgressBlock key={key} label={CATEGORY_LABELS[key]} value={progress[key] ?? { done: 0, total: 0 }} />
          ))}
        </section>

        <section className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#E2D3C8] bg-white p-4" aria-label="대기열 필터">
          <select value={category} onChange={(event) => setCategory(event.target.value as Category)} aria-label="업체 유형" className="min-h-10 rounded-lg border border-[#C7D1C2] bg-white px-3 text-sm text-[#36534E]">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="지역" className="min-h-10 rounded-lg border border-[#C7D1C2] bg-white px-3 text-sm text-[#36534E]">
            {REGIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value as EnrichmentStatus)} aria-label="보강 상태" className="min-h-10 rounded-lg border border-[#C7D1C2] bg-white px-3 text-sm text-[#36534E]">
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#C7D1C2] px-3 text-sm font-semibold text-[#36534E]">
            <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} className="accent-[#36534E]" />
            내가 담당
          </label>
        </section>

        {error && !loading && vendors.length > 0 && <p className="mt-4 rounded-lg bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}
        {loading ? (
          <AdminLoadingState label="업체 보강 대기열을 불러오는 중입니다…" />
        ) : error && vendors.length === 0 ? (
          <AdminErrorState message={error} onRetry={() => void load()} />
        ) : vendors.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[#C7D1C2] bg-white px-6 py-16 text-center">
            <CheckCircle2 className="mx-auto text-[#6D806E]" aria-hidden="true" />
            <p className="mt-3 font-semibold">이 조건의 업체가 없습니다.</p>
            <p className="mt-1 text-sm text-[#6D806E]">다른 필터를 선택하거나 완료 상태를 확인해 주세요.</p>
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-2xl border border-[#E2D3C8] bg-white">
            <div className="hidden grid-cols-[minmax(220px,1fr)_130px_150px_120px_210px] gap-4 border-b border-[#E2D3C8] bg-[#F7F1E8] px-5 py-3 text-xs font-bold text-[#6D806E] md:grid">
              <span>업체</span><span>유형</span><span>지역</span><span>상태</span><span className="text-right">작업</span>
            </div>
            <ul className="divide-y divide-[#EFE4D7]">
              {vendors.map((vendor) => (
                <li key={vendor.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(220px,1fr)_130px_150px_120px_210px] md:items-center md:gap-4">
                  <div><p className="font-semibold text-[#243832]">{vendor.name}</p>{vendor.assigned_to_me ? <p className="mt-1 text-xs font-semibold text-[#8F6662]">내 담당</p> : vendor.is_assigned && vendor.enrichment_status === "in_progress" ? <p className="mt-1 text-xs font-semibold text-[#6D806E]">다른 담당자 작업 중</p> : null}</div>
                  <p className="text-sm text-[#36534E]">{CATEGORY_LABELS[vendor.category]}</p>
                  <p className="text-sm text-[#6D806E]">{REGIONS.find(([value]) => value === vendor.region_code)?.[1] ?? vendor.region_code ?? "미확인"}</p>
                  <p className="text-sm font-semibold text-[#6D806E]">{STATUS_LABELS[vendor.enrichment_status]}</p>
                  <div className="flex justify-start gap-2 md:justify-end">
                    {!vendor.is_assigned && vendor.enrichment_status !== "done" && vendor.enrichment_status !== "skip" && (
                      <button type="button" disabled={busyId === vendor.id} onClick={() => void assign(vendor.id)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#C7D1C2] px-3 text-sm font-semibold text-[#36534E] disabled:opacity-50"><UserPlus size={15} />내가 담당</button>
                    )}
                    {(vendor.assigned_to_me || vendor.enrichment_status === "done" || vendor.enrichment_status === "skip") && (
                      <Link href={`/admin/enrich/${vendor.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#36534E] px-3.5 text-sm font-semibold text-white">{vendor.enrichment_status === "done" || vendor.enrichment_status === "skip" ? "검토" : "편집"}<ArrowRight size={15} /></Link>
                    )}
                    {vendor.is_assigned && !vendor.assigned_to_me && vendor.enrichment_status === "in_progress" && (
                      <span className="inline-flex min-h-10 items-center rounded-lg bg-[#EFE4D7] px-3 text-xs font-semibold text-[#6D806E]" aria-disabled="true">편집 잠금</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
