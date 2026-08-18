import { validateAmoraPreparationGuideModule } from "@hanbang/shared/amora-preparation-guide";
import { buildAmoraPreparationTopicConsumerState } from "@hanbang/shared/amora-preparation-topic-consumer-state";
import { buildAmoraSourceDisclosure } from "@hanbang/shared/amora-source-disclosure";
import { resolveBudgetPayerOptions } from "./neutralBudgetPayerPresentation.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UNSAFE_DISPLAY_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const GUIDE_STATUSES = new Set(["not_started", "exploring", "in_progress"]);

function isWonAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;
}

function formatWon(value) {
  if (!isWonAmount(value)) return null;
  return value % 10_000 === 0
    ? `${(value / 10_000).toLocaleString("ko-KR")}만원`
    : `${value.toLocaleString("ko-KR")}원`;
}

function buildBudgetAction(summary, payerPresentationContext) {
  if (summary === null || summary === undefined) return null;
  if (!isRecord(summary) || typeof summary.categoryKey !== "string") return null;

  if (summary.state === "invalid") {
    return Object.freeze({
      categoryKey: summary.categoryKey,
      title: "예산 기록 확인 필요",
      description: "저장된 금액 형식을 안전하게 읽지 못했어요.",
      canOpen: false,
    });
  }
  if (summary.state !== "empty" && summary.state !== "ready") return null;

  const budget = formatWon(summary.budgetWon);
  const spent = formatWon(summary.spentWon);
  const payerOptions = payerPresentationContext === null
    ? null
    : resolveBudgetPayerOptions(
        payerPresentationContext ?? { memberModelVersion: 1, viewerRole: null },
      );
  const payer = payerOptions?.find((option) => option.value === summary.payer)?.label ?? null;
  const overrun = budget && spent && summary.spentWon > summary.budgetWon
    ? formatWon(summary.spentWon - summary.budgetWon)
    : null;

  return Object.freeze({
    categoryKey: summary.categoryKey,
    title: summary.state === "empty"
      ? "예산 입력 전"
      : `예산 ${budget ?? "미입력"} · 기록 지출 ${spent ?? "미입력"}`,
    description: [
      overrun ? `입력 예산보다 ${overrun} 많아요` : null,
      payer ? `분담 · ${payer}` : null,
      summary.state === "empty"
        ? "이 준비에 쓸 범위를 정해두면 비교가 쉬워져요."
        : null,
    ].filter(Boolean).join(" · ") || null,
    canOpen: true,
  });
}

function selectEvidenceLines(facts) {
  if (facts.length <= 3) return facts.map((fact) => fact.label);

  const selected = facts.slice(0, 3);
  const protectedSources = ["linked_schedule", "linked_action"];
  for (const source of protectedSources) {
    const protectedFact = facts.find((fact) => fact?.source === source);
    if (
      protectedFact
      && !selected.some((fact) => fact?.key === protectedFact.key)
    ) {
      const replaceIndex = [...selected]
        .map((fact, index) => ({ fact, index }))
        .reverse()
        .find(({ fact }) => !protectedSources.includes(fact?.source))?.index;
      if (replaceIndex !== undefined) selected[replaceIndex] = protectedFact;
    }
  }

  return [
    ...selected.map((fact) => fact.label),
    `그 외 ${facts.length - selected.length}개 확인됨`,
  ];
}

function formatConfirmedDate(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp));
}

function buildConfirmedScheduleSection(decisions) {
  if (!Array.isArray(decisions)) return null;
  const seen = new Set();
  const rows = decisions.flatMap((decision) => {
    if (
      !isRecord(decision)
      || typeof decision.id !== "string"
      || !UUID_RE.test(decision.id)
      || seen.has(decision.id)
      || typeof decision.title !== "string"
      || decision.title.trim().length === 0
      || Array.from(decision.title.trim()).length > 160
      || UNSAFE_DISPLAY_TEXT_RE.test(decision.title)
      || decision.scope !== "couple_shared"
    ) return [];
    const confirmedDate = formatConfirmedDate(decision.confirmedAt);
    if (!confirmedDate) return [];
    seen.add(decision.id);
    const title = decision.title.trim();
    const meta = `함께 보는 기록 · ${confirmedDate} 확인`;
    return [{
      id: decision.id,
      title,
      confirmedAt: decision.confirmedAt,
      meta,
      accessibilityLabel: `확인한 일정 기록, ${title}, 함께 보는 기록, ${confirmedDate} 확인`,
    }];
  }).sort((left, right) => (
    right.confirmedAt.localeCompare(left.confirmedAt)
    || left.id.localeCompare(right.id)
  ));
  if (rows.length === 0) return null;

  const visible = rows.slice(0, 2).map((row) => Object.freeze({
    id: row.id,
    title: row.title,
    meta: row.meta,
    accessibilityLabel: row.accessibilityLabel,
  }));
  return Object.freeze({
    title: "확인한 일정 기록",
    items: Object.freeze(visible),
    additionalLabel: rows.length > visible.length
      ? `그 외 ${rows.length - visible.length}개 일정 기록`
      : null,
  });
}

function buildConfirmedBudgetSection(decisions, readState) {
  const state = readState === undefined ? "loaded" : readState;
  if (state !== "loaded" && state !== "partial" && state !== "unavailable") {
    return null;
  }
  if (!Array.isArray(decisions) && state === "loaded") return null;

  const safeDecisions = Array.isArray(decisions) ? decisions : [];
  const seen = new Set();
  const rows = (state === "unavailable" ? [] : safeDecisions).flatMap((decision) => {
    if (
      !isRecord(decision)
      || typeof decision.id !== "string"
      || !UUID_RE.test(decision.id)
      || seen.has(decision.id)
      || typeof decision.title !== "string"
      || decision.title.trim().length === 0
      || Array.from(decision.title.trim()).length > 160
      || UNSAFE_DISPLAY_TEXT_RE.test(decision.title)
      || !formatConfirmedDate(decision.confirmedAt)
      || (
        decision.confirmationScope !== "couple"
        && decision.confirmationScope !== "current_member"
      )
      || !Number.isSafeInteger(decision.appliedRevision)
      || decision.appliedRevision < 0
      || decision.scope !== "couple_shared"
    ) return [];

    seen.add(decision.id);
    const title = decision.confirmationScope === "couple"
      ? "두 사람이 확인한 예산 기록"
      : "현재 구성원이 확인한 예산 기록";
    const meta = "준비 예산 변경 · 결제 기록이 아니에요.";
    return [{
      id: decision.id,
      confirmedAt: decision.confirmedAt,
      title,
      meta,
      accessibilityLabel: `확인한 예산 기록, ${title}, 준비 예산 변경, 결제 기록이 아니에요`,
    }];
  }).sort((left, right) => (
    right.confirmedAt.localeCompare(left.confirmedAt)
    || left.id.localeCompare(right.id)
  ));
  if (rows.length === 0 && state === "loaded") return null;

  const visible = rows.slice(0, 1).map((row) => Object.freeze({
    key: "confirmed-budget",
    title: row.title,
    meta: row.meta,
    accessibilityLabel: row.accessibilityLabel,
  }));
  return Object.freeze({
    title: "확인한 예산 기록",
    items: Object.freeze(visible),
    notice: state === "unavailable"
      ? "확인한 예산 기록을 지금 불러오지 못했어요."
      : state === "partial"
        ? "확인한 예산 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요."
        : null,
  });
}

const CATCH_UP_STATE_LABELS = Object.freeze({
  completed: "완료했다고 알려준 기록",
  in_progress: "진행 중이라고 알려준 기록",
  unknown: "아직 모른다고 남긴 기록",
  not_applicable: "해당 없다고 알려준 기록",
});

function buildCatchUpSection(records, readState) {
  const state = readState === undefined ? "loaded" : readState;
  if (state !== "loaded" && state !== "partial" && state !== "unavailable") {
    return null;
  }
  if (!Array.isArray(records) && state === "loaded") return null;
  const safeRecords = Array.isArray(records) ? records : [];
  const rows = (state === "unavailable" ? [] : safeRecords).flatMap((record) => {
    if (!isRecord(record)) return [];
    const title = CATCH_UP_STATE_LABELS[record.state];
    const confirmedDate = formatConfirmedDate(record.confirmedAt);
    if (
      typeof record.decisionId !== "string"
      || !UUID_RE.test(record.decisionId)
      || typeof record.receiptId !== "string"
      || !UUID_RE.test(record.receiptId)
      || typeof title !== "string"
      || (record.scope !== "owner_private" && record.scope !== "couple_shared")
      || confirmedDate === null
      || record.evidence !== "user_reported"
      || record.checklistCompletionChanged !== false
      || record.vendorConfirmationStatus !== "unconfirmed"
      || record.paymentEvidence !== false
    ) return [];
    const audience = record.scope === "owner_private"
      ? "나만 보는 사용자 기록"
      : "함께 보는 사용자 기록";
    const boundary = "체크리스트 완료·업체·계약·결제 증빙 아님";
    return [{
      key: "user-reported-catch-up",
      title,
      meta: `${audience} · ${confirmedDate} 입력 · ${boundary}`,
      accessibilityLabel: `직접 알려준 현재 상태, ${title}, ${audience}, ${confirmedDate} 입력, ${boundary}`,
    }];
  });
  if (rows.length > 1) return null;
  if (rows.length === 0 && state === "loaded") return null;
  return Object.freeze({
    title: "직접 알려준 현재 상태",
    items: Object.freeze(rows.map((row) => Object.freeze(row))),
    notice: state === "unavailable"
      ? "직접 알려준 준비 기록을 지금 불러오지 못했어요."
      : state === "partial"
        ? "직접 알려준 준비 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요."
        : null,
  });
}

function formatBookingVisitDate(date, time) {
  if (
    typeof date !== "string"
    || typeof time !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
    || !/^(?:[01]\d|2[0-3]):00$/u.test(time)
  ) return null;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return `${month}월 ${day}일 ${time} 방문 후보`;
}

function buildBookingDecisionSection(records, readState) {
  const state = readState === undefined ? "loaded" : readState;
  if (state !== "loaded" && state !== "partial" && state !== "unavailable") {
    return null;
  }
  if (!Array.isArray(records) && state === "loaded") return null;
  const safeRecords = Array.isArray(records) ? records : [];
  const seen = new Set();
  const rows = (state === "unavailable" ? [] : safeRecords).flatMap((record) => {
    if (!isRecord(record)) return [];
    const productIdIsValid = record.productId === null
      || (typeof record.productId === "string" && UUID_RE.test(record.productId));
    const productNameIsValid = record.productName === null
      || (
        typeof record.productName === "string"
        && record.productName.trim().length > 0
        && Array.from(record.productName.trim()).length <= 300
        && !UNSAFE_DISPLAY_TEXT_RE.test(record.productName)
      );
    const detail = formatBookingVisitDate(record.bookingDate, record.bookingTime);
    if (
      typeof record.bookingId !== "string"
      || !UUID_RE.test(record.bookingId)
      || seen.has(record.bookingId)
      || typeof record.decisionId !== "string"
      || !UUID_RE.test(record.decisionId)
      || typeof record.vendorId !== "string"
      || !UUID_RE.test(record.vendorId)
      || !productIdIsValid
      || typeof record.vendorName !== "string"
      || record.vendorName.trim().length === 0
      || Array.from(record.vendorName.trim()).length > 300
      || UNSAFE_DISPLAY_TEXT_RE.test(record.vendorName)
      || !productNameIsValid
      || detail === null
      || !Number.isSafeInteger(record.quotedAmountWon)
      || record.quotedAmountWon < 0
      || record.quotedAmountWon > 1_000_000_000_000
      || typeof record.initiatedByProfileId !== "string"
      || !UUID_RE.test(record.initiatedByProfileId)
      || typeof record.initiatedAt !== "string"
      || !Number.isFinite(Date.parse(record.initiatedAt))
      || record.recordScope !== "amora_internal_request"
      || record.evidence !== "actor_bound_atomic_intent"
      || record.vendorDeliveryStatus !== "not_sent"
      || record.vendorConfirmationStatus !== "unconfirmed"
    ) return [];

    seen.add(record.bookingId);
    const vendorName = record.vendorName.trim();
    const productName = record.productName === null ? null : record.productName.trim();
    const title = productName ? `${vendorName} · ${productName}` : vendorName;
    const meta = "아모라 내부 기록 · 업체에 전달·확정된 예약이 아니에요.";
    return [{
      id: record.bookingId,
      title,
      detail,
      meta,
      accessibilityLabel: `방문·상담 후보 기록, ${title}, ${detail}, 아모라 내부 기록, 업체에 전달·확정된 예약이 아니에요`,
    }];
  });
  if (rows.length === 0 && state === "loaded") return null;

  const visible = rows.slice(0, 2).map((row) => Object.freeze(row));
  return Object.freeze({
    title: "방문·상담 후보 기록",
    items: Object.freeze(visible),
    additionalLabel: rows.length > visible.length
      ? `그 외 ${rows.length - visible.length}개 후보 기록`
      : null,
    notice: state === "unavailable"
      ? "방문·상담 후보 기록을 지금 불러오지 못했어요."
      : state === "partial"
        ? "후보 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요."
        : null,
  });
}

function formatCompletedBookingDate(date, time) {
  if (
    typeof date !== "string"
    || typeof time !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
    || !/^(?:[01]\d|2[0-3]):00$/u.test(time)
  ) return null;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return `${month}월 ${day}일 ${time} 완료로 기록`;
}

function formatRecordedWon(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) return null;
  if (value === 0) return "0원";
  return value % 10_000 === 0
    ? `${(value / 10_000).toLocaleString("ko-KR")}만원`
    : `${value.toLocaleString("ko-KR")}원`;
}

function buildCompletedBookingOutcomeSection(records, readState) {
  const state = readState === undefined ? "loaded" : readState;
  if (state !== "loaded" && state !== "partial" && state !== "unavailable") {
    return null;
  }
  if (!Array.isArray(records) && state === "loaded") return null;
  const safeRecords = Array.isArray(records) ? records : [];
  const seen = new Set();
  const rows = (state === "unavailable" ? [] : safeRecords).flatMap((record) => {
    if (!isRecord(record)) return [];
    const productIdIsValid = record.productId === null
      || (typeof record.productId === "string" && UUID_RE.test(record.productId));
    const productNameIsValid = record.productName === null
      || (
        typeof record.productName === "string"
        && record.productName.trim().length > 0
        && Array.from(record.productName.trim()).length <= 300
        && !UNSAFE_DISPLAY_TEXT_RE.test(record.productName)
      );
    const detail = formatCompletedBookingDate(record.bookingDate, record.bookingTime);
    const contracted = record.contractedAmountWon === null
      ? null
      : formatRecordedWon(record.contractedAmountWon);
    const actual = formatRecordedWon(record.actualAmountWon);
    if (
      typeof record.bookingId !== "string"
      || !UUID_RE.test(record.bookingId)
      || seen.has(record.bookingId)
      || typeof record.decisionId !== "string"
      || !UUID_RE.test(record.decisionId)
      || typeof record.vendorId !== "string"
      || !UUID_RE.test(record.vendorId)
      || !productIdIsValid
      || typeof record.vendorName !== "string"
      || record.vendorName.trim().length === 0
      || Array.from(record.vendorName.trim()).length > 300
      || UNSAFE_DISPLAY_TEXT_RE.test(record.vendorName)
      || !productNameIsValid
      || detail === null
      || (record.contractedAmountWon !== null && contracted === null)
      || actual === null
      || !Number.isFinite(Date.parse(record.userConfirmedAt))
      || !Number.isFinite(Date.parse(record.decidedAt))
      || record.recordScope !== "amora_internal_completed_outcome"
      || record.evidence !== "actor_bound_atomic_user_report"
      || record.completionEvidence !== "user_reported"
      || record.vendorDeliveryStatus !== "not_sent"
      || record.vendorConfirmationStatus !== "unconfirmed"
      || record.isPaid !== false
    ) return [];

    seen.add(record.bookingId);
    const vendorName = record.vendorName.trim();
    const productName = record.productName === null ? null : record.productName.trim();
    const title = productName ? `${vendorName} · ${productName}` : vendorName;
    const amount = contracted
      ? `계약으로 입력한 금액 ${contracted} · 직접 기록한 지출 ${actual}`
      : `직접 기록한 지출 ${actual}`;
    const meta = "사용자가 직접 남긴 내부 기록 · 업체 확인·결제 증빙이 아니에요.";
    return [{
      id: record.bookingId,
      title,
      detail,
      amount,
      meta,
      accessibilityLabel: `직접 남긴 완료·지출 기록, ${title}, ${detail}, ${amount.replace(" · ", ", ")}, 업체 확인·결제 증빙이 아니에요`,
    }];
  });
  if (rows.length === 0 && state === "loaded") return null;

  const visible = rows.slice(0, 2).map((row) => Object.freeze(row));
  return Object.freeze({
    title: "직접 남긴 완료·지출 기록",
    items: Object.freeze(visible),
    additionalLabel: rows.length > visible.length
      ? `그 외 ${rows.length - visible.length}개 완료 기록`
      : null,
    notice: state === "unavailable"
      ? "완료·지출 기록을 지금 불러오지 못했어요."
      : state === "partial"
        ? "완료·지출 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요."
        : null,
  });
}

function buildSavedConversationSection(topicKey, read) {
  if (!isRecord(read)) return null;
  if (read.state === "unavailable") {
    return Object.freeze({
      title: "아모라와 저장한 대화",
      items: Object.freeze([]),
      initialVisibleCount: 2,
      notice: "저장한 대화를 지금 불러오지 못했어요. 새로고침해서 다시 확인해 주세요.",
    });
  }
  if (
    (read.state !== "loaded" && read.state !== "partial")
    || !Array.isArray(read.references)
  ) return null;

  const seen = new Set();
  const rows = read.references.flatMap((reference) => {
    if (
      !isRecord(reference)
      || typeof reference.refId !== "string"
      || !UUID_RE.test(reference.refId)
      || seen.has(reference.refId)
      || reference.topicKey !== topicKey
      || typeof reference.messageId !== "string"
      || !UUID_RE.test(reference.messageId)
      || (
        reference.audience !== "couple_shared"
        && reference.audience !== "owner_private"
      )
      || !Number.isSafeInteger(reference.revision)
      || reference.revision < 1
      || typeof reference.excerpt !== "string"
      || reference.excerpt.trim().length === 0
      || Array.from(reference.excerpt).length > 320
      || UNSAFE_DISPLAY_TEXT_RE.test(reference.excerpt)
      || reference.canOpenOriginal !== true
    ) return [];
    const savedAtTimestamp = Date.parse(reference.savedAt);
    const savedDate = formatConfirmedDate(reference.savedAt);
    if (!Number.isFinite(savedAtTimestamp) || !savedDate) return [];
    seen.add(reference.refId);
    const excerpt = reference.excerpt.trim();
    const audienceLabel = reference.audience === "couple_shared"
      ? "함께 보는 대화"
      : "나만 보는 대화";
    const meta = `${audienceLabel} · ${savedDate} 저장`;
    return [{
      refId: reference.refId,
      excerpt,
      audience: reference.audience,
      savedAt: reference.savedAt,
      meta,
      canOpenOriginal: true,
      accessibilityLabel: `${excerpt}, ${meta}`,
    }];
  }).sort((left, right) => (
    right.savedAt.localeCompare(left.savedAt)
    || left.refId.localeCompare(right.refId)
  )).map((row) => Object.freeze(row));

  if (rows.length === 0 && read.state === "loaded") return null;
  return Object.freeze({
    title: "아모라와 저장한 대화",
    items: Object.freeze(rows),
    initialVisibleCount: 2,
    notice: read.state === "partial"
      ? "일부 저장한 대화만 불러왔어요. 새로고침하면 다시 확인할 수 있어요."
      : null,
  });
}

function formatGuideReviewDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function buildGuideSection(view) {
  if (
    !isRecord(view)
    || typeof view.topicKey !== "string"
    || view.topicKey.length === 0
    || view.applicability !== "applicable"
    || !GUIDE_STATUSES.has(view.status)
    || !Array.isArray(view.guideModules)
    || view.guideModules.length !== 1
    || !Array.isArray(view.unknowns)
  ) return null;
  const validation = validateAmoraPreparationGuideModule(
    view.guideModules[0],
    view.topicKey,
  );
  if (!validation.ok) return null;

  const guide = validation.value;
  const matchingUnknowns = view.unknowns.filter((unknown) => (
    isRecord(unknown)
    && unknown.key === `checklist:${guide.whyShown.checklistItemId}`
    && unknown.source === "unfinished_checklist"
    && typeof unknown.label === "string"
    && guide.whyShown.label
      === `현재 준비 상태에서 ‘${unknown.label}’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.`
  ));
  if (matchingUnknowns.length !== 1) return null;
  const reviewedDate = formatGuideReviewDate(guide.provenance.reviewedAt);
  const sourceDisclosure = buildAmoraSourceDisclosure({
    version: 1,
    sourceType: "reviewed_guidance",
    commercialRelationship: "none",
    checkedAt: guide.provenance.reviewedAt,
    asOfDate: guide.provenance.reviewDueAt,
  });
  if (!reviewedDate || !sourceDisclosure) return null;
  return Object.freeze({
    eyebrow: "아모라 가이드",
    moduleId: guide.moduleId,
    title: guide.title,
    whyShown: guide.whyShown.label,
    decisions: Object.freeze([...guide.decisions]),
    exceptions: Object.freeze([...guide.exceptions]),
    dialogueLines: Object.freeze(guide.dialogueLines.map((line) => Object.freeze({ ...line }))),
    completionEvidence: Object.freeze([...guide.completionEvidence]),
    sourceDisclosure,
    provenance: Object.freeze({
      sourceLabel: "웨딩한방 독립 작성 · 내부 편집 검토",
      reviewedLabel: `${reviewedDate} 검토`,
      scopeLabel: `적용 범위 · ${guide.provenance.applicabilityScope}`,
      limitations: Object.freeze([...guide.provenance.limitations]),
    }),
    accessibilityLabel: `아모라 가이드, ${guide.title}, ${guide.whyShown.label}`,
  });
}

export function buildPreparationTopicPresentation(
  view,
  messageReferenceRead,
  payerPresentationContext,
) {
  if (
    !isRecord(view)
    || view.version !== 1
    || !isRecord(view.progress)
    || !Array.isArray(view.facts)
    || !Array.isArray(view.unknowns)
    || !Array.isArray(view.conflicts)
    || !Array.isArray(view.linkedScheduleIds)
    || !Array.isArray(view.linkedBudgetCategoryKeys)
    || !Array.isArray(view.linkedActionIds)
  ) return null;

  const topicConsumerState = buildAmoraPreparationTopicConsumerState(view);
  if (!topicConsumerState) return null;
  const primaryState = topicConsumerState.consumerState.primaryState;
  const isUnknown = primaryState === "applicability_unknown";
  const isReadyToStart = primaryState === "ready";
  const isExploring = primaryState === "in_progress" && view.status === "exploring";
  const isInProgress = primaryState === "in_progress" && view.status === "in_progress";
  const isExcluded = primaryState === "not_applicable";
  const needsDecision = primaryState === "conflict";
  const isCompleted = primaryState === "completed";
  const connectedPlanCount = view.linkedScheduleIds.length + view.linkedActionIds.length;
  const closesTopic = isExcluded || isCompleted;
  if (
    (!isUnknown && !isReadyToStart && !isExploring && !isInProgress && !isExcluded && !needsDecision && !isCompleted)
    || (!closesTopic && !isRecord(view.nextAction))
    || (closesTopic && view.nextAction !== null)
  ) return null;

  return Object.freeze({
    statusLabel: isCompleted
      ? "준비 완료"
      : needsDecision
      ? "기록 확인 필요"
      : isExcluded
        ? "해당 없음"
        : isUnknown
          ? "확인 전"
          : isReadyToStart ? "준비 전" : isExploring ? "계획 연결됨" : "준비 중",
    statusTone: isCompleted
      ? "success"
      : needsDecision
      ? "warning"
      : isUnknown || isReadyToStart || isExcluded ? "neutral" : "rose",
    progressLabel: isCompleted
      ? `${view.progress.total}개 모두 확인했어요.`
      : isExcluded
      ? "우리에게는 하지 않기로 정했어요."
      : needsDecision
        ? "서로 다른 준비 기록을 먼저 확인해요."
        : isUnknown
        ? "필요한 준비인지 먼저 확인해요."
        : isReadyToStart
          ? `${view.progress.total}개 중 아직 확인한 항목이 없어요.`
        : isExploring
          ? `연결된 계획 ${connectedPlanCount}개 · 준비 ${view.unknowns.length}개 확인 전`
        : `${view.progress.total}개 중 ${view.progress.completed}개 확인`,
    evidenceTitle: connectedPlanCount > 0
      ? "우리 계획과 확인된 준비"
      : "확인된 준비",
    evidenceLines: Object.freeze(selectEvidenceLines(view.facts)),
    confirmedScheduleSection: buildConfirmedScheduleSection(
      view.confirmedScheduleDecisions,
    ),
    confirmedBudgetSection: buildConfirmedBudgetSection(
      view.confirmedBudgetDecisions,
      view.budgetDecisionReadState,
    ),
    catchUpSection: buildCatchUpSection(
      view.userReportedCatchUpRecords,
      view.catchUpReadState,
    ),
    bookingDecisionSection: buildBookingDecisionSection(
      view.currentVendorBookingRecords,
      view.vendorBookingReadState,
    ),
    completedBookingOutcomeSection: buildCompletedBookingOutcomeSection(
      view.currentCompletedVendorBookingRecords,
      view.completedVendorBookingReadState,
    ),
    savedConversationSection: buildSavedConversationSection(
      view.topicKey,
      messageReferenceRead,
    ),
    guideSection: buildGuideSection(view),
    budgetAction: buildBudgetAction(view.budgetSummary, payerPresentationContext),
    actionReadNotice: view.actionReadState === "unavailable"
      ? "저장된 공동 행동은 지금 확인하지 못했어요. 아래 내용은 체크리스트와 일정 기준이에요."
      : null,
    remainingLabel: closesTopic
      ? null
      : needsDecision
        ? `확인할 기록 ${view.conflicts.length}개`
        : isUnknown
      ? `아직 확인하지 않은 준비 ${view.unknowns.length}개`
      : `남은 준비 ${view.unknowns.length}개`,
    nextAction: closesTopic
      ? null
      : Object.freeze({
          eyebrow: needsDecision
            ? "먼저 바로잡을 것"
            : view.actionReadState === "unavailable"
              ? "확인된 기록 기준"
              : isUnknown ? "먼저 확인할 것" : "다음 한 가지",
          title: view.nextAction.title,
          reason: view.nextAction.reason,
          completionCriterion: view.nextAction.completionCriterion,
        }),
  });
}
