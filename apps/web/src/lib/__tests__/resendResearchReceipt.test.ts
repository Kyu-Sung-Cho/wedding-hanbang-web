import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import {
  buildResearchCohortReceiptEmail,
  sendResearchCohortReceiptEmail,
} from "@/lib/resend";

const VERIFICATION_URL =
  "https://hanbang.ai/beta/verify#token=signed-application-token";
const APPLICATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const COHORT_CODE = "research-2026-h2";
const STRONG_SECRET = "R7vY0M5sK8qN2bF9xW4cL6jH1pT3dG5zA9uE";

describe("research cohort receipt email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", STRONG_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hanbang.ai");
    mocks.send.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("matches the selected research purpose without promising launch access or discounts", () => {
    const message = buildResearchCohortReceiptEmail("couple@example.com", VERIFICATION_URL);

    expect(message.subject).toContain("이메일을 확인");
    expect(message.html).toContain("6주 사용자 연구");
    expect(message.html).toContain("이메일 주소 확인하기");
    expect(message.html).toContain(VERIFICATION_URL);
    expect(message.html).toContain("페이지에서 확인 버튼을 한 번 더");
    expect(message.html).toContain("선정 또는 정식 베타 초대를 의미하지 않습니다");
    expect(message.html).toContain("2시간");
    expect(message.html).toContain("본인이 신청하지 않았다면");
    expect(message.html).toContain("삭제를 요청");
    expect(message.html).toContain("180일");
    expect(message.html).not.toContain("특별 할인");
    expect(message.html).not.toContain("우선 초대");
  });

  it("escapes the displayed address in HTML", () => {
    const message = buildResearchCohortReceiptEmail(
      'couple+"<tag>"@example.com',
      VERIFICATION_URL
    );
    expect(message.html).toContain("&quot;&lt;tag&gt;&quot;");
    expect(message.html).not.toContain('"<tag>"');
  });

  it("sends a newly signed, single-purpose verification link", async () => {
    await expect(sendResearchCohortReceiptEmail(
      "couple@example.com",
      APPLICATION_ID,
      COHORT_CODE
    )).resolves.toBe(true);

    const message = mocks.send.mock.calls[0]?.[0] as { html: string; text: string };
    expect(message.html).toContain("https://hanbang.ai/beta/verify#token=");
    expect(message.text).toContain("https://hanbang.ai/beta/verify#token=");
    expect(message.html).not.toContain("/api/preregister/verify?token=");
    expect(message.html).not.toContain(`${APPLICATION_ID}.${COHORT_CODE}`);
  });

  it("does not send an unverifiable link when its dedicated secret is unavailable", async () => {
    vi.stubEnv("RESEARCH_EMAIL_VERIFICATION_SECRET", "");

    await expect(sendResearchCohortReceiptEmail(
      "couple@example.com",
      APPLICATION_ID,
      COHORT_CODE
    )).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
