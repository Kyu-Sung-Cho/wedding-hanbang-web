// @vitest-environment node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 결제를 여는 날 사업자 정보를 잊지 않게 한다.
 *
 * 2026-08-23 파운더 결정: **사업자등록 없이 먼저 출시하고 나중에 등록한다.**
 * 지금은 그 결정이 안전하다 — 세 가지가 모두 참이기 때문이다.
 *
 * 1. 약관이 "현재 웨딩한방은 업체 계약 신청, 예약 또는 결제를 중개하지 않습니다" 라고
 *    적었고(`app/terms/page.tsx`), 그 말이 실제와 같다.
 * 2. 결제 연동이 저장소에 없다.
 * 3. 사업자 정보는 상호와 등록번호가 **둘 다** 있을 때만 화면에 나온다
 *    (`lib/legal/businessInfo.ts` 의 `readBusinessInfo`). 없으면 섹션 자체가 안 그려져서
 *    "등록했다" 고 거짓말하지 않는다.
 *
 * **결제나 예약 중개를 여는 순간 1번이 거짓이 되고, 전자상거래법 표시 의무가 붙는다.**
 * 그때 이 검사가 실패해서 알려준다. 사람의 기억에 맡기지 않는다.
 *
 * 이 검사를 통과시키려고 결제 코드를 숨기지 마라 — 약관 문구를 먼저 고치고
 * 사업자 정보를 넣는 것이 순서다.
 *
 * ## `lib/payments/paymentLedger` 는 결제 연동이 아니다
 *
 * 이름 때문에 헷갈리기 쉬워서 적어 둔다. 그것은 **커플이 서비스 밖에서 업체에 낸 돈을
 * 적어 두는 기록장**이다. 담는 것은 품목·업체명·금액·잔금일·상태뿐이고
 * (`PaymentLedgerValues`), 카드번호·계좌번호는 한 칸도 없다 — 약관의
 * "운영자는 업체 결제 정보나 카드 정보를 받거나 저장하지 않습니다" 가 그래서 참이다.
 *
 * 그래서 아래 판별식은 이름이 아니라 **결제 대행사 연동**을 찾는다.
 */
describe("사업자 등록 전에는 결제를 열지 않는다", () => {
  const webSrc = resolve(process.cwd(), "src");
  const termsPath = join(webSrc, "app", "terms", "page.tsx");

  /** 약관이 "결제를 중개하지 않는다" 고 말하고 있는가. */
  const terms = readFileSync(termsPath, "utf8");
  const termsClaimNoPayment = terms.includes("예약 또는 결제를 중개하지 않습니다");

  /** 결제 연동의 표시. 문구가 아니라 **연동**을 찾는다. */
  const PAYMENT_INTEGRATION = [
    // 국내외 결제 대행사 SDK
    /from\s+["'](?:@tosspayments|@portone|iamport|@stripe|stripe)[^"']*["']/,
    /require\(["'](?:@tosspayments|@portone|iamport|@stripe|stripe)[^"']*["']\)/,
    // 결제 창을 여는 전역 객체
    /\b(?:IMP|TossPayments|PortOne)\s*\./,
  ];

  const SKIP_DIRS = new Set(["__tests__", "node_modules", ".next"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("검사가 실제로 파일을 읽는다", () => {
    // 경로가 틀리면 아래 검사가 빈 목록을 보며 늘 통과한다.
    expect(existsSync(termsPath), "약관 파일을 못 찾았다").toBe(true);
    expect(walk(webSrc).length).toBeGreaterThan(100);
  });

  it("약관이 아직 '결제를 중개하지 않는다' 고 말한다", () => {
    // 이 검사가 실패했다면 결제를 여는 중이라는 뜻이다. 그렇다면 아래 검사도 함께
    // 다시 정하고, **사업자 정보를 먼저 넣어라.**
    expect(
      termsClaimNoPayment,
      "약관이 결제 중개를 열었다면 사업자 정보(전자상거래법 표시 의무)가 먼저다 — "
        + "`NEXT_PUBLIC_BUSINESS_NAME`·`_REGISTRATION_NUMBER` 를 채우고 이 검사를 다시 정하라",
    ).toBe(true);
  });

  it("약관이 그렇게 말하는 동안에는 결제 연동이 없다", () => {
    if (!termsClaimNoPayment) return;

    const wired = walk(webSrc)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return PAYMENT_INTEGRATION.some((pattern) => pattern.test(source));
      })
      .map((file) => relative(process.cwd(), file).split(sep).join("/"));

    expect(
      wired,
      "결제 연동이 들어왔는데 약관은 아직 '중개하지 않습니다' 라고 말한다. "
        + "약관 문구와 사업자 정보를 먼저 맞춰라 — 사업자등록 없이 결제를 여는 것은 "
        + "출시 결정(2026-08-23)의 전제를 깨뜨린다",
    ).toEqual([]);
  });

  it("사업자 정보는 반쪽으로 나오지 않는다", () => {
    // 상호만 있고 등록번호가 없으면 오히려 오해를 만든다. 그 판단이 코드에 있는지 본다.
    const source = readFileSync(join(webSrc, "lib", "legal", "businessInfo.ts"), "utf8");
    expect(source).toContain("if (!companyName || !registrationNumber) return null;");
  });
});
