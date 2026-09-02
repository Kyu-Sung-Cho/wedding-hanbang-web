import { describe, expect, it, vi } from "vitest";

import { sendAccountDeletionNotice } from "../deletionNotice";

/**
 * **통지가 실패해도 삭제는 끝난 채로 남는다.**
 *
 * 이 함수는 워커의 `try` 블록 안에서 `finalize` 직후에 불린다. 여기서 던지면
 * **이미 완료된 삭제가 `retry` 로 바뀌어** 지워진 사용자를 두고 사가 전체가 다시
 * 돈다. 배선하면서 실제로 그렇게 만들었고 워커 테스트가 잡았다(2026-09-02).
 *
 * 통지 실패의 대가는 "연락을 못 받는다" 여야지 **"삭제가 안 끝난다"** 가 되면
 * 안 된다. 그래서 이 함수는 어떤 경로로도 던지지 않는다.
 *
 * 법 근거: 개인정보 보호법 제36조 제2항(조치 후 결과 통지) · 시행령 제43조
 * 제3항(요구를 받은 날부터 10일 이내).
 */

function adminWith(overrides: {
  selectThrows?: boolean;
  selectError?: boolean;
  row?: { notice_email: string | null; notice_sent_at: string | null } | null;
  rpcThrows?: boolean;
  rpcResult?: string;
}) {
  const rpc = vi.fn(async () => {
    if (overrides.rpcThrows) throw new Error("network");
    return { data: overrides.rpcResult ?? "retry", error: null };
  });
  const maybeSingle = vi.fn(async () => {
    if (overrides.selectThrows) throw new Error("network");
    if (overrides.selectError) return { data: null, error: { message: "boom" } };
    return { data: overrides.row ?? null, error: null };
  });
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  }));
  return { from, rpc } as never;
}

describe("삭제 결과 통지", () => {
  it("조회가 던져도 던지지 않는다", async () => {
    await expect(
      sendAccountDeletionNotice(adminWith({ selectThrows: true }), "job-1"),
    ).resolves.toBe("skipped");
  });

  it("조회가 오류를 주어도 던지지 않는다", async () => {
    await expect(
      sendAccountDeletionNotice(adminWith({ selectError: true }), "job-1"),
    ).resolves.toBe("skipped");
  });

  it("기록 RPC 가 던져도 던지지 않는다", async () => {
    const admin = adminWith({
      row: { notice_email: "x@example.com", notice_sent_at: null },
      rpcThrows: true,
    });
    await expect(sendAccountDeletionNotice(admin, "job-1")).resolves.toBe("retry");
  });

  it("이미 보냈으면 다시 보내지 않는다", async () => {
    // **반환값만 보면 부족하다.** 주소가 남아 있는 채로 `notice_sent_at` 만
    // 찍힌 상태에서 그 관문을 없애면 재발송이 일어나는데, 반환값은 여전히
    // 그럴듯하다. 그래서 **기록 RPC 를 부르지 않았는지**로 확인한다 —
    // 발송을 시도했다면 반드시 기록이 따라온다.
    const admin = adminWith({
      row: { notice_email: "x@example.com", notice_sent_at: "2026-09-02T00:00:00Z" },
    });
    await expect(sendAccountDeletionNotice(admin, "job-1")).resolves.toBe("skipped");
    const rpc = (admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc, "이미 보낸 건인데 다시 발송을 시도했다").not.toHaveBeenCalled();
  });

  it("주소가 없으면 조용히 건너뛴다 — 못 박기 전이거나 이미 버린 뒤다", async () => {
    const admin = adminWith({ row: { notice_email: null, notice_sent_at: null } });
    await expect(sendAccountDeletionNotice(admin, "job-1")).resolves.toBe("skipped");
  });

  it("전송 수단이 없으면 실패로 기록한다 — 조용히 성공으로 세지 않는다", async () => {
    // 키가 없는데 'sent' 로 기록하면 법이 요구하는 통지가 한 번도 안 나갔는데
    // 보냈다고 남는다. 그건 되돌릴 수 없는 거짓 기록이다.
    const original = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const admin = adminWith({
        row: { notice_email: "x@example.com", notice_sent_at: null },
        rpcResult: "retry",
      });
      await sendAccountDeletionNotice(admin, "job-1");
      const rpc = (admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
      expect(rpc).toHaveBeenCalledWith(
        "record_account_deletion_notice",
        expect.objectContaining({ p_sent: false }),
      );
    } finally {
      if (original === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original;
    }
  });
});
