// 앱이 여는 웹 경로는 실제로 열려야 한다.
//
// 2026-07-27 실측으로 죽은 링크 4곳을 찾았다. 전부 웹에서 라우트를 지우거나 만들지
// 않은 채 앱에 링크만 남은 경우다.
//   - `/etiquette`   — 2026-07-26에 페이지를 지웠는데 프로필 "예절 가이드"가 웹뷰로 열었다
//   - `/support` ×3  — 대상 페이지가 없다. 하필 실패 복구 경로("연결 상태를 확인하지
//                      못했어요 … 문의해 주세요")에 있어 막힌 사용자가 404를 봤다
//   - `/licenses`    — 대상 페이지가 없다
//
// 웹의 `publicEtiquetteSafety` 가드는 apps/web만 훑어 앱을 보지 못했다. 여기서 방향을
// 뒤집어, **앱이 가리키는 모든 웹 경로**를 웹 라우트와 대조한다. 웹에서 페이지를 지우면
// 이 테스트가 앱의 링크를 짚어 준다.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_APP_DIR = resolve(REPO_ROOT, "apps", "web", "src", "app");
const MOBILE_DIR = resolve(REPO_ROOT, "apps", "mobile");

const ROUTE_FILES = ["page.tsx", "page.ts", "route.ts", "route.tsx"];

/** 웹에서 정적으로 열리는 URL 경로 전체. 라우트 그룹 `(...)`은 주소에 안 들어간다. */
function webRoutes() {
  const routes = new Set();
  const walk = (dir, urlPath) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { name } = entry;
      if (name.startsWith("_")) continue;
      const isGroup = name.startsWith("(") && name.endsWith(")");
      const nextUrl = isGroup ? urlPath : `${urlPath}/${name}`;
      const child = join(dir, name);
      if (ROUTE_FILES.some((file) => existsSync(join(child, file)))) routes.add(nextUrl || "/");
      walk(child, nextUrl);
    }
  };
  walk(WEB_APP_DIR, "");
  return routes;
}

/** next.config.ts의 redirect·rewrite source도 살아 있는 주소로 인정한다. */
function configuredSources() {
  const source = readFileSync(resolve(REPO_ROOT, "apps", "web", "next.config.ts"), "utf8");
  return new Set([...source.matchAll(/source:\s*[`"']([^`"']+)[`"']/g)].map((m) => m[1]));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function mobileSources() {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(resolve(MOBILE_DIR, "app"));
  walk(resolve(MOBILE_DIR, "src"));
  return files;
}

test("모바일이 여는 웹 경로가 모두 실재한다", () => {
  const routes = webRoutes();
  const sources = configuredSources();
  const dead = [];

  for (const file of mobileSources()) {
    const text = stripComments(readFileSync(file, "utf8"));
    const paths = new Set();
    // 하드코딩된 절대 URL
    for (const m of text.matchAll(/https:\/\/hanbang\.ai(\/[a-z0-9\-/]*)/gi)) paths.add(m[1]);
    // buildMobileSiteUrl("/x")
    for (const m of text.matchAll(/buildMobileSiteUrl\(\s*["'`](\/[a-z0-9\-/]*)["'`]/gi)) {
      paths.add(m[1]);
    }

    for (const raw of paths) {
      const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
      if (path.startsWith("/api/")) continue; // API 라우트는 별도 계약이 검사한다
      if (routes.has(path) || sources.has(path)) continue;
      dead.push(`${relative(MOBILE_DIR, file)} → ${path}`);
    }
  }

  assert.deepEqual(
    dead,
    [],
    `앱이 없는 웹 경로를 연다:\n  ${dead.join("\n  ")}\n`
      + "웹 페이지를 만들거나 앱 링크를 고칠 것 — 사용자는 404를 본다.",
  );
});
