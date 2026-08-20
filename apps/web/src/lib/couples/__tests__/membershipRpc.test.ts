import { describe, expect, it } from "vitest";

import { parseMembershipRpcResponse } from "../membershipRpc";

const coupleId = "12345678-1234-4234-9234-123456789abc";

describe("parseMembershipRpcResponse", () => {
  it("accepts a fresh create result", () => {
    expect(
      parseMembershipRpcResponse(
        {
          success: true,
          created: true,
          idempotent: false,
          couple_id: coupleId,
          invite_code: "WH-ABC123",
          role: "bride",
        },
        "bride",
        "create",
      ),
    ).toEqual({
      ok: true,
      coupleId,
      inviteCode: "WH-ABC123",
      changed: true,
      idempotent: false,
      role: "bride",
    });
  });

  it("accepts an exact idempotent create retry", () => {
    const result = parseMembershipRpcResponse(
      {
        success: true,
        created: false,
        idempotent: true,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "groom",
      },
      "groom",
      "create",
    );

    expect(result).toMatchObject({ ok: true, changed: false, idempotent: true });
  });

  it("uses joined rather than created for join results", () => {
    const result = parseMembershipRpcResponse(
      {
        success: true,
        joined: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
      "bride",
      "join",
    );

    expect(result).toMatchObject({ ok: true, changed: true, idempotent: false });
  });

  it("maps stable error codes without exposing database text", () => {
    const result = parseMembershipRpcResponse(
      {
        success: false,
        error_code: "BRIDE_SLOT_OCCUPIED",
        error: "internal detail that must not be exposed",
      },
      "bride",
      "join",
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      message: "이미 신부 역할이 연결되어 있습니다.",
      errorCode: "BRIDE_SLOT_OCCUPIED",
    });
  });

  it("keeps compatibility with the allow-listed legacy errors", () => {
    const result = parseMembershipRpcResponse(
      { success: false, error: "Invalid invite code." },
      "groom",
      "join",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      errorCode: "INVALID_INVITE_CODE",
    });
  });

  it("maps invite-code exhaustion to a retryable service failure", () => {
    const result = parseMembershipRpcResponse(
      {
        success: false,
        created: false,
        idempotent: false,
        error_code: "INVITE_CODE_EXHAUSTED",
        error: "Invite code generation exhausted.",
      },
      "bride",
      "create",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      errorCode: "INVITE_CODE_EXHAUSTED",
    });
  });

  it("fails closed for unknown errors", () => {
    const result = parseMembershipRpcResponse(
      { success: false, error: "relation secret_table does not exist" },
      "bride",
      "create",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      errorCode: "UNKNOWN_RPC_ERROR",
    });
    if (!result.ok) {
      expect(result.message).not.toContain("secret_table");
    }
  });

  it("rejects a success payload for the wrong role", () => {
    const result = parseMembershipRpcResponse(
      {
        success: true,
        created: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "groom",
      },
      "bride",
      "create",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      errorCode: "INVALID_RPC_RESPONSE",
    });
  });

  it("rejects contradictory idempotency flags", () => {
    const result = parseMembershipRpcResponse(
      {
        success: true,
        joined: false,
        idempotent: false,
        couple_id: coupleId,
        invite_code: "WH-ABC123",
        role: "bride",
      },
      "bride",
      "join",
    );

    expect(result).toMatchObject({ ok: false, errorCode: "INVALID_RPC_RESPONSE" });
  });
});
