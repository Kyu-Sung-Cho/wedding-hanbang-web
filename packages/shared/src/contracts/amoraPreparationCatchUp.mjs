export const AMORA_PREPARATION_CATCH_UP_CONTRACT_VERSION = 1;

const ENTRY_KEYS = Object.freeze([
  "canonicalProgress",
  "readState",
  "selfReportedStage",
  "version",
]);
const PREVIEW_KEYS = Object.freeze(["items", "version"]);
const ITEM_KEYS = Object.freeze(["scope", "state", "topicKey"]);
const DRAFT_SUBMISSION_KEYS = Object.freeze(["items", "requestId", "version"]);
const MUTATION_KEYS = Object.freeze(["expectedCoupleId", "items", "requestId", "version"]);
const RECEIPT_KEYS = Object.freeze([
  "boundaries",
  "confirmedAt",
  "coupleId",
  "items",
  "next",
  "receiptId",
  "requestId",
  "reused",
  "sourceJourneyRevision",
  "status",
  "version",
]);
const RECEIPT_ITEM_KEYS = Object.freeze(["decisionId", "scope", "source", "state", "topicKey"]);
const BOUNDARY_KEYS = Object.freeze(["checklistCompletionChanged", "paymentEvidence", "vendorConfirmation"]);
const NEXT_KEYS = Object.freeze(["kind", "route"]);
const CANONICAL_EXISTING_KEYS = Object.freeze(["next", "status", "version"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const READ_STATES = new Set(["loaded", "partial", "unavailable"]);
const CANONICAL_PROGRESS_STATES = new Set(["empty", "present"]);
const SELF_REPORTED_STAGES = new Set(["starting", "already_preparing", "unknown", "later"]);
const CATCH_UP_STATES = new Set(["completed", "in_progress", "unknown", "not_applicable"]);
const CATCH_UP_SCOPES = new Set(["owner_private", "couple_shared"]);

export const AMORA_PREPARATION_CATCH_UP_TOPICS = Object.freeze([
  Object.freeze({ topicKey: "meeting", topicLabel: "부모님 첫 만남" }),
  Object.freeze({ topicKey: "venue", topicLabel: "결혼식장" }),
  Object.freeze({ topicKey: "studio", topicLabel: "웨딩 사진 촬영" }),
  Object.freeze({ topicKey: "dress", topicLabel: "드레스·예식 정장" }),
  Object.freeze({ topicKey: "makeup", topicLabel: "헤어·메이크업" }),
  Object.freeze({ topicKey: "ring", topicLabel: "결혼반지·기념 선물" }),
  Object.freeze({ topicKey: "hanbok", topicLabel: "한복" }),
  Object.freeze({ topicKey: "yedan", topicLabel: "두 가족에게 드릴 선물" }),
  Object.freeze({ topicKey: "honeymoon", topicLabel: "신혼여행" }),
  Object.freeze({ topicKey: "houseware", topicLabel: "가전·가구·생활용품" }),
  Object.freeze({ topicKey: "housing", topicLabel: "신혼집" }),
  Object.freeze({ topicKey: "invitation", topicLabel: "종이·모바일 초대장" }),
  Object.freeze({ topicKey: "snap", topicLabel: "결혼식 날 사진·영상" }),
  Object.freeze({ topicKey: "shoes", topicLabel: "결혼식 신발" }),
  Object.freeze({ topicKey: "bouquet", topicLabel: "손에 드는 꽃·꽃 장식" }),
  Object.freeze({ topicKey: "gift", topicLabel: "결혼식에 온 분께 드릴 선물" }),
  Object.freeze({ topicKey: "mc", topicLabel: "결혼식 진행·축하 노래" }),
  Object.freeze({ topicKey: "ham", topicLabel: "가족에게 전하는 전통 혼례 선물" }),
  Object.freeze({ topicKey: "pyebaek", topicLabel: "결혼식 뒤 전통 인사" }),
]);

const TOPIC_INDEX = new Map(
  AMORA_PREPARATION_CATCH_UP_TOPICS.map((topic, index) => [topic.topicKey, index]),
);
const TOPIC_LABELS = new Map(
  AMORA_PREPARATION_CATCH_UP_TOPICS.map((topic) => [topic.topicKey, topic.topicLabel]),
);

const STATE_PRESENTATIONS = Object.freeze({
  completed: Object.freeze({
    stateLabel: "이미 끝냈어요",
    boundaryLabel: "사용자가 완료로 기록 · 체크리스트 완료·예약·계약·결제 증빙 아님",
  }),
  in_progress: Object.freeze({
    stateLabel: "진행 중이에요",
    boundaryLabel: "사용자가 진행 중으로 기록 · 업체 진행 확인 아님",
  }),
  unknown: Object.freeze({
    stateLabel: "아직 잘 모르겠어요",
    boundaryLabel: "아직 모름으로 유지 · 완료로 계산하지 않음",
  }),
  not_applicable: Object.freeze({
    stateLabel: "해당 없어요",
    boundaryLabel: "사용자가 해당 없음으로 기록 · 언제든 다시 포함 가능",
  }),
});

const SCOPE_LABELS = Object.freeze({
  owner_private: "나만 보기",
  couple_shared: "함께 보기",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function freezeEntry(value) {
  return Object.freeze({
    ...value,
    primaryAction: value.primaryAction === null
      ? null
      : Object.freeze({ ...value.primaryAction }),
  });
}

export function resolveAmoraPreparationCatchUpEntry(input) {
  if (
    !isRecord(input)
    || !hasExactKeys(input, ENTRY_KEYS)
    || input.version !== AMORA_PREPARATION_CATCH_UP_CONTRACT_VERSION
    || !READ_STATES.has(input.readState)
    || !CANONICAL_PROGRESS_STATES.has(input.canonicalProgress)
    || !SELF_REPORTED_STAGES.has(input.selfReportedStage)
  ) {
    return null;
  }

  if (input.readState !== "loaded") {
    return freezeEntry({
      version: 1,
      mode: "recovery",
      title: "현재 준비를 먼저 다시 확인할게요",
      description: input.readState === "partial"
        ? "확인된 기록이 일부뿐이라 새 상태를 더하지 않아요."
        : "현재 기록을 불러오지 못해 새 상태를 더하지 않아요.",
      primaryAction: {
        kind: "retry_canonical_read",
        label: "현재 준비 다시 확인",
        requiresWrite: false,
      },
      catchUpEnabled: false,
    });
  }

  if (input.canonicalProgress === "present") {
    return freezeEntry({
      version: 1,
      mode: "canonical_existing",
      title: "저장된 준비에서 이어갈게요",
      description: "이미 확인된 기록을 먼저 사용하고 같은 내용을 다시 묻지 않아요.",
      primaryAction: {
        kind: "continue_canonical",
        label: "준비 이어가기",
        requiresWrite: false,
      },
      catchUpEnabled: false,
    });
  }

  if (input.selfReportedStage === "already_preparing") {
    return freezeEntry({
      version: 1,
      mode: "catch_up",
      title: "이미 준비한 것부터 알려주세요",
      description: "확실한 주제만 최대 세 가지 골라주세요. 모르는 항목은 그대로 남겨도 괜찮아요.",
      primaryAction: {
        kind: "open_catch_up_editor",
        label: "준비한 것 정리하기",
        requiresWrite: false,
      },
      catchUpEnabled: true,
    });
  }

  if (input.selfReportedStage === "later") {
    return freezeEntry({
      version: 1,
      mode: "deferred",
      title: "지금은 건너뛸게요",
      description: "준비 상태를 저장하지 않고도 다음 행동을 확인할 수 있어요.",
      primaryAction: null,
      catchUpEnabled: false,
    });
  }

  return freezeEntry({
    version: 1,
    mode: "not_needed",
    title: input.selfReportedStage === "starting" ? "처음부터 가볍게 시작해요" : "모르는 상태 그대로 시작해요",
    description: "준비 완료를 추정하지 않고 지금 확인할 한 가지부터 안내해요.",
    primaryAction: {
      kind: "continue_first_value",
      label: "다음 행동 보기",
      requiresWrite: false,
    },
    catchUpEnabled: false,
  });
}

function parsePreviewItem(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ITEM_KEYS)
    || !TOPIC_INDEX.has(value.topicKey)
    || !CATCH_UP_STATES.has(value.state)
    || !CATCH_UP_SCOPES.has(value.scope)
  ) {
    return null;
  }

  return {
    topicKey: value.topicKey,
    state: value.state,
    scope: value.scope,
  };
}

export function buildAmoraPreparationCatchUpPreview(input) {
  if (
    !isRecord(input)
    || !hasExactKeys(input, PREVIEW_KEYS)
    || input.version !== AMORA_PREPARATION_CATCH_UP_CONTRACT_VERSION
    || !Array.isArray(input.items)
    || input.items.length < 1
    || input.items.length > 3
  ) {
    return null;
  }

  const parsedItems = input.items.map(parsePreviewItem);
  if (parsedItems.some((item) => item === null)) {
    return null;
  }

  const topicKeys = parsedItems.map((item) => item.topicKey);
  if (new Set(topicKeys).size !== topicKeys.length) {
    return null;
  }

  const orderedItems = [...parsedItems].sort(
    (left, right) => TOPIC_INDEX.get(left.topicKey) - TOPIC_INDEX.get(right.topicKey),
  );
  const operationItems = Object.freeze(orderedItems.map((item) => Object.freeze({
    topicKey: item.topicKey,
    state: item.state,
    scope: item.scope,
    source: "user_reported",
  })));
  const previewItems = Object.freeze(orderedItems.map((item) => Object.freeze({
    topicKey: item.topicKey,
    topicLabel: TOPIC_LABELS.get(item.topicKey),
    state: item.state,
    stateLabel: STATE_PRESENTATIONS[item.state].stateLabel,
    scope: item.scope,
    scopeLabel: SCOPE_LABELS[item.scope],
    source: "user_reported",
    boundaryLabel: STATE_PRESENTATIONS[item.state].boundaryLabel,
  })));

  return Object.freeze({
    version: 1,
    kind: "preview",
    title: "이렇게 준비 상태를 정리할게요",
    description: "확인한 세 항목만 반영하며, 기존 체크리스트를 임의로 완료하지 않아요.",
    items: previewItems,
    operation: Object.freeze({
      version: 1,
      kind: "reconcile_preparation_catch_up",
      items: operationItems,
    }),
    requiresApproval: true,
    writesChecklistCompletion: false,
    estimatedCompletionRate: null,
  });
}

function normalizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

export function parseAmoraPreparationCatchUpDraftSubmission(input) {
  if (
    !isRecord(input)
    || !hasExactKeys(input, DRAFT_SUBMISSION_KEYS)
    || input.version !== AMORA_PREPARATION_CATCH_UP_CONTRACT_VERSION
  ) {
    return null;
  }
  const requestId = normalizeUuid(input.requestId);
  const preview = buildAmoraPreparationCatchUpPreview({
    version: input.version,
    items: input.items,
  });
  if (!requestId || !preview) return null;
  return Object.freeze({
    version: 1,
    requestId,
    items: Object.freeze(preview.operation.items.map((item) => Object.freeze({
      topicKey: item.topicKey,
      state: item.state,
      scope: item.scope,
    }))),
  });
}

export function parseAmoraPreparationCatchUpMutationRequest(input) {
  if (
    !isRecord(input)
    || !hasExactKeys(input, MUTATION_KEYS)
    || input.version !== AMORA_PREPARATION_CATCH_UP_CONTRACT_VERSION
  ) {
    return null;
  }
  const expectedCoupleId = normalizeUuid(input.expectedCoupleId);
  const draft = parseAmoraPreparationCatchUpDraftSubmission({
    version: input.version,
    requestId: input.requestId,
    items: input.items,
  });
  if (!expectedCoupleId || !draft) {
    return null;
  }
  return Object.freeze({
    version: 1,
    expectedCoupleId,
    requestId: draft.requestId,
    items: draft.items,
  });
}

export function parseAmoraPreparationCatchUpCanonicalExisting(input) {
  if (
    !isRecord(input)
    || !hasExactKeys(input, CANONICAL_EXISTING_KEYS)
    || input.version !== 1
    || input.status !== "canonical_existing"
    || !isRecord(input.next)
    || !hasExactKeys(input.next, NEXT_KEYS)
    || input.next.kind !== "continue_canonical"
    || input.next.route !== "/schedule"
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    status: "canonical_existing",
    next: Object.freeze({ kind: "continue_canonical", route: "/schedule" }),
  });
}

function invalidReceipt(reason) {
  return Object.freeze({ ok: false, reason });
}

export function validateAmoraPreparationCatchUpReceipt(
  input,
  expectedCoupleIdValue,
  expectedRequestIdValue,
  expectedItemsValue,
) {
  const expectedCoupleId = normalizeUuid(expectedCoupleIdValue);
  const expectedRequestId = normalizeUuid(expectedRequestIdValue);
  const expectedPreview = buildAmoraPreparationCatchUpPreview({
    version: 1,
    items: expectedItemsValue,
  });
  if (!expectedCoupleId || !expectedRequestId || !expectedPreview) {
    return invalidReceipt("expected_context_invalid");
  }
  if (
    !isRecord(input)
    || !hasExactKeys(input, RECEIPT_KEYS)
    || input.version !== 1
    || input.status !== "applied"
    || normalizeUuid(input.receiptId) !== input.receiptId
    || normalizeUuid(input.coupleId) !== expectedCoupleId
    || normalizeUuid(input.requestId) !== expectedRequestId
    || !Number.isSafeInteger(input.sourceJourneyRevision)
    || input.sourceJourneyRevision < 0
    || typeof input.reused !== "boolean"
    || typeof input.confirmedAt !== "string"
    || Number.isNaN(Date.parse(input.confirmedAt))
    || new Date(input.confirmedAt).toISOString() !== input.confirmedAt
    || !Array.isArray(input.items)
    || input.items.length !== expectedPreview.operation.items.length
    || !isRecord(input.boundaries)
    || !hasExactKeys(input.boundaries, BOUNDARY_KEYS)
    || input.boundaries.checklistCompletionChanged !== false
    || input.boundaries.vendorConfirmation !== "unconfirmed"
    || input.boundaries.paymentEvidence !== false
    || !isRecord(input.next)
    || !hasExactKeys(input.next, NEXT_KEYS)
    || input.next.kind !== "recalculate_current_state"
    || input.next.route !== "/schedule"
  ) {
    return invalidReceipt("receipt_invalid");
  }

  const items = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const value = input.items[index];
    const expected = expectedPreview.operation.items[index];
    if (
      !isRecord(value)
      || !hasExactKeys(value, RECEIPT_ITEM_KEYS)
      || normalizeUuid(value.decisionId) !== value.decisionId
      || value.topicKey !== expected.topicKey
      || value.state !== expected.state
      || value.scope !== expected.scope
      || value.source !== "user_reported"
    ) {
      return invalidReceipt("receipt_item_invalid");
    }
    items.push(Object.freeze({
      decisionId: value.decisionId,
      topicKey: value.topicKey,
      state: value.state,
      scope: value.scope,
      source: "user_reported",
    }));
  }

  const value = Object.freeze({
    version: 1,
    status: "applied",
    receiptId: input.receiptId,
    coupleId: expectedCoupleId,
    requestId: expectedRequestId,
    sourceJourneyRevision: input.sourceJourneyRevision,
    confirmedAt: input.confirmedAt,
    reused: input.reused,
    items: Object.freeze(items),
    boundaries: Object.freeze({
      checklistCompletionChanged: false,
      vendorConfirmation: "unconfirmed",
      paymentEvidence: false,
    }),
    next: Object.freeze({
      kind: "recalculate_current_state",
      route: "/schedule",
    }),
  });
  return Object.freeze({ ok: true, value });
}
