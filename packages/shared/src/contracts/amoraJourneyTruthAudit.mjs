export const AMORA_JOURNEY_TRUTH_AUDIT_CONTRACT_VERSION = 1;

const COVERAGE_KEYS = Object.freeze([
  "version",
  "scope",
  "axes",
  "connectedChecklistTopics",
  "gaps",
  "issues",
  "isComplete",
]);
const AXIS_KEYS = Object.freeze([
  "foundation",
  "couple_and_family",
  "venue_and_guests",
  "photo_and_style",
  "ceremony_program",
  "vendors_and_money",
  "home_and_life",
  "travel_and_admin",
  "final_operations",
  "post_wedding",
]);
const TOPIC_KEYS = Object.freeze([
  "greeting",
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
  "registration",
]);
const GAP_POLICIES = Object.freeze({
  planning_foundation: Object.freeze({
    disposition: "now",
    surfaceOwner: "onboarding_and_amora",
    axisKeys: Object.freeze(["foundation"]),
    requiredSourceKinds: Object.freeze(["journey", "budget", "decision"]),
    consumerState: "known_gap_priority",
  }),
  guest_operations: Object.freeze({
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: Object.freeze(["venue_and_guests"]),
    requiredSourceKinds: Object.freeze(["guest", "schedule", "decision"]),
    consumerState: "known_gap",
  }),
  contract_record_safety: Object.freeze({
    disposition: "known_gap",
    surfaceOwner: "preparation_topic",
    axisKeys: Object.freeze(["vendors_and_money"]),
    requiredSourceKinds: Object.freeze(["vendor", "contract", "budget"]),
    consumerState: "known_gap",
  }),
  contract_transaction_execution: Object.freeze({
    disposition: "parked",
    surfaceOwner: "none",
    axisKeys: Object.freeze(["vendors_and_money"]),
    requiredSourceKinds: Object.freeze(["vendor", "contract", "payment", "legal_review"]),
    consumerState: "parked_out_of_scope",
  }),
  marriage_admin: Object.freeze({
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: Object.freeze(["travel_and_admin"]),
    requiredSourceKinds: Object.freeze(["verified_guide", "decision"]),
    consumerState: "known_gap",
  }),
  wedding_day_operations: Object.freeze({
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: Object.freeze(["ceremony_program", "final_operations"]),
    requiredSourceKinds: Object.freeze(["schedule", "contact", "checklist", "budget"]),
    consumerState: "known_gap",
  }),
  post_wedding_closeout: Object.freeze({
    disposition: "known_gap",
    surfaceOwner: "preparation_map",
    axisKeys: Object.freeze(["post_wedding"]),
    requiredSourceKinds: Object.freeze(["deliverable", "budget", "checklist", "verified_guide"]),
    consumerState: "known_gap",
  }),
});
const GAP_KEYS = Object.freeze(Object.keys(GAP_POLICIES));

const TRUTH_OWNERS = Object.freeze({
  problem: "canonical_checklist",
  applicability: "saved_checklist",
  status: "saved_checklist",
  progress: "saved_checklist",
  decision: "validated_receipt_projection",
  execution: "current_schedule_or_shared_action",
  completion: "saved_checklist",
});
const EVIDENCE_EFFECTS = Object.freeze({
  schedule: "supporting_execution_only",
  decisionReceipt: "supporting_decision_only",
  userReport: "supporting_non_proof_only",
  vendorRecord: "supporting_non_proof_only",
  budgetRecord: "supporting_non_payment_only",
  openAction: "prevents_terminal_completion",
  guide: "supporting_guidance_only",
  savedConversation: "supporting_context_only",
});
const FAILURE_UI = Object.freeze({
  unknownApplicability: "review_required",
  conflict: "review_required",
  partial: "partial_visible",
  unavailable: "unavailable_visible",
  empty: "empty_only_when_all_required_reads_loaded",
});

export function getAmoraJourneyTruthTopicPolicy(topicKey) {
  if (typeof topicKey !== "string" || !TOPIC_KEYS.includes(topicKey)) return null;
  return Object.freeze({
    topicKey,
    truthOwners: TRUTH_OWNERS,
    evidenceEffects: EVIDENCE_EFFECTS,
    failureUi: FAILURE_UI,
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function hasExactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function validateTopics(topics) {
  if (!Array.isArray(topics) || topics.length !== TOPIC_KEYS.length) return false;
  return topics.every((topic, index) => (
    isRecord(topic)
    && hasExactKeys(topic, ["topicKey", "label", "applicability", "axisKeys"])
    && topic.topicKey === TOPIC_KEYS[index]
    && typeof topic.label === "string"
    && topic.label.trim().length > 0
    && topic.applicability === "explicit_not_applicable_supported"
    && Array.isArray(topic.axisKeys)
    && topic.axisKeys.length > 0
    && new Set(topic.axisKeys).size === topic.axisKeys.length
    && topic.axisKeys.every((axisKey) => AXIS_KEYS.includes(axisKey))
  ));
}

function validateGaps(gaps) {
  if (!Array.isArray(gaps) || gaps.length !== GAP_KEYS.length) return false;
  return gaps.every((gap, index) => {
    if (
      !isRecord(gap)
      || !hasExactKeys(gap, [
        "gapKey",
        "label",
        "disposition",
        "surfaceOwner",
        "axisKeys",
        "reason",
        "requiredSourceKinds",
      ])
      || gap.gapKey !== GAP_KEYS[index]
      || typeof gap.label !== "string"
      || gap.label.trim().length === 0
      || typeof gap.reason !== "string"
      || gap.reason.trim().length === 0
    ) return false;
    const expected = GAP_POLICIES[gap.gapKey];
    return gap.disposition === expected.disposition
      && gap.surfaceOwner === expected.surfaceOwner
      && hasExactStringArray(gap.axisKeys, expected.axisKeys)
      && hasExactStringArray(gap.requiredSourceKinds, expected.requiredSourceKinds);
  });
}

function validateAxes(axes, topics, gaps) {
  if (!Array.isArray(axes) || axes.length !== AXIS_KEYS.length) return false;
  return axes.every((axis, index) => {
    if (
      !isRecord(axis)
      || !hasExactKeys(axis, ["axisKey", "label", "status", "connectedTopicKeys", "gapKeys"])
      || axis.axisKey !== AXIS_KEYS[index]
      || typeof axis.label !== "string"
      || axis.label.trim().length === 0
    ) return false;
    const connectedTopicKeys = topics
      .filter((topic) => topic.axisKeys.includes(axis.axisKey))
      .map((topic) => topic.topicKey);
    const gapKeys = gaps
      .filter((gap) => gap.axisKeys.includes(axis.axisKey))
      .map((gap) => gap.gapKey);
    const status = connectedTopicKeys.length === 0
      ? "gap"
      : gapKeys.length > 0 ? "partial" : "connected";
    return axis.status === status
      && hasExactStringArray(axis.connectedTopicKeys, connectedTopicKeys)
      && hasExactStringArray(axis.gapKeys, gapKeys);
  });
}

function isCanonicalCoverage(coverage) {
  return isRecord(coverage)
    && hasExactKeys(coverage, COVERAGE_KEYS)
    && coverage.version === 1
    && coverage.scope === "full_wedding_journey"
    && coverage.isComplete === false
    && Array.isArray(coverage.issues)
    && coverage.issues.length === 0
    && validateTopics(coverage.connectedChecklistTopics)
    && validateGaps(coverage.gaps)
    && validateAxes(coverage.axes, coverage.connectedChecklistTopics, coverage.gaps);
}

export function buildAmoraJourneyTruthAudit(coverage) {
  if (!isCanonicalCoverage(coverage)) return null;

  const topicPolicies = coverage.connectedChecklistTopics.map((topic) => (
    getAmoraJourneyTruthTopicPolicy(topic.topicKey)
  ));
  const gapPolicies = coverage.gaps.map((gap) => {
    const policy = GAP_POLICIES[gap.gapKey];
    return Object.freeze({
      gapKey: gap.gapKey,
      disposition: policy.disposition,
      surfaceOwner: policy.surfaceOwner,
      axisKeys: policy.axisKeys,
      requiredSourceKinds: policy.requiredSourceKinds,
      consumerState: policy.consumerState,
      allowProgress: false,
      allowCompletion: false,
      allowRecommendation: false,
    });
  });

  return Object.freeze({
    version: AMORA_JOURNEY_TRUTH_AUDIT_CONTRACT_VERSION,
    scope: "full_wedding_journey_truth",
    topicPolicies: Object.freeze(topicPolicies),
    gapPolicies: Object.freeze(gapPolicies),
    isComplete: false,
  });
}
