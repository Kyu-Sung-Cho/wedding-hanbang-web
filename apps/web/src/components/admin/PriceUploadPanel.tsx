"use client";

import { useRef, useState } from "react";

import { PriceUploadConfirmationQueue } from "./PriceUploadConfirmationQueue";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

type MatchCandidate = {
  vendorId: string;
  vendorName: string;
  vendorSlug: string | null;
  aliases: string[];
  similarity: number;
  matchKind: "exact_name" | "exact_alias" | "similar";
};

type UploadReport = {
  snapshot_id: string | null;
  counts: {
    auto_matched: number;
    newly_created: number;
    needs_confirmation: number;
    errors: number;
    staged_prices: number;
  };
  details: {
    auto_matched: Array<{ entry_index: number; vendor_id: string; vendor_name: string }>;
    newly_created: Array<{ entry_index: number; vendor_id: string; vendor_name: string }>;
    needs_confirmation: Array<{
      confirmation_id: string;
      version: 0;
      entry_index: number;
      vendor_name: string;
      candidates: MatchCandidate[];
    }>;
    errors: Array<{ entry_index: number; vendor_name: string; code: string; message: string }>;
  };
};

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsText(file, "utf-8");
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUploadEnvelope(value: unknown): boolean {
  return isObject(value)
    && typeof value.period_label === "string"
    && typeof value.source === "string"
    && typeof value.source_note === "string"
    && typeof value.collected_at === "string"
    && Array.isArray(value.entries)
    && value.entries.length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function parseUploadReport(value: unknown): UploadReport | null {
  if (!isObject(value) || !isObject(value.counts) || !isObject(value.details)) return null;
  const counts = value.counts;
  const details = value.details;
  if (
    !isCount(counts.auto_matched)
    || !isCount(counts.newly_created)
    || !isCount(counts.needs_confirmation)
    || !isCount(counts.errors)
    || !isCount(counts.staged_prices)
    || !Array.isArray(details.auto_matched)
    || !Array.isArray(details.newly_created)
    || !Array.isArray(details.needs_confirmation)
    || !Array.isArray(details.errors)
  ) return null;

  const matched = details.auto_matched.filter(isObject);
  const created = details.newly_created.filter(isObject);
  const confirmations = details.needs_confirmation.filter(isObject);
  const errors = details.errors.filter(isObject);
  if (
    matched.length !== details.auto_matched.length
    || created.length !== details.newly_created.length
    || confirmations.length !== details.needs_confirmation.length
    || errors.length !== details.errors.length
    || matched.some((row) => !isCount(row.entry_index) || !isString(row.vendor_id) || !isString(row.vendor_name))
    || created.some((row) => !isCount(row.entry_index) || !isString(row.vendor_id) || !isString(row.vendor_name))
    || confirmations.some((row) => !isString(row.confirmation_id)
      || row.version !== 0
      || !isCount(row.entry_index)
      || !isString(row.vendor_name)
      || !Array.isArray(row.candidates))
    || errors.some((row) => !isCount(row.entry_index) || !isString(row.vendor_name) || !isString(row.code) || !isString(row.message))
  ) return null;

  for (const confirmation of confirmations) {
    const candidates = confirmation.candidates as unknown[];
    if (candidates.some((candidate) => !isObject(candidate)
      || !isString(candidate.vendorId)
      || !isString(candidate.vendorName)
      || !(candidate.vendorSlug === null || isString(candidate.vendorSlug))
      || !Array.isArray(candidate.aliases)
      || !candidate.aliases.every(isString)
      || typeof candidate.similarity !== "number"
      || candidate.similarity < 0
      || candidate.similarity > 1
      || !["exact_name", "exact_alias", "similar"].includes(String(candidate.matchKind)))) return null;
  }

  return value as UploadReport;
}

function serverErrorMessage(body: unknown): string {
  const fallback = "공시 JSON을 적재하지 못했습니다.";
  if (!isObject(body)) return fallback;
  const headline = isString(body.error) ? body.error : fallback;
  if (!Array.isArray(body.issues)) return headline;
  const issues = body.issues
    .filter(isObject)
    .filter((issue) => isString(issue.path) && isString(issue.message))
    .slice(0, 5)
    .map((issue) => `${issue.path || "파일"}: ${issue.message}`);
  return issues.length > 0 ? `${headline}\n${issues.join("\n")}` : headline;
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#E2D3C8] bg-white px-3 py-2">
      <span className="text-xs text-[#6D806E]">{label}</span>
      <strong className="ml-1 text-sm text-[#243832]">{value}</strong>
    </div>
  );
}

const tableClassName = "w-full min-w-[540px] border-collapse text-left text-sm";
const headingCellClassName = "border-b border-[#E2D3C8] bg-[#FBF8F2] px-3 py-2 text-xs font-bold text-[#6D806E]";
const bodyCellClassName = "border-b border-[#EFE4D7] px-3 py-2 align-top text-[#36534E]";
export function PriceUploadPanel() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [error, setError] = useState("");
  const validationId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function selectFile(file: File | undefined) {
    const activeValidation = ++validationId.current;
    setSelectedFile(null);
    setRawJson("");
    setReport(null);
    setError("");
    if (!file) return;
    if (!file.name.toLocaleLowerCase("en-US").endsWith(".json")) {
      setError("확장자가 .json인 파일만 선택할 수 있습니다.");
      return;
    }
    if (file.size === 0) {
      setError("빈 JSON 파일은 업로드할 수 없습니다.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("파일이 2MiB를 초과합니다. 더 작은 JSON 파일을 선택해 주세요.");
      return;
    }
    setValidating(true);
    try {
      const text = await readFileText(file);
      const parsed: unknown = JSON.parse(text);
      if (!hasUploadEnvelope(parsed)) {
        throw new Error("INVALID_UPLOAD_ENVELOPE");
      }
      if (activeValidation !== validationId.current) return;
      setSelectedFile(file);
      setRawJson(text);
    } catch {
      if (activeValidation === validationId.current) {
        setError("JSON 형식과 필수 항목(period_label, source, source_note, collected_at, entries)을 확인해 주세요.");
      }
    } finally {
      if (activeValidation === validationId.current) setValidating(false);
    }
  }

  async function upload() {
    if (!selectedFile || !rawJson || validating || uploading) return;
    setUploading(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch("/api/admin/price/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rawJson,
      });
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(serverErrorMessage(body));
      }
      const parsed = parseUploadReport(body);
      if (!parsed) throw new Error("서버의 적재 결과 형식을 확인할 수 없습니다.");
      setReport(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "공시 JSON을 적재하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    validationId.current += 1;
    setSelectedFile(null);
    setRawJson("");
    setValidating(false);
    setReport(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <section className="mb-7 rounded-2xl border border-[#E2D3C8] bg-white p-4 sm:p-5" aria-labelledby="price-upload-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-wide text-[#8F6662]">MANUAL DISCLOSURE INGEST</p>
          <h2 id="price-upload-title" className="mt-1 text-lg font-bold text-[#243832]">공시 JSON 적재</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6D806E]">
            검수할 공시 JSON 파일을 선택하세요. JSON 파일만 가능하며 파일 크기는 2MiB 이하여야 합니다.
          </p>
        </div>
        <a
          href="/api/admin/price/export"
          download="wedding-hanbang-current-prices.json"
          className="inline-flex min-h-10 items-center rounded-lg border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[#36534E]"
        >
          현재 발행 데이터 JSON 내려받기
        </a>
      </div>
      <div className="mt-5 rounded-xl border border-dashed border-[#C7D1C2] bg-[#FBF8F2] p-4">
        <label htmlFor="price-upload-file" className="block text-sm font-bold text-[#36534E]">공시 JSON 파일</label>
        <input
          ref={fileInputRef}
          id="price-upload-file"
          type="file"
          accept=".json,application/json"
          disabled={uploading}
          onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
          aria-describedby="price-upload-help"
          className="mt-2 block w-full text-sm text-[#36534E] file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-[#36534E] file:px-4 file:font-semibold file:text-white"
        />
        <p id="price-upload-help" className="mt-2 text-xs leading-5 text-[#6D806E]">
          파일은 브라우저에서 먼저 형식과 2MiB 제한을 확인한 뒤 서버의 전체 스키마 검증을 거칩니다.
        </p>
        {error && <p className="mt-3 whitespace-pre-line rounded-lg bg-[#D95F5F]/10 px-4 py-3 text-sm text-[#8A3030]" role="alert">{error}</p>}
        {validating && <p className="mt-3 text-sm text-[#6D806E]" role="status" aria-live="polite">JSON 파일을 확인하는 중…</p>}
        {selectedFile && !validating && (
          <p className="mt-3 text-sm text-[#36534E]">
            선택됨 · <strong>{selectedFile.name}</strong> · {(selectedFile.size / 1024).toFixed(1)}KiB
          </p>
        )}
        {uploading && <p className="mt-3 text-sm font-semibold text-[#36534E]" role="status" aria-live="polite">서버에서 매칭하고 검수 대기 데이터로 적재하는 중…</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!selectedFile || !rawJson || validating || uploading}
            onClick={() => void upload()}
            aria-busy={uploading}
            className="min-h-10 rounded-lg bg-[#36534E] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploading ? "업로드 중…" : error && selectedFile ? "다시 시도" : "JSON 업로드"}
          </button>
          {(selectedFile || error || report) && (
            <button
              type="button"
              disabled={uploading}
              onClick={reset}
              className="min-h-10 rounded-lg border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[#36534E] disabled:opacity-40"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {report && (
        <div className="mt-5 rounded-xl border border-[#C7D1C2] bg-[#F2F7F3] p-4">
          <p className="font-bold text-[#243832]" role="status" aria-live="polite">
            적재가 끝났습니다. 아래 결과를 확인한 뒤 검수·중복 판단·스냅샷 승격을 진행하세요.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SummaryMetric label="자동 매칭" value={report.counts.auto_matched} />
            <SummaryMetric label="신규 생성" value={report.counts.newly_created} />
            <SummaryMetric label="확인 필요" value={report.counts.needs_confirmation} />
            <SummaryMetric label="오류" value={report.counts.errors} />
            <SummaryMetric label="적재 가격" value={report.counts.staged_prices} />
          </div>

          {report.details.auto_matched.length > 0 && (
            <div className="mt-5 overflow-x-auto rounded-lg border border-[#E2D3C8] bg-white">
              <table className={tableClassName}>
                <caption className="px-3 py-2 text-left text-sm font-bold text-[#36534E]">자동 매칭</caption>
                <thead><tr><th className={headingCellClassName}>입력 행</th><th className={headingCellClassName}>매칭 업체</th><th className={headingCellClassName}>업체 ID</th></tr></thead>
                <tbody>{report.details.auto_matched.map((row) => <tr key={`${row.entry_index}-${row.vendor_id}`}><td className={bodyCellClassName}>{row.entry_index + 1}</td><td className={bodyCellClassName}>{row.vendor_name}</td><td className={`${bodyCellClassName} font-mono text-xs`}>{row.vendor_id}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          {report.details.newly_created.length > 0 && (
            <div className="mt-5 overflow-x-auto rounded-lg border border-[#E2D3C8] bg-white">
              <table className={tableClassName}>
                <caption className="px-3 py-2 text-left text-sm font-bold text-[#36534E]">신규 draft 업체</caption>
                <thead><tr><th className={headingCellClassName}>입력 행</th><th className={headingCellClassName}>신규 업체</th><th className={headingCellClassName}>업체 ID</th></tr></thead>
                <tbody>{report.details.newly_created.map((row) => <tr key={`${row.entry_index}-${row.vendor_id}`}><td className={bodyCellClassName}>{row.entry_index + 1}</td><td className={bodyCellClassName}>{row.vendor_name}</td><td className={`${bodyCellClassName} font-mono text-xs`}>{row.vendor_id}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          {report.details.errors.length > 0 && (
            <div className="mt-5 overflow-x-auto rounded-lg border border-[#D95F5F]/40 bg-white">
              <table className={tableClassName}>
                <caption className="px-3 py-2 text-left text-sm font-bold text-[#8A3030]">오류 · 적재하지 않음</caption>
                <thead><tr><th className={headingCellClassName}>입력 행</th><th className={headingCellClassName}>업체</th><th className={headingCellClassName}>오류</th></tr></thead>
                <tbody>{report.details.errors.map((row) => <tr key={`${row.entry_index}-${row.code}`}><td className={bodyCellClassName}>{row.entry_index + 1}</td><td className={bodyCellClassName}>{row.vendor_name}</td><td className={bodyCellClassName}><strong className="text-[#8A3030]">{row.code}</strong><p className="mt-1">{row.message}</p></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <PriceUploadConfirmationQueue
        initialConfirmations={report?.details.needs_confirmation ?? []}
      />
    </section>
  );
}
