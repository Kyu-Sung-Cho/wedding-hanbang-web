export type SnapshotEvidenceRow = {
  review_status?: unknown;
  needs_review?: unknown;
  provenance_complete?: unknown;
};

export type SnapshotEntityCounts = {
  total: number;
  review_status: {
    pending: number;
    approved: number;
    rejected: number;
    unknown: number;
  };
  needs_review: { yes: number; no: number };
  provenance: { complete: number; incomplete: number };
  publishable_count: number;
};

type EntitySummary = {
  counts: SnapshotEntityCounts;
  approvedNeedsReview: number;
  approvedIncomplete: number;
};

function summarizeEntity(rows: SnapshotEvidenceRow[]): EntitySummary {
  const counts: SnapshotEntityCounts = {
    total: 0,
    review_status: { pending: 0, approved: 0, rejected: 0, unknown: 0 },
    needs_review: { yes: 0, no: 0 },
    provenance: { complete: 0, incomplete: 0 },
    publishable_count: 0,
  };
  let approvedNeedsReview = 0;
  let approvedIncomplete = 0;

  for (const row of rows) {
    counts.total += 1;
    const status = row.review_status;
    if (status === "pending" || status === "approved" || status === "rejected") {
      counts.review_status[status] += 1;
    } else {
      counts.review_status.unknown += 1;
    }

    const needsReview = row.needs_review !== false;
    counts.needs_review[needsReview ? "yes" : "no"] += 1;
    const provenanceComplete = row.provenance_complete === true;
    counts.provenance[provenanceComplete ? "complete" : "incomplete"] += 1;

    if (status === "approved") {
      if (needsReview) approvedNeedsReview += 1;
      if (!provenanceComplete) approvedIncomplete += 1;
      if (!needsReview && provenanceComplete) counts.publishable_count += 1;
    }
  }

  return { counts, approvedNeedsReview, approvedIncomplete };
}

function appendEntityReasons(
  reasons: string[],
  label: "가격" | "패키지",
  summary: EntitySummary,
) {
  const pending = summary.counts.review_status.pending;
  if (pending > 0) {
    reasons.push(`${label} 검토 대기 항목이 ${pending}건 남아 있습니다.`);
  }
  const unknown = summary.counts.review_status.unknown;
  if (unknown > 0) {
    reasons.push(`${label} 검토 상태를 확인해야 하는 항목이 ${unknown}건 있습니다.`);
  }
  if (summary.approvedNeedsReview > 0) {
    reasons.push(
      `${label} 승인 항목 중 추가 검토가 필요한 항목이 ${summary.approvedNeedsReview}건 있습니다.`,
    );
  }
  if (summary.approvedIncomplete > 0) {
    reasons.push(
      `${label} 승인 항목 중 근거가 불완전한 항목이 ${summary.approvedIncomplete}건 있습니다.`,
    );
  }
}

export function summarizeSnapshotReadiness(
  prices: SnapshotEvidenceRow[],
  packages: SnapshotEvidenceRow[],
) {
  const priceSummary = summarizeEntity(prices);
  const packageSummary = summarizeEntity(packages);
  const total = priceSummary.counts.total + packageSummary.counts.total;
  const publishableCount = priceSummary.counts.publishable_count
    + packageSummary.counts.publishable_count;
  const rejectedCount = priceSummary.counts.review_status.rejected
    + packageSummary.counts.review_status.rejected;
  const blockingReasons: string[] = [];

  if (total === 0) {
    blockingReasons.push("검토된 가격 또는 패키지 항목이 없습니다.");
  }
  appendEntityReasons(blockingReasons, "가격", priceSummary);
  appendEntityReasons(blockingReasons, "패키지", packageSummary);
  if (publishableCount === 0) {
    blockingReasons.push(
      total > 0 && rejectedCount === total
        ? "모든 항목이 반려 상태라 공개 가능한 승인 항목이 없습니다."
        : "공개 가능한 승인 항목이 없습니다.",
    );
  }

  return {
    price_counts: priceSummary.counts,
    package_counts: packageSummary.counts,
    publishable_count: publishableCount,
    readiness: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
  };
}
