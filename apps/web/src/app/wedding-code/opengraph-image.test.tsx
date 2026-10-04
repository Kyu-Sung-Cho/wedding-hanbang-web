// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * 진짜 `ImageResponse` 로 PNG 를 그리되, 그린 JSX 도 붙잡아 둔다.
 * 그림이 깨지는 것(satori 는 여러 자식을 둔 div 에 `display:flex` 가 없으면 죽는다)과
 * 카드에 적힌 말을 한 번에 본다.
 */
const captured = vi.hoisted(() => [] as Array<{ element: ReactElement; options: Record<string, unknown> }>);
vi.mock("next/og", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/og")>();
  class CapturingImageResponse extends actual.ImageResponse {
    constructor(element: ReactElement, options: ConstructorParameters<typeof actual.ImageResponse>[1]) {
      super(element, options);
      captured.push({ element, options: (options ?? {}) as Record<string, unknown> });
    }
  }
  return { ...actual, ImageResponse: CapturingImageResponse };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import OpenGraphImage, { alt, contentType, size } from "./opengraph-image";
import WeddingCodePage, { generateMetadata } from "./page";
import { metadata as togetherMetadata } from "./together/page";
import { metadata as tasteMetadata } from "./taste/page";
import V40OpenGraphImage, { alt as v40Alt, contentType as v40ContentType, size as v40Size } from "./v40-card/opengraph-image";

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function drawCard(render: () => Promise<Response> = OpenGraphImage) {
  captured.length = 0;
  const response = await render();
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(captured, "ImageResponse 를 한 번 만들어야 한다").toHaveLength(1);
  const text = renderToStaticMarkup(captured[0].element).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { response, bytes, text };
}

describe("웨딩코드 공유 카드 이미지", () => {
  it("1200×630 PNG 로 실제로 그려진다", async () => {
    const { response, bytes } = await drawCard();
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(response.headers.get("content-type")).toContain("image/png");
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
    // 한글 글꼴이 없으면 글자가 두부(□)로 나온다. ttf 를 실제로 실어 보냈는지 본다.
    const fonts = captured[0].options.fonts as Array<{ data: ArrayBuffer | Buffer }>;
    expect(fonts).toHaveLength(1);
    expect(fonts[0].data.byteLength).toBeGreaterThan(100_000);
  }, 60_000);

  it("무엇을 하는 곳인지만 말하고 네 글자 예시나 판정은 싣지 않는다", async () => {
    const { text } = await drawCard();
    expect(text).toContain("웨딩코드");
    expect(text).toContain("내가 원하는 결혼식과");
    expect(text).toContain("hanbang.ai");
    for (const source of [text, alt]) {
      // 네 글자 코드(예: KTFL, MOFA)는 라틴 글자로 쓴다. 주소 hanbang.ai 말고는 라틴 글자가 없어야 한다.
      const latin = (source.match(/[A-Za-z?]+/g) ?? []).filter((run) => run !== "hanbang" && run !== "ai");
      expect(latin, source).toEqual([]);
      for (const banned of ["성격", "궁합", "유형", "점수", "등급", "당신은", "잘 맞", "예측", "베타", "분이면", "약 ", "—", "–"]) {
        expect(source, banned).not.toContain(banned);
      }
      expect(source).not.toMatch(/\d+\s*분|\d+\s*%|\d+\s*점/);
    }
  }, 60_000);

  /**
   * 카드의 이 줄은 시작 화면 카드 셋째 줄과 같은 약속이다. 각자 답하기만 해서는 두 사람이 연결되지 않고, 둘 다 답한 뒤 서로
   * 공유해야 나란히 보인다. 예전 글(「상대도 답하면 …」)은 상대가 답하기만 하면 저절로 비교되는 것처럼 읽혔다.
   */
  it("두 사람의 답을 나란히 보는 조건을 ‘둘 다 답하고 서로 공유하면’으로 말한다", async () => {
    const { text } = await drawCard();
    // 카드는 줄을 줄여 「혼자서도 결과를 볼 수 있고, 상대와 나눠 보면 나란히 볼 수 있어요」라고만 말하고, 시작 화면의 카드가 조건(둘 다 답한 뒤 서로 답을 공유해야 해요)을 밝힌다.
    expect(text).toContain("혼자서도 결과를 볼 수 있고, 상대와 나눠 보면 나란히 볼 수 있어요.");
    expect(text).not.toContain("상대도 답하면");
    const page = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).toContain("혼자 해도 결과를 볼 수 있어요. 두 사람의 답을 나란히 보려면, 둘 다 답한 뒤 서로 답을 공유해야 해요.");
  }, 60_000);

  it("카드가 약속하는 「로그인 없이」는 시작 화면도 그대로 말한다", async () => {
    const { text } = await drawCard();
    expect(text).toContain("로그인 없이");
    const page = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("로그인 없이 시작");
  }, 60_000);

  /**
   * Next 는 같은 폴더의 `opengraph-image` 를 **그 단계 metadata 에 `openGraph.images` 키가 없을
   * 때만** 붙인다. 입구 metadata 가 `images` 를 적으면 이 카드가 조용히 빠진다.
   * 그래서 v4.0-tendency 입구만 일부러 `images` 를 적고(아래 「웨딩코드 v4.0-tendency 공유 카드」), 다른 판은 키를 아예 적지 않는다.
   * 하위 경로는 openGraph 를 스스로 정하는 순간 부모 이미지를 잃으므로 주소를 직접 적는다.
   */
  it("입구는 이 파일을 카드 이미지로 쓰고(v4 입구만 빼고), 함께 보기 초대 링크는 같은 주소를 가리킨다", async () => {
    // v1.2-code 는 장면 판의 이름이다(`generateMetadata` 의 마지막 갈래).
    const others = [{}, { v: "3.1" }, { a: "AACB" }, { v: WEDDING_CODE_V31_VERSION }, { v: WEDDING_CODE_V30_VERSION }, { v: WEDDING_CODE_V20_VERSION }, { v: "v1.2-code" }];
    for (const search of others) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(metadata.openGraph, JSON.stringify(search)).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(metadata.openGraph, "images"), JSON.stringify(search)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(metadata.twitter, "images"), JSON.stringify(search)).toBe(false);
    }
    const images = togetherMetadata.openGraph?.images;
    const list = Array.isArray(images) ? images : [images];
    expect(list).toHaveLength(1);
    const image = list[0] as { url: string; width: number; height: number; alt: string };
    expect(image.url).toBe("/wedding-code/opengraph-image");
    expect(existsSync(resolve(process.cwd(), "src/app/wedding-code/opengraph-image.tsx"))).toBe(true);
    expect({ width: image.width, height: image.height }).toEqual(size);
    expect(image.alt).toBe(alt);
  });

  /**
   * 함께 보기 초대 링크(`#room=…&invite=…`)는 대화창에 붙여 보내는 주소다. 여기서 카드를 정하지
   * 않으면 아모라 소개와 `og:url=/landing` 이 나온다. `og:url` 을 적으면 그 주소를 따라가는 곳에서
   * `#` 뒤 초대 토큰이 빠진 주소가 열릴 수 있어 적지 않는다.
   */
  it("함께 보기 주소는 색인하지 않고, 랜딩 카드 대신 일반 카드를 쓴다", () => {
    expect(togetherMetadata.robots).toMatchObject({ index: false, follow: false });
    expect(togetherMetadata.openGraph).toMatchObject({
      title: togetherMetadata.title,
      description: togetherMetadata.description,
      siteName: "웨딩한방",
      locale: "ko_KR",
      type: "website",
    });
    expect(togetherMetadata.twitter).toMatchObject({ card: "summary_large_image", title: togetherMetadata.title, description: togetherMetadata.description });
    expect(Object.prototype.hasOwnProperty.call(togetherMetadata.openGraph, "url")).toBe(false);
    expect(JSON.stringify([togetherMetadata.openGraph, togetherMetadata.twitter])).not.toMatch(/landing|아모라|og-image/);
  });

  /**
   * 고른 취향이 담긴 링크(`/wedding-code/taste#v=…&a=…`)도 대화창에 붙여 보내는 주소다. 여기서 카드를 정하지 않으면
   * 루트 카드의 아모라 제목·설명과 `og:url=/landing` 에 부모 폴더의 웨딩코드 그림만 붙은 섞인 카드가 나갔다.
   */
  it("취향 링크도 랜딩 카드 대신 자기 제목·설명과 같은 카드 그림을 쓰고, 답이 빠지는 og:url 은 적지 않는다", () => {
    expect(tasteMetadata.robots).toMatchObject({ index: false, follow: false });
    expect(tasteMetadata.referrer).toBe("no-referrer");
    expect(tasteMetadata.openGraph).toMatchObject({
      title: tasteMetadata.title,
      description: tasteMetadata.description,
      siteName: "웨딩한방",
      locale: "ko_KR",
      type: "website",
    });
    expect(tasteMetadata.twitter).toMatchObject({ card: "summary_large_image", title: tasteMetadata.title, description: tasteMetadata.description });
    expect(Object.prototype.hasOwnProperty.call(tasteMetadata.openGraph, "url")).toBe(false);
    expect(JSON.stringify([tasteMetadata.openGraph, tasteMetadata.twitter])).not.toMatch(/landing|아모라|og-image/);
    const images = tasteMetadata.openGraph?.images;
    const list = Array.isArray(images) ? images : [images];
    expect(list).toHaveLength(1);
    // 그림을 직접 적지 않으면 부모 폴더 그림도 붙지 않아 그림 없는 카드가 된다.
    expect(list[0]).toMatchObject({ url: "/wedding-code/opengraph-image", width: 1200, height: 630 });
  });

  /**
   * 부모 폴더에 카드 그림이 있으면, openGraph 를 스스로 정하지 않은 하위 경로는 루트 카드 글에 그 그림만 붙은
   * 섞인 카드가 된다. 새 하위 경로가 생겨도 같은 일이 되풀이되지 않게, 이 폴더의 모든 화면이 openGraph 를 정하는지 본다.
   */
  it("웨딩코드 폴더의 모든 화면이 공유 카드(openGraph)를 스스로 정한다", async () => {
    const root = resolve(process.cwd(), "src/app/wedding-code");
    const pages = (readdirSync(root, { recursive: true }) as string[])
      .map(file => file.split("\\").join("/"))
      .filter(file => /(^|\/)page\.tsx$/.test(file))
      .sort();
    // 찾는 방법이 고장 나 빈 목록으로 통과하지 않게, 알고 있는 화면이 모두 잡히는지 먼저 본다.
    expect(pages).toEqual(expect.arrayContaining(["page.tsx", "c/[code]/page.tsx", "result/page.tsx", "taste/page.tsx", "together/page.tsx"]));
    // 화면 없이 입구로 돌려보내기만 하는 경로는 카드가 필요 없다(돌려보낸 곳의 카드가 쓰인다).
    const redirectOnly = new Set(["result/page.tsx"]);
    for (const file of pages) {
      const source = readFileSync(resolve(root, file), "utf8");
      if (redirectOnly.has(file)) { expect(source, file).toMatch(/redirect\("\/wedding-code"\)/); continue; }
      const mod = await import(/* @vite-ignore */ `./${file}`) as { metadata?: Metadata; generateMetadata?: (props: unknown) => Promise<Metadata> };
      const metadata = mod.metadata ?? await mod.generateMetadata?.({ params: Promise.resolve({ code: "MTFA" }), searchParams: Promise.resolve({}) });
      expect(metadata, file).toBeDefined();
      expect(metadata?.openGraph, file).toBeDefined();
      expect(JSON.stringify(metadata?.openGraph), file).not.toMatch(/landing|아모라/);
    }
  });
});

/**
 * v4.0-tendency 입구(`?v=v4.0-tendency`)의 카드. 예전에는 이 입구도 위의 기본 카드를 받아서, 제목은 v4 인데 그림은
 * 「내가 원하는 결혼식과 준비 방식을 살펴봐요 / 둘 다 답하고 서로 공유하면 …」(v3.1 문장)였다.
 */
describe("웨딩코드 v4.0-tendency 공유 카드", () => {
  const V40 = WEDDING_CODE_V40_VERSION;
  const title = V40_COPY.intro.title;
  const lede = V40_COPY.intro.lede;
  /** 첫 문단의 첫 문장(마침표 앞까지). 카드 작은 글은 이 문장만 옮긴다. */
  const ledeFirstSentence = lede.slice(0, lede.indexOf(". "));
  const BANNED_ON_CARD = [
    "성격", "궁합", "유형", "점수", "등급", "당신은", "잘 맞", "예측", "베타", "분이면", "약 ", "—", "–",
    // 계약 문서가 v4 에서도 쓰지 않는다고 못 박은 말(CLAUDE.md WeddingCode 절)
    "검증", "정확", "과학", "진단", "퍼센트", "백분율", "동물", "캐릭터", "스타일", "MBTI", "속마음", "무의식", "본모습", "모순", "일관성", "숨은",
  ];
  const WEB_ROOT = process.cwd();
  const read = (file: string) => readFileSync(resolve(WEB_ROOT, file), "utf8");

  it("1200×630 PNG 로 실제로 그려지고 글꼴을 싣는다", async () => {
    const { response, bytes } = await drawCard(V40OpenGraphImage);
    expect(v40Size).toEqual({ width: 1200, height: 630 });
    expect(v40Size).toEqual(size);
    expect(v40ContentType).toBe("image/png");
    expect(response.headers.get("content-type")).toContain("image/png");
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
    const fonts = captured[0].options.fonts as Array<{ data: ArrayBuffer | Buffer }>;
    expect(fonts).toHaveLength(1);
    expect(fonts[0].data.byteLength).toBeGreaterThan(100_000);
  }, 60_000);

  /**
   * 카드가 하는 말은 입구 화면이 이미 하는 말(제목, 첫 문단 첫 문장)과 기본 카드와 같은 아래 줄뿐이다. 글 전체를 한 번에 못 박아서
   * 새 문장이 슬쩍 끼어드는 것(주장, 숫자, 약속)을 잡는다.
   */
  it("카드의 글은 입구 제목, 첫 문단 첫 문장, 로그인 없이, 주소뿐이다", async () => {
    const { text } = await drawCard(V40OpenGraphImage);
    expect(ledeFirstSentence.length).toBeGreaterThan(10);
    expect(lede.startsWith(`${ledeFirstSentence}. `)).toBe(true);
    expect(text).toBe(["한", "웨딩한방", "웨딩코드", title, ledeFirstSentence, "로그인 없이 시작해요", "hanbang.ai"].join(" "));
  }, 60_000);

  it("주장, 점수, 숫자, 네 글자 예시, 둘이 비교된다는 약속이 없고 v3.1 문장도 없다", async () => {
    const { text } = await drawCard(V40OpenGraphImage);
    for (const source of [text, v40Alt]) {
      const latin = (source.match(/[A-Za-z]+/g) ?? []).filter((run) => run !== "hanbang" && run !== "ai");
      expect(latin, source).toEqual([]);
      for (const banned of BANNED_ON_CARD) expect(source, banned).not.toContain(banned);
      expect(source).not.toMatch(/[0-9%]/);
      // 혼자 답하는 것만으로 둘이 연결되거나 비교된다고 읽히는 말은 카드에 두지 않는다(비교는 상대가 결과 링크를 돌려보낼 때만 생긴다).
      expect(source).not.toMatch(/나란히|비교|둘 다|서로 공유|상대/);
    }
    for (const v31Sentence of ["내가 원하는 결혼식과", "준비 방식을 살펴봐요", "둘 다 답하고 서로 공유하면", "두 사람의 답을 나란히"]) {
      expect(text, v31Sentence).not.toContain(v31Sentence);
      expect(v40Alt, v31Sentence).not.toContain(v31Sentence);
    }
  }, 60_000);

  it("alt 는 입구 제목을 그대로 말한다", () => {
    expect(v40Alt).toBe(`웨딩코드, ${title}`);
    expect(v40Alt).not.toBe(alt);
  });

  /**
   * 이 카드를 받는 길은 입구 metadata 가 적은 `images` 뿐이다(폴더에 화면이 없고 쿼리를 읽는 파일 규약 이미지도 아니다). 그래서
   * 적는 쪽과 카드 파일이 같은 주소·크기·alt 를 말하는지, v4 입구에서만 적는지를 본다. 트위터 카드도 같은 그림이어야 한다.
   */
  it("v4 입구만 이 카드를 openGraph 와 twitter 에 적고, 제목은 v4 제목 그대로다", async () => {
    const expectedImage = { url: "/wedding-code/v40-card/opengraph-image", type: v40ContentType, width: v40Size.width, height: v40Size.height, alt: v40Alt };
    expect(existsSync(resolve(WEB_ROOT, "src/app/wedding-code/v40-card/opengraph-image.tsx"))).toBe(true);
    // 입구 화면이 아닌 폴더라 주소 하나만 카드로 열려야 한다(화면이 생기면 openGraph 를 스스로 정하는지 위의 시험이 따로 본다).
    expect(existsSync(resolve(WEB_ROOT, "src/app/wedding-code/v40-card/page.tsx"))).toBe(false);
    for (const search of [{ v: V40 }, { v: V40, utm_source: "kakao" }, { v: V40, a: "AACB" }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(metadata.openGraph?.images, JSON.stringify(search)).toEqual([expectedImage]);
      expect(metadata.twitter?.images, JSON.stringify(search)).toEqual([expectedImage]);
      expect(String(metadata.title), JSON.stringify(search)).toContain(title);
    }
    // 다른 판은 키를 적지 않아 기본 카드를 그대로 받는다(위의 「입구는 이 파일을 카드 이미지로 쓰고」 시험이 키가 없음을 본다).
    const plain = await generateMetadata({ searchParams: Promise.resolve({ v: WEDDING_CODE_V31_VERSION }) });
    expect(JSON.stringify([plain.openGraph, plain.twitter])).not.toContain("v40-card");
  });

  /**
   * 틀(`ogCard.tsx`)을 두 카드가 함께 쓴다. 기본 카드의 글이 틀을 나누며 달라지지 않았는지, 두 카드 파일이 색이나 배치를 다시
   * 따로 갖지 않는지(그러면 한쪽만 고쳐져 두 카드가 어긋난다)를 본다.
   */
  it("기본 카드의 글은 틀을 나눈 뒤에도 그대로이고, 두 카드 파일은 색과 배치를 따로 갖지 않는다", async () => {
    const { text } = await drawCard();
    expect(text).toBe(["한", "웨딩한방", "웨딩코드", "내가 원하는 결혼식과 준비 방식을 살펴봐요", "혼자서도 결과를 볼 수 있고, 상대와 나눠 보면 나란히 볼 수 있어요.", "로그인 없이 시작해요", "hanbang.ai"].join(" "));
    for (const file of ["src/app/wedding-code/opengraph-image.tsx", "src/app/wedding-code/v40-card/opengraph-image.tsx"]) {
      const source = read(file);
      expect(source, `${file}: 색은 ogCard.tsx 한 곳에만 둔다`).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
      expect(source, `${file}: 배치(style)는 ogCard.tsx 한 곳에만 둔다`).not.toContain("style={{");
      expect(source, file).toContain("weddingCodeCard(");
    }
    expect(read("src/app/wedding-code/ogCard.tsx")).toMatch(/#FDFCF7/);
  }, 60_000);
});
