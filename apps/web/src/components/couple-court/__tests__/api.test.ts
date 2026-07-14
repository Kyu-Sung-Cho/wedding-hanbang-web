import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveCase, cancelInvite, createInvite, createPublicComment, createPublicPreview, deleteCase, getVerdict, getVerdictStatus, listPublicCases, normalizeCase, normalizePublicCase, normalizeVerdict, setPublicConsent, submitStatement } from "../api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("couple court client contract", () => {
  it("projects nested case workflow without requiring hidden partner statement text", () => {
    const result = normalizeCase({
      case: {
        id: "case-1",
        title: "역할 분담 사건",
        mode: "couple",
        category: "planning_roles",
        tone: "practical",
        workflow_status: "awaiting_partner_statement",
        safety_level: "normal",
        applicant_statement_submitted: true,
        partner_statement_submitted: false,
      },
      participant: { role: "partner" },
      participants: [
        { id: "a", role: "applicant", status: "active" },
        { id: "p", role: "partner", status: "active" },
      ],
      statements: [],
    });

    expect(result.viewerRole).toBe("partner");
    expect(result.applicantStatementSubmitted).toBe(true);
    expect(result.partnerJoined).toBe(true);
    expect(result.partnerStatementSubmitted).toBe(false);
    expect(result.canJudge).toBe(false);
  });

  it("projects only the viewer statement and preserves the exact existing public snapshot", () => {
    const result = normalizeCase({
      case: {
        id: "case-1",
        title: "역할 분담 사건",
        mode: "couple",
        category: "planning_roles",
        tone: "practical",
        workflow_status: "verdict_ready",
      },
      participant: { id: "partner-participant", role: "partner" },
      participants: [
        { id: "applicant-participant", role: "applicant" },
        { id: "partner-participant", role: "partner" },
      ],
      statements: [
        { participant_id: "applicant-participant", facts: "노출되면 안 되는 신청인 원문" },
        {
          participant_id: "partner-participant",
          facts: "내가 기억하는 사실입니다.",
          feelings: "내 감정입니다.",
          expectations: "내 기대입니다.",
          attempts: "내가 시도한 일입니다.",
          desired_agreement: "내가 원하는 합의입니다.",
        },
      ],
      publicPost: {
        id: "post-1",
        status: "awaiting_consents",
        viewer_consented: true,
        snapshot_hash: "same-hash-for-both-participants",
        snapshot_version: 3,
        sanitized_snapshot_json: {
          safeTitle: "익명 역할 분담 사건",
          oneLine: "역할과 기한을 함께 정하기로 했어요.",
          resultLabel: "공동 규칙 권고",
          hashtags: ["역할분담"],
          provisional: false,
        },
      },
    });

    expect(result.ownStatement?.facts).toBe("내가 기억하는 사실입니다.");
    expect(result.ownStatement?.facts).not.toContain("신청인 원문");
    expect(result.publicPreview).toEqual({
      publicPostId: "post-1",
      snapshotHash: "same-hash-for-both-participants",
      snapshotVersion: 3,
      snapshot: {
        safeTitle: "익명 역할 분담 사건",
        oneLine: "역할과 기한을 함께 정하기로 했어요.",
        resultLabel: "공동 규칙 권고",
        hashtags: ["역할분담"],
        provisional: false,
      },
    });
    expect(result.publicViewerConsented).toBe(true);
  });

  it("never enables judgment for a high-risk projected case", () => {
    const result = normalizeCase({
      id: "case-2",
      title: "안전 확인 사건",
      mode: "solo",
      category: "communication",
      tone: "spicy",
      workflow_status: "statements_complete",
      safety_level: "high_risk",
      can_judge: true,
    });

    expect(result.safetyLevel).toBe("high_risk");
    expect(result.canJudge).toBe(false);
  });

  it("maps the structured verdict contract and keeps shared responsibility", () => {
    const result = normalizeVerdict({
      status: "ready",
      verdict: {
        id: "verdict-1",
        safety: { level: "normal" },
        caseMeta: { provisional: false },
        caseSummary: "준비 속도와 확인 방식이 달랐어요.",
        sharedFacts: ["토요일까지 후보를 정하기로 했어요."],
        differentViews: [{ applicant: "답을 기다렸어요.", respondent: "확인 중이었어요." }],
        applicantNeeds: "답변 기한",
        partnerNeeds: "검토 시간",
        coreConflict: "응답 기한을 합의하지 않았어요.",
        responsibility: { applicant: 25, respondent: 35, shared: 40, explanation: "공동 규칙이 필요해요." },
        verdict: { headline: "기한과 확인 방식을 함께 정하세요.", judgeOneLiner: "읽씹보다 먼저 정할 것은 답변 시각입니다." },
        conversationScript: { opening: "오늘 답변 시간을 정해볼까?", applicantLine: "나는 기한이 필요해.", respondentLine: "나는 검토 시간이 필요해." },
        missions: [{ id: "mission-1", title: "답변 규칙 정하기", description: "오늘 안에 답변 시각을 정해요.", target_role: "both" }],
        confidence: "medium",
        limitations: ["두 사람의 진술을 바탕으로 정리했어요."],
      },
    });

    expect(result.verdictOneLine).toBe("기한과 확인 방식을 함께 정하세요.");
    expect(result.facts).toHaveLength(2);
    expect(result.responsibility).toEqual({ applicant: 25, respondent: 35, shared: 40, explanation: "공동 규칙이 필요해요." });
    expect(result.missions[0]?.id).toBe("mission-1");
    expect(result.confidence).toBe("medium");
    expect(result.repairScripts).toHaveLength(3);
  });

  it("reads only the sanitized public snapshot fields", () => {
    const result = normalizePublicCase({
      id: "post-1",
      category: "budget",
      vote_count: 7,
      vote_counts: {
        applicant_more_at_fault: 1,
        partner_more_at_fault: 2,
        both_need_change: 3,
        need_more_info: 1,
      },
      comment_count: 2,
      sanitized_snapshot_json: {
        mode: "solo",
        safeTitle: "추가금 합의 사건",
        oneLine: "결제 전 확인 규칙이 필요했어요.",
        resultLabel: "공동 규칙 권고",
        hashtags: ["예산"],
      },
    });

    expect(result.title).toBe("추가금 합의 사건");
    expect(result.summary).toBe("결제 전 확인 규칙이 필요했어요.");
    expect(result.votes?.total).toBe(7);
    expect(result.votes?.counts?.both_need_change).toBe(3);
    expect(result.facts).toEqual([]);
    expect(result.missions).toEqual([]);
  });

  it("sends public filters and pagination to the server and preserves its page contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      posts: [{
        id: "post-1",
        category: "budget",
        mode: "couple",
        vote_count: 9,
        sanitized_snapshot_json: {
          safeTitle: "익명 예산 사건",
          oneLine: "추가금 확인 규칙을 정했어요.",
          resultLabel: "공동 규칙 권고",
        },
      }],
      total: 13,
      page: 2,
      limit: 6,
      total_pages: 3,
      has_more: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPublicCases({
      category: "budget",
      mode: "couple",
      sort: "popular",
      page: 2,
      limit: 6,
    })).resolves.toMatchObject({
      total: 13,
      page: 2,
      limit: 6,
      totalPages: 3,
      hasMore: true,
      posts: [{ id: "post-1", votes: { total: 9 } }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/couple-court/public?category=budget&mode=couple&sort=popular&page=2&limit=6",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("accepts the public-preview RPC top-level public_post_id contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      public_post_id: "post-rpc-1",
      snapshot_hash: "snapshot-hash-1",
      snapshot_version: 1,
      snapshot: {
        safeTitle: "익명 예산 사건",
        oneLine: "결제 전 확인 규칙이 필요했어요.",
        resultLabel: "공동 규칙 권고",
        hashtags: ["예산"],
        provisional: false,
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } })));

    await expect(createPublicPreview("case-1")).resolves.toMatchObject({
      publicPostId: "post-rpc-1",
      snapshotHash: "snapshot-hash-1",
      snapshotVersion: 1,
    });
  });

  it("returns the consent workflow status so the UI waits for moderation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      consent: { status: "pending_review" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(setPublicConsent("case-1", {
      publicPostId: "post-1",
      snapshotHash: "a".repeat(64),
      snapshotVersion: 1,
      snapshot: {
        safeTitle: "익명 사건",
        oneLine: "익명 요약",
        resultLabel: "공동 규칙 권고",
        hashtags: [],
        provisional: false,
      },
    }, true)).resolves.toBe("pending_review");
  });

  it("turns the server's same-origin relative invite into a shareable absolute URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      invite_url: "/wedding/couple-court/invite#token=secret-fragment-token",
      expires_at: "2026-07-14T00:00:00.000Z",
    }), { status: 201, headers: { "Content-Type": "application/json" } })));

    const result = await createInvite("case-1");
    const parsed = new URL(result.inviteUrl);
    expect(parsed.origin).toBe(window.location.origin);
    expect(parsed.pathname).toBe("/wedding/couple-court/invite");
    expect(parsed.hash).toBe("#token=secret-fragment-token");
  });

  it("archives a case with a JSON same-origin mutation request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await archiveCase("case-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/couple-court/cases/case-1", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ action: "archive" }),
      credentials: "same-origin",
    }));
  });

  it("requires an explicit client confirmation for permanent deletion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteCase("case-1", "영구삭제");

    expect(fetchMock).toHaveBeenCalledWith("/api/couple-court/cases/case-1", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ action: "delete", confirmation: "영구삭제" }),
    }));
  });

  it("cancels an issued invite through a same-origin mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ invite: { revoked: true, status: "revoked" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelInvite("case-1")).resolves.toEqual({
      revoked: true,
      status: "revoked",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/couple-court/cases/case-1/invite", expect.objectContaining({
      method: "DELETE",
      body: "{}",
    }));
  });

  it("returns pending comment moderation instead of pretending it is already visible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      comment: {
        comment_id: "00000000-0000-4000-8000-000000000001",
        moderation_status: "pending",
        reused: false,
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createPublicComment(
      "post-1",
      "empathy",
      "따뜻한 공감입니다.",
      "00000000-0000-4000-8000-000000000002",
    )).resolves.toEqual({
      commentId: "00000000-0000-4000-8000-000000000001",
      moderationStatus: "pending",
      reused: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/couple-court/public/post-1/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          commentType: "empathy",
          body: "따뜻한 공감입니다.",
          submissionRequestId: "00000000-0000-4000-8000-000000000002",
        }),
      }),
    );
  });

  it("surfaces an acknowledged replay without changing the comment identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      comment: {
        comment_id: "00000000-0000-4000-8000-000000000001",
        moderation_status: "pending",
        reused: true,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(createPublicComment(
      "post-1",
      "question",
      "같은 요청을 재시도합니다.",
      "00000000-0000-4000-8000-000000000002",
    )).resolves.toEqual({
      commentId: "00000000-0000-4000-8000-000000000001",
      moderationStatus: "pending",
      reused: true,
    });
  });

  it("rejects a malformed 2xx comment acknowledgement so the draft can be retried", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      comment: { moderation_status: "pending" },
    }), { status: 201, headers: { "Content-Type": "application/json" } })));

    await expect(createPublicComment(
      "post-1",
      "empathy",
      "응답 계약이 없으면 성공으로 처리하지 않습니다.",
      "00000000-0000-4000-8000-000000000002",
    )).rejects.toMatchObject({
      status: 502,
      code: "court_comment_result_invalid",
    });
  });

  it("normalizes uppercase server safety codes so the UI takes the safety branch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "COURT_SAFETY_REDIRECT",
      error: "판결보다 안전이 먼저예요.",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(getVerdict("case-1")).rejects.toMatchObject({
      status: 409,
      code: "court_safety_redirect",
    });
  });

  it("uses the status endpoint Retry-After header and forwards cancellation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "judging",
      retry_after_seconds: 2,
      recovery_allowed: false,
    }), {
      status: 202,
      headers: { "Content-Type": "application/json", "Retry-After": "13" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getVerdictStatus("case-1", controller.signal)).resolves.toEqual({
      status: "judging",
      retryAfterSeconds: 13,
      recoveryAllowed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/couple-court/cases/case-1/verdict/status",
      expect.objectContaining({ signal: controller.signal, cache: "no-store" }),
    );
  });

  it("fails closed when the status projection is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "almost_ready",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getVerdictStatus("case-1")).rejects.toMatchObject({
      status: 502,
      code: "verdict_status_invalid",
    });
  });

  it("preserves the server safety outcome from a successful statement submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      safety: {
        level: "high_risk",
        categories: ["violence", 123],
        requires_immediate_help: true,
        resource_message: "안전한 장소에서 도움을 요청해 주세요.",
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } })));

    await expect(submitStatement("case-1", {
      facts: "사실",
      feelings: "감정",
      expectations: "기대",
      attempts: "시도",
      desiredAgreement: "합의",
    })).resolves.toEqual({
      safety: {
        level: "high_risk",
        categories: ["violence"],
        requiresImmediateHelp: true,
        resourceMessage: "안전한 장소에서 도움을 요청해 주세요.",
      },
    });
  });
});
