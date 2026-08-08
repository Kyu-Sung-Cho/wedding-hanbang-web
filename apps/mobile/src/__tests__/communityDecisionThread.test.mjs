import test from "node:test";
import assert from "node:assert/strict";
import {
  isCommunityDecisionCreateReceiptForSubmission,
  isCommunityDecisionReceiptForCommand,
  parseCommunityDecisionCreateReceipt,
  parseCommunityDecisionDraft,
  parseCommunityDecisionMutationPending,
  parseCommunityDecisionPublicationStatus,
  parseCommunityDecisionPublicationWithdrawReceipt,
  parseCommunityDecisionWithdrawReceipt,
  parseCommunityDecisionMutationReceipt,
  parseCommunityDecisionStaleReceipt,
  parseCommunityDecisionDetail,
  parseRetryAfterSeconds,
  readDecisionThreadIdFromPost,
} from "../lib/communityDecisionThread.mjs";

const ids = {
  questionId: "00000000-0000-4000-8000-000000000001",
  commandId: "00000000-0000-4000-8000-000000000002",
  threadId: "00000000-0000-4000-8000-000000000003",
  postId: "00000000-0000-4000-8000-000000000004",
  operationKey: "00000000-0000-4000-8000-000000000006",
  outcomeId: "00000000-0000-4000-8000-000000000007",
};

function publishedDetail() {
  return {
    thread: {
      id: ids.threadId,
      postId: ids.postId,
      state: "answered",
      version: 2,
      kind: "experience_question",
      topicCategory: "contract_extra_cost",
      experienceScope: "extra_charge",
      coarseRegion: "서울 동부",
      preparationStage: "contracted",
      contractPhase: "after_contract",
      desiredAnswer: "확인한 계약 문구와 실제 결과",
      qualifiedPeerAnswerCount: 0,
      qualifiedProfessionalAnswerCount: 0,
      nextAction: null,
      resolvedAt: null,
      completedAt: null,
      sourceUnavailableAt: null,
      newApplicationsAllowed: true,
      createdAt: "2026-08-04T12:00:00.000Z",
    },
    post: {
      title: "계약 뒤 추가금 확인 경험이 궁금해요",
      content: "계약서에 없던 추가 비용을 안내받은 경험을 듣고 싶어요.",
      contentOrigin: "member",
      commercialRelationship: "none",
      sponsorshipDetail: null,
      publicationState: "published",
      author: { nickname: "준비하는커플", badge: "member" },
      createdAt: "2026-08-04T12:00:00.000Z",
    },
    answers: [],
    viewer: {
      isAuthor: false,
      canAnswer: false,
      canResolve: false,
      canRecordOutcome: false,
      canWithdraw: false,
      selection: [],
      outcomes: [],
    },
  };
}

test("202 remains a private waitlist receipt and cannot become published by shape alone", () => {
  const receipt = parseCommunityDecisionCreateReceipt({
    status: "private_waitlist",
    questionId: ids.questionId,
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  }, 202);

  assert.deepEqual(receipt, {
    kind: "private_waitlist",
    questionId: ids.questionId,
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  });
  assert.equal(parseCommunityDecisionCreateReceipt({
    status: "published",
    ...ids,
    publicationVersion: 1,
    currentState: "open",
    currentVersion: 1,
    replayed: false,
  }, 202), null);
});

test("only exact 200/201 publication receipts expose a thread route", () => {
  for (const status of [200, 201]) {
    const receipt = parseCommunityDecisionCreateReceipt({
      status: "published",
      ...ids,
      publicationVersion: 1,
      currentState: status === 200 ? "answered" : "open",
      currentVersion: status === 200 ? 3 : 1,
      replayed: status === 200,
    }, status);
    assert.equal(receipt?.kind, "published");
    assert.equal(receipt?.threadId, ids.threadId);
  }

  assert.equal(parseCommunityDecisionCreateReceipt({
    status: "published",
    ...ids,
    publicationVersion: 2,
    currentState: "answered",
    currentVersion: 2,
    replayed: true,
  }, 200), null);
  assert.equal(parseCommunityDecisionCreateReceipt({
    status: "published",
    ...ids,
    publicationVersion: 1,
    currentState: "open",
    currentVersion: 1,
    replayed: false,
  }, 200), null);
  assert.equal(parseCommunityDecisionCreateReceipt({
    status: "published",
    ...ids,
    threadId: "not-a-uuid",
    publicationVersion: 1,
    currentState: "open",
    currentVersion: 1,
    replayed: true,
  }, 200), null);
});

test("a valid receipt still fails closed when it belongs to another pending submission", () => {
  const receipt = parseCommunityDecisionCreateReceipt({
    status: "published",
    ...ids,
    publicationVersion: 1,
    currentState: "open",
    currentVersion: 1,
    replayed: false,
  }, 201);
  assert.ok(receipt);
  assert.equal(isCommunityDecisionCreateReceiptForSubmission(
    receipt,
    ids.questionId,
    ids.operationKey,
    null,
  ), true);
  assert.equal(isCommunityDecisionCreateReceiptForSubmission(
    receipt,
    "00000000-0000-4000-8000-000000000099",
    ids.operationKey,
    null,
  ), false);
  assert.equal(isCommunityDecisionCreateReceiptForSubmission(
    receipt,
    ids.questionId,
    ids.operationKey,
    "00000000-0000-4000-8000-000000000098",
  ), false);
});

test("mutation receipts are bound to the exact persisted command", () => {
  const receipt = parseCommunityDecisionMutationReceipt({
    status: "answered",
    answerId: ids.questionId,
    commentId: ids.postId,
    threadId: ids.threadId,
    state: "answered",
    version: 2,
    qualifiedPeerAnswerCount: 1,
    qualifiedProfessionalAnswerCount: 0,
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  }, "answer");
  assert.equal(isCommunityDecisionReceiptForCommand(receipt, ids.operationKey), true);
  assert.equal(isCommunityDecisionReceiptForCommand(
    receipt,
    "00000000-0000-4000-8000-000000000099",
  ), false);
});

test("detail mutation recovery accepts only owner-scoped exact unexpired commands", () => {
  const now = 2_000_000_000_000;
  const bodyText = JSON.stringify({
    content: "직접 겪은 계약 추가 비용 확인 경험을 공유합니다.",
    responseKind: "experience",
    directExperience: true,
    experiencePeriod: "within_6_months",
    experienceStage: "contracted",
    coarseRegion: "서울 동부",
    actionTaken: "계약서 포함 항목을 서면으로 다시 확인했어요.",
    resultSummary: null,
    nextCheck: null,
    factOpinionBoundary: "제가 직접 확인한 계약서와 응답만 적었어요.",
    commercialRelationship: "none",
    sponsorshipDetail: null,
  });
  const pending = {
    ownerId: ids.questionId,
    questionId: ids.threadId,
    slot: "answer",
    operation: "answer",
    operationKey: ids.commandId,
    bodyText,
    createdAt: now,
  };
  assert.deepEqual(parseCommunityDecisionMutationPending(
    pending,
    ids.questionId,
    ids.threadId,
    now,
  ), pending);
  assert.equal(parseCommunityDecisionMutationPending(
    pending,
    ids.postId,
    ids.threadId,
    now,
  ), null);
  assert.equal(parseCommunityDecisionMutationPending({
    ...pending,
    bodyText: JSON.stringify({ content: "tampered" }),
  }, ids.questionId, ids.threadId, now), null);
  assert.equal(parseCommunityDecisionMutationPending({
    ...pending,
    createdAt: now - 24 * 60 * 60 * 1000 - 1,
  }, ids.questionId, ids.threadId, now), null);

  const publicationWithdrawPending = {
    ...pending,
    slot: `publication_withdraw:${ids.outcomeId}`,
    operation: "publication_withdraw",
    bodyText: "{}",
  };
  assert.deepEqual(parseCommunityDecisionMutationPending(
    publicationWithdrawPending,
    ids.questionId,
    ids.threadId,
    now,
  ), publicationWithdrawPending);
  assert.equal(parseCommunityDecisionMutationPending({
    ...publicationWithdrawPending,
    bodyText: JSON.stringify({ outcomeId: ids.outcomeId }),
  }, ids.questionId, ids.threadId, now), null);
  assert.equal(parseCommunityDecisionMutationPending({
    ...publicationWithdrawPending,
    slot: "publication_withdraw:not-a-uuid",
  }, ids.questionId, ids.threadId, now), null);
});

test("owner publication state is exact and only active states are withdrawable", () => {
  const active = {
    outcomeId: ids.outcomeId,
    threadId: ids.threadId,
    revision: 2,
    publicationState: "pending_review",
    canWithdraw: true,
    updatedAt: "2026-08-04T12:00:00.000Z",
  };
  assert.deepEqual(parseCommunityDecisionPublicationStatus(active), active);
  assert.equal(parseCommunityDecisionPublicationStatus({
    ...active,
    canWithdraw: false,
  }), null);
  assert.equal(parseCommunityDecisionPublicationStatus({
    ...active,
    publicationState: "rejected",
    canWithdraw: true,
  }), null);
  assert.ok(parseCommunityDecisionPublicationStatus({
    ...active,
    publicationState: "withdrawn",
    canWithdraw: false,
  }));
  assert.equal(parseCommunityDecisionPublicationStatus({
    ...active,
    canonicalResult: "private",
  }), null);
});

test("publication withdrawal accepts only the exact target receipt", () => {
  const receipt = {
    status: "withdrawn",
    threadId: ids.threadId,
    outcomeId: ids.outcomeId,
    operationKey: ids.operationKey,
    revision: 2,
    withdrawnAt: "2026-08-04T12:00:00.000Z",
    replayed: false,
  };
  assert.deepEqual(
    parseCommunityDecisionPublicationWithdrawReceipt(receipt),
    receipt,
  );
  assert.equal(parseCommunityDecisionPublicationWithdrawReceipt({
    ...receipt,
    canonicalResult: "private",
  }), null);
  assert.equal(parseCommunityDecisionPublicationWithdrawReceipt({
    ...receipt,
    outcomeId: "not-a-uuid",
  }), null);
  assert.equal(parseCommunityDecisionPublicationWithdrawReceipt({
    ...receipt,
    withdrawnAt: "not-a-date",
  }), null);
});

test("generic post bridge never derives a thread id and only accepts an actual UUID field", () => {
  assert.equal(readDecisionThreadIdFromPost({ id: ids.postId }), null);
  assert.equal(readDecisionThreadIdFromPost({
    id: ids.postId,
    decisionThreadId: "not-a-uuid",
  }), null);
  assert.equal(readDecisionThreadIdFromPost({
    id: ids.postId,
    decisionThreadId: ids.threadId,
  }), ids.threadId);
});

test("retry-after accepts only bounded positive seconds", () => {
  assert.equal(parseRetryAfterSeconds("300"), 300);
  assert.equal(parseRetryAfterSeconds("0"), null);
  assert.equal(parseRetryAfterSeconds("tomorrow"), null);
  assert.equal(parseRetryAfterSeconds("999999"), null);
});

test("composer drafts are owner scoped, bounded, and expire after 24 hours", () => {
  const now = 2_000_000_000_000;
  const draft = {
    ownerId: ids.questionId,
    updatedAt: now,
    content: "계약서에 없는 원본 비용을 계약 뒤에 안내받았습니다.",
    title: "계약 뒤 원본 추가금 확인 경험이 궁금해요",
    experienceScope: "extra_charge",
    preparationStage: "contracted",
    contractPhase: "after_contract",
    coarseRegion: "서울 동부",
    desiredAnswer: "확인한 계약 문구와 실제 결과",
    commercialRelationship: "none",
    sponsorshipDetail: "",
  };
  assert.deepEqual(parseCommunityDecisionDraft(draft, ids.questionId, now), draft);
  assert.equal(parseCommunityDecisionDraft(draft, ids.commandId, now), null);
  assert.equal(parseCommunityDecisionDraft({
    ...draft,
    updatedAt: now - 24 * 60 * 60 * 1000 - 1,
  }, ids.questionId, now), null);
  assert.equal(parseCommunityDecisionDraft({
    ...draft,
    content: "x".repeat(5001),
  }, ids.questionId, now), null);
});

test("withdraw receipts distinguish a private waitlist from a published source", () => {
  const waitlist = parseCommunityDecisionWithdrawReceipt({
    status: "withdrawn",
    questionId: ids.questionId,
    threadId: null,
    state: null,
    version: null,
    sourceUnavailableAt: null,
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  });
  assert.equal(waitlist?.threadId, null);

  const published = parseCommunityDecisionWithdrawReceipt({
    status: "withdrawn",
    questionId: ids.questionId,
    threadId: ids.threadId,
    state: "answered",
    version: 4,
    sourceUnavailableAt: "2026-08-04T12:00:00.000Z",
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: true,
  });
  assert.equal(published?.threadId, ids.threadId);
  assert.equal(parseCommunityDecisionWithdrawReceipt({
    status: "withdrawn",
    questionId: ids.questionId,
    threadId: null,
    state: "open",
    version: null,
    sourceUnavailableAt: null,
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  }), null);
});

test("mutation receipts are operation-specific and stale is never success", () => {
  const applicability = parseCommunityDecisionMutationReceipt({
    status: "applicability_recorded",
    threadId: ids.threadId,
    state: "answered",
    version: 3,
    selectionId: ids.questionId,
    answerId: ids.postId,
    applicability: "conditions_differ",
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  }, "applicability");
  assert.equal(applicability?.operation, "applicability");
  assert.equal(parseCommunityDecisionMutationReceipt(applicability, "resolve"), null);

  const stale = parseCommunityDecisionStaleReceipt({
    status: "stale",
    threadId: ids.threadId,
    state: "answered",
    currentVersion: 4,
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  });
  assert.equal(stale?.currentVersion, 4);
});

test("resolve receipts prove the exact answer and selection evidence", () => {
  const selectionId = "00000000-0000-4000-8000-000000000005";
  const resolved = parseCommunityDecisionMutationReceipt({
    status: "resolved",
    threadId: ids.threadId,
    state: "resolved",
    version: 4,
    nextAction: "업체에 계약 문구를 서면으로 다시 확인한다",
    answerIds: [ids.postId],
    selectionIds: [selectionId],
    commandId: ids.commandId,
    operationKey: ids.operationKey,
    replayed: false,
  }, "resolve");
  assert.deepEqual(resolved?.answerIds, [ids.postId]);
  assert.deepEqual(resolved?.selectionIds, [selectionId]);
  assert.equal(parseCommunityDecisionMutationReceipt({
    ...resolved,
    answerIds: [ids.postId],
    selectionIds: [],
  }, "resolve"), null);
  assert.equal(parseCommunityDecisionMutationReceipt({
    ...resolved,
    answerIds: [ids.postId, ids.postId],
    selectionIds: [selectionId, ids.questionId],
  }, "resolve"), null);
});

test("private waitlist reads are owner-only shapes and never look published", () => {
  const detail = parseCommunityDecisionDetail({
    status: "private_waitlist",
    intake: {
      questionId: ids.questionId,
      title: "계약 뒤 원본 추가금 확인 경험이 궁금해요",
      content: "계약서에 없는 원본 비용을 계약 뒤에 안내받았습니다.",
      topicCategory: "contract_extra_cost",
      experienceScope: "extra_charge",
      coarseRegion: "서울 동부",
      preparationStage: "contracted",
      contractPhase: "after_contract",
      desiredAnswer: "확인한 계약 문구와 실제 결과",
      commercialRelationship: "none",
      sponsorshipDetail: null,
      createdAt: "2026-08-04T12:00:00.000Z",
    },
    thread: null,
    post: null,
    answers: [],
    viewer: {
      isAuthor: true,
      canAnswer: false,
      canResolve: false,
      canRecordOutcome: false,
      canWithdraw: true,
      selection: [],
      outcomes: [],
    },
  });
  assert.equal(detail?.status, "private_waitlist");
  assert.equal(detail?.thread, null);
  assert.equal(parseCommunityDecisionDetail({
    ...detail,
    viewer: { ...detail?.viewer, isAuthor: false },
  }), null);
});

test("published projections reject a hidden or missing commercial disclosure", () => {
  assert.ok(parseCommunityDecisionDetail(publishedDetail()));
  assert.equal(parseCommunityDecisionDetail({
    ...publishedDetail(),
    post: {
      ...publishedDetail().post,
      commercialRelationship: "none",
      sponsorshipDetail: "실제로는 할인 제공",
    },
  }), null);
  assert.equal(parseCommunityDecisionDetail({
    ...publishedDetail(),
    post: {
      ...publishedDetail().post,
      commercialRelationship: "paid",
      sponsorshipDetail: null,
    },
  }), null);
});

test("published projections reject impossible source and viewer action states", () => {
  assert.equal(parseCommunityDecisionDetail({
    ...publishedDetail(),
    thread: {
      ...publishedDetail().thread,
      sourceUnavailableAt: null,
      newApplicationsAllowed: false,
    },
  }), null);
  assert.equal(parseCommunityDecisionDetail({
    ...publishedDetail(),
    thread: {
      ...publishedDetail().thread,
      qualifiedPeerAnswerCount: 1,
    },
  }), null);
  assert.equal(parseCommunityDecisionDetail({
    ...publishedDetail(),
    viewer: {
      ...publishedDetail().viewer,
      canResolve: true,
    },
  }), null);
  assert.equal(parseCommunityDecisionDetail({
    ...publishedDetail(),
    viewer: {
      ...publishedDetail().viewer,
      selection: [{
        id: ids.questionId,
        answerId: ids.postId,
        commentId: ids.commandId,
        applicability: "applies",
        selectedAt: "2026-08-04T12:00:00.000Z",
        includedInResolutionAt: null,
      }],
    },
  }), null);
});

test("author selections preserve final-resolution membership as a nullable timestamp", () => {
  const value = publishedDetail();
  value.thread.qualifiedPeerAnswerCount = 1;
  value.answers = [{
    id: ids.postId,
    commentId: ids.commandId,
    content: "계약 문구를 캡처해 업체에 서면 확인했고 추가 청구가 취소됐어요.",
    responseKind: "experience",
    contentOrigin: "member",
    directExperience: true,
    experiencePeriod: "within_3_months",
    experienceStage: "contracted",
    coarseRegion: "서울 동부",
    actionTaken: "계약 문구를 첨부해 서면으로 확인했어요.",
    resultSummary: "추가 청구가 취소됐어요.",
    nextCheck: null,
    factOpinionBoundary: "취소 답변은 확인한 사실이고 대응 평가는 개인 의견이에요.",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    rubricVersion: 1,
    author: { nickname: "경험한커플", badge: "member" },
    createdAt: "2026-08-04T12:00:00.000Z",
  }];
  value.viewer = {
    ...value.viewer,
    isAuthor: true,
    canResolve: true,
    canWithdraw: true,
    selection: [{
      id: ids.questionId,
      answerId: ids.postId,
      commentId: ids.commandId,
      applicability: "taken_as_next_action",
      selectedAt: "2026-08-04T12:00:00.000Z",
      includedInResolutionAt: null,
    }],
  };
  const parsed = parseCommunityDecisionDetail(value);
  assert.equal(parsed?.viewer.selection[0]?.includedInResolutionAt, null);
  assert.equal(parseCommunityDecisionDetail({
    ...value,
    viewer: {
      ...value.viewer,
      selection: [{
        ...value.viewer.selection[0],
        includedInResolutionAt: "not-a-date",
      }],
    },
  }), null);
});
