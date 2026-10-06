import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import { WEDDING_CODE_V43_VERSION } from "@/constants/weddingCodeV43";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import WeddingCodePage, { generateMetadata } from "./page";

describe("v4.2 작업 기본판과 메타데이터", () => {
  it("맨 주소는 v4.3이며 명시 v4.2와 v4.1은 이전 문항판을 그대로 넘긴다", async () => {
    const bare = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    const exact = await WeddingCodePage({ searchParams: Promise.resolve({ v: WEDDING_CODE_V42_VERSION }) });
    const previous = await WeddingCodePage({ searchParams: Promise.resolve({ v: WEDDING_CODE_V41_VERSION }) });
    expect(bare.props.initialEntry).toEqual({ kind: "v43", initial: { partner: null, both: null } });
    expect(exact.props.initialEntry).toEqual({ kind: "v42", initial: { partner: null, both: null } });
    const current = await WeddingCodePage({ searchParams: Promise.resolve({ v: WEDDING_CODE_V43_VERSION }) });
    expect(current.props.initialEntry).toEqual(bare.props.initialEntry);
    expect(previous.props.initialEntry).toEqual({ kind: "v41", initial: { partner: null, both: null } });
  });

  it("작업 기본판과 두 정확판 모두 미검증 제목·공유 카드와 noindex를 유지한다", async () => {
    for (const search of [{}, { v: WEDDING_CODE_V41_VERSION }, { v: WEDDING_CODE_V42_VERSION }, { v: WEDDING_CODE_V43_VERSION }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(metadata.title).toBe(`${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`);
      expect(metadata.description).toBe(V40_COPY.intro.lede);
      expect(metadata.robots).toMatchObject({ index: false, follow: false });
      expect(metadata.referrer).toBe("no-referrer");
      expect(metadata.openGraph?.images).toEqual([{ url: "/wedding-code/v40-card/opengraph-image", type: "image/png", width: 1200, height: 630, alt: `웨딩코드, ${V40_COPY.intro.title}` }]);
      expect(metadata.openGraph).not.toHaveProperty("url");
    }
  });
});
