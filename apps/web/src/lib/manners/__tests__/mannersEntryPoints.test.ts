// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";

import { WEDDING_APP_ROUTES } from "../../../../weddingAppRoutes";
import { MANNERS_PARTS } from "../data";
import { MAPPED_MANNERS_CATEGORY_KEYS, mannersPartForCategory } from "../categoryMap";

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

  it("keeps a sidebar entry into the guide", () => {
    const sidebar = source("src/components/app/Sidebar.tsx");

    expect(sidebar).toContain('legacyPath: "/manners"');
    expect(sidebar).toContain('label: "예절 가이드"');
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
