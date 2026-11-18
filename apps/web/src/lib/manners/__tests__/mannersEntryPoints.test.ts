// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";

import { WEDDING_APP_ROUTES } from "../../../../weddingAppRoutes";
import { MANNERS_PARTS } from "../data";
import {
  MAPPED_MANNERS_CATEGORY_KEYS,
  categoryKeysForMannersPart,
  mannersPartForCategory,
} from "../categoryMap";

/**
 * 예절 안내는 2026-08-11까지 **아무 데서도 링크되지 않는 화면**이었다. 10파트를
 * 다 써 놓고도 사이트 안에서 들어가는 길이 0건이라 URL을 직접 쳐야만 열렸고,
 * 그건 2026-07-17에 사라진 것(라운지에서 알아서 뜨던 카드)이 돌아오지 않았다는
 * 뜻이었다.
 *
 * 그래서 콘텐츠 계약(`mannersSourceContract.test.ts`)과 별개로 **배선**을 잠근다.
 * 링크가 끊기면 화면이 멀쩡해도 제품에서는 없는 것과 같다.
 */

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("manners entry points", () => {
  // /wedding/<이름>은 next.config의 리라이트 목록에 있는 것만 열린다.
  // 빠지면 사이드바·주차 카드 링크가 전부 404다(2026-07-26 `saved`가 그랬다).
  it("exposes /wedding/manners through the rewrite list", () => {
    expect(WEDDING_APP_ROUTES).toContain("manners");
  });

  // 2026-11-13 파운더 결정으로 메뉴는 웨딩 라운지와 아모라 둘이 되었고, 예절 가이드는 메뉴에서
  // 빠졌다. 그래서 들어가는 길을 라운지의 "지금 준비에 맞는 가이드" 칸으로 잠근다. 이 칸마저
  // 빠지면 로그인한 사람에게 가이드는 다시 주소를 쳐야만 열리는 화면이 된다.
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 라운지가 청첩장 홈으로 바뀌어 옛 "지금 준비에
  // 맞는 가이드" 칸이 없다. 들어가는 길은 홈 맨 아래 링크 묶음(옛 사이드바·라운지 바로가기를 대신하는 자리)이다.
  // 잠그는 것은 같다 — 라운지에서 가이드로 가는 링크가 끊기지 않는다. 화면에 실제로 그려지는지는
  // `components/invitation/live/__tests__/liveScreens.test.tsx` 가 `/wedding/manners` 링크로 다시 잰다.
  it("keeps a lounge entry into the guide now that the menu has only the lounge and Amora", () => {
    const routes = source("src/components/invitation/live/liveRoutes.ts");
    const parts = source("src/components/invitation/live/LiveParts.tsx");
    const lounge = source("src/components/invitation/live/LiveLounge.tsx");
    const loungePage = source("src/app/(app)/lounge/page.tsx");

    expect(routes).toContain('{ path: "/manners", label: "예절 가이드" }');
    expect(parts).toContain("LIVE_MORE_LINKS.map");
    expect(lounge).toContain("footer={<LiveFooter />}");
    expect(loungePage).toContain("<LiveLounge />");
  });

  // 사이트맵은 리다이렉트 원본이 아니라 정본 주소를 실어야 한다.
  it("publishes the canonical /wedding/manners URLs in the sitemap", () => {
    const sitemap = source("src/app/sitemap.ts");

    expect(sitemap).toContain("${BASE_URL}/wedding/manners");
    expect(sitemap).toContain("${BASE_URL}/wedding/manners/${part.slug}");
    expect(sitemap).not.toContain("${BASE_URL}/manners");
  });

  it("points every public manners link at the canonical path", () => {
    for (const file of [
      "src/app/manners/layout.tsx",
      "src/app/manners/page.tsx",
      "src/app/manners/[slug]/page.tsx",
    ]) {
      const text = source(file);
      // `href="/manners..."` 같은 리다이렉트 원본이 남아 있으면 안 된다.
      expect(text, `${file}: 리다이렉트 원본을 직접 링크한다`).not.toMatch(
        /href=(?:"|\{`)\/manners/,
      );
      expect(text, `${file}: canonical이 리다이렉트 원본을 가리킨다`).not.toMatch(
        /hanbang\.ai\/manners/,
      );
    }
  });

  // 카테고리 매핑이 없는 파트를 가리키면 카드가 죽은 링크를 만든다.
  it("maps every wedding category to a real part", () => {
    const slugs = new Set(MANNERS_PARTS.map((part) => part.slug));

    for (const key of MAPPED_MANNERS_CATEGORY_KEYS) {
      const part = mannersPartForCategory(key);
      expect(part, `카테고리 ${key}의 파트를 찾지 못했다`).not.toBeNull();
      expect(slugs).toContain(part?.slug);
    }
  });

  // 오타로 매핑이 조용히 꺼지는 것을 막는다.
  it("only maps category keys that actually exist", () => {
    const known = new Set(Object.keys(PLANNING_CATEGORY_LABELS));
    const unknown = MAPPED_MANNERS_CATEGORY_KEYS.filter((key) => !known.has(key));

    expect(unknown, `없는 카테고리 키: ${unknown.join(", ")}`).toEqual([]);
  });

  // 아직 파트가 없는 카테고리에 억지로 다른 파트를 붙이지 않는다.
  // 2026-08-19에 레거시 25편을 이관하면서 이 아홉 개가 채워졌다. 그 전에는 전부
  // null이었고 모달 하단이 "아모라에게 물어보기"로 떨어졌다.
  it("covers the nine categories that phase-1 could not", () => {
    for (const key of ["meeting", "ring", "hanbok", "yedan", "honeymoon", "houseware", "housing", "ham", "pyebaek"]) {
      expect(mannersPartForCategory(key), `${key}에 안내가 없다`).not.toBeNull();
    }
  });

  it("returns null instead of inventing a part", () => {
    expect(mannersPartForCategory(undefined)).toBeNull();
    expect(mannersPartForCategory("")).toBeNull();
    expect(mannersPartForCategory("nope")).toBeNull();
  });
});

/**
 * 2026-08-19 실측 사고: 「폐백 예절」을 다 읽고 버튼을 누르면 '한복' 체크리스트가 열렸다.
 * 한 파트를 여러 카테고리가 가리킬 때 호출부가 `categoryKeys[0]`을 쓰는데, 그 첫 번째가
 * 객체 리터럴 선언 순서였기 때문이다. 순서에 기대면 키를 한 줄 추가할 때 또 깨진다.
 */
describe("파트가 여는 체크리스트가 그 글의 주제와 맞는다", () => {
  const EXPECTED: Record<string, string> = {
    "traditional-greetings": "pyebaek",
    "gifts-and-traditions": "yedan",
    "wedding-day": "venue",
    "photo-manners": "studio",
  };

  it("다대일 매핑에서 대표 카테고리가 주제와 일치한다", () => {
    for (const [slug, expected] of Object.entries(EXPECTED)) {
      expect(categoryKeysForMannersPart(slug)[0], `${slug}의 대표 카테고리`).toBe(expected);
    }
  });

  it("대표를 지정해도 나머지 카테고리를 잃지 않는다", () => {
    expect(categoryKeysForMannersPart("traditional-greetings").sort()).toEqual(["hanbok", "pyebaek"]);
    expect(categoryKeysForMannersPart("wedding-day")).toHaveLength(5);
  });
});
