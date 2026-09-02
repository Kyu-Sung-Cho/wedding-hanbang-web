import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * **국외 이전 고지에 "이전받는 자의 연락처" 가 있어야 한다.**
 *
 * 개인정보 보호법 제28조의8 제2항 제3호가 명시적으로 요구하는 항목이다. 이
 * 서비스는 국외이전 **별도 동의를 받지 않으므로**, 같은 조 제1항 제3호 가목에
 * 따라 제2항 각 호를 처리방침에 공개하는 것이 이전의 적법 근거 자체다. 즉 이
 * 열이 빠지면 근거가 빠진다.
 *
 * 2026-09-02 실측 — 표에 이전받는 자·국가·항목은 있었는데 연락처만 "요청하시면
 * 안내해 드립니다" 로 미뤄져 있었다. 이용자가 자기 정보를 넘겨받은 미국·인도
 * 사업자에게 직접 권리를 행사할 창구를 방침에서 알 수 없었다.
 *
 * 값은 각 사가 공개한 개인정보 처리방침 원문에서 확인했다(같은 날). 여기서
 * 고정하는 것은 **주소 문자열이 아니라 "모든 수탁사에 연락처가 있다" 는 성질**이다
 * — 업체가 바뀌면 그 행에 맞는 값을 넣어야 하고, 빠뜨리면 여기가 빨개진다.
 */
const SOURCE = readFileSync(
  join(process.cwd(), "src", "app", "privacy", "page.tsx"),
  "utf8",
);

/** 표에 실린 수탁사. 행이 늘면 여기도 늘려야 한다 — 그게 이 검사의 요점이다. */
const TRANSFEREES = [
  "Supabase, Inc.",
  "Vercel Inc.",
  "Cloudflare, Inc.",
  "OpenAI",
  "Resend, Inc.",
  "PostHog, Inc.",
  "Functional Software, Inc. (Sentry)",
];

describe("국외 이전 고지", () => {
  it("표에 '이전받는 자의 연락처' 열이 있다", () => {
    expect(SOURCE).toContain("이전받는 자의 연락처");
  });

  it("수탁사마다 연락처가 하나씩 있다", () => {
    const mailtos = [...SOURCE.matchAll(/mailto:([^"'`]+)/g)].map((m) => m[1]);
    // 고객센터 주소는 템플릿 리터럴(`mailto:${CONTACT.email}`)이라 여기 안 잡힌다.
    const transfereeContacts = mailtos.filter((v) => !v.includes("${"));
    expect(
      transfereeContacts.length,
      `수탁사 ${TRANSFEREES.length}곳인데 연락처가 ${transfereeContacts.length}개다`,
    ).toBeGreaterThanOrEqual(TRANSFEREES.length);
  });

  it.each(TRANSFEREES)("표에 %s 행이 남아 있다", (name) => {
    expect(SOURCE).toContain(name);
  });

  it("연락처를 '요청하시면 안내' 로 되돌리지 않는다", () => {
    // 이것이 원래 상태였고, 법이 요구하는 것은 공개다.
    expect(SOURCE).not.toContain("연락처는 고객센터(");
  });
});
