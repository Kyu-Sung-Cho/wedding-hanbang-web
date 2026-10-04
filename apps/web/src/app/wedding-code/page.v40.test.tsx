import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

const V40 = WEDDING_CODE_V40_VERSION;
/** 해시로 오면 읽히는 진짜 코드. 깨진 코드("AACB")로만 시험하면 query 를 읽든 말든 오류라서 「query 의 답을 읽지 않는다」를 밝히지 못한다. */
const READABLE_CODE = (() => {
  const fixture = fixtureByName("swua-example");
  const code = fixture ? encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses) : null;
  if (code === null) throw new Error("고정 표본 코드를 만들 수 없어요");
  return code;
})();
const BANNED_IN_DESCRIPTION = /모든 성향|완벽|정확히|MBTI|16개 문장|32개 문장만/;
const CLAIMS = /검증된|정확|과학|진단|점수|등급|궁합|유형|스타일|퍼센트|%/;

describe("웨딩코드 진입 화면: v4.0-tendency 명시 진입(기본 판 v3.1)", () => {
  it("v4 입구의 제목과 설명은 웨딩코드를 말하고 주장 낱말을 쓰지 않는다", async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: V40 }) });
    expect(String(metadata.title)).toContain("웨딩코드");
    expect(String(metadata.title)).toBe(`${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`);
    expect(metadata.description).toBe(V40_COPY.intro.lede);
    expect(metadata.description).not.toMatch(BANNED_IN_DESCRIPTION);
    expect(`${metadata.title} ${metadata.description}`).not.toMatch(CLAIMS);
  });

  it("v4 입구는 색인하지 않고 링크를 따라가지도 않는다", async () => {
    for (const search of [{ v: V40 }, { v: V40, a: "AACB" }, { v: V40, utm_source: "kakao" }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(metadata.robots, JSON.stringify(search)).toMatchObject({ index: false, follow: false });
    }
  });

  it("공유 카드: 이 화면의 제목·설명과 v4 카드 그림 하나를 쓰고 og:url 은 적지 않는다", async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: V40 }) });
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      siteName: "웨딩한방",
      locale: "ko_KR",
      type: "website",
    });
    expect(Object.prototype.hasOwnProperty.call(metadata.openGraph, "url")).toBe(false);
    // 같은 폴더의 opengraph-image.tsx 는 v3.1 문장이 든 기본 카드이고 쿼리를 읽지 못한다. 그래서 v4 입구만 일부러 images 를 적어
    // 그 파일을 밀어내고 v4 카드(v40-card/opengraph-image.tsx)를 붙인다. 오픈그래프와 트위터가 같은 그림 하나다.
    const v4Card = { url: "/wedding-code/v40-card/opengraph-image", type: "image/png", width: 1200, height: 630, alt: `웨딩코드, ${V40_COPY.intro.title}` };
    expect(metadata.openGraph?.images).toEqual([v4Card]);
    expect(metadata.twitter?.images).toEqual([v4Card]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: metadata.title, description: metadata.description });
    expect(metadata.alternates?.canonical).toBe("/wedding-code");
    expect(metadata).toMatchObject({ referrer: "no-referrer" });
    expect(JSON.stringify([metadata.openGraph, metadata.twitter])).not.toMatch(/landing|아모라|og-image|AACB/);
  });

  it("다른 판의 메타데이터와 색인 규칙은 그대로다(기본 판이 v3.1 인 동안)", async () => {
    // v4 카드는 v4 입구만 적는다. 다른 판은 images 키가 없어야 같은 폴더의 기본 카드(opengraph-image.tsx)를 그대로 받는다.
    const noImages = (metadata: Awaited<ReturnType<typeof generateMetadata>>) => [
      Object.prototype.hasOwnProperty.call(metadata.openGraph, "images"),
      Object.prototype.hasOwnProperty.call(metadata.twitter, "images"),
    ];
    const clean = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(clean.robots).toMatchObject({ index: true, follow: true });
    expect(clean.title).toContain("원하는 결혼식과 준비 방식");
    expect(noImages(clean)).toEqual([false, false]);
    for (const version of [WEDDING_CODE_V31_VERSION, WEDDING_CODE_V30_VERSION]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: version }) });
      expect(metadata.title).toContain("원하는 결혼식과 준비 방식");
      expect(metadata.robots).toMatchObject({ index: true, follow: true });
      expect(noImages(metadata), version).toEqual([false, false]);
    }
    const v20 = await generateMetadata({ searchParams: Promise.resolve({ v: WEDDING_CODE_V20_VERSION }) });
    expect(v20.title).toContain("내 웨딩 준비 방식");
    expect(v20.robots).toMatchObject({ index: true, follow: true });
    expect(noImages(v20)).toEqual([false, false]);
    const scene = await generateMetadata({ searchParams: Promise.resolve({ v: "v1.2-code" }) });
    expect(scene.title).toContain("결혼 준비 장면");
    expect(noImages(scene)).toEqual([false, false]);
  });

  it("맨 주소는 v3.1 이고 ?v=v4.0-tendency 만 빈 v4 입구를 넘긴다", async () => {
    const bare = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    expect(bare.props.initialEntry).toEqual({ kind: "v31", initial: { partnerDraft: null, partnerCode: null, bothDrafts: null } });
    const v4 = await WeddingCodePage({ searchParams: Promise.resolve({ v: V40 }) });
    expect(v4.props.initialEntry).toEqual({ kind: "v40", initial: { partner: null, both: null } });
    expect(v4.props.researchContributionOpen).toBe(bare.props.researchContributionOpen);
  });

  it("query 에 답이 실린 v4 주소는 복원하지 않고 v4 오류 입구를 넘긴다", async () => {
    for (const search of [{ v: V40, a: "AACB" }, { v: V40, b: "AACB" }, { v: [V40, V40] }]) {
      const page = await WeddingCodePage({ searchParams: Promise.resolve(search) });
      expect(page.props.initialEntry, JSON.stringify(search)).toEqual({ kind: "error", version: V40 });
      const html = renderToStaticMarkup(page);
      expect(html).toContain(V40_COPY.error.brokenLink.title);
      expect(html).not.toContain("이 링크는 열 수 없어요");
      expect(html).not.toContain("AACB");
    }
  });

  it("query 에 읽을 수 있는 진짜 코드가 실려도 서버는 풀지 않고, 코드가 화면에 나가지 않는다(같은 코드가 해시로 오면 읽힌다)", async () => {
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${READABLE_CODE}`)?.kind).toBe("v40");
    for (const search of [{ v: V40, a: READABLE_CODE }, { v: V40, b: READABLE_CODE }, { v: V40, a: READABLE_CODE, b: READABLE_CODE }]) {
      const page = await WeddingCodePage({ searchParams: Promise.resolve(search) });
      expect(page.props.initialEntry, JSON.stringify(search)).toEqual({ kind: "error", version: V40 });
      const html = renderToStaticMarkup(page);
      expect(html).toContain(V40_COPY.error.brokenLink.title);
      expect(html).not.toContain(READABLE_CODE);
    }
  });

  it("v4 입구를 서버에서 그려도 던지지 않는다(시험 환경에서는 불러오는 자리만 그려진다)", async () => {
    const page = await WeddingCodePage({ searchParams: Promise.resolve({ v: V40 }) });
    const html = renderToStaticMarkup(page);
    expect(html).not.toContain(V40_COPY.error.brokenLink.title);
    expect(html).not.toContain("이 링크는 열 수 없어요");
    expect(html).toContain(V40_COPY.common.loadingLabel);
    // 낭독기에 들리려면 글자가 있는 것만으로는 모자라고 상태 알림 영역(role=status) 안에 있어야 한다.
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${V40_COPY.common.loadingLabel}</`));
  });
});

/**
 * 2026-10-04 감사(A21, A50, A68, A15): 판 이름은 입구(entry.ts)와 같은 읽기로 읽는다.
 *  - 끝에 점이나 괄호가 붙은 v4 주소(?v=v4.0-tendency.)는 입구가 v4 로 여는 주소이므로 제목과 카드도 v4 것이다.
 *  - 알 수 없는 판 이름(오타, 대소문자)은 열 수 없는 링크 안내가 뜨는 주소다. 폐기된 장면 판 제목(「결혼 준비 장면, 나라면?」)이 나가지 않고,
 *    현재 기본 판의 제목을 쓰며, 색인하지 않는다.
 */
describe("웨딩코드 진입 화면: 판 이름의 끝 글자와 알 수 없는 판 이름", () => {
  const OLD_SCENE_TITLE = "결혼 준비 장면, 나라면?";

  it("끝에 글자가 붙은 v4 주소도 v4 제목, v4 카드, 색인 막기를 쓴다(입구가 v4 로 여는 주소와 같다)", async () => {
    const exact = await generateMetadata({ searchParams: Promise.resolve({ v: V40 }) });
    for (const tail of [".", ")", "/", " ", "요", ","]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: `${V40}${tail}` }) });
      expect(metadata, JSON.stringify(tail)).toEqual(exact);
      const page = await WeddingCodePage({ searchParams: Promise.resolve({ v: `${V40}${tail}` }) });
      expect(page.props.initialEntry, JSON.stringify(tail)).toEqual({ kind: "v40", initial: { partner: null, both: null } });
    }
  });

  it("알 수 없는 판 이름은 폐기된 장면 판 제목을 쓰지 않고 현재 기본 판 제목으로 나가며 색인하지 않는다", async () => {
    const bare = await generateMetadata({ searchParams: Promise.resolve({}) });
    for (const v of ["V4.0-TENDENCY", "v4.0-tendency-x", "v4.0", "v4-tendency", "v9-unknown", "", " v4.0-tendency", "v4.0-tendencyx", "v3.1-preference"]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ v }) });
      expect(String(metadata.title), JSON.stringify(v)).not.toContain(OLD_SCENE_TITLE);
      expect(metadata.title, JSON.stringify(v)).toBe(bare.title);
      expect(metadata.description, JSON.stringify(v)).toBe(bare.description);
      expect(metadata.robots, JSON.stringify(v)).toMatchObject({ index: false, follow: false });
      expect(metadata.openGraph, JSON.stringify(v)).toMatchObject({ title: bare.title });
      // 맨 주소는 그대로 색인한다(알 수 없는 판 이름 처리가 입구 색인 규칙을 건드리지 않는다).
      expect(bare.robots).toMatchObject({ index: true, follow: true });
    }
    // 배열(반복된 v)도 알 수 없는 값이다.
    const repeated = await generateMetadata({ searchParams: Promise.resolve({ v: [V40, V40] }) });
    expect(String(repeated.title)).not.toContain(OLD_SCENE_TITLE);
    expect(repeated.robots).toMatchObject({ index: false, follow: false });
  });

  it("알려진 판의 이름은 그대로 읽는다: 폐기된 장면 판(v1.2-code)의 제목과 색인은 예전 그대로다", async () => {
    const scene = await generateMetadata({ searchParams: Promise.resolve({ v: "v1.2-code" }) });
    expect(scene.title).toContain(OLD_SCENE_TITLE);
    expect(scene.robots).toMatchObject({ index: true, follow: true });
    const sceneWithTail = await generateMetadata({ searchParams: Promise.resolve({ v: "v1.2-code." }) });
    expect(sceneWithTail).toEqual(scene);
  });
});
