import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VerificationResultPage, { metadata } from "../page";

async function render(status?: string) {
  const element = await VerificationResultPage({
    searchParams: Promise.resolve(status === undefined ? {} : { status }),
  });
  return renderToStaticMarkup(element);
}

describe("research email verification result page", () => {
  it("renders a mutation-free client handoff when no result status is present", async () => {
    const html = await render();

    expect(html).toContain("확인 링크를 안전하게 준비하고 있어요");
    expect(html).not.toContain('method="post"');
    expect(html).not.toContain('action="/api/preregister/verify"');
    expect(html).not.toContain("token=");
  });

  it("confirms email ownership without implying cohort selection", async () => {
    const html = await render("verified");

    expect(html).toContain("이메일 주소를 확인했어요");
    expect(html).toContain("선정을 의미하지 않습니다");
    expect(html).toContain("별도 이메일로 안내");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("explains a two-hour expiry and a human recovery path", async () => {
    const html = await render("expired");

    expect(html).toContain("확인 링크가 만료됐어요");
    expect(html).toContain("2시간");
    expect(html).toContain("support@hanbang.ai");
  });

  it("uses a safe generic failure for invalid or unknown statuses", async () => {
    const invalid = await render("invalid");
    const unknown = await render("attacker-controlled-status");

    expect(invalid).toContain("확인할 수 없는 링크예요");
    expect(unknown).toContain("확인할 수 없는 링크예요");
    expect(unknown).not.toContain("attacker-controlled-status");
  });

  it("keeps a transient storage failure distinct from an invalid link", async () => {
    const html = await render("unavailable");

    expect(html).toContain("지금은 확인을 완료하지 못했어요");
    expect(html).toContain("이메일 확인 상태를 지금 확정하지 못했습니다");
  });
});
