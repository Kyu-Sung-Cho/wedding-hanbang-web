import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import type { WeddingCodeEntrySearchParams } from "../entry";
import { WEDDING_CODE_BARE_TARGET } from "../releaseEntry";

vi.mock("../WeddingCodeReleaseClient", () => ({ default: () => null }));
vi.mock("@/lib/weddingCode/contribution/server", () => ({ isWeddingCodeResearchContributionOpen: () => false, isWeddingCodeResearchStorageActive: () => false }));

import WeddingCodePage, { generateMetadata } from "../page";

const WC64_DESCRIPTION = "웨딩을 얼마나 아는지와 결혼 준비 성향을 네 글자와 %로 정리해 봐요. 답은 이 브라우저에만 남아요.";

async function expect36Entry(search: WeddingCodeEntrySearchParams, explicitTarget: "36" | null) {
  const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
  expect(metadata.description).toContain("36개");
  expect(metadata.description).not.toContain("30개");
  expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: "/wedding-code" } });
  expect(metadata.openGraph).toMatchObject({ images: [{ url: "/wedding-code/r6-card/opengraph-image" }] });
  expect(metadata.openGraph).not.toHaveProperty("url");
  expect(JSON.stringify(metadata)).not.toContain("a-private-invite-token");
  const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
  expect(element.props.queryIsLegacy).toBe(false);
  expect(element.props.explicitTarget).toBe(explicitTarget);
  expect(element.props.researchContributionOpen).toBe(false);
}

describe("36문항 입구와 기존 판 메타데이터 분리", () => {
  it.each([{ v: "36" }, { ct: "a-private-invite-token" }, { v: "36", utm_source: "qa" }, { v: "36", deleted: "1" }])("36문항 명시 주소와 초대 %j는 36문항 설명을 쓰고 개인 링크를 메타데이터에 복사하지 않는다", async search => {
    await expect36Entry(search, "36");
  });

  it.each([{}, { utm_source: "qa" }])("맨 주소 %j는 스위치 상수가 정한 판의 설명을 쓰고 명시 판을 넘기지 않는다", async search => {
    if (WEDDING_CODE_BARE_TARGET === "36") {
      await expect36Entry(search, null);
      return;
    }
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata.description).toBe(WC64_DESCRIPTION);
    expect(metadata.description).not.toContain("36개");
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: "/wedding-code" } });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/wedding-code/wc64-card/opengraph-image" }] });
    expect(metadata.openGraph).not.toHaveProperty("url");
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(false);
    expect(element.props.explicitTarget).toBeNull();
  });

  it("64문항 명시 주소는 64문항 설명과 카드를 쓰고 64문항을 넘긴다", async () => {
    const search = { v: "64" };
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata.description).toBe(WC64_DESCRIPTION);
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/wedding-code/wc64-card/opengraph-image" }] });
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(false);
    expect(element.props.explicitTarget).toBe("wc64");
  });

  /** 맨 주소가 다른 판을 열어도 36문항 화면에서 돌아가는 링크는 36문항에 남는다. 초대 링크(`?ct=`)는 프록시 규칙상 `v` 없이 둔다. */
  it("36문항 화면이 돌아가는 주소는 모두 ?v=36 이고 맨 주소를 쓰지 않는다", () => {
    const root = resolve(process.cwd(), "src/app/wedding-code");
    const sources = {
      "WeddingCodeClient.tsx": readFileSync(resolve(root, "WeddingCodeClient.tsx"), "utf8"),
      "result/Result36Client.tsx": readFileSync(resolve(root, "result/Result36Client.tsx"), "utf8"),
    };
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/["`]\/wedding-code["`]/);
      expect(source, file).not.toMatch(/["`]\/wedding-code\?(?!v=36|ct=)/);
    }
    expect(sources["WeddingCodeClient.tsx"].match(/"\/wedding-code\?v=36"/g)).toHaveLength(2);
    expect(sources["result/Result36Client.tsx"].match(/"\/wedding-code\?v=36"/g)).toHaveLength(3);
    expect(sources["result/Result36Client.tsx"]).toContain(`"/wedding-code?v=36&deleted=1"`);
    expect(sources["result/Result36Client.tsx"]).toContain("/wedding-code?ct=${body.coupleToken}");
    // Candidate 4 퇴역 표식은 다른 시험(candidate5.test.ts)이 고정한다.
    expect(sources["WeddingCodeClient.tsx"]).toContain("CANDIDATE4_RETIRED");
  });

  it("명시한 기존 30문항 판의 설명과 컴포넌트 선택을 유지한다", async () => {
    const search = { v: MEASUREMENT_VERSION };
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata.description).toContain("30개");
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/wedding-code/likert-card/opengraph-image" }] });
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(false);
    expect(element.props.explicitTarget).toBe("likert");
  });

  it.each([
    { v: WEDDING_CODE_V31_VERSION }, { v: WEDDING_CODE_V40_VERSION },
    { a: "private-old-answer" }, { v: "unknown-version" },
  ] as WeddingCodeEntrySearchParams[])("명시 구판이나 이전 답 %j는 기존 파서에 넘긴다", async search => {
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(true);
    expect(element.props.explicitTarget).toBeNull();
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
    expect(JSON.stringify(metadata)).not.toContain("private-old-answer");
  });
});
