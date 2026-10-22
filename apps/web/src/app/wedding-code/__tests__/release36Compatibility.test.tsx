import { describe, expect, it, vi } from "vitest";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { createVirtualPartnerAnswers19, encodePartnerPayload19 } from "@/lib/weddingCode19/engine";
import type { WeddingCodeEntrySearchParams } from "../entry";

vi.mock("../WeddingCodeReleaseClient", () => ({ default: () => null }));
vi.mock("@/lib/weddingCode/contribution/server", () => ({ isWeddingCodeResearchContributionOpen: () => false, isWeddingCodeResearchStorageActive: () => false }));

import WeddingCodePage, { generateMetadata } from "../page";

describe("36문항 배포판의 기본 입구와 기존 판 메타데이터 분리", () => {
  it.each([{}, { ct: "a-private-invite-token" }, { utm_source: "qa" }])("새 입구 %j는 19문항 설명을 쓰고 개인 링크를 메타데이터에 복사하지 않는다", async search => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata.description).toContain("19문항");
    expect(metadata.description).not.toContain("30개");
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: "/wedding-code" } });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/wedding-code/r6-card/opengraph-image" }] });
    expect(metadata.openGraph).not.toHaveProperty("url");
    expect(JSON.stringify(metadata)).not.toContain("a-private-invite-token");
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(false);
    expect(element.props.explicitLikert).toBe(false);
    expect(element.props.researchContributionOpen).toBe(false);
  });

  it("명시한 기존 30문항 판의 설명과 컴포넌트 선택을 유지한다", async () => {
    const search = { v: MEASUREMENT_VERSION };
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata.description).toContain("30개");
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/wedding-code/likert-card/opengraph-image" }] });
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(false);
    expect(element.props.explicitLikert).toBe(true);
  });

  it.each([
    { v: WEDDING_CODE_V31_VERSION }, { v: WEDDING_CODE_V40_VERSION },
    { a: "private-old-answer" }, { v: "unknown-version" },
  ] as WeddingCodeEntrySearchParams[])("명시 구판이나 이전 답 %j는 기존 파서에 넘긴다", async search => {
    const element = await WeddingCodePage({ searchParams: Promise.resolve(search) });
    expect(element.props.queryIsLegacy).toBe(true);
    expect(element.props.explicitLikert).toBe(false);
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
    expect(JSON.stringify(metadata)).not.toContain("private-old-answer");
  });

  it("19문항 파트너 초대 링크(?partner=...) 진입 시 카톡 미리보기(OpenGraph)에 파트너 동물 캐릭터명과 4자리 코드를 표시하고 원답 문자열은 노출하지 않는다", async () => {
    const partnerPreset = createVirtualPartnerAnswers19("SDMH");
    const encoded = encodePartnerPayload19(partnerPreset.answers, partnerPreset.topPriorityIds);
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ partner: encoded }),
    });
    expect(String(metadata.title)).toContain("파트너(🦢 로망을 수놓는 다정한 백조)가 보낸 웨딩코드 도착!");
    expect(String(metadata.description)).toContain("SDMH");
    expect(String(metadata.description)).toContain("19문항(약 3분)");
    expect(JSON.stringify(metadata)).not.toContain(encoded);
  });
});
