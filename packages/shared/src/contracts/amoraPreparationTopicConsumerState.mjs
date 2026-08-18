import { composeAmoraConsumerState } from "./amoraConsumerState.mjs";
import { getAmoraJourneyTruthTopicPolicy } from "./amoraJourneyTruthAudit.mjs";

export const AMORA_PREPARATION_TOPIC_CONSUMER_STATE_CONTRACT_VERSION = 1;

const VALID_STATE_COMBINATIONS = new Set([
  "unknown:not_started",
  "not_applicable:not_started",
  "not_applicable:decision_needed",
  "applicable:not_started",
  "applicable:exploring",
  "applicable:decision_needed",
  "applicable:in_progress",
  "applicable:completed",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOptionalArray(view, key) {
  if (!Object.prototype.hasOwnProperty.call(view, key)) return [];
  return Array.isArray(view[key]) ? view[key] : null;
}

function hasValidProgress(progress) {
  return isRecord(progress)
    && Number.isSafeInteger(progress.completed)
    && Number.isSafeInteger(progress.total)
    && progress.completed >= 0
    && progress.total >= progress.completed
    && typeof progress.percent === "number"
    && Number.isFinite(progress.percent)
    && progress.percent >= 0
    && progress.percent <= 100;
}

function isNullableWonAmount(value) {
  return value === null
    || (Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000);
}

function hasValidBudgetSummary(summary) {
  if (summary === undefined || summary === null) return true;
  if (!isRecord(summary) || typeof summary.categoryKey !== "string") return false;
  if (summary.state === "invalid") return true;
  return (summary.state === "empty" || summary.state === "ready")
    && isNullableWonAmount(summary.budgetWon)
    && isNullableWonAmount(summary.spentWon)
    && (
      summary.payer === null
      || ["couple", "bride_parents", "groom_parents", "both_parents"].includes(
        summary.payer,
      )
    );
}

function isValidUserReport(record) {
  return isRecord(record)
    && record.evidence === "user_reported"
    && record.checklistCompletionChanged === false
    && record.vendorConfirmationStatus === "unconfirmed"
    && record.paymentEvidence === false;
}

function isValidVendorRecord(record) {
  return isRecord(record)
    && record.recordScope === "amora_internal_request"
    && record.evidence === "actor_bound_atomic_intent"
    && record.vendorDeliveryStatus === "not_sent"
    && record.vendorConfirmationStatus === "unconfirmed";
}

function isValidCompletedVendorRecord(record) {
  return isRecord(record)
    && record.recordScope === "amora_internal_completed_outcome"
    && record.evidence === "actor_bound_atomic_user_report"
    && record.completionEvidence === "user_reported"
    && record.vendorDeliveryStatus === "not_sent"
    && record.vendorConfirmationStatus === "unconfirmed"
    && record.isPaid === false;
}

function lifecycleForStatus(status) {
  if (status === "not_started") return "ready";
  if (status === "exploring" || status === "in_progress") return "in_progress";
  if (status === "decision_needed") return "changed";
  if (status === "completed") return "completed";
  return null;
}

export function buildAmoraPreparationTopicConsumerState(view) {
  if (
    !isRecord(view)
    || view.version !== 1
    || !hasValidProgress(view.progress)
    || typeof view.topicKey !== "string"
    || typeof view.applicability !== "string"
    || typeof view.status !== "string"
    || !VALID_STATE_COMBINATIONS.has(`${view.applicability}:${view.status}`)
  ) return null;

  const truthPolicy = getAmoraJourneyTruthTopicPolicy(view.topicKey);
  if (!truthPolicy) return null;

  const confirmedScheduleDecisions = readOptionalArray(view, "confirmedScheduleDecisions");
  const confirmedBudgetDecisions = readOptionalArray(view, "confirmedBudgetDecisions");
  const userReportedCatchUpRecords = readOptionalArray(view, "userReportedCatchUpRecords");
  const currentVendorBookingRecords = readOptionalArray(view, "currentVendorBookingRecords");
  const currentCompletedVendorBookingRecords = readOptionalArray(
    view,
    "currentCompletedVendorBookingRecords",
  );
  if (
    confirmedScheduleDecisions === null
    || confirmedBudgetDecisions === null
    || userReportedCatchUpRecords === null
    || currentVendorBookingRecords === null
    || currentCompletedVendorBookingRecords === null
  ) return null;
  const validCompletedVendorRecords = currentCompletedVendorBookingRecords.filter(
    isValidCompletedVendorRecord,
  );
  const hasUserReport = userReportedCatchUpRecords.some(isValidUserReport)
    || validCompletedVendorRecords.length > 0;
  const hasVendorRecord = currentVendorBookingRecords.some(isValidVendorRecord)
    || validCompletedVendorRecords.length > 0;
  const provenance = [];
  if (view.applicability !== "unknown") provenance.push("user_input");
  if (hasUserReport) provenance.push("user_reported");
  if (hasVendorRecord) provenance.push("vendor_unconfirmed");

  const lifecycle = lifecycleForStatus(view.status);
  if (!lifecycle) return null;
  const consumerState = composeAmoraConsumerState({
    version: 1,
    safety: "clear",
    identity: "current",
    scope: "verified",
    read: view.status === "decision_needed" ? "conflict" : "loaded",
    hasVerifiedSnapshot: true,
    applicability: view.applicability,
    approval: view.status === "completed" ? "receipt" : "none",
    lifecycle,
    provenance,
    money: hasVendorRecord
      ? "unpaid"
      : hasValidBudgetSummary(view.budgetSummary)
        && view.budgetSummary?.state === "ready" ? "planned" : "none",
    vendorConfirmation: hasVendorRecord ? "unconfirmed" : "not_applicable",
  });
  if (!consumerState) return null;

  return Object.freeze({
    version: AMORA_PREPARATION_TOPIC_CONSUMER_STATE_CONTRACT_VERSION,
    topicStatus: view.status,
    truthPolicy,
    consumerState,
  });
}
