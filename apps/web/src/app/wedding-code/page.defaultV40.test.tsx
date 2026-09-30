import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** 기본 진입 교체 PR(상수 하나)이 낼 결과를 미리 굳힌다. */
vi.mock("./entry", async (importOriginal) => {
  const original = await importOriginal<typeof import("./entry")>();
  return { ...original, WEDDING_CODE_DEFAULT_VERSION: "v4.0-tendency" };
});

import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import WeddingCodePage, { generateMetadata } from "./page";

const V40_TITLE = `${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`;

describe("웨딩코드 진입 화면: 기본 진입을 v4 로 바꾼 뒤", () => {
  it("맨 주소의 메타데이터는 v4 이고, 색인 밖이다(재검사 통과 전까지 경로 전체가 noindex)", async () => {
    for (const search of [{}, { utm_source: "landing" }, { v: WEDDING_CODE_V40_VERSION }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(String(metadata.title), JSON.stringify(search)).toBe(V40_TITLE);
      expect(metadata.robots, JSON.stringify(search)).toMatchObject({ index: false, follow: false });
    }
  });

  it("이전 판 입구는 예전 제목이지만 역시 색인하지 않는다", async () => {
    for (const version of [WEDDING_CODE_V31_VERSION, WEDDING_CODE_V30_VERSION]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: version }) });
      expect(String(metadata.title)).toContain("원하는 결혼식과 준비 방식");
      expect(metadata.robots).toMatchObject({ index: false, follow: false });
    }
    const v20 = await generateMetadata({ searchParams: Promise.resolve({ v: WEDDING_CODE_V20_VERSION }) });
    expect(String(v20.title)).toContain("내 웨딩 준비 방식");
    expect(v20.robots).toMatchObject({ index: false, follow: false });
  });

  it("맨 주소는 v4 빈 입구, 명시 v3.1(답 없음)은 이전 판 안내가 붙은 v3.1 입구를 넘긴다", async () => {
    const bare = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    expect(bare.props.initialEntry).toEqual({ kind: "v40", initial: { partner: null, both: null } });
    const older = await WeddingCodePage({ searchParams: Promise.resolve({ v: WEDDING_CODE_V31_VERSION }) });
    expect(older.props.initialEntry).toMatchObject({ kind: "v31", older: true });
    const v30 = await WeddingCodePage({ searchParams: Promise.resolve({ v: WEDDING_CODE_V30_VERSION }) });
    expect(v30.props.initialEntry.kind).toBe("v30");
  });

  it("쿼리에 답이 오면 어느 판이든 오류다", async () => {
    for (const search of [{ v: WEDDING_CODE_V31_VERSION, a: "AACB" }, { a: "AACB" }, { v: WEDDING_CODE_V40_VERSION, a: "AACB" }]) {
      const page = await WeddingCodePage({ searchParams: Promise.resolve(search) });
      expect(page.props.initialEntry.kind, JSON.stringify(search)).toBe("error");
    }
  });
});
