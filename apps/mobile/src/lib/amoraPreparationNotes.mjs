import {
  validateAmoraPreparationTopicMessageRefCollectionResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
import { parseAmoraCoreCriterionResponse } from "@hanbang/shared/amora-core-criterion";
import { parseAmoraCoupleCriterionResponse } from "@hanbang/shared/amora-couple-criterion";
import { listDashboardOpenActions } from "./dashboardExperience.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const READ_STATES = new Set(["loading", "loaded", "partial", "unavailable"]);
const SCOPE_FILTERS = new Set(["all", "owner_private", "couple_shared"]);
const TYPE_FILTERS = new Set([
  "all",
  "saved_conversation",
  "owner_criterion",
  "couple_criterion",
  "confirmed_decision",
  "applied_receipt",
]);
const TOPIC_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const UNSAFE_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeQuery(value) {
  if (typeof value !== "string" || Array.from(value).length > 120) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return UNSAFE_TEXT_RE.test(normalized) ? null : normalized;
}

function searchableText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function parseTopics(value) {
  if (!Array.isArray(value) || value.length > 80) return null;
  const topics = new Map();
  for (const topic of value) {
    if (
      !isRecord(topic)
      || Object.keys(topic).length !== 2
      || !Object.hasOwn(topic, "key")
      || !Object.hasOwn(topic, "label")
      || typeof topic.key !== "string"
      || !TOPIC_KEY_RE.test(topic.key)
      || typeof topic.label !== "string"
      || topic.label !== topic.label.trim()
      || Array.from(topic.label).length < 1
      || Array.from(topic.label).length > 80
      || UNSAFE_TEXT_RE.test(topic.label)
      || topics.has(topic.key)
    ) return null;
    topics.set(topic.key, topic.label);
  }
  return topics;
}

function emptyResult(state, query, scopeFilter, topicFilter, typeFilter) {
  return Object.freeze({
    state,
    query,
    scopeFilter,
    topicFilter,
    typeFilter,
    continuingStory: null,
    records: Object.freeze([]),
  });
}

function scopeLabel(scope) {
  return scope === "owner_private" ? "나만 보기" : "함께 보기";
}

function buildSavedConversationRecords(references, topics) {
  const grouped = new Map();
  for (const reference of references) {
    const topicLabel = topics.get(reference.topicKey);
    if (!topicLabel) return null;
    const key = `${reference.audience}:${reference.messageId}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        id: `saved_conversation:${key}`,
        type: "saved_conversation",
        typeLabel: "저장 대화",
        excerpt: reference.excerpt,
        topicKeys: [reference.topicKey],
        topicLabels: [topicLabel],
        scope: reference.audience,
        scopeLabel: scopeLabel(reference.audience),
        savedAt: reference.savedAt,
        sourceCreatedAt: reference.sourceCreatedAt,
        freshness: "current",
        openOriginal: { refId: reference.refId },
      });
      continue;
    }
    if (
      current.excerpt !== reference.excerpt
      || current.sourceCreatedAt !== reference.sourceCreatedAt
      || current.topicKeys.includes(reference.topicKey)
    ) return null;
    current.topicKeys.push(reference.topicKey);
    current.topicLabels.push(topicLabel);
    if (Date.parse(reference.savedAt) > Date.parse(current.savedAt)) {
      current.savedAt = reference.savedAt;
      current.openOriginal = { refId: reference.refId };
    }
  }
  return [...grouped.values()]
    .sort((left, right) => (
      Date.parse(right.savedAt) - Date.parse(left.savedAt)
      || left.id.localeCompare(right.id)
    ))
    .map((record) => Object.freeze({
      ...record,
      topicKeys: Object.freeze(record.topicKeys),
      topicLabels: Object.freeze(record.topicLabels),
      openOriginal: Object.freeze(record.openOriginal),
    }));
}

function criterionRecord({ id, type, excerpt, scope, at, focus }) {
  return Object.freeze({
    id: `${type}:${id}`,
    type,
    typeLabel: type === "owner_criterion" ? "내 기준" : "우리 기준",
    excerpt,
    topicKeys: Object.freeze([]),
    topicLabels: Object.freeze([]),
    scope,
    scopeLabel: scopeLabel(scope),
    savedAt: at,
    sourceCreatedAt: at,
    freshness: "current",
    openSource: Object.freeze({
      route: "/settings/amora-style",
      focus,
    }),
  });
}

function buildCriterionRecords(input) {
  const records = [];
  let incomplete = false;
  let loading = false;
  let successfulSources = 0;
  if (input.ownerCriterionReadState !== undefined) {
    if (!READ_STATES.has(input.ownerCriterionReadState)) return null;
    if (input.ownerCriterionReadState === "loaded") {
      const response = parseAmoraCoreCriterionResponse(input.ownerCriterionResponse);
      if (!response) incomplete = true;
      else if (response.criterion) {
        successfulSources += 1;
        records.push(criterionRecord({
          id: response.criterion.id,
          type: "owner_criterion",
          excerpt: response.criterion.value,
          scope: "owner_private",
          at: response.criterion.updatedAt,
          focus: "owner_criterion",
        }));
      } else successfulSources += 1;
    } else {
      incomplete = true;
      loading = input.ownerCriterionReadState === "loading" || loading;
    }
  }

  if (input.coupleCriterionReadState !== undefined) {
    if (!READ_STATES.has(input.coupleCriterionReadState)) return null;
    if (input.coupleCriterionReadState === "loaded") {
      const response = parseAmoraCoupleCriterionResponse(input.coupleCriterionResponse);
      if (!response || response.coupleId !== input.coupleId) incomplete = true;
      else if (response.linked && response.current) {
        successfulSources += 1;
        records.push(criterionRecord({
          id: response.current.decisionId,
          type: "couple_criterion",
          excerpt: response.current.value,
          scope: "couple_shared",
          at: response.current.confirmedAt,
          focus: "couple_criterion",
        }));
      } else successfulSources += 1;
    } else {
      incomplete = true;
      loading = input.coupleCriterionReadState === "loading" || loading;
    }
  }
  return { records, incomplete, loading, successfulSources };
}

function buildContinuingStory(input, topics) {
  if (input.actionReadState === undefined) {
    return { value: null, incomplete: false, successfulSources: 0 };
  }
  if (input.actionReadState !== "loaded") {
    return { value: null, incomplete: true, successfulSources: 0 };
  }
  const actions = listDashboardOpenActions(
    input.openActions,
    input.coupleId,
    input.todayYmd,
  );
  if (!actions) return { value: null, incomplete: true, successfulSources: 0 };
  const action = actions[0] ?? null;
  if (!action?.categoryKey) {
    return { value: null, incomplete: false, successfulSources: 1 };
  }
  const topicLabel = topics.get(action.categoryKey);
  if (!topicLabel) return { value: null, incomplete: false, successfulSources: 1 };
  return {
    value: Object.freeze({
      actionId: action.id,
      actionRevision: action.sourceRevision,
      topicKey: action.categoryKey,
      topicLabel,
      title: action.title,
      description: action.description ?? "저장된 열린 행동이에요.",
      route: "/checklist",
    }),
    incomplete: false,
    successfulSources: 1,
  };
}

export function buildAmoraPreparationNotes(input) {
  const query = normalizeQuery(input?.query);
  const scopeFilter = input?.scopeFilter;
  const topicFilter = input?.topicFilter ?? "all";
  const typeFilter = input?.typeFilter;
  if (
    !isRecord(input)
    || typeof input.ownerId !== "string"
    || !UUID_RE.test(input.ownerId)
    || typeof input.coupleId !== "string"
    || !UUID_RE.test(input.coupleId)
    || query === null
    || !SCOPE_FILTERS.has(scopeFilter)
    || !TYPE_FILTERS.has(typeFilter)
    || !READ_STATES.has(input.messageReferenceReadState)
  ) {
    return emptyResult("read_error", query ?? "", "all", "all", "all");
  }

  const topics = parseTopics(input.topics);
  if (
    !topics
    || (
      topicFilter !== "all"
      && (typeof topicFilter !== "string" || !topics.has(topicFilter))
    )
  ) return emptyResult("read_error", query, scopeFilter, "all", typeFilter);
  const criteria = buildCriterionRecords(input);
  const continuingStory = buildContinuingStory(input, topics);
  if (!criteria) {
    return emptyResult("read_error", query, scopeFilter, topicFilter, typeFilter);
  }
  let savedConversationRecords = [];
  let messageReferencesIncomplete = false;
  let messageReferencesLoading = false;
  let messageReferenceSuccessfulSources = 0;
  let collectionPartial = false;
  if (
    input.messageReferenceReadState === "loaded"
    || input.messageReferenceReadState === "partial"
  ) {
    const collection = validateAmoraPreparationTopicMessageRefCollectionResponse(
      input.messageReferenceCollection,
      input.ownerId,
      input.coupleId,
    );
    if (collection.ok) {
      const built = buildSavedConversationRecords(collection.value.references, topics);
      if (built) {
        savedConversationRecords = built;
        messageReferenceSuccessfulSources = 1;
        collectionPartial = collection.value.partial;
      } else messageReferencesIncomplete = true;
    } else messageReferencesIncomplete = true;
  } else {
    messageReferencesIncomplete = true;
    messageReferencesLoading = input.messageReferenceReadState === "loading";
  }
  const records = [...savedConversationRecords, ...criteria.records].sort((left, right) => (
    Date.parse(right.savedAt) - Date.parse(left.savedAt)
    || left.id.localeCompare(right.id)
  ));

  const normalizedSearch = searchableText(query);
  const filteredRecords = records.filter((record) => (
    (scopeFilter === "all" || record.scope === scopeFilter)
    && (topicFilter === "all" || record.topicKeys.includes(topicFilter))
    && (typeFilter === "all" || record.type === typeFilter)
    && (
      normalizedSearch.length === 0
      || searchableText([
        record.excerpt,
        record.typeLabel,
        ...record.topicLabels,
      ].join(" ")).includes(normalizedSearch)
    )
  ));

  const incomplete = messageReferencesIncomplete
    || input.messageReferenceReadState === "partial"
    || collectionPartial
    || criteria.incomplete
    || continuingStory.incomplete;
  const loading = messageReferencesLoading || criteria.loading;
  const successfulSources = messageReferenceSuccessfulSources
    + criteria.successfulSources
    + continuingStory.successfulSources;
  const state = successfulSources === 0 && loading
    ? "loading"
    : successfulSources === 0 && incomplete
      ? "read_error"
      : incomplete || loading
        ? "partial"
    : records.length === 0
      ? "empty"
      : filteredRecords.length === 0
        ? "no_results"
        : "ready";
  return Object.freeze({
    state,
    query,
    scopeFilter,
    topicFilter,
    typeFilter,
    continuingStory: continuingStory.value,
    records: Object.freeze(filteredRecords),
  });
}
