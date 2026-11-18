import { EMPTY_INVITATION_CONDITIONS, type InquiryApproverSetting } from "@hanbang/shared/invitation";
import { describe, expect, it } from "vitest";
import type { ApprovalRow, LetterVersionRow } from "../inquiryRepository";
import {
  approvalProgress,
  budgetShareValues,
  draftLetterBody,
  formatMobile,
  letterSignature,
  letterState,
  maskMobile,
} from "../letter";
import { normalizeLetterBody, parseLetterInput, resolveShares } from "../letterInput";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FP = "a".repeat(64);
const MEMBERS = [{ id: A, name: "민지" }, { id: B, name: "준호" }];

const setting = (mode: InquiryApproverSetting["mode"], designatedUserId: string | null = null, revision = 1): InquiryApproverSetting =>
  ({ mode, designatedUserId, revision });
const approval = (approverUserId: string, settingsRevision = 1, fingerprint = FP, sendingEnabled = true): ApprovalRow =>
  ({ approverUserId, settingsRevision, fingerprint, sendingEnabled });

const version = (overrides: Partial<LetterVersionRow> = {}): LetterVersionRow => ({
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  letterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  version: 2,
  recipientHallIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  recipientNames: ["소담 하우스", "가온 웨딩홀"],
  body: "본문",
  signature: "민지와 준호 드림",
  shares: { name: { on: false, value: null }, phone: { on: false, value: null }, budget: { on: false, value: null } },
  fingerprint: FP,
  createdAt: "2026-11-15T01:00:00Z",
  approvalCompletedAt: null,
  queuedAt: null,
  ...overrides,
});

describe("letter draft", () => {
  it("writes the artifact's sentences from stored conditions only", () => {
    const full = { ...EMPTY_INVITATION_CONDITIONS, hopedYear: 2027, hopedMonth: 5, timeLabel: "토요일 낮", guestCount: 200 };
    expect(draftLetterBody(full, null)).toBe(
      "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다. 하객은 200명 정도예요. 상담 가능한 시간을 알려 주시면 두 사람이 맞춰 가겠습니다.",
    );
    expect(draftLetterBody(EMPTY_INVITATION_CONDITIONS, null)).toBe(
      "결혼식을 준비하고 있는 커플입니다. 상담 가능한 시간을 알려 주시면 두 사람이 맞춰 가겠습니다.",
    );
    expect(draftLetterBody(full, "2027-05-22")).toMatch(/^2027년 5월 22일 토요일 낮에/);
  });

  it("signs with names only when the name is shared", () => {
    expect(letterSignature(true, MEMBERS)).toBe("민지와 준호 드림");
    expect(letterSignature(false, MEMBERS)).toBe("결혼을 준비하는 두 사람 드림");
    expect(letterSignature(true, [{ id: A, name: "민지" }])).toBe("민지 드림");
    expect(letterSignature(true, [{ id: A, name: "가".repeat(40) }, { id: B, name: "나".repeat(40) }])).toBe("결혼을 준비하는 두 사람 드림");
  });

  it("formats and masks phone numbers and states an unset budget", () => {
    expect(formatMobile("01012345678")).toBe("010-1234-5678");
    expect(formatMobile("0101234567")).toBe("010-123-4567");
    expect(formatMobile("0212345678")).toBeNull();
    expect(maskMobile("010-1234-5678")).toBe("010-****-5678");
    expect(budgetShareValues(null)).toEqual({ stored: "아직 정하지 않았어요", display: "아직 정하지 않았다고 알려요" });
    expect(budgetShareValues(30_000_000)).toEqual({ stored: "3,000만 원", display: "3,000만 원이라고 알려요" });
  });
});

describe("approval policy mirrors the database", () => {
  it("unset: one current member completes it", () => {
    expect(approvalProgress({ setting: setting("unset", null, 0), memberIds: [A, B], approvals: [], fingerprint: FP, sendingEnabled: true }))
      .toEqual({ approvedBy: [], pausedBy: [], complete: false, unavailable: false, waitingFor: [A, B] });
    expect(approvalProgress({ setting: setting("unset", null, 0), memberIds: [A, B], approvals: [approval(B, 0)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: true, waitingFor: [] });
  });

  it("designated: only the chosen person completes it", () => {
    const chosen = setting("designated", B);
    expect(approvalProgress({ setting: chosen, memberIds: [A, B], approvals: [approval(A)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false, waitingFor: [B], approvedBy: [A] });
    expect(approvalProgress({ setting: chosen, memberIds: [A, B], approvals: [approval(B)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: true });
    expect(approvalProgress({ setting: chosen, memberIds: [A], approvals: [approval(A)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false, unavailable: true, waitingFor: [] });
  });

  it("both: needs both members on the same fingerprint and the current settings revision", () => {
    const both = setting("both", null, 3);
    expect(approvalProgress({ setting: both, memberIds: [A, B], approvals: [approval(A, 3)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false, waitingFor: [B] });
    expect(approvalProgress({ setting: both, memberIds: [A, B], approvals: [approval(A, 3), approval(B, 2)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false, waitingFor: [B] });
    expect(approvalProgress({ setting: both, memberIds: [A, B], approvals: [approval(A, 3), approval(B, 3, "b".repeat(64))], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false });
    expect(approvalProgress({ setting: both, memberIds: [A, B], approvals: [approval(A, 3), approval(B, 3)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: true, waitingFor: [] });
    expect(approvalProgress({ setting: both, memberIds: [A], approvals: [approval(A, 3)], fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false, unavailable: true });
  });

  it("counts approvals given while sending was off only while it stays off", () => {
    const paused = [approval(A, 0, FP, false)];
    expect(approvalProgress({ setting: setting("unset", null, 0), memberIds: [A, B], approvals: paused, fingerprint: FP, sendingEnabled: false }))
      .toMatchObject({ complete: true, approvedBy: [A], pausedBy: [] });
    expect(approvalProgress({ setting: setting("unset", null, 0), memberIds: [A, B], approvals: paused, fingerprint: FP, sendingEnabled: true }))
      .toMatchObject({ complete: false, approvedBy: [], pausedBy: [A], waitingFor: [A, B] });
    const both = setting("both", null, 2);
    expect(approvalProgress({
      setting: both, memberIds: [A, B], approvals: [approval(A, 2, FP, false), approval(B, 2, FP, true)], fingerprint: FP, sendingEnabled: true,
    })).toMatchObject({ complete: false, approvedBy: [B], pausedBy: [A], waitingFor: [A] });
  });

  it("derives the screen status, the not-queued reason and who may press approve", () => {
    const base = {
      letterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", members: MEMBERS, viewerId: A,
      recipients: [], sendingEnabled: true, dailyCap: 5, queuedToday: 0,
    };
    expect(letterState({ ...base, version: null, approvals: [], setting: setting("unset", null, 0) }))
      .toMatchObject({ status: "draft", versionId: null, viewerCanApprove: true, viewerIsApprover: true });
    expect(letterState({ ...base, version: version(), approvals: [approval(B)], setting: setting("both") }))
      .toMatchObject({ status: "awaiting_approval", waitingFor: [A], viewerCanApprove: true });
    expect(letterState({ ...base, version: version(), approvals: [approval(A, 0)], setting: setting("unset", null, 0), sendingEnabled: false }))
      .toMatchObject({ status: "approved_not_queued", notQueuedReason: "sending_disabled", viewerCanApprove: true });
    expect(letterState({ ...base, version: version(), approvals: [approval(A, 0)], setting: setting("unset", null, 0), queuedToday: 4 }))
      .toMatchObject({ status: "approved_not_queued", notQueuedReason: "daily_cap" });
    expect(letterState({ ...base, version: version({ queuedAt: "2026-11-15T02:00:00Z" }), approvals: [approval(A, 0)], setting: setting("unset", null, 0) }))
      .toMatchObject({ status: "queued", viewerCanApprove: false });
    expect(letterState({ ...base, version: version(), approvals: [], setting: setting("designated", B) }))
      .toMatchObject({ status: "draft", viewerIsApprover: false, waitingFor: [B], viewerCanApprove: false });
    expect(letterState({ ...base, version: null, approvals: [], setting: setting("designated", B) }))
      .toMatchObject({ status: "draft", viewerCanApprove: false });
    // 꺼진 동안의 승인은 켜진 뒤 다시 승인해야 하는 사람으로 보여 준다.
    expect(letterState({ ...base, version: version(), approvals: [approval(A, 0, FP, false)], setting: setting("unset", null, 0) }))
      .toMatchObject({ status: "draft", approvedBy: [], approvedWhilePaused: [A], viewerCanApprove: true, notQueuedReason: null });
    // 켜진 동안의 승인으로 끝났는데 커플 상한 안이면 서비스 전체 상한에 걸린 것이다.
    expect(letterState({ ...base, version: version(), approvals: [approval(A, 0)], setting: setting("unset", null, 0) }))
      .toMatchObject({ status: "approved_not_queued", notQueuedReason: "global_daily_cap", approvedWhilePaused: [] });
  });
});

describe("letter input", () => {
  it("normalises the body and refuses hidden characters", () => {
    expect(normalizeLetterBody("  안녕하세요\r\n\r\n\r\n상담 부탁드려요  ")).toBe("안녕하세요\n\n상담 부탁드려요");
    expect(normalizeLetterBody("숨은‮글자")).toBeNull();
    expect(normalizeLetterBody("가".repeat(1001))).toBeNull();
    expect(normalizeLetterBody("   ")).toBeNull();
  });

  it("refuses duplicates, unknown keys and missing shares", () => {
    const shares = { name: { on: false }, phone: { on: false }, budget: { on: false } };
    const hall = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(parseLetterInput({ recipientHallIds: [hall], body: "본문", shares }).ok).toBe(true);
    expect(parseLetterInput({ recipientHallIds: [hall, hall.toUpperCase()], body: "본문", shares }).ok).toBe(false);
    expect(parseLetterInput({ recipientHallIds: [hall], body: "본문", shares, to: "x" }).ok).toBe(false);
    expect(parseLetterInput({ recipientHallIds: [], body: "본문", shares }).ok).toBe(false);
    expect(parseLetterInput({ recipientHallIds: [hall], body: "본문", shares: { name: { on: false } } }).ok).toBe(false);
    expect(parseLetterInput({ recipientHallIds: [hall], body: "본문", shares: { ...shares, budget: { on: true, value: "1억" } } }).ok).toBe(false);
  });

  it("keeps no value for off shares, reuses the previous phone, and computes the budget on the server", () => {
    const previous = {
      name: { on: true, value: "김민지" }, phone: { on: true, value: "010-1234-5678" }, budget: { on: false, value: null },
    };
    expect(resolveShares({ name: { on: false, value: "김민지" }, phone: { on: true, value: null }, budget: { on: true } }, previous, 0))
      .toEqual({
        ok: true,
        shares: { name: { on: false, value: null }, phone: { on: true, value: "010-1234-5678" }, budget: { on: true, value: "아직 정하지 않았어요" } },
      });
    expect(resolveShares({ name: { on: false, value: null }, phone: { on: true, value: "010 9876 5432" }, budget: { on: false } }, null, null))
      .toMatchObject({ ok: true, shares: { phone: { on: true, value: "010-9876-5432" } } });
    expect(resolveShares({ name: { on: false, value: null }, phone: { on: true, value: null }, budget: { on: false } }, null, null).ok).toBe(false);
    expect(resolveShares({ name: { on: true, value: "" }, phone: { on: false, value: null }, budget: { on: false } }, null, null).ok).toBe(false);
    expect(resolveShares({ name: { on: false, value: null }, phone: { on: true, value: "02-123-4567" }, budget: { on: false } }, null, null).ok).toBe(false);
  });
});
