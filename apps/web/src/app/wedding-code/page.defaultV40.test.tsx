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
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { parseWeddingCodeEntryHash } from "./entry";
import WeddingCodePage, { generateMetadata } from "./page";

const V40_TITLE = `${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`;

/** 해시로 오면 읽히는 진짜 코드. 깨진 코드("AACB")로만 시험하면 query 를 읽든 말든 오류라서 「query 의 답을 읽지 않는다」를 밝히지 못한다. */
const READABLE_V31_CODE = "31_------5------------------_-.-.-.-.-.c02_c01_-_-";
const READABLE_V40_CODE = (() => {
  const fixture = fixtureByName("swua-example");
  const code = fixture ? encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses) : null;
  if (code === null) throw new Error("고정 표본 코드를 만들 수 없어요");
  return code;
})();

describe("웨딩코드 진입 화면: 기본 진입을 v4 로 바꾼 뒤", () => {
  it("맨 주소의 메타데이터는 v4 이고, 색인 밖이다(재검사 통과 전까지 경로 전체가 noindex)", async () => {
    for (const search of [{}, { utm_source: "landing" }, { v: WEDDING_CODE_V40_VERSION }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(String(metadata.title), JSON.stringify(search)).toBe(V40_TITLE);
      expect(metadata.robots, JSON.stringify(search)).toMatchObject({ index: false, follow: false });
      // 제목이 v4 인 주소는 카드 그림도 v4 카드다(제목은 v4 인데 그림이 v3.1 문장이던 어긋남을 막는다).
      const v4Card = { url: "/wedding-code/v40-card/opengraph-image", type: "image/png", width: 1200, height: 630, alt: `웨딩코드, ${V40_COPY.intro.title}` };
      expect(metadata.openGraph?.images, JSON.stringify(search)).toEqual([v4Card]);
      expect(metadata.twitter?.images, JSON.stringify(search)).toEqual([v4Card]);
    }
  });

  it("이전 판 입구는 예전 제목이지만 역시 색인하지 않고, 카드 그림은 같은 폴더의 기본 카드를 받는다", async () => {
    const noImages = (metadata: Awaited<ReturnType<typeof generateMetadata>>) => [
      Object.prototype.hasOwnProperty.call(metadata.openGraph, "images"),
      Object.prototype.hasOwnProperty.call(metadata.twitter, "images"),
    ];
    for (const version of [WEDDING_CODE_V31_VERSION, WEDDING_CODE_V30_VERSION]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: version }) });
      expect(String(metadata.title)).toContain("원하는 결혼식과 준비 방식");
      expect(metadata.robots).toMatchObject({ index: false, follow: false });
      expect(noImages(metadata), version).toEqual([false, false]);
    }
    const v20 = await generateMetadata({ searchParams: Promise.resolve({ v: WEDDING_CODE_V20_VERSION }) });
    expect(String(v20.title)).toContain("내 웨딩 준비 방식");
    expect(v20.robots).toMatchObject({ index: false, follow: false });
    expect(noImages(v20)).toEqual([false, false]);
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

  it("쿼리에 읽을 수 있는 진짜 코드가 와도 서버는 풀지 않는다(같은 코드가 해시로 오면 읽힌다)", async () => {
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V31_VERSION}&a=${READABLE_V31_CODE}`)?.kind).toBe("v31");
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V40_VERSION}&a=${READABLE_V40_CODE}`)?.kind).toBe("v40");
    for (const search of [
      { v: WEDDING_CODE_V31_VERSION, a: READABLE_V31_CODE },
      { v: WEDDING_CODE_V40_VERSION, a: READABLE_V40_CODE },
      { v: WEDDING_CODE_V40_VERSION, a: READABLE_V40_CODE, b: READABLE_V40_CODE },
    ]) {
      const page = await WeddingCodePage({ searchParams: Promise.resolve(search) });
      expect(page.props.initialEntry.kind, JSON.stringify(search)).toBe("error");
    }
  });
});
