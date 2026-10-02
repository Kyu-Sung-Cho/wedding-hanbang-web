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

import OpenGraphImage, { alt, contentType, size } from "./opengraph-image";
import WeddingCodePage, { generateMetadata } from "./page";
import { metadata as togetherMetadata } from "./together/page";
import { metadata as tasteMetadata } from "./taste/page";

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function drawCard() {
  captured.length = 0;
  const response = await OpenGraphImage();
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
    expect(text).toContain("둘 다 답하고 서로 공유하면 두 사람의 답을 나란히 볼 수 있어요");
    expect(text).not.toContain("상대도 답하면");
    const page = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).toContain("둘 다 답하고 서로 공유하면 두 사람의 답을 나란히 볼 수 있어요");
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
   * 하위 경로는 openGraph 를 스스로 정하는 순간 부모 이미지를 잃으므로 주소를 직접 적는다.
   */
  it("입구는 이 파일을 카드 이미지로 쓰고, 함께 보기 초대 링크는 같은 주소를 가리킨다", async () => {
    for (const search of [{}, { v: "3.1" }, { a: "AACB" }]) {
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
