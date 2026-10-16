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
import { WEDDING_CODE_BARE_TARGET } from "./releaseEntry";

const V40_TITLE = `${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`;

/** 해시로 오면 읽히는 진짜 코드. 깨진 코드("AACB")로만 시험하면 query 를 읽든 말든 오류라서 「query 의 답을 읽지 않는다」를 밝히지 못한다. */
const READABLE_V31_CODE = "31_------5------------------_-.-.-.-.-.c02_c01_-_-";
const READABLE_V40_CODE = (() => {
  const fixture = fixtureByName("swua-example");
  const code = fixture ? encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses) : null;
  if (code === null) throw new Error("고정 표본 코드를 만들 수 없어요");
  return code;
})();

describe("웨딩코드 진입 화면: 이전 기본 상수가 v4여도 새 입구와 구판을 구분한다", () => {
  it("맨 주소와 명시 36·64는 새 제목·카드, 명시 v4는 구판 제목·카드를 쓰고 모두 색인 밖이다", async () => {
    const v4Card = { url: "/wedding-code/v40-card/opengraph-image", type: "image/png", width: 1200, height: 630, alt: `웨딩코드, ${V40_COPY.intro.title}` };
    const r6Card = { url: "/wedding-code/r6-card/opengraph-image", type: "image/png", width: 1200, height: 630, alt: "웨딩코드, 우리의 결혼 준비 방식" };
    const wc64Card = { url: "/wedding-code/wc64-card/opengraph-image", type: "image/png", width: 1200, height: 630, alt: "웨딩코드, 우리의 결혼 준비 성향" };
    const r6Title = "우리의 결혼 준비 방식 | 웨딩코드 · 웨딩한방";
    const wc64Title = "우리의 결혼 준비 성향 | 웨딩코드 · 웨딩한방";
    const bare = WEDDING_CODE_BARE_TARGET === "wc64" ? { title: wc64Title, card: wc64Card } : { title: r6Title, card: r6Card };
    const cases: Array<[Record<string, string>, { title: string; card: typeof v4Card }]> = [
      [{}, bare], [{ utm_source: "landing" }, bare],
      [{ v: "36" }, { title: r6Title, card: r6Card }], [{ ct: "invite" }, { title: r6Title, card: r6Card }],
      [{ v: "64" }, { title: wc64Title, card: wc64Card }],
      [{ v: WEDDING_CODE_V40_VERSION }, { title: V40_TITLE, card: v4Card }],
    ];
    for (const [search, expected] of cases) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(String(metadata.title), JSON.stringify(search)).toBe(expected.title);
      expect(metadata.robots, JSON.stringify(search)).toMatchObject({ index: false, follow: false });
      const expectedCard = expected.card;
      expect(metadata.openGraph?.images, JSON.stringify(search)).toEqual([expectedCard]);
      expect(metadata.twitter?.images, JSON.stringify(search)).toEqual([expectedCard]);
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

  it("맨 주소는 새 클라이언트로, 명시 v3.1(답 없음)은 이전 판 안내가 붙은 구판으로 넘긴다", async () => {
    const bare = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    expect(bare.props.initialEntry).toEqual({ kind: "v40", initial: { partner: null, both: null } });
    expect(bare.props.queryIsLegacy).toBe(false);
    const older = await WeddingCodePage({ searchParams: Promise.resolve({ v: WEDDING_CODE_V31_VERSION }) });
    expect(older.props.initialEntry).toMatchObject({ kind: "v31", older: true });
    expect(older.props.queryIsLegacy).toBe(true);
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
