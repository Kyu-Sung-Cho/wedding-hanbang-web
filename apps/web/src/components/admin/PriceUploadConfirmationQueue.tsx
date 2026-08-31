"use client";

import { useEffect, useState } from "react";

type MatchCandidate = {
  vendorId: string;
  vendorName: string;
  vendorSlug: string | null;
  aliases: string[];
  category?: string | null;
  regionCode?: string | null;
  similarity: number;
  matchKind: "exact_name" | "exact_alias" | "similar";
};

export type PriceUploadConfirmationView = {
  confirmation_id: string;
  entry_index: number;
  vendor_name: string;
  version: 0;
  candidates: MatchCandidate[];
};

type Outcome =
  | { kind: "success"; stagedPrices: number }
  | { kind: "error"; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCandidate(value: unknown): value is MatchCandidate {
  return isObject(value)
    && typeof value.vendorId === "string"
    && typeof value.vendorName === "string"
    && (value.vendorSlug === null || typeof value.vendorSlug === "string")
    && Array.isArray(value.aliases)
    && value.aliases.every((alias) => typeof alias === "string")
    && (value.category === undefined
      || value.category === null
      || typeof value.category === "string")
    && (value.regionCode === undefined
      || value.regionCode === null
      || typeof value.regionCode === "string")
    && typeof value.similarity === "number"
    && value.similarity >= 0
    && value.similarity <= 1
    && ["exact_name", "exact_alias", "similar"].includes(String(value.matchKind));
}

function parseConfirmation(value: unknown): PriceUploadConfirmationView | null {
  if (!isObject(value)
    || typeof value.confirmation_id !== "string"
    || !Number.isInteger(value.entry_index)
    || Number(value.entry_index) < 0
    || typeof value.vendor_name !== "string"
    || value.version !== 0
    || !Array.isArray(value.candidates)
    || value.candidates.length < 1
    || value.candidates.length > 5
    || !value.candidates.every(isCandidate)
  ) return null;
  return {
    confirmation_id: value.confirmation_id,
    entry_index: Number(value.entry_index),
    vendor_name: value.vendor_name,
    version: 0,
    candidates: value.candidates,
  };
}

function errorMessage(value: unknown): string {
  if (isObject(value) && typeof value.error === "string" && value.error.length <= 500) {
    return value.error;
  }
  return "업체 연결을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "예식장",
  venue: "예식장",
  other: "기타",
};

const MATCH_KIND_LABELS: Record<MatchCandidate["matchKind"], string> = {
  exact_name: "업체명 정확히 일치",
  exact_alias: "기존 별칭 정확히 일치",
  similar: "유사 업체명 후보",
};

export function PriceUploadConfirmationQueue({
  initialConfirmations,
}: {
  initialConfirmations: PriceUploadConfirmationView[];
}) {
  const [rows, setRows] = useState(initialConfirmations);
  const [hasLoaded, setHasLoaded] = useState(initialConfirmations.length > 0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [pendingChoice, setPendingChoice] = useState<{
    confirmationId: string;
    vendorId: string;
  } | null>(null);

  useEffect(() => {
    setRows(initialConfirmations);
    setHasLoaded(initialConfirmations.length > 0);
    setOutcomes({});
    setPendingChoice(null);
  }, [initialConfirmations]);

  async function resolveCandidate(row: PriceUploadConfirmationView, vendorId: string) {
    if (busyId || outcomes[row.confirmation_id]?.kind === "success") return;
    setBusyId(row.confirmation_id);
    setOutcomes((current) => {
      const next = { ...current };
      delete next[row.confirmation_id];
      return next;
    });
    try {
      const response = await fetch(
        `/api/admin/price/upload/confirmations/${row.confirmation_id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vendor_id: vendorId, expected_version: row.version }),
        },
      );
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body));
      if (!isObject(body)
        || body.resolved !== true
        || !Number.isInteger(body.staged_prices)
        || Number(body.staged_prices) < 1
      ) throw new Error("서버의 연결 결과를 확인할 수 없습니다.");
      setOutcomes((current) => ({
        ...current,
        [row.confirmation_id]: { kind: "success", stagedPrices: Number(body.staged_prices) },
      }));
      setPendingChoice(null);
    } catch (error) {
      setOutcomes((current) => ({
        ...current,
        [row.confirmation_id]: {
          kind: "error",
          message: error instanceof Error ? error.message : errorMessage(null),
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function refresh() {
    if (refreshing || busyId) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/price/upload/confirmations", {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isObject(body) || !Array.isArray(body.confirmations)) {
        throw new Error(errorMessage(body));
      }
      const parsed = body.confirmations.map(parseConfirmation);
      if (parsed.some((row) => row === null)) {
        throw new Error("서버의 대기 목록 형식을 확인할 수 없습니다.");
      }
      setRows(parsed as PriceUploadConfirmationView[]);
      setHasLoaded(true);
      setOutcomes({});
      setPendingChoice(null);
    } catch (error) {
      setOutcomes((current) => ({
        ...current,
        queue: {
          kind: "error",
          message: error instanceof Error ? error.message : errorMessage(null),
        },
      }));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mt-5 rounded-[6px] border border-[#E7C9A9] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#70472D]">확인이 필요한 업체 연결</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--hb-success)]">
            후보를 선택하면 별칭을 보존하고 해당 가격을 검수 대기 상태로 원자적으로 적재합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || busyId !== null}
          aria-busy={refreshing}
          className="min-h-10 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-semibold text-[var(--hb-text-strong)] disabled:opacity-40"
        >
          {refreshing ? "새로고침 중…" : "대기 목록 새로고침"}
        </button>
      </div>

      {outcomes.queue?.kind === "error" && (
        <p role="alert" className="mt-3 rounded-[6px] bg-[#D95F5F]/10 px-3 py-2 text-sm text-[#8A3030]">
          {outcomes.queue.message}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-4 rounded-[6px] bg-[#F2F7F3] px-3 py-3 text-sm text-[var(--hb-text-strong)]">
          {hasLoaded
            ? "확인이 필요한 업로드가 없습니다."
            : "대기 목록 새로고침을 눌러 기존 확인 항목을 불러오세요."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => {
            const outcome = outcomes[row.confirmation_id];
            const isBusy = busyId === row.confirmation_id;
            const selectedCandidate = row.candidates.find((candidate) => (
              pendingChoice?.confirmationId === row.confirmation_id
              && pendingChoice.vendorId === candidate.vendorId
            ));
            return (
              <li key={row.confirmation_id} className="rounded-[6px] border border-[var(--hb-hairline)] p-3">
                <p className="text-sm font-bold text-[var(--hb-text-strong)]">
                  {row.entry_index + 1}번 입력 · {row.vendor_name}
                </p>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {row.candidates.map((candidate) => (
                    <li key={candidate.vendorId} className="rounded-[6px] bg-[var(--hb-surface-page)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <strong className="text-sm text-[var(--hb-text-strong)]">{candidate.vendorName}</strong>
                          <p className="mt-1 text-xs text-[var(--hb-success)]">
                            유사도 {Math.round(candidate.similarity * 100)}%
                            {candidate.vendorSlug ? ` · ${candidate.vendorSlug}` : ""}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-[var(--hb-text-strong)]">
                            {MATCH_KIND_LABELS[candidate.matchKind]}
                            {candidate.category
                              ? ` · ${CATEGORY_LABELS[candidate.category] ?? candidate.category}`
                              : ""}
                            {candidate.regionCode ? ` · ${candidate.regionCode}` : ""}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--hb-success)]">
                            {candidate.aliases.length > 0
                              ? `등록된 별칭: ${candidate.aliases.join(", ")}`
                              : "등록된 별칭 없음"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingChoice({
                            confirmationId: row.confirmation_id,
                            vendorId: candidate.vendorId,
                          })}
                          disabled={busyId !== null || outcome?.kind === "success"}
                          className="min-h-10 shrink-0 rounded-[6px] bg-[var(--hb-primary)] px-3 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          이 후보 검토
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {selectedCandidate && outcome?.kind !== "success" && (
                  <div
                    className="mt-3 rounded-[6px] border-2 border-[#C58B55] bg-[#FFF8EE] p-3"
                    aria-label="최종 연결 확인"
                  >
                    <p className="text-sm font-bold text-[#70472D]">최종 연결 확인</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--hb-text-strong)]">
                      업로드의 <strong>{row.vendor_name}</strong>을(를) 기존 업체
                      {" "}<strong>{selectedCandidate.vendorName}</strong>에 연결합니다.
                    </p>
                    <p className="mt-2 rounded-[6px] bg-[#D95F5F]/10 px-3 py-2 text-xs leading-5 text-[#8A3030]">
                      확정하면 업로드 이름이 별칭으로 보존되고 가격이 검수 대기에 적재됩니다.
                      잘못 연결해도 이 화면에서 되돌릴 수 없습니다. 이름·별칭·카테고리·지역을 다시 확인해 주세요.
                    </p>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingChoice(null)}
                        disabled={isBusy}
                        className="min-h-10 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-semibold text-[var(--hb-text-strong)] disabled:opacity-40"
                      >
                        선택 취소
                      </button>
                      <button
                        type="button"
                        onClick={() => void resolveCandidate(row, selectedCandidate.vendorId)}
                        disabled={busyId !== null}
                        aria-busy={isBusy}
                        className="min-h-10 rounded-[6px] bg-[#70472D] px-4 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {isBusy ? "연결 중…" : outcome?.kind === "error" ? "연결 다시 시도" : "연결 확정"}
                      </button>
                    </div>
                  </div>
                )}
                {outcome?.kind === "success" && (
                  <p role="status" className="mt-3 rounded-[6px] bg-[#E8F3EA] px-3 py-2 text-sm font-semibold text-[var(--hb-text-strong)]">
                    연결 완료 · 가격 {outcome.stagedPrices}건을 검수 대기로 적재했습니다.
                  </p>
                )}
                {outcome?.kind === "error" && (
                  <p role="alert" className="mt-3 rounded-[6px] bg-[#D95F5F]/10 px-3 py-2 text-sm text-[#8A3030]">
                    {outcome.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
