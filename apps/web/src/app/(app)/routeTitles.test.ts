// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it, vi } from "vitest";

// 제목만 보는 시험이라 무거운 화면 컴포넌트는 불러오지 않는다.
vi.mock("@/components/app/amora-board/AmoraDecisionBoard", () => ({ default: () => null }));
vi.mock("@/components/app/amora-personal/AmoraPersonalActions", () => ({ default: () => null }));

/**
 * 로그인한 화면마다 자기 제목이 있다.
 *
 * ## 무엇이 있었나
 *
 * 루트 `layout.tsx` 의 제목 하나가 전부였고, (app) 쪽에서 덮는 곳은 `preparation-style` 뿐이었다.
 * 나머지 화면은 첫 줄이 `"use client"` 라 `metadata` 를 내보낼 수 없었고, 그 화면들의 layout 은
 * 자식만 돌려줬다. 그래서 탭과 방문 기록이 전부 같은 긴 문장이었다.
 *
 * 더 큰 문제는 화면낭독기다. Next 의 쪽 이동 안내는 제목이 **바뀔 때만** 읽어 준다. 제목이 늘
 * 같으면 사이드바로 예산에서 일정으로 옮겨도 아무 말도 하지 않는다(WCAG 2.4.2).
 *
 * ## 왜 layout 에 두나
 *
 * 클라이언트 페이지는 `metadata` 를 못 내보내므로, 서버 컴포넌트인 layout 이 대신 낸다.
 * 서버 페이지(`chat/board`, `chat/personal`)는 자기 파일에서 내고 위 layout 의 제목을 덮는다.
 *
 * 루트 제목 template 은 쓰지 않는다. 이미 `… | 웨딩한방` 을 통째로 적은 화면이 있어 접미사가 두 번 붙는다.
 */

const APP_DIR = resolve(__dirname);
const ROOT_LAYOUT = resolve(__dirname, "..", "layout.tsx");
const SUFFIX = " | 웨딩한방";

type TitleModule = { metadata: { title?: unknown } };

const SCREENS: Array<[string, string, () => Promise<TitleModule>]> = [
  ["budget/layout", "예산 | 웨딩한방", () => import("./budget/layout")],
  ["chat/layout", "아모라 | 웨딩한방", () => import("./chat/layout")],
  ["schedule/layout", "일정 | 웨딩한방", () => import("./schedule/layout")],
  ["checklist/layout", "웨딩 체크리스트 | 웨딩한방", () => import("./checklist/layout")],
  ["lounge/layout", "웨딩 라운지 | 웨딩한방", () => import("./lounge/layout")],
  ["bookings/layout", "예약 관리 | 웨딩한방", () => import("./bookings/layout")],
  ["money/layout", "축의금 관리 | 웨딩한방", () => import("./money/layout")],
  ["settings/layout", "설정 | 웨딩한방", () => import("./settings/layout")],
  ["settings/amora-style/layout", "아모라 도움 방식 | 웨딩한방", () => import("./settings/amora-style/layout")],
  ["settings/amora-memory/layout", "아모라가 기억하는 것 | 웨딩한방", () => import("./settings/amora-memory/layout")],
  ["chat/board/page", "결정 보드 | 웨딩한방", () => import("./chat/board/page")],
  ["chat/personal/page", "나만 보는 할 일 | 웨딩한방", () => import("./chat/personal/page")],
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)의 새 화면. 이름은 아티팩트 화면 제목 그대로다.
  ["journey/layout", "준비 순서 | 웨딩한방", () => import("./journey/layout")],
  ["halls/layout", "웨딩홀 비교 | 웨딩한방", () => import("./halls/layout")],
  ["halls/letter/layout", "보내기 전 확인 | 웨딩한방", () => import("./halls/letter/layout")],
  ["halls/consultation/layout", "답장과 상담 확정 | 웨딩한방", () => import("./halls/consultation/layout")],
];

function rootTitle(): string {
  const match = /^ {2}title: "([^"]+)",/m.exec(readFileSync(ROOT_LAYOUT, "utf8"));
  if (!match) throw new Error("루트 layout 에서 제목을 못 찾았다 — 이 시험의 정규식이 깨졌다");
  return match[1];
}

describe("로그인한 화면의 제목", () => {
  it.each(SCREENS)("%s 가 자기 이름을 제목으로 낸다", async (_name, expected, load) => {
    const { metadata } = await load();
    expect(metadata.title).toBe(expected);
  });

  it("제목이 서로 다르고 모두 접미사 하나만 가지며 루트 제목과도 다르다", async () => {
    const titles = await Promise.all(SCREENS.map(async ([, , load]) => (await load()).metadata.title));
    expect(titles.every((title): title is string => typeof title === "string")).toBe(true);
    const names = titles as string[];

    expect(new Set(names).size, "제목이 겹치면 화면낭독기가 화면을 옮겨도 아무 말 안 한다").toBe(names.length);
    for (const name of names) {
      expect(name.endsWith(SUFFIX), name).toBe(true);
      expect(name.split("웨딩한방").length - 1, `${name} 에 브랜드가 두 번 붙었다`).toBe(1);
      expect(name).not.toBe(rootTitle());
    }
  });
});

/** 열리지 않거나 곧바로 다른 화면으로 보내는 페이지. 제목을 낼 일이 없다. */
const NO_SCREEN: Record<string, (source: string) => boolean> = {
  "saved/page.tsx": (source) => source.includes("redirect("),
  "chat/missions/page.tsx": (source) => source.includes("redirect("),
  // `/wedding/dashboard` 는 next.config 가 라운지로 보낸다.
  "dashboard/page.tsx": () => readFileSync(resolve(APP_DIR, "..", "..", "..", "next.config.ts"), "utf8").includes("\"/wedding/dashboard\""),
};

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") pageFiles(full, out);
    } else if (entry.name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

/** 이 페이지 자신, 아니면 (app) 밑 가까운 상위 layout 이 `metadata` 를 내는지. */
function hasTitle(page: string): boolean {
  if (/export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)\b/.test(readFileSync(page, "utf8"))) return true;
  for (let dir = dirname(page); dir.length > APP_DIR.length; dir = dirname(dir)) {
    try {
      if (/export\s+const\s+metadata\b/.test(readFileSync(join(dir, "layout.tsx"), "utf8"))) return true;
    } catch {
      // 이 단계에는 layout 이 없다. 위 단계로 올라간다.
    }
  }
  return false;
}

describe("(app) 아래 모든 화면이 제목을 가진다", () => {
  const pages = pageFiles(APP_DIR).map((page) => relative(APP_DIR, page).split(sep).join("/"));

  it("스캔이 살아 있다 — 비면 아래 검사가 통째로 초록불이 된다", () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(pages).toContain("budget/page.tsx");
    expect(pages).toContain("settings/amora-memory/page.tsx");
  });

  it("열리지 않는 페이지로 빼 둔 것은 지금도 그렇다", () => {
    for (const [file, stillTrue] of Object.entries(NO_SCREEN)) {
      expect(pages, `${file} 가 없어졌다 — 이 예외를 지운다`).toContain(file);
      expect(stillTrue(readFileSync(join(APP_DIR, file), "utf8")), `${file} 가 더는 열리지 않는 페이지가 아니다`).toBe(true);
    }
  });

  it("나머지는 자기 파일이나 상위 layout 에 제목이 있다", () => {
    const missing = pages
      .filter((file) => !(file in NO_SCREEN))
      .filter((file) => !hasTitle(join(APP_DIR, file)));
    expect(missing, `제목이 없는 화면: ${missing.join(", ")}`).toEqual([]);
  });
});
