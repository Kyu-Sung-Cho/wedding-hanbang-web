"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CopyCheck, Plus, Save, Trash2, X } from "lucide-react";
import {
  DisclosureSourcePreview,
  type DisclosureSourceFile,
} from "@/components/admin/DisclosureSourcePreview";
import { PriceUploadPanel } from "@/components/admin/PriceUploadPanel";
import {
  AdminErrorState,
  AdminLoadingState,
  SignedSourceLink,
  VendorWorkspaceHeader,
} from "@/components/admin/VendorWorkspaceHeader";
import {
  AGENCY_PACKAGE_CATEGORY_SCOPES,
  OFFICIAL_PRICE_CATEGORIES,
  parseAgencyPackageReviewSubmission,
  validationIssueLabel,
  vendorRegionLabel,
} from "@/lib/admin/vendorWorkspace";

type PriceStatus = "pending" | "approved" | "rejected" | "all";

const REVIEW_VERSION_CONFLICT_MESSAGE =
  "다른 관리자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.";

type PriceItem = {
  id: string;
  category: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  review_status: "pending" | "approved" | "rejected";
  needs_review: boolean;
  validation_issue_codes: string[];
  source_quote: string | null;
  confidence: number | null;
  review_version: number;
  edited_by_admin: boolean;
  updated_at: string;
  source_available: boolean;
  source_count: number;
  source_file_label: string | null;
  source_file_labels: string[];
  snapshot: { period_label?: string; source?: string } | null;
  vendor: { id?: string; name?: string; region_code?: string; status?: string } | null;
  agency: { id?: string; name?: string; region_code?: string } | null;
  alias_proposals: Array<{
    id: string;
    alias: string;
    status: "pending" | "approved" | "rejected";
    reviewed_at: string | null;
  }>;
  options: Array<{
    id: string | null;
    name: string;
    price_min_krw: number | null;
    price_max_krw: number | null;
    unit: string | null;
    condition: string | null;
    raw_text: string | null;
    source_quote: string | null;
    confidence: number | null;
  }>;
};

type OptionDraft = PriceItem["options"][number] & { clientKey: string };

type AgencyPackageOption = {
  name: string;
  price_min_krw: number | null;
  price_max_krw: number | null;
  unit: string | null;
  condition: string | null;
  raw_text: string | null;
  source_quote: string | null;
};

type AgencyPackageItem = {
  id: string;
  package_name: string;
  category_scope: Array<(typeof AGENCY_PACKAGE_CATEGORY_SCOPES)[number]>;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  options: AgencyPackageOption[];
  review_status: "pending" | "approved" | "rejected";
  needs_review: boolean;
  validation_issue_codes: string[];
  source_quote: string | null;
  confidence: number | null;
  review_version: number;
  edited_by_admin: boolean;
  updated_at: string;
  source_available: boolean;
  source_count: number;
  source_file_label: string | null;
  source_file_labels: string[];
  snapshot: { period_label?: string; source?: string } | null;
  agency: { id?: string; name?: string; region_code?: string } | null;
};

type AgencyPackageOptionDraft = AgencyPackageOption & { clientKey: string };

const PACKAGE_SCOPE_LABELS: Record<(typeof AGENCY_PACKAGE_CATEGORY_SCOPES)[number], string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  venue: "예식장",
};

type DedupeVendor = {
  id: string;
  name: string;
  aliases?: string[];
  category: string;
  region_code: string | null;
  enrichment_status: string;
};

type DedupeAgency = {
  id: string;
  name: string;
  normalized_name: string | null;
  corporate_name: string | null;
  aliases?: string[];
  region_code: string | null;
};

type DedupeCandidateBase = {
  id: string;
  reason: string | null;
  similarity: number | null;
  status: string;
};

type VendorDedupeCandidate = DedupeCandidateBase & {
  entity_kind: "vendor";
  left_vendor: DedupeVendor | DedupeVendor[] | null;
  right_vendor: DedupeVendor | DedupeVendor[] | null;
};

type AgencyDedupeCandidate = DedupeCandidateBase & {
  entity_kind: "agency";
  left_agency: DedupeAgency | DedupeAgency[] | null;
  right_agency: DedupeAgency | DedupeAgency[] | null;
};

type DedupeCandidate = VendorDedupeCandidate | AgencyDedupeCandidate;
type DedupeKind = DedupeCandidate["entity_kind"];

type SnapshotCounts = {
  total: number;
  review_status: { pending: number; approved: number; rejected: number; unknown: number };
  needs_review: { yes: number; no: number };
  provenance: { complete: number; incomplete: number };
  publishable_count: number;
};

type PriceSnapshot = {
  id: string;
  period_label: string;
  source: string;
  is_current: boolean;
  published_at: string | null;
  price_counts: SnapshotCounts;
  package_counts: SnapshotCounts;
  publishable_count: number;
  readiness: boolean;
  blocking_reasons: string[];
};

type BulkApprovalSummary = {
  batch_eligible_count: number | null;
  has_more: boolean | null;
  count_verified: boolean;
  can_execute: boolean;
  batch_limit: number;
  eligibility_contract_version: 1;
  eligibility_sha256: string | null;
  blocked_code?: string;
  blocked_reason?: string;
};

// 업체 수요 랭킹 (2026-07-23): 소비자 행동 카운터(vendor_demand_daily)를 기간·카테고리로
// 집계해 업체 제휴 대화용 근거 수치를 보여준다. CSV 내려받기 지원.
type DemandRankRow = {
  vendor_id: string;
  name: string;
  category: string;
  region_code: string | null;
  impressions: number;
  detail_views: number;
  wishlist_adds: number;
  combo_adds: number;
  quote_requests: number;
  weighted_score: number;
  qualified_score: number;
};

function VendorDemandPanel() {
  const [days, setDays] = useState(30);
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState<DemandRankRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");

  async function load() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ days: String(days) });
      if (category) query.set("category", category);
      const response = await fetch(`/api/admin/price/demand?${query.toString()}`);
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "수요 데이터를 불러오지 못했습니다.");
      setRows(body.rows ?? []);
      setLoadedAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (caught) {
      setRows([]);
      setError(caught instanceof Error ? caught.message : "수요 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function aggregateToday() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
      const response = await fetch("/api/admin/price/demand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "aggregate", day: today }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "집계 실행에 실패했습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "집계 실행에 실패했습니다.");
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (rows.length === 0) return;
    const header = "업체명,카테고리,지역,노출,상세열람,찜,조합담기,견적요청,가중점수,유효점수(예식일보유)";
    const lines = rows.map((row) => [
      `"${row.name.replaceAll('"', '""')}"`,
      row.category,
      row.region_code ?? "",
      row.impressions,
      row.detail_views,
      row.wishlist_adds,
      row.combo_adds,
      row.quote_requests,
      row.weighted_score,
      row.qualified_score,
    ].join(","));
    const blob = new Blob(["﻿" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `vendor-demand-${days}d${category ? `-${category}` : ""}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <section className="mb-4 rounded-[6px] border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-indigo-900">업체 수요 랭킹</h2>
          <p className="mt-1 text-xs text-indigo-800">
            소비자 행동(노출·상세·찜·조합·견적) 일별 롤업 — 유효점수는 예식일 등록 커플 한정
            {loadedAt ? ` · ${loadedAt} 기준` : ""}
          </p>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-[6px] border border-indigo-200 bg-white px-2 py-2 text-xs"
          >
            <option value={7}>최근 7일</option>
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
          </select>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-[6px] border border-indigo-200 bg-white px-2 py-2 text-xs"
          >
            <option value="">전체 카테고리</option>
            <option value="studio">스튜디오</option>
            <option value="dress">드레스</option>
            <option value="makeup">메이크업</option>
            <option value="venue">웨딩홀</option>
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-[6px] bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "불러오는 중…" : "불러오기"}
          </button>
          <button
            type="button"
            onClick={aggregateToday}
            disabled={loading}
            title="pg_cron(매일 04:00)이 돌기 전 오늘분을 즉시 롤업"
            className="rounded-[6px] border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-900 disabled:opacity-40"
          >
            오늘분 집계
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={rows.length === 0}
            className="rounded-[6px] border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-900 disabled:opacity-40"
          >
            CSV
          </button>
        </div>
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 max-h-80 overflow-auto rounded-[6px] border border-indigo-100 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-indigo-100/80 text-indigo-900">
              <tr>
                <th className="px-2 py-1.5 text-left">업체</th>
                <th className="px-2 py-1.5 text-right">노출</th>
                <th className="px-2 py-1.5 text-right">상세</th>
                <th className="px-2 py-1.5 text-right">찜</th>
                <th className="px-2 py-1.5 text-right">조합</th>
                <th className="px-2 py-1.5 text-right">견적</th>
                <th className="px-2 py-1.5 text-right">가중점수</th>
                <th className="px-2 py-1.5 text-right font-semibold">유효점수</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((row) => (
                <tr key={row.vendor_id} className="border-t border-indigo-50">
                  <td className="px-2 py-1.5">
                    {row.name}
                    <span className="ml-1 text-[10px] text-indigo-400">{row.category}·{row.region_code ?? "-"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.impressions}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.detail_views}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.wishlist_adds}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.combo_adds}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.quote_requests}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.weighted_score}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{row.qualified_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// 2026-07-22 전량 추출 런: 자동 검증 통과 유닛('agent_auto_validated')의 pending 행을
// 사람이 건수 확인 후 한 번에 승인하는 패널. 공개 전환은 하지 않는다.
function AutoValidatedApprovalPanel() {
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCount() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/price/auto-approve");
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "대상 건수를 확인하지 못했습니다.");
      setEligibleCount(body.eligible_count);
      setCriteria(body.criteria ?? "");
    } catch (caught) {
      setEligibleCount(null);
      setError(caught instanceof Error ? caught.message : "대상 건수를 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (busy || !eligibleCount || eligibleCount < 1) return;
    if (!window.confirm(
      `자동 검증 통과분 ${eligibleCount}건을 승인합니다. 공개 전환은 하지 않습니다. 계속할까요?`,
    )) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/price/auto-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: "approve_agent_auto_validated_pending",
          expected_count: eligibleCount,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "일괄 승인에 실패했습니다.");
      setNotice(`승인 ${body.approved}건 완료 (충돌 ${body.conflicts} · 실패 ${body.failed})`);
      setEligibleCount(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "일괄 승인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-[6px] border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-900">자동 검증 통과분 일괄 승인</h2>
          <p className="mt-1 text-xs text-emerald-800">
            {criteria || "confidence≥0.9 · 커버리지 갭 0 · 지어냄 검사 통과 · vendor 확정(dedupe 후보 제외) 유닛의 pending 공시가"}
          </p>
          {eligibleCount !== null && (
            <p className="mt-1 text-sm font-semibold text-emerald-900">대상 {eligibleCount}건</p>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          {notice && <p className="mt-1 text-xs text-emerald-700">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadCount}
            disabled={busy}
            className="rounded-[6px] border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-900 disabled:opacity-50"
          >
            대상 건수 확인
          </button>
          <button
            type="button"
            onClick={execute}
            disabled={busy || !eligibleCount}
            className="rounded-[6px] bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            일괄 승인 실행
          </button>
        </div>
      </div>
    </section>
  );
}

function BulkApprovalPanel() {
  const [summary, setSummary] = useState<BulkApprovalSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCount() {
    if (loading || executing) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/price/bulk-approval");
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.blocked_reason ?? body.error ?? "일괄 승인 대상을 계산하지 못했습니다.");
      }
      setSummary(body as BulkApprovalSummary);
    } catch (caught) {
      setSummary(null);
      setError(caught instanceof Error ? caught.message : "일괄 승인 대상을 계산하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (
      !summary?.can_execute
      || summary.batch_eligible_count === null
      || summary.batch_eligible_count < 1
      || summary.eligibility_contract_version !== 1
      || !summary.eligibility_sha256
      || executing
    ) return;
    if (!window.confirm(
      `자동 검증을 통과한 이번 배치 ${summary.batch_eligible_count}건을 승인합니다. 공개 전환은 하지 않습니다. 계속할까요?`,
    )) return;
    setExecuting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/price/bulk-approval", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eligibility_contract_version: 1,
          confirmation: "approve_automatically_validated_pending",
          expected_eligible_count: summary.batch_eligible_count,
          expected_eligibility_sha256: summary.eligibility_sha256,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.blocked_reason ?? body.error ?? "일괄 승인을 완료하지 못했습니다.");
      setNotice(
        `승인 ${body.approved_count ?? 0}건 · 충돌 ${body.conflict_count ?? 0}건 · 실패 ${body.failed_count ?? 0}건`,
      );
      setSummary(null);
    } catch (caught) {
      // Any failed mutation invalidates the human-bound snapshot in the UI.
      // A retry must begin with a fresh eligibility count and fingerprint.
      setSummary(null);
      setError(caught instanceof Error ? caught.message : "일괄 승인을 완료하지 못했습니다.");
    } finally {
      setExecuting(false);
    }
  }

  const blocked = summary !== null && !summary.can_execute;
  return (
    <section
      aria-label="자동 검증 통과분 일괄 승인"
      className="mb-7 rounded-[6px] border border-[#E2D3C8] bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-wide text-[var(--color-rose-700)]">HUMAN-CONFIRMED BULK REVIEW</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--hb-text-strong)]">자동 검증 통과분 일괄 승인</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--hb-success)]">
            버튼을 누르면 이번 승인 배치(최대 25건)만 계산합니다. 승인 실행은 건수 확인 뒤 다시 눌러야 하며 공개 전환은 별도입니다.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || executing || blocked}
          onClick={() => void (summary ? execute() : loadCount())}
          className="min-h-11 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading
            ? "승인 가능 건수 확인 중…"
            : executing
              ? "일괄 승인 중…"
              : summary
                ? summary.batch_eligible_count === null
                  ? "승인 가능 건수 확인 불가"
                  : `${summary.batch_eligible_count}건 승인하기`
                : "승인 가능 건수 확인"}
        </button>
      </div>
      {summary ? (
        <div className={`mt-4 rounded-[6px] border px-4 py-3 text-sm ${blocked ? "border-[#B89785]/35 bg-[var(--hb-surface-hover)] text-[var(--hb-text-strong)]" : "border-[#C7D1C2] bg-[#F2F7F3] text-[var(--hb-text-strong)]"}`}>
          <p className="font-bold">
            이번 승인 배치 {summary.batch_eligible_count ?? "확인 불가"}건
            {summary.has_more ? " · 이후 승인 대상 더 있음" : ""}
          </p>
          {summary.blocked_reason ? <p className="mt-1 leading-6">{summary.blocked_reason}</p> : null}
          {blocked ? (
            <button
              type="button"
              onClick={() => {
                setSummary(null);
                void loadCount();
              }}
              className="mt-3 min-h-10 rounded-[6px] border border-[#B89785]/50 bg-white px-3 text-xs font-bold"
            >
              대상 다시 확인
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="mt-4 rounded-[6px] bg-[#E8F1EA] px-4 py-3 text-sm font-semibold text-[var(--hb-text-strong)]" role="status">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-[6px] bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p> : null}
    </section>
  );
}

function SourceLoadError({
  message,
  recordId,
  kind,
  labels,
}: {
  message: string;
  recordId: string;
  kind: "price" | "agency_package";
  labels: string[];
}) {
  return (
    <div className="grid min-h-[360px] place-items-center p-8 text-center text-sm text-[#8A3030]">
      <div>
        <p>{message}</p>
        <p className="mt-2 text-xs leading-5 text-[var(--hb-success)]">파생 미리보기를 열지 못해도 private 원본은 직접 확인할 수 있습니다.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {labels.map((label, index) => (
            <a
              key={`${label}-${index}`}
              href={`/api/admin/price/${recordId}/source?kind=${kind}&redirect=1&index=${index}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center rounded-[6px] border border-[#C7D1C2] bg-white px-3 text-xs font-bold text-[var(--hb-text-strong)]"
            >
              원본 {index + 1} · {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function joinedVendor(value: DedupeVendor | DedupeVendor[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function joinedAgency(value: DedupeAgency | DedupeAgency[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function appendUniqueById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (!merged.has(item.id)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

function ReviewStatusBadge({
  needsReview,
  issueCount,
}: {
  needsReview: boolean;
  issueCount: number;
}) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${needsReview ? "bg-[#FFF0DE] text-[#92532C]" : "bg-[#E8F1EA] text-[#3F6B55]"}`}>
      {needsReview
        ? `검토 필요${issueCount > 0 ? ` · ${issueCount}` : ""}`
        : `추가 검토 플래그 없음${issueCount > 0 ? ` · 이력 ${issueCount}` : ""}`}
    </span>
  );
}

function ValidationReviewNotice({
  needsReview,
  issueCodes,
  reviewStatus,
}: {
  needsReview: boolean;
  issueCodes: string[];
  reviewStatus: "pending" | "approved" | "rejected";
}) {
  return (
    <section
      aria-label="자동 검증 상태"
      className={`border-b px-5 py-4 ${needsReview ? "border-[#E7C9A9] bg-[#FFF6E8] text-[#70472D]" : "border-[#C7D1C2] bg-[#F2F7F3] text-[var(--hb-text-strong)]"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {needsReview
            ? <AlertTriangle className="mt-0.5 shrink-0" size={19} aria-hidden="true" />
            : <Check className="mt-0.5 shrink-0" size={19} aria-hidden="true" />}
          <div>
            <p className="font-bold">{needsReview ? "자동 검증이 추가 사람 검토를 요구합니다." : "자동 검증의 추가 검토 플래그가 없습니다."}</p>
            <p className="mt-1 text-sm leading-6">
              {needsReview
                ? issueCodes.length > 0
                  ? "아래 이슈를 원본과 대조해 수정하거나 사실임을 확인한 뒤에만 승인 버튼을 직접 눌러 주세요. 자동으로 승인되지 않습니다."
                  : "세부 이슈 코드가 없으므로 원본 전체를 직접 대조한 뒤 승인 여부를 판단해 주세요. 자동으로 승인되지 않습니다."
                : reviewStatus === "approved"
                  ? "현재 관리자가 명시적으로 승인한 항목입니다. 아래 수집 당시 검증 이력은 감사용으로 계속 표시합니다."
                  : reviewStatus === "rejected"
                    ? "추가 자동 경고가 없다는 뜻일 뿐 현재 항목은 반려 상태입니다. 다시 승인하려면 원본을 대조하고 승인 버튼을 직접 눌러야 합니다."
                    : "추가 자동 경고가 없다는 뜻일 뿐 승인 완료를 의미하지 않습니다. 원본을 대조한 뒤 승인 버튼을 직접 눌러야 합니다."}
            </p>
          </div>
        </div>
        <code className={`shrink-0 rounded-[6px] px-2 py-1 text-[11px] font-bold ${needsReview ? "bg-white/70" : "bg-white"}`}>
          needs_review={String(needsReview)}
        </code>
      </div>
      {issueCodes.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="검증 이슈 목록">
          {issueCodes.map((code) => (
            <li key={code} className="min-w-0 rounded-[6px] border border-current/15 bg-white/70 px-3 py-2">
              <p className="text-sm font-semibold leading-5">{validationIssueLabel(code)}</p>
              <code className="mt-1 block break-all text-[11px] opacity-75">{code}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PriceReviewWorkspace() {
  const [status, setStatus] = useState<PriceStatus>("pending");
  const [items, setItems] = useState<PriceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceFiles, setSourceFiles] = useState<DisclosureSourceFile[]>([]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [sourceError, setSourceError] = useState("");
  const [optionDrafts, setOptionDrafts] = useState<OptionDraft[]>([]);
  const [selectedAliasIds, setSelectedAliasIds] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRequestId = useRef(0);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (append && loadingMoreRef.current) return;
    const activeRequest = ++listRequestId.current;
    if (append) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoading(true);
    }
    setError("");
    try {
      const params = new URLSearchParams({ status, limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/price?${params.toString()}`);
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "검수 목록을 불러오지 못했습니다.");
      if (activeRequest !== listRequestId.current) return;
      const incoming = Array.isArray(body.prices) ? body.prices as PriceItem[] : [];
      setItems((current) => append
        ? appendUniqueById(current, incoming)
        : incoming);
      if (!append) {
        setSelectedId((current) => incoming.some((item) => item.id === current)
          ? current
          : incoming[0]?.id ?? null);
      }
      setHasMore(body.has_more === true);
      setNextCursor(typeof body.next_cursor === "string" ? body.next_cursor : null);
    } catch (caught) {
      if (activeRequest === listRequestId.current) {
        setError(caught instanceof Error ? caught.message : "검수 목록을 불러오지 못했습니다.");
      }
    } finally {
      if (append) loadingMoreRef.current = false;
      if (activeRequest === listRequestId.current) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    setOptionDrafts((selected?.options ?? []).map((option) => ({
      ...option,
      clientKey: option.id ?? crypto.randomUUID(),
    })));
    setSelectedAliasIds((selected?.alias_proposals ?? [])
      .filter((proposal) => proposal.status === "approved")
      .map((proposal) => proposal.id));
  }, [selected]);

  useEffect(() => {
    setSourceFiles([]);
    setSourceIndex(0);
    setSourceError("");
    if (!selected?.source_available) return;
    let active = true;
    void fetch(`/api/admin/price/${selected.id}/source`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "원본 파일을 열 수 없습니다.");
        if (active) setSourceFiles(body.files ?? []);
      })
      .catch((caught) => {
        if (active) setSourceError(caught instanceof Error ? caught.message : "원본 파일을 열 수 없습니다.");
      });
    return () => { active = false; };
  }, [selected]);

  async function submit(action: "save" | "approve" | "reject", form: HTMLFormElement) {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(form);
    const nullableNumber = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? null : Number(value);
    };
    try {
      const response = await fetch(`/api/admin/price/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          expected_review_version: selected.review_version,
          category: data.get("category"),
          item_name: data.get("item_name"),
          base_spec: data.get("base_spec"),
          price_min_krw: nullableNumber("price_min_krw"),
          price_max_krw: nullableNumber("price_max_krw"),
          vat_note: data.get("vat_note"),
          price_note: data.get("price_note"),
          source_quote: data.get("source_quote"),
          confidence: nullableNumber("confidence"),
          selected_alias_proposal_ids: action === "approve" ? selectedAliasIds : [],
          options: optionDrafts.map((option) => ({
            id: option.id,
            name: option.name,
            price_min_krw: option.price_min_krw,
            price_max_krw: option.price_max_krw,
            unit: option.unit,
            condition: option.condition,
            raw_text: option.raw_text,
            source_quote: option.source_quote,
            confidence: option.confidence,
          })),
        }),
      });
      const body = await response.json();
      if (response.status === 409 && body.code === "REVIEW_VERSION_CONFLICT") {
        await load();
        setError(REVIEW_VERSION_CONFLICT_MESSAGE);
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "저장하지 못했습니다.");
      setNotice(action === "approve" ? "승인했습니다." : action === "reject" ? "반려했습니다." : "수정 내용을 저장했습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <AdminLoadingState label="가격 근거를 불러오는 중입니다…" />;
  if (error && items.length === 0) return <AdminErrorState message={error} onRetry={() => void load()} />;

  const activeSource = sourceFiles[sourceIndex] ?? null;

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#8F6662]">근거 우선 · 낮은 신뢰도 순</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--hb-text-strong)]">공시 가격 검수</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--hb-success)]">원문과 추출값을 나란히 확인한 뒤 승인하세요. 근거가 없거나 원본이 보관되지 않은 행은 승인할 수 없습니다.</p>
        </div>
        <label className="text-sm font-semibold text-[var(--hb-text-strong)]">
          상태
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PriceStatus)}
            className="ml-2 min-h-10 rounded-[6px] border border-[#C7D1C2] bg-white px-3 font-normal"
          >
            <option value="pending">검수 대기</option>
            <option value="approved">승인</option>
            <option value="rejected">반려</option>
            <option value="all">전체</option>
          </select>
        </label>
      </div>

      {notice && <p className="mb-4 rounded-[6px] bg-[#C7D1C2]/45 px-4 py-3 text-sm font-semibold text-[var(--hb-text-strong)]" role="status">{notice}</p>}
      {error && <p className="mb-4 rounded-[6px] bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}

      {items.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[#C7D1C2] bg-white px-6 py-16 text-center">
          <Check className="mx-auto text-[var(--hb-success)]" aria-hidden="true" />
          <p className="mt-3 font-semibold text-[var(--hb-text-strong)]">이 상태의 검수 항목이 없습니다.</p>
          <p className="mt-1 text-sm text-[var(--hb-success)]">새 적재가 끝나면 이곳에 낮은 신뢰도 순으로 표시됩니다.</p>
        </div>
      ) : (
        <div className="grid min-h-[690px] gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white" aria-label="가격 검수 항목">
            <div className="border-b border-[var(--hb-hairline)] px-4 py-3 text-xs font-semibold text-[var(--hb-success)]">{items.length}개 항목</div>
            <div className="max-h-[740px] overflow-y-auto">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`block w-full border-b border-[#F0E8DE] px-4 py-4 text-left transition-colors ${selectedId === item.id ? "bg-[var(--hb-surface-hover)]" : "hover:bg-[var(--hb-surface-page)]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words font-semibold text-[var(--hb-text-strong)]">{item.vendor?.name ?? item.agency?.name ?? "연결 업체 없음"}</p>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ReviewStatusBadge needsReview={item.needs_review} issueCount={item.validation_issue_codes.length} />
                      <span className="rounded-full bg-[#EFE4D7] px-2 py-1 text-[11px] font-bold text-[var(--color-rose-700)]">
                        신뢰도 {item.confidence === null ? "미확인" : `${Math.round(item.confidence * 100)}%`}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-[var(--hb-text-strong)]">{item.item_name}</p>
                  {item.vendor && (
                    <p className={`mt-2 text-[11px] font-bold ${item.vendor.status === "approved" ? "text-[#3F6B55]" : "text-[#A05A35]"}`}>
                      업체 상태 · {item.vendor.status === "approved" ? "공개 승인" : "공개 대기"}
                    </p>
                  )}
                  {item.validation_issue_codes.length > 0 && (
                    <p className={`mt-2 line-clamp-2 text-xs font-semibold leading-5 ${item.needs_review ? "text-[#92532C]" : "text-[#58705E]"}`}>
                      {item.needs_review ? "검증 이슈" : "검증 이력"} · {validationIssueLabel(item.validation_issue_codes[0])}
                      {item.validation_issue_codes.length > 1 ? ` 외 ${item.validation_issue_codes.length - 1}개` : ""}
                    </p>
                  )}
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--hb-success)]">{item.source_quote || "근거 원문 없음"}</p>
                </button>
              ))}
              {hasMore && nextCursor && (
                <div className="border-t border-[var(--hb-hairline)] p-3">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void load(nextCursor, true)}
                    className="min-h-10 w-full rounded-[6px] border border-[#C7D1C2] bg-white px-3 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50"
                  >
                    {loadingMore ? "더 불러오는 중…" : "검수 항목 더 불러오기"}
                  </button>
                </div>
              )}
            </div>
          </aside>

          {selected && (
            <form
              key={`${selected.id}:${selected.review_version}`}
              onSubmit={(event) => { event.preventDefault(); void submit("save", event.currentTarget); }}
              className="overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white"
            >
              <ValidationReviewNotice
                needsReview={selected.needs_review}
                issueCodes={selected.validation_issue_codes}
                reviewStatus={selected.review_status}
              />
              {selected.vendor && selected.vendor.status !== "approved" && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E7C9A9] bg-[#FFF6E8] px-5 py-3 text-sm text-[#70472D]" role="status">
                  <p className="leading-6">
                    <strong>업체 공개 승인도 필요합니다.</strong> 이 가격을 승인해도 업체 상태가 승인되지 않으면 소비자 화면과 아모라 추천에 노출되지 않습니다.
                  </p>
                  {/* ⚠️ 여기 `href="/admin/vendors"` 였는데 **그 페이지는 없다.** 지워진
                      것이 아니라 만들어진 적이 없다(git 이력 0건) — 계획서의 경로를 코드에
                      먼저 적어 둔 것으로 보인다. 눌러도 404 였다.
                      업체 승인/반려는 `/admin` 의 "업체 심사" 탭이 이미 전부 하고 있다
                      (`admin/page.tsx` 의 `activeTab === "vendors"`, `/api/admin/vendors`).
                      다만 그 화면은 URL 을 읽지 않고 첫 탭("사전등록")에서 시작하므로,
                      어디로 가는지 문구로 알려 준다. */}
                  <Link href="/admin" className="shrink-0 rounded-[6px] border border-[#C98E5C] bg-white px-3 py-2 text-xs font-bold text-[#70472D] hover:bg-[#FFF9F1]">
                    관리자 대시보드 · 업체 심사 탭
                  </Link>
                </div>
              )}
              <div className="grid lg:grid-cols-2">
                <section className="border-b border-[#E2D3C8] bg-[var(--hb-surface-hover)] p-5 lg:border-b-0 lg:border-r">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">ORIGINAL EVIDENCE</p>
                      <h3 className="mt-1 font-bold text-[var(--hb-text-strong)]">원본 대조</h3>
                    </div>
                    {selected.source_available && <SignedSourceLink priceId={selected.id} label="새 탭에서 원본" expectedCount={selected.source_count} />}
                  </div>
                  {sourceFiles.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-2" aria-label="원본 파일 선택">
                      {sourceFiles.map((file, index) => (
                        <button key={`${file.label}-${index}`} type="button" onClick={() => setSourceIndex(index)} className={`min-h-9 rounded-[6px] px-3 text-xs font-semibold ${sourceIndex === index ? "bg-[var(--hb-primary)] text-white" : "border border-[#C7D1C2] bg-white text-[var(--hb-text-strong)]"}`}>원본 {index + 1} · {file.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 min-h-[360px] overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white">
                    {!selected.source_available ? (
                      <div className="grid min-h-[360px] place-items-center p-8 text-center text-sm text-[#8A3030]">보관된 원본 파일이 없습니다. 승인 전에 적재 상태를 확인하세요.</div>
                    ) : sourceError ? (
                      <SourceLoadError message={sourceError} recordId={selected.id} kind="price" labels={selected.source_file_labels} />
                    ) : !activeSource ? (
                      <div className="grid min-h-[360px] place-items-center text-sm text-[var(--hb-success)]">원본을 안전하게 여는 중…</div>
                    ) : (
                      <DisclosureSourcePreview source={activeSource} title="가격 공시 원본" />
                    )}
                  </div>
                  <div className="mt-4 border-l-4 border-[#A77B74] bg-white px-4 py-3">
                    <p className="text-xs font-bold text-[var(--color-rose-700)]">추출 근거 원문</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--hb-text-strong)]">{selected.source_quote || "근거 원문 없음"}</p>
                  </div>
                </section>

                <section className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">EXTRACTED DATA</p>
                      <h3 className="mt-1 font-bold text-[var(--hb-text-strong)]">추출값 수정</h3>
                    </div>
                    {selected.edited_by_admin && <span className="rounded-full bg-[#C7D1C2]/50 px-2.5 py-1 text-xs font-semibold text-[var(--hb-text-strong)]">관리자 수정</span>}
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label="분류"><select name="category" defaultValue={selected.category} required className="admin-input">{OFFICIAL_PRICE_CATEGORIES.map((category) => <option key={category} value={category}>{({ studio: "스튜디오", dress: "드레스", makeup: "메이크업", hall: "예식장", other: "기타" } as const)[category]}</option>)}</select></Field>
                    <Field label="항목명"><input name="item_name" defaultValue={selected.item_name} required className="admin-input" /></Field>
                    <Field label="최소 금액"><input name="price_min_krw" type="number" min="0" defaultValue={selected.price_min_krw ?? ""} className="admin-input" /></Field>
                    <Field label="최대 금액"><input name="price_max_krw" type="number" min="0" defaultValue={selected.price_max_krw ?? ""} className="admin-input" /></Field>
                    <Field label="신뢰도 (0~1)"><input name="confidence" type="number" min="0" max="1" step="0.01" defaultValue={selected.confidence ?? ""} className="admin-input" /></Field>
                    <Field label="VAT 안내"><input name="vat_note" defaultValue={selected.vat_note ?? ""} className="admin-input" /></Field>
                  </div>
                  <div className="mt-4 space-y-4">
                    <Field label="기본 구성"><textarea name="base_spec" defaultValue={selected.base_spec ?? ""} rows={3} className="admin-input resize-y" /></Field>
                    <Field label="가격 안내"><textarea name="price_note" defaultValue={selected.price_note ?? ""} rows={3} className="admin-input resize-y" /></Field>
                    <Field label="근거 원문"><textarea name="source_quote" defaultValue={selected.source_quote ?? ""} rows={5} className="admin-input resize-y" /></Field>
                  </div>
                  {selected.alias_proposals.length > 0 && (
                    <fieldset className="mt-5 border-t border-[var(--hb-hairline)] pt-4">
                      <legend className="text-sm font-bold text-[var(--hb-text-strong)]">업체 옛 상호·별칭 제안</legend>
                      <p className="mt-1 text-xs leading-5 text-[var(--hb-success)]">
                        가격 승인 시 체크한 대기 제안만 업체 별칭으로 승인되고, 체크하지 않은 대기 제안은 반려됩니다. 수정 저장은 대기 상태를 유지하고 가격 반려는 모든 대기 제안을 함께 반려합니다.
                      </p>
                      <div className="mt-3 space-y-2">
                        {selected.alias_proposals.map((proposal) => {
                          const locked = proposal.status !== "pending";
                          const checked = proposal.status === "approved"
                            || (proposal.status === "pending" && selectedAliasIds.includes(proposal.id));
                          return (
                            <label key={proposal.id} className={`flex min-h-11 items-center gap-3 rounded-[6px] border px-3 py-2 text-sm ${locked ? "border-[#E2D3C8] bg-[var(--hb-surface-page)] text-[var(--hb-success)]" : "border-[#C7D1C2] bg-white text-[var(--hb-text-strong)]"}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked || saving}
                                onChange={(event) => setSelectedAliasIds((current) => event.target.checked
                                  ? [...new Set([...current, proposal.id])]
                                  : current.filter((id) => id !== proposal.id))}
                                aria-label={`${proposal.alias} 별칭 제안`}
                              />
                              <span className="min-w-0 flex-1 break-words font-semibold">{proposal.alias}</span>
                              <span className="shrink-0 text-xs font-bold">
                                {proposal.status === "approved" ? "승인됨" : proposal.status === "rejected" ? "반려됨" : "검토 대기"}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  <div className="mt-5 border-t border-[var(--hb-hairline)] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div><p className="text-sm font-bold text-[var(--hb-text-strong)]">추가금 · 옵션</p><p className="mt-1 text-xs text-[var(--hb-success)]">승인할 옵션에도 근거 원문과 신뢰도가 필요합니다.</p></div>
                      <button
                        type="button"
                        onClick={() => setOptionDrafts((current) => [...current, {
                          id: null,
                          clientKey: crypto.randomUUID(),
                          name: "",
                          price_min_krw: null,
                          price_max_krw: null,
                          unit: null,
                          condition: null,
                          raw_text: null,
                          source_quote: null,
                          confidence: null,
                        }])}
                        className="inline-flex min-h-9 items-center gap-1 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-semibold text-[var(--hb-text-strong)]"
                      >
                        <Plus size={14} />옵션 추가
                      </button>
                    </div>
                    {optionDrafts.length === 0 ? (
                      <p className="mt-4 rounded-[6px] bg-[var(--hb-surface-page)] px-3 py-4 text-center text-xs text-[var(--hb-success)]">추출된 추가금이 없습니다.</p>
                    ) : (
                      <div className="mt-3 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
                        {optionDrafts.map((option, index) => {
                          const updateOption = (patch: Partial<OptionDraft>) => setOptionDrafts((current) => current.map((item) => item.clientKey === option.clientKey ? { ...item, ...patch } : item));
                          return (
                            <div key={option.clientKey} className="py-4">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-bold text-[var(--color-rose-700)]">옵션 {index + 1}</p>
                                <button type="button" onClick={() => setOptionDrafts((current) => current.filter((item) => item.clientKey !== option.clientKey))} className="inline-flex min-h-8 items-center gap-1 px-2 text-xs font-semibold text-[#A23F3F]"><Trash2 size={13} />삭제</button>
                              </div>
                              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                <Field label="옵션명"><input value={option.name} required onChange={(event) => updateOption({ name: event.target.value })} className="admin-input" /></Field>
                                <Field label="단위"><input value={option.unit ?? ""} onChange={(event) => updateOption({ unit: event.target.value || null })} className="admin-input" /></Field>
                                <Field label="최소 금액"><input type="number" min="0" value={option.price_min_krw ?? ""} onChange={(event) => updateOption({ price_min_krw: event.target.value === "" ? null : Number(event.target.value) })} className="admin-input" /></Field>
                                <Field label="최대 금액"><input type="number" min="0" value={option.price_max_krw ?? ""} onChange={(event) => updateOption({ price_max_krw: event.target.value === "" ? null : Number(event.target.value) })} className="admin-input" /></Field>
                                <Field label="조건"><input value={option.condition ?? ""} onChange={(event) => updateOption({ condition: event.target.value || null })} className="admin-input" /></Field>
                                <Field label="신뢰도 (0~1)"><input type="number" min="0" max="1" step="0.01" value={option.confidence ?? ""} onChange={(event) => updateOption({ confidence: event.target.value === "" ? null : Number(event.target.value) })} className="admin-input" /></Field>
                              </div>
                              <div className="mt-3 grid gap-3">
                                <Field label="원문 표기"><textarea value={option.raw_text ?? ""} onChange={(event) => updateOption({ raw_text: event.target.value || null })} rows={2} className="admin-input resize-y" /></Field>
                                <Field label="옵션 근거 원문"><textarea value={option.source_quote ?? ""} onChange={(event) => updateOption({ source_quote: event.target.value || null })} rows={3} className="admin-input resize-y" /></Field>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-[#E2D3C8] bg-[var(--hb-surface-page)] p-4">
                <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50"><Save size={16} />수정 저장</button>
                <button type="button" disabled={saving} onClick={(event) => void submit("reject", event.currentTarget.form!)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#D95F5F]/40 bg-white px-4 text-sm font-semibold text-[#A23F3F] disabled:opacity-50"><X size={16} />반려</button>
                <button type="button" disabled={saving || !selected.source_available} onClick={(event) => void submit("approve", event.currentTarget.form!)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Check size={16} />{selected.needs_review ? "검증 이슈·근거 확인 후 승인" : "근거 확인 후 승인"}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function AgencyPackageReviewWorkspace() {
  const [status, setStatus] = useState<PriceStatus>("pending");
  const [items, setItems] = useState<AgencyPackageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scopeDraft, setScopeDraft] = useState<AgencyPackageItem["category_scope"]>([]);
  const [optionDrafts, setOptionDrafts] = useState<AgencyPackageOptionDraft[]>([]);
  const [sourceFiles, setSourceFiles] = useState<DisclosureSourceFile[]>([]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [sourceError, setSourceError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRequestId = useRef(0);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (append && loadingMoreRef.current) return;
    const activeRequest = ++listRequestId.current;
    if (append) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoading(true);
    }
    setError("");
    try {
      const params = new URLSearchParams({ kind: "agency_package", status, limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/price?${params.toString()}`);
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "패키지 검수 목록을 불러오지 못했습니다.");
      if (activeRequest !== listRequestId.current) return;
      const incoming = Array.isArray(body.packages) ? body.packages as AgencyPackageItem[] : [];
      setItems((current) => append
        ? appendUniqueById(current, incoming)
        : incoming);
      if (!append) {
        setSelectedId((current) => incoming.some((item) => item.id === current)
          ? current
          : incoming[0]?.id ?? null);
      }
      setHasMore(body.has_more === true);
      setNextCursor(typeof body.next_cursor === "string" ? body.next_cursor : null);
    } catch (caught) {
      if (activeRequest === listRequestId.current) {
        setError(caught instanceof Error ? caught.message : "패키지 검수 목록을 불러오지 못했습니다.");
      }
    } finally {
      if (append) loadingMoreRef.current = false;
      if (activeRequest === listRequestId.current) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    setScopeDraft(selected?.category_scope ?? []);
    setOptionDrafts((selected?.options ?? []).map((option) => ({
      ...option,
      clientKey: crypto.randomUUID(),
    })));
  }, [selected]);

  useEffect(() => {
    setSourceFiles([]);
    setSourceIndex(0);
    setSourceError("");
    if (!selected?.source_available) return;
    let active = true;
    void fetch(`/api/admin/price/${selected.id}/source?kind=agency_package`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "패키지 원본 파일을 열 수 없습니다.");
        if (active) setSourceFiles(body.files ?? []);
      })
      .catch((caught) => {
        if (active) setSourceError(caught instanceof Error ? caught.message : "패키지 원본 파일을 열 수 없습니다.");
      });
    return () => { active = false; };
  }, [selected]);

  async function submit(action: "save" | "approve" | "reject", form: HTMLFormElement) {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(form);
    const nullableNumber = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? null : Number(value);
    };
    try {
      const payload = {
        action,
        expected_review_version: selected.review_version,
        package_name: data.get("package_name"),
        category_scope: scopeDraft,
        price_min_krw: nullableNumber("price_min_krw"),
        price_max_krw: nullableNumber("price_max_krw"),
        vat_note: data.get("vat_note"),
        price_note: data.get("price_note"),
        source_quote: data.get("source_quote"),
        confidence: nullableNumber("confidence"),
        options: optionDrafts.map((option) => ({
          name: option.name,
          price_min_krw: option.price_min_krw,
          price_max_krw: option.price_max_krw,
          unit: option.unit,
          condition: option.condition,
          raw_text: option.raw_text,
          source_quote: option.source_quote,
        })),
      };
      const validation = parseAgencyPackageReviewSubmission(payload);
      if (!validation.success) {
        throw new Error(validation.error.issues[0]?.message ?? "패키지 입력값을 확인해 주세요.");
      }
      const response = await fetch(`/api/admin/price/${selected.id}?kind=agency_package`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      const body = await response.json();
      if (response.status === 409 && body.code === "REVIEW_VERSION_CONFLICT") {
        await load();
        setError(REVIEW_VERSION_CONFLICT_MESSAGE);
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "패키지 검수 내용을 저장하지 못했습니다.");
      setNotice(action === "approve" ? "패키지를 승인했습니다." : action === "reject" ? "패키지를 반려했습니다." : "패키지 수정 내용을 저장했습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "패키지 검수 내용을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <AdminLoadingState label="대행사 패키지 근거를 불러오는 중입니다…" />;
  if (error && items.length === 0) return <AdminErrorState message={error} onRetry={() => void load()} />;

  const activeSource = sourceFiles[sourceIndex] ?? null;

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#8F6662]">패키지 구성 · 원문 근거 · 낮은 신뢰도 순</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--hb-text-strong)]">대행사 패키지 검수</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--hb-success)]">스드메·예식장 묶음 범위와 구성 옵션을 원문 옆에서 확인합니다. 패키지 또는 옵션 가격이 하나도 없으면 승인할 수 없습니다.</p>
        </div>
        <label className="text-sm font-semibold text-[var(--hb-text-strong)]">
          상태
          <select value={status} onChange={(event) => setStatus(event.target.value as PriceStatus)} className="ml-2 min-h-10 rounded-[6px] border border-[#C7D1C2] bg-white px-3 font-normal">
            <option value="pending">검수 대기</option><option value="approved">승인</option><option value="rejected">반려</option><option value="all">전체</option>
          </select>
        </label>
      </div>

      {notice && <p className="mb-4 rounded-[6px] bg-[#C7D1C2]/45 px-4 py-3 text-sm font-semibold text-[var(--hb-text-strong)]" role="status">{notice}</p>}
      {error && <p className="mb-4 rounded-[6px] bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}

      {items.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[#C7D1C2] bg-white px-6 py-16 text-center"><Check className="mx-auto text-[var(--hb-success)]" /><p className="mt-3 font-semibold text-[var(--hb-text-strong)]">이 상태의 패키지 검수 항목이 없습니다.</p></div>
      ) : (
        <div className="grid min-h-[690px] gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white" aria-label="패키지 검수 목록">
            <div className="border-b border-[var(--hb-hairline)] px-4 py-3 text-xs font-semibold text-[var(--hb-success)]">{items.length}개 패키지</div>
            <div className="max-h-[740px] overflow-y-auto">
              {items.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`block w-full border-b border-[#F0E8DE] px-4 py-4 text-left transition-colors ${selectedId === item.id ? "bg-[var(--hb-surface-hover)]" : "hover:bg-[var(--hb-surface-page)]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words font-semibold text-[var(--hb-text-strong)]">{item.agency?.name ?? "연결 대행사 없음"}</p>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ReviewStatusBadge needsReview={item.needs_review} issueCount={item.validation_issue_codes.length} />
                      <span className="rounded-full bg-[#EFE4D7] px-2 py-1 text-[11px] font-bold text-[var(--color-rose-700)]">신뢰도 {item.confidence === null ? "미확인" : `${Math.round(item.confidence * 100)}%`}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-[var(--hb-text-strong)]">{item.package_name}</p>
                  <p className="mt-2 text-[11px] font-semibold text-[var(--color-rose-700)]">{item.category_scope.map((scope) => PACKAGE_SCOPE_LABELS[scope]).join(" · ") || "범위 미지정"}</p>
                  {item.validation_issue_codes.length > 0 && <p className={`mt-2 line-clamp-2 text-xs font-semibold leading-5 ${item.needs_review ? "text-[#92532C]" : "text-[#58705E]"}`}>{item.needs_review ? "검증 이슈" : "검증 이력"} · {validationIssueLabel(item.validation_issue_codes[0])}{item.validation_issue_codes.length > 1 ? ` 외 ${item.validation_issue_codes.length - 1}개` : ""}</p>}
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--hb-success)]">{item.source_quote || "근거 원문 없음"}</p>
                </button>
              ))}
              {hasMore && nextCursor && (
                <div className="border-t border-[var(--hb-hairline)] p-3">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void load(nextCursor, true)}
                    className="min-h-10 w-full rounded-[6px] border border-[#C7D1C2] bg-white px-3 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50"
                  >
                    {loadingMore ? "더 불러오는 중…" : "패키지 더 불러오기"}
                  </button>
                </div>
              )}
            </div>
          </aside>

          {selected && (
            <form key={`${selected.id}:${selected.review_version}`} onSubmit={(event) => { event.preventDefault(); void submit("save", event.currentTarget); }} className="overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white">
              <ValidationReviewNotice
                needsReview={selected.needs_review}
                issueCodes={selected.validation_issue_codes}
                reviewStatus={selected.review_status}
              />
              <div className="grid lg:grid-cols-2">
                <section className="border-b border-[#E2D3C8] bg-[var(--hb-surface-hover)] p-5 lg:border-b-0 lg:border-r">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">ORIGINAL EVIDENCE</p><h3 className="mt-1 font-bold text-[var(--hb-text-strong)]">패키지 원본 대조</h3></div>{selected.source_available && <SignedSourceLink priceId={selected.id} kind="agency_package" label="새 탭에서 원본" expectedCount={selected.source_count} />}</div>
                  {sourceFiles.length > 1 && <div className="mt-3 flex flex-wrap gap-2" aria-label="패키지 원본 파일 선택">{sourceFiles.map((file, index) => <button key={`${file.label}-${index}`} type="button" onClick={() => setSourceIndex(index)} className={`min-h-9 rounded-[6px] px-3 text-xs font-semibold ${sourceIndex === index ? "bg-[var(--hb-primary)] text-white" : "border border-[#C7D1C2] bg-white text-[var(--hb-text-strong)]"}`}>원본 {index + 1} · {file.label}</button>)}</div>}
                  <div className="mt-4 min-h-[360px] overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white">
                    {!selected.source_available ? <div className="grid min-h-[360px] place-items-center p-8 text-center text-sm text-[#8A3030]">보관된 패키지 원본 파일이 없습니다. 승인 전에 적재 상태를 확인하세요.</div>
                      : sourceError ? <SourceLoadError message={sourceError} recordId={selected.id} kind="agency_package" labels={selected.source_file_labels} />
                        : !activeSource ? <div className="grid min-h-[360px] place-items-center text-sm text-[var(--hb-success)]">패키지 원본을 안전하게 여는 중…</div>
                          : <DisclosureSourcePreview source={activeSource} title="패키지 공시 원본" />}
                  </div>
                  <div className="mt-4 border-l-4 border-[#A77B74] bg-white px-4 py-3"><p className="text-xs font-bold text-[var(--color-rose-700)]">패키지 근거 원문</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--hb-text-strong)]">{selected.source_quote || "근거 원문 없음"}</p></div>
                </section>

                <section className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold tracking-wide text-[var(--color-rose-700)]">EXTRACTED PACKAGE</p><h3 className="mt-1 font-bold text-[var(--hb-text-strong)]">패키지 추출값 수정</h3></div>{selected.edited_by_admin && <span className="rounded-full bg-[#C7D1C2]/50 px-2.5 py-1 text-xs font-semibold text-[var(--hb-text-strong)]">관리자 수정</span>}</div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label="패키지명"><input name="package_name" defaultValue={selected.package_name} required className="admin-input" /></Field>
                    <Field label="신뢰도 (0~1)"><input name="confidence" type="number" min="0" max="1" step="0.01" defaultValue={selected.confidence ?? ""} className="admin-input" /></Field>
                    <Field label="최소 금액"><input name="price_min_krw" type="number" min="0" defaultValue={selected.price_min_krw ?? ""} className="admin-input" /></Field>
                    <Field label="최대 금액"><input name="price_max_krw" type="number" min="0" defaultValue={selected.price_max_krw ?? ""} className="admin-input" /></Field>
                  </div>
                  <fieldset className="mt-4"><legend className="text-sm font-semibold text-[var(--hb-text-strong)]">패키지 범위</legend><div className="mt-2 flex flex-wrap gap-2">{AGENCY_PACKAGE_CATEGORY_SCOPES.map((scope) => { const active = scopeDraft.includes(scope); return <label key={scope} className={`cursor-pointer rounded-full border px-3 py-2 text-sm ${active ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white" : "border-[#C7D1C2] bg-white text-[var(--hb-text-strong)]"}`}><input type="checkbox" checked={active} onChange={() => setScopeDraft((current) => active ? current.filter((value) => value !== scope) : [...current, scope])} className="sr-only" />{PACKAGE_SCOPE_LABELS[scope]}</label>; })}</div></fieldset>
                  <div className="mt-4 space-y-4">
                    <Field label="VAT 안내"><input name="vat_note" defaultValue={selected.vat_note ?? ""} className="admin-input" /></Field>
                    <Field label="가격 안내"><textarea name="price_note" defaultValue={selected.price_note ?? ""} rows={3} className="admin-input resize-y" /></Field>
                    <Field label="근거 원문"><textarea name="source_quote" defaultValue={selected.source_quote ?? ""} rows={5} className="admin-input resize-y" /></Field>
                  </div>
                  <div className="mt-5 border-t border-[var(--hb-hairline)] pt-4">
                    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-[var(--hb-text-strong)]">패키지 구성 옵션</p><p className="mt-1 text-xs text-[var(--hb-success)]">승인할 각 옵션에는 근거 원문이 필요합니다.</p></div><button type="button" onClick={() => setOptionDrafts((current) => [...current, { clientKey: crypto.randomUUID(), name: "", price_min_krw: null, price_max_krw: null, unit: null, condition: null, raw_text: null, source_quote: null }])} className="inline-flex min-h-9 items-center gap-1 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-semibold text-[var(--hb-text-strong)]"><Plus size={14} />옵션 추가</button></div>
                    {optionDrafts.length === 0 ? <p className="mt-4 rounded-[6px] bg-[var(--hb-surface-page)] px-3 py-4 text-center text-xs text-[var(--hb-success)]">추출된 패키지 옵션이 없습니다.</p> : <div className="mt-3 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">{optionDrafts.map((option, index) => { const updateOption = (patch: Partial<AgencyPackageOptionDraft>) => setOptionDrafts((current) => current.map((item) => item.clientKey === option.clientKey ? { ...item, ...patch } : item)); return <div key={option.clientKey} className="py-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-[var(--color-rose-700)]">구성 {index + 1}</p><button type="button" onClick={() => setOptionDrafts((current) => current.filter((item) => item.clientKey !== option.clientKey))} className="inline-flex min-h-8 items-center gap-1 px-2 text-xs font-semibold text-[#A23F3F]"><Trash2 size={13} />삭제</button></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label="옵션명"><input value={option.name} required onChange={(event) => updateOption({ name: event.target.value })} className="admin-input" /></Field><Field label="단위"><input value={option.unit ?? ""} onChange={(event) => updateOption({ unit: event.target.value || null })} className="admin-input" /></Field><Field label="최소 금액"><input type="number" min="0" value={option.price_min_krw ?? ""} onChange={(event) => updateOption({ price_min_krw: event.target.value === "" ? null : Number(event.target.value) })} className="admin-input" /></Field><Field label="최대 금액"><input type="number" min="0" value={option.price_max_krw ?? ""} onChange={(event) => updateOption({ price_max_krw: event.target.value === "" ? null : Number(event.target.value) })} className="admin-input" /></Field><Field label="조건"><input value={option.condition ?? ""} onChange={(event) => updateOption({ condition: event.target.value || null })} className="admin-input" /></Field></div><div className="mt-3 grid gap-3"><Field label="원문 표기"><textarea value={option.raw_text ?? ""} onChange={(event) => updateOption({ raw_text: event.target.value || null })} rows={2} className="admin-input resize-y" /></Field><Field label="옵션 근거 원문"><textarea value={option.source_quote ?? ""} onChange={(event) => updateOption({ source_quote: event.target.value || null })} rows={3} className="admin-input resize-y" /></Field></div></div>; })}</div>}
                  </div>
                </section>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-[#E2D3C8] bg-[var(--hb-surface-page)] p-4"><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50"><Save size={16} />수정 저장</button><button type="button" disabled={saving} onClick={(event) => void submit("reject", event.currentTarget.form!)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#D95F5F]/40 bg-white px-4 text-sm font-semibold text-[#A23F3F] disabled:opacity-50"><X size={16} />반려</button><button type="button" disabled={saving || !selected.source_available} onClick={(event) => void submit("approve", event.currentTarget.form!)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Check size={16} />{selected.needs_review ? "검증 이슈·근거 확인 후 승인" : "근거 확인 후 승인"}</button></div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function SnapshotReadinessPanel() {
  const [snapshots, setSnapshots] = useState<PriceSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/price/snapshots");
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "스냅샷 준비 상태를 불러오지 못했습니다.");
      setSnapshots(Array.isArray(body.snapshots) ? body.snapshots : []);
      setSelectedId((current) => body.snapshots?.some((snapshot: PriceSnapshot) => snapshot.id === current)
        ? current
        : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "스냅샷 준비 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = snapshots.find((snapshot) => snapshot.id === selectedId) ?? null;
  const current = snapshots.find((snapshot) => snapshot.is_current) ?? null;

  async function promote() {
    if (!selected || !selected.readiness || promoting) return;
    const confirmed = window.confirm(
      current
        ? `현재 ${current.period_label} 대신 ${selected.period_label} 스냅샷을 공개합니다. 소비자 가격과 아모라 추천 기준이 바뀝니다. 계속할까요?`
        : `${selected.period_label} 스냅샷을 최초 공개합니다. 소비자 가격과 아모라 추천 기준이 바뀝니다. 계속할까요?`,
    );
    if (!confirmed) return;

    setPromoting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/price/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot_id: selected.id, action: "promote" }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? (response.status === 409
          ? "최신 검토 상태와 충돌했습니다. 준비 상태를 다시 확인해 주세요."
          : "스냅샷을 승격하지 못했습니다."));
      }
      setNotice(`${selected.period_label} 스냅샷을 현재 공개본으로 승격했습니다.`);
      setSelectedId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "스냅샷을 승격하지 못했습니다.");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <section className="mb-7 rounded-[6px] border border-[#E2D3C8] bg-white p-4 sm:p-5" aria-label="가격 공개 스냅샷">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wide text-[var(--color-rose-700)]">PUBLICATION SAFETY GATE</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--hb-text-strong)]">가격 공개 스냅샷</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--hb-success)]">
            승인·근거·추가 검토 상태가 모두 준비된 스냅샷만 공개할 수 있습니다. 이전 스냅샷을 다시 승격하면 같은 안전 절차로 롤백됩니다.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || promoting} className="min-h-9 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-bold text-[var(--hb-text-strong)] disabled:opacity-50">
          상태 새로고침
        </button>
      </div>

      {notice && <p className="mt-4 rounded-[6px] bg-[#E8F1EA] px-4 py-3 text-sm font-semibold text-[var(--hb-text-strong)]" role="status">{notice}</p>}
      {error && <p className="mt-4 rounded-[6px] bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}
      {loading ? (
        <p className="mt-4 text-sm text-[var(--hb-success)]">스냅샷 준비 상태를 계산하는 중…</p>
      ) : snapshots.length === 0 ? (
        <p className="mt-4 rounded-[6px] border border-dashed border-[#C7D1C2] px-4 py-5 text-sm text-[var(--hb-success)]">적재된 가격 스냅샷이 없습니다.</p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {snapshots.map((snapshot) => (
            <article key={snapshot.id} className={`rounded-[6px] border p-4 ${snapshot.is_current ? "border-[#6E8D76] bg-[#F2F7F3]" : snapshot.readiness ? "border-[#C7D1C2]" : "border-[#E7C9A9] bg-[#FFF9F1]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[var(--hb-text-strong)]">{snapshot.period_label}</p>
                  <p className="mt-1 text-xs text-[var(--hb-success)]">{snapshot.source} · 공개 가능 {snapshot.publishable_count}건</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${snapshot.is_current || snapshot.readiness ? "bg-[#E1EEE4] text-[var(--hb-text-strong)]" : "bg-[#FFE7CC] text-[#92532C]"}`}>
                  {snapshot.is_current ? "현재 공개본" : snapshot.readiness ? "승격 준비 완료" : "승격 차단"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--hb-success)]">
                <p>개별 가격 {snapshot.price_counts.total}건 · 승인 {snapshot.price_counts.review_status.approved}</p>
                <p>패키지 {snapshot.package_counts.total}건 · 승인 {snapshot.package_counts.review_status.approved}</p>
                <p>검토 대기 {snapshot.price_counts.review_status.pending + snapshot.package_counts.review_status.pending}건</p>
                <p>근거 미완료 {snapshot.price_counts.provenance.incomplete + snapshot.package_counts.provenance.incomplete}건</p>
              </div>
              {snapshot.blocking_reasons.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-[#70472D]">
                  {snapshot.blocking_reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              {!snapshot.is_current && (
                <button
                  type="button"
                  disabled={!snapshot.readiness || promoting}
                  onClick={() => setSelectedId(snapshot.id)}
                  className="mt-4 min-h-10 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {current ? "승격·롤백 검토" : "최초 공개 검토"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-[6px] border-2 border-[#8F6662] bg-[#FFF9F1] p-4" role="region" aria-label="스냅샷 최종 승격 확인">
          <p className="font-bold text-[var(--hb-text-strong)]">최종 확인 · {selected.period_label}</p>
          <p className="mt-1 text-sm leading-6 text-[#70472D]">
            현재 공개본 {current?.period_label ?? "없음"}에서 {selected.period_label}(으)로 전환합니다. 준비 상태를 다시 읽은 데이터베이스 RPC가 마지막으로 검증하며, 충돌하거나 미완료 항목이 생기면 승격은 중단됩니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedId(null)} disabled={promoting} className="min-h-10 rounded-[6px] border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50">취소</button>
            <button type="button" onClick={() => void promote()} disabled={promoting || !selected.readiness} className="min-h-10 rounded-[6px] bg-[#8F3F3F] px-4 text-sm font-bold text-white disabled:opacity-50">
              {promoting ? "승격 검증 중…" : "최종 승격 실행"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-[var(--hb-text-strong)]"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function DedupeWorkspace() {
  const [kind, setKind] = useState<DedupeKind>("vendor");
  const [candidates, setCandidates] = useState<DedupeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    setCandidates([]);
    try {
      const response = await fetch(`/api/admin/price/dedupe?kind=${kind}&status=pending`);
      if (response.status === 401) { window.location.assign("/admin/login"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "중복 후보를 불러오지 못했습니다.");
      if (activeRequest === requestId.current) setCandidates(body.candidates ?? []);
    } catch (caught) {
      if (activeRequest === requestId.current) {
        setError(caught instanceof Error ? caught.message : "중복 후보를 불러오지 못했습니다.");
      }
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  async function decide(candidate: DedupeCandidate, decision: "same" | "different", preservedId: string | null) {
    if (busyRef.current) return;
    if (candidate.entity_kind === "agency" && decision === "same") {
      const left = joinedAgency(candidate.left_agency);
      const right = joinedAgency(candidate.right_agency);
      if (!left?.region_code || left.region_code !== right?.region_code) {
        setError("대행사는 같은 지역이 확인된 후보만 병합할 수 있습니다.");
        return;
      }
    }

    let confirmationMessage: string;
    if (decision === "same") {
      const records = candidate.entity_kind === "vendor"
        ? [joinedVendor(candidate.left_vendor), joinedVendor(candidate.right_vendor)]
        : [joinedAgency(candidate.left_agency), joinedAgency(candidate.right_agency)];
      const preserved = records.find((record) => record?.id === preservedId);
      const losing = records.find((record) => record && record.id !== preservedId);
      if (!preserved || !losing) {
        setError("유지할 대상과 병합할 대상을 다시 확인해 주세요.");
        return;
      }
      confirmationMessage = `같은 ${candidate.entity_kind === "vendor" ? "업체" : "대행사"}로 병합합니다.\n\n유지: ${preserved.name}\n병합 후 제외: ${losing.name}\n\n별칭과 연결 데이터가 유지 대상으로 이전됩니다. 계속할까요?`;
    } else {
      confirmationMessage = `이 후보를 서로 다른 ${candidate.entity_kind === "vendor" ? "업체" : "대행사"}로 확정합니다. 이 판단은 감사 기록에 남고 후보 목록에서 제거됩니다. 계속할까요?`;
    }
    if (!window.confirm(confirmationMessage)) return;

    busyRef.current = true;
    setBusyId(candidate.id);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/price/dedupe/${candidate.id}?kind=${candidate.entity_kind}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(candidate.entity_kind === "vendor"
            ? { decision, preserved_vendor_id: preservedId }
            : { decision, preserved_agency_id: preservedId }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "중복 결정을 저장하지 못했습니다.");
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "중복 결정을 저장하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#8F6662]">수동 검토 · 자동 병합 없음</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--hb-text-strong)]">
            {kind === "vendor" ? "업체 중복 판단" : "대행사 중복 판단"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--hb-success)]">
            {kind === "vendor"
              ? "같은 업체로 판단해도 즉시 삭제하지 않습니다. 선택한 업체에 별칭·가격·태그를 옮기고 다른 행은 보존한 채 제외합니다."
              : "동일 지역이 확인된 후보만 수동으로 병합합니다. 선택한 대행사를 유지하고 연결 정보와 별칭을 원자적으로 이전하며, 충돌하면 저장되지 않습니다."}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="중복 판단 대상"
          className="grid w-full grid-cols-2 rounded-[6px] border border-[#E2D3C8] bg-white p-1 sm:w-auto"
        >
          {(["vendor", "agency"] as const).map((candidateKind) => (
            <button
              key={candidateKind}
              type="button"
              role="tab"
              aria-selected={kind === candidateKind}
              disabled={busyId !== null}
              onClick={() => setKind(candidateKind)}
              className={`min-h-10 rounded-[6px] px-4 text-sm font-semibold ${kind === candidateKind ? "bg-[var(--hb-primary)] text-white" : "text-[var(--hb-success)]"}`}
            >
              {candidateKind === "vendor" ? "업체 후보" : "대행사 후보"}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-4 rounded-[6px] bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}
      {loading ? (
        <AdminLoadingState label={`${kind === "vendor" ? "업체" : "대행사"} 중복 후보를 불러오는 중입니다…`} />
      ) : error && candidates.length === 0 ? (
        <AdminErrorState message={error} onRetry={() => void load()} />
      ) : candidates.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[#C7D1C2] bg-white px-6 py-16 text-center"><CopyCheck className="mx-auto text-[var(--hb-success)]" /><p className="mt-3 font-semibold text-[var(--hb-text-strong)]">판단할 중복 후보가 없습니다.</p></div>
      ) : (
        <div className="space-y-4">
          {candidates.map((candidate) => {
            if (candidate.entity_kind === "vendor") {
              const left = joinedVendor(candidate.left_vendor);
              const right = joinedVendor(candidate.right_vendor);
              if (!left || !right) {
                return (
                  <article key={candidate.id} className="rounded-[6px] border border-[#E7C9A9] bg-[#FFF6E8] p-5 text-sm text-[#70472D]">
                    연결된 업체 정보가 누락된 후보입니다. 병합하지 말고 데이터베이스 관계를 확인해 주세요.
                  </article>
                );
              }
              return (
                <article key={candidate.id} className="rounded-[6px] border border-[#E2D3C8] bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hb-hairline)] pb-4">
                    <div><p className="text-xs font-semibold text-[var(--color-rose-700)]">유사도 {candidate.similarity === null ? "미확인" : `${Math.round(candidate.similarity * 100)}%`}</p><p className="mt-1 text-sm text-[var(--hb-success)]">{candidate.reason || "이름·지역 유사 후보"}</p></div>
                    <button type="button" disabled={busyId !== null} onClick={() => void decide(candidate, "different", null)} className="min-h-10 rounded-[6px] border border-[#C7D1C2] px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50">다른 업체 · 별도 개체로 기록</button>
                  </div>
                  <div className="grid gap-4 pt-4 md:grid-cols-2">
                    {[left, right].map((vendor, index) => (
                      <div key={vendor.id} className="min-w-0 border-l-4 border-[#C7D1C2] pl-4">
                        <p className="text-xs font-semibold text-[var(--hb-success)]">{index === 0 ? "왼쪽" : "오른쪽"} 업체</p>
                        <p className="mt-1 break-words text-lg font-bold text-[var(--hb-text-strong)]">{vendor.name}</p>
                        <p className="mt-1 text-sm text-[var(--hb-success)]">{vendor.category} · {vendorRegionLabel(vendor.region_code) || vendor.region_code || "지역 미확인"}</p>
                        {vendor.aliases && vendor.aliases.length > 0 && <p className="mt-2 break-words text-xs text-[var(--hb-success)]">별칭: {vendor.aliases.join(", ")}</p>}
                        <button type="button" disabled={busyId !== null} onClick={() => void decide(candidate, "same", vendor.id)} className="mt-4 min-h-10 w-full rounded-[6px] bg-[var(--hb-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">같은 업체(병합) · {vendor.name} 유지</button>
                      </div>
                    ))}
                  </div>
                </article>
              );
            }

            const left = joinedAgency(candidate.left_agency);
            const right = joinedAgency(candidate.right_agency);
            if (!left || !right) {
              return (
                <article key={candidate.id} className="rounded-[6px] border border-[#E7C9A9] bg-[#FFF6E8] p-5 text-sm text-[#70472D]">
                  연결된 대행사 정보가 누락된 후보입니다. 병합하지 말고 데이터베이스 관계를 확인해 주세요.
                </article>
              );
            }
            const sameRegion = Boolean(left.region_code && left.region_code === right.region_code);
            return (
              <article key={candidate.id} className="rounded-[6px] border border-[#E2D3C8] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hb-hairline)] pb-4">
                  <div><p className="text-xs font-semibold text-[var(--color-rose-700)]">유사도 {candidate.similarity === null ? "미확인" : `${Math.round(candidate.similarity * 100)}%`}</p><p className="mt-1 text-sm text-[var(--hb-success)]">{candidate.reason || "이름·지역 유사 후보"}</p></div>
                  <button type="button" disabled={busyId !== null} onClick={() => void decide(candidate, "different", null)} className="min-h-10 rounded-[6px] border border-[#C7D1C2] px-4 text-sm font-semibold text-[var(--hb-text-strong)] disabled:opacity-50">다른 대행사 · 별도 개체로 기록</button>
                </div>
                {!sameRegion && (
                  <p className="mt-4 rounded-[6px] border border-[#E7C9A9] bg-[#FFF6E8] px-4 py-3 text-sm leading-6 text-[#70472D]" role="status">
                    두 대행사의 지역이 같다고 확인되지 않아 병합할 수 없습니다. 지역을 먼저 정정하거나 ‘다른 대행사’로 판단해 주세요.
                  </p>
                )}
                <div className="grid gap-4 pt-4 md:grid-cols-2">
                  {[left, right].map((agency, index) => (
                    <div key={agency.id} className="min-w-0 border-l-4 border-[#C7D1C2] pl-4">
                      <p className="text-xs font-semibold text-[var(--hb-success)]">{index === 0 ? "왼쪽" : "오른쪽"} 대행사</p>
                      <p className="mt-1 break-words text-lg font-bold text-[var(--hb-text-strong)]">{agency.name}</p>
                      <p className="mt-1 text-sm text-[var(--hb-success)]">{vendorRegionLabel(agency.region_code) || agency.region_code || "지역 미확인"}</p>
                      {agency.corporate_name && <p className="mt-2 break-words text-xs text-[var(--hb-success)]">법인명: {agency.corporate_name}</p>}
                      {agency.normalized_name && <p className="mt-1 break-words text-xs text-[var(--hb-success)]">정규화명: {agency.normalized_name}</p>}
                      {agency.aliases && agency.aliases.length > 0 && <p className="mt-1 break-words text-xs text-[var(--hb-success)]">별칭: {agency.aliases.join(", ")}</p>}
                      <button type="button" disabled={busyId !== null || !sameRegion} onClick={() => void decide(candidate, "same", agency.id)} className="mt-4 min-h-10 w-full rounded-[6px] bg-[var(--hb-primary)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">같은 대행사(병합) · {agency.name} 유지</button>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function AdminPricePage() {
  const [view, setView] = useState<"prices" | "packages" | "dedupe">("prices");
  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-strong)]">
      <VendorWorkspaceHeader active="price" />
      <main className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">
        <PriceUploadPanel />
        <VendorDemandPanel />
        <AutoValidatedApprovalPanel />
        <BulkApprovalPanel />
        <SnapshotReadinessPanel />
        <div className="mb-7 grid w-full grid-cols-3 rounded-[6px] border border-[#E2D3C8] bg-white p-1 sm:inline-grid sm:w-auto">
          <button type="button" onClick={() => setView("prices")} className={`min-h-10 whitespace-nowrap rounded-[6px] px-2 text-xs font-semibold sm:px-4 sm:text-sm ${view === "prices" ? "bg-[var(--hb-primary)] text-white" : "text-[var(--hb-success)]"}`}>개별 가격</button>
          <button type="button" onClick={() => setView("packages")} className={`min-h-10 whitespace-nowrap rounded-[6px] px-2 text-xs font-semibold sm:px-4 sm:text-sm ${view === "packages" ? "bg-[var(--hb-primary)] text-white" : "text-[var(--hb-success)]"}`}>대행사 패키지</button>
          <button type="button" onClick={() => setView("dedupe")} className={`min-h-10 whitespace-nowrap rounded-[6px] px-2 text-xs font-semibold sm:px-4 sm:text-sm ${view === "dedupe" ? "bg-[var(--hb-primary)] text-white" : "text-[var(--hb-success)]"}`}>중복 판단</button>
        </div>
        {view === "prices" ? <PriceReviewWorkspace /> : view === "packages" ? <AgencyPackageReviewWorkspace /> : <DedupeWorkspace />}
      </main>
      <style jsx global>{`
        .admin-input { width: 100%; min-height: 42px; border: 1px solid #c7d1c2; border-radius: 8px; background: #fff; padding: 9px 11px; color: #243832; font-size: 14px; outline: none; }
        .admin-input:focus { border-color: #36534e; box-shadow: 0 0 0 3px rgba(54,83,78,.12); }
      `}</style>
    </div>
  );
}
