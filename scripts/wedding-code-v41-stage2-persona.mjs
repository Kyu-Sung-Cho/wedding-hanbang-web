#!/usr/bin/env node
/**
 * 웨딩코드 4.1 단계 2(서로 짐작하기, 결과 전 글자 고르기)를 실제 브라우저로 걷는 페르소나 점검.
 *
 * 개발 서버(기본 http://localhost:4750)를 켜지도 끄지도 않는다. 읽기만 하는 점검이라 앱 코드, 저장소, 운영 값을 바꾸지 않는다.
 * 모든 요청을 지켜본다: GET 이 아닌 요청, 같은 출처 밖으로 가는 요청, 주소에 ga=/gb= 나 짐작 글자열이 실린 요청이 하나라도 있으면 실패다.
 * 기준은 저장소의 JS 기준 계산기(scripts/lib/wedding-code-v40-ref.mjs, wedding-code-v41-guess-ref.mjs)와 원천 JSON(docs/wedding-code/2026-10-01_v41_guess_set.json)이고
 * 화면 구현(TypeScript)의 코드는 한 줄도 가져오지 않는다.
 *
 * 쓰는 법:
 *   node scripts/wedding-code-v41-stage2-persona.mjs [--base=http://localhost:4750] [--widths=390,320] [--only=solo,couple,links,escape,storage] [--out=<dir>]
 *   Chrome 은 CHROME_PATH, 설치된 Chrome, Playwright 가 내려받은 Chromium 순으로 찾는다.
 *
 * 흐름(폭마다 한 번):
 *   solo    혼자: 글자 고르기 화면, 두 번 누름 막기, 결과의 「먼저 고른 글자와 나란히」, 보내는 사람 카드와 여섯 장면, 링크 내용, 빼기
 *   couple  두 사람: A 가 짐작이 든 링크를 보내고 B 가 받는 사람 흐름을 걷고 두 사람 결과를 보고 두 사람 링크를 돌려보내고 C 가 연다. 옛 링크와 한쪽만 한 링크도 본다
 *   links   바꿔치기한 링크(한 글자, 잘림, 중복, a 없음, 쿼리, 위조 등)는 통째로 거절되고 정상 링크는 열린다
 *   escape  탈출구 단추만 눌러 끝까지 가도 막다른 길이 없다
 *   storage 자동 저장을 끄거나 저장이 막혔을 때 글자 고르기를 저장한다고 말하거나 저장하지 않는다
 * 실패가 하나라도 있으면 종료 코드 1, 점검을 돌리지 못하면 2.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as ref from "./lib/wedding-code-v40-ref.mjs";
import * as gref from "./lib/wedding-code-v41-guess-ref.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const GUESS_SET = JSON.parse(readFileSync(path.join(ROOT, "docs/wedding-code/2026-10-01_v41_guess_set.json"), "utf8"));

// ---------------------------------------------------------------------------------------------
// 인자와 바깥 틀
// ---------------------------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);
const BASE = (args.base ?? "http://localhost:4750").replace(/\/+$/, "");
const WIDTHS = (args.widths ?? "390,320").split(",").map(Number);
const ONLY = new Set((args.only ?? "solo,couple,links,escape,storage").split(","));
const OUT = path.resolve(args.out ?? path.join(process.cwd(), "test-results/wedding-code-v41-stage2"));
mkdirSync(OUT, { recursive: true });
const SIZES = { 390: { width: 390, height: 844 }, 320: { width: 320, height: 568 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const LETTER_KEY = "hanbang:wedding-code:v4:letter-guess";

const problems = [];
const notes = [];
let currentTag = "";
const fail = (msg) => problems.push(`[${currentTag}] ${msg}`);
const note = (msg) => notes.push(`[${currentTag}] ${msg}`);
const check = (cond, msg) => {
  if (!cond) fail(msg);
  return !!cond;
};

function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  const candidates = [
    fromEnv,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const hit = candidates.find((c) => existsSync(c));
  if (hit) return hit;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"), process.env.HOME && path.join(process.env.HOME, ".cache/ms-playwright")].filter((r) => r && existsSync(r));
  for (const root of roots) {
    const dirs = readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const d of dirs) {
      const exe = [path.join(root, d, "chrome-win64/chrome.exe"), path.join(root, d, "chrome-win/chrome.exe"), path.join(root, d, "chrome-linux/chrome"), path.join(root, d, "chrome-mac/Chromium.app/Contents/MacOS/Chromium")].find(existsSync);
      if (exe) return exe;
    }
  }
  throw new Error("Chrome 을 찾지 못했어요. CHROME_PATH 에 실행 파일 경로를 주세요.");
}

let browser = null;

/** 문맥 하나(저장소가 따로)와 요청 기록. 같은 출처의 GET 만 통과시키고 나머지는 막아서 기록한다. */
async function newActor(name, width, { blockStorage = false } = {}) {
  const size = SIZES[width] ?? { width, height: width <= 340 ? 568 : 844 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, locale: "ko-KR" });
  const log = [];
  const violations = [];
  const baseHost = new URL(BASE).host;
  await ctx.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    let host = "";
    try {
      host = new URL(url).host;
    } catch {}
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    log.push({ method, url, nav: req.isNavigationRequest(), post: req.postData() });
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      violations.push(`GET 이 아닌 요청 ${method} ${url.slice(0, 100)}`);
      return route.abort();
    }
    if (host !== baseHost) {
      violations.push(`다른 호스트로 가는 요청 ${host}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  await page.addInitScript(() => {
    const orig = Math.random;
    window.__forceFormBit = null;
    Math.random = function () {
      if (window.__forceFormBit !== null && window.__forceFormBit !== undefined) {
        const v = window.__forceFormBit;
        window.__forceFormBit = null;
        return v;
      }
      return orig.call(Math);
    };
    try {
      Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, "canShare", { value: undefined, configurable: true });
    } catch {}
  });
  if (blockStorage) {
    await page.addInitScript(() => {
      const deny = () => {
        throw new DOMException("이 사이트의 저장소가 막혀 있어요", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", { get: deny, configurable: true });
      Object.defineProperty(window, "sessionStorage", { get: deny, configurable: true });
    });
  }
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  return { name, ctx, page, log, violations, errors, width };
}

/** 요청 기록 점검. codes 는 요청에 실려서는 안 되는 글자열(짐작 8자, 답 70자). ignoreNavUrl 은 사용자가 주소창에 직접 넣은 주소(쿼리 링크)라 서버로 가는 것이 정상이다. */
function requestCheck(actor, codes = [], ignoreNavUrl = null) {
  for (const v of actor.violations) fail(`${actor.name}: ${v}`);
  for (const r of actor.log) {
    if (ignoreNavUrl && r.nav && r.url.split("#")[0] === ignoreNavUrl.split("#")[0]) continue;
    const noHash = r.url.split("#")[0];
    if (/[?&](ga|gb)=/.test(noHash)) fail(`${actor.name}: 요청 주소에 ga=/gb= ${noHash.slice(0, 100)}`);
    const hay = `${noHash} ${r.post ?? ""}`;
    for (const c of codes) if (c && hay.includes(c)) fail(`${actor.name}: 요청에 글자열이 실림 ${c.slice(0, 12)}…`);
  }
  for (const e of actor.errors) fail(`${actor.name}: ${e}`);
}

const shot = async (actor, label) => {
  try {
    await actor.page.screenshot({ path: path.join(OUT, `${currentTag}-${label}.png`.replace(/[<>:"|?*]/g, "_")) });
  } catch {}
};

// ---------------------------------------------------------------------------------------------
// 질문 걷기(화면의 data-item 이 문항 id 라서 기준 계산기의 응답자가 정한 화면 답을 그대로 누른다)
// ---------------------------------------------------------------------------------------------
const bank = ref.makeBank(ref.loadBankData());

/** 은행 문항의 글(6자 이상)을 모은다. 긴 것부터 지워야 짧은 조각이 긴 문장을 쪼개지 않는다. */
const BANK_STRINGS = (() => {
  const out = new Set();
  const walkValue = (v) => {
    if (typeof v === "string") {
      if (v.length >= 6) out.add(norm(v));
    } else if (Array.isArray(v)) v.forEach(walkValue);
    else if (v && typeof v === "object") Object.values(v).forEach(walkValue);
  };
  bank.items.forEach(walkValue);
  return [...out].sort((a, b) => b.length - a.length);
})();

const SETTLED = (ax) => ax.letter !== null && !ax.provisional && (ax.shownBand === "clear" || ax.shownBand === "lean");

function respondentFor(formBit, wanted) {
  for (let seed = 1; seed < 4000; seed += 1) {
    const r = ref.randomRespondent(bank, seed, { mode: "persona", formBit, skipRate: wanted === "gaps" ? 0.25 : 0, naRate: wanted === "gaps" ? 0.2 : 0 });
    if (r.formBit !== formBit) continue;
    const stored = {};
    let ok = true;
    for (const item of bank.items) {
      const view = r.views[item.id];
      const s = view ? ref.viewToStored(item, formBit, view) : null;
      if (s === null) {
        ok = false;
        break;
      }
      stored[item.id] = s;
    }
    if (!ok) continue;
    const built = ref.buildResult(bank, formBit, stored);
    const settled = built.axes.filter(SETTLED).length;
    const undetermined = built.axes.filter((a) => a.letter === null).length;
    if (built.code === null) continue;
    if (wanted === "settled" && settled >= 3 && built.axes.every((a) => a.letter !== null)) return { seed, formBit, views: r.views, stored, built };
    if (wanted === "gaps" && settled >= 1 && undetermined >= 1) return { seed, formBit, views: r.views, stored, built };
  }
  throw new Error(`응답자를 찾지 못함(${wanted}, 폼 비트 ${formBit})`);
}

async function screenKind(page) {
  return page.evaluate(() => document.querySelector("[data-wedding-code-v40] [data-screen]")?.getAttribute("data-screen") ?? null);
}

async function screenKey(page) {
  return page.evaluate(() => {
    const s = document.querySelector("[data-wedding-code-v40] [data-screen]");
    if (!s) return "none";
    const kind = s.getAttribute("data-screen");
    const pageKey = s.getAttribute("data-page-key") || s.getAttribute("data-rest-after") || "";
    const items = [...s.querySelectorAll("[data-item]")].map((e) => e.getAttribute("data-item"));
    return `${kind}|${pageKey}|${items.join(",")}`;
  });
}

async function waitKeyChange(page, prev, timeout = 20000) {
  await page.waitForFunction(
    (k) => {
      const s = document.querySelector("[data-wedding-code-v40] [data-screen]");
      if (!s) return false;
      const kind = s.getAttribute("data-screen");
      const pageKey = s.getAttribute("data-page-key") || s.getAttribute("data-rest-after") || "";
      const items = [...s.querySelectorAll("[data-item]")].map((e) => e.getAttribute("data-item"));
      return `${kind}|${pageKey}|${items.join(",")}` !== k;
    },
    prev,
    { timeout },
  );
}

async function applyView(root, item, view) {
  if (view.fmt === "escape") {
    await root.getByRole("button", { name: view.which === "unsure" ? "잘 모르겠어요" : "제 상황과 안 맞아요", exact: true }).click();
    return;
  }
  switch (item.fmt) {
    case "pair":
    case "self":
    case "react":
      await root.getByRole("radio").nth(view.cell).click();
      return;
    case "recall":
    case "instant":
      await root.getByRole("radio").nth(view.option).click();
      return;
    case "bestworst":
      await root.locator('[data-group="best"] label').nth(view.best).click();
      await root.locator('[data-group="worst"] label').nth(view.worst).click();
      return;
    case "split": {
      const lis = root.locator("[data-split] > ul > li");
      for (let i = 0; i < view.counts.length; i += 1) for (let n = 0; n < view.counts[i]; n += 1) await lis.nth(i).locator('[data-step="add"]').click();
      return;
    }
    default:
      throw new Error(`알 수 없는 형식 ${item.fmt}`);
  }
}

const END_KINDS = new Set(["result", "couple", "gate", "no-compare", "broken-link", "boundary", "receiver", "intro", "letter-guess", "pair-guess"]);

/** 시작 단추를 누르고 질문을 끝까지 걷는다. 멈춘 화면 이름(letter-guess, result, couple 등)을 돌려준다. */
async function walk(actor, resp, { receiver = false, autosaveOff = false } = {}) {
  const page = actor.page;
  const startName = receiver ? "나도 답해 보기" : "시작하기";
  const start = page.getByRole("button", { name: startName, exact: true });
  await start.waitFor({ timeout: 120000 });
  await sleep(500);
  if (autosaveOff && !receiver) {
    await page.getByRole("button", { name: "자동 저장 끄기", exact: true }).click();
    await page.waitForSelector('[data-autosave="off"]', { timeout: 5000 }).catch(() => fail(`${actor.name}: 자동 저장 끄기 뒤 상태가 바뀌지 않음`));
  }
  await page.evaluate((v) => {
    window.__forceFormBit = v === 0 ? 0.25 : 0.75;
  }, resp.formBit);
  await start.click();
  for (let guard = 0; guard < 400; guard += 1) {
    const kind = await screenKind(page);
    if (kind === null || kind === "loading") {
      await sleep(150);
      continue;
    }
    if (END_KINDS.has(kind)) {
      if ((kind === "intro" || kind === "receiver") && guard < 40) {
        await sleep(150);
        continue;
      }
      return kind;
    }
    const key = await screenKey(page);
    if (kind === "rest" || kind === "self-intro") {
      await page.getByRole("button", { name: "이어서 하기", exact: true }).click();
      await waitKeyChange(page, key);
      continue;
    }
    if (kind !== "questions") throw new Error(`예상하지 못한 화면 ${kind}`);
    const edit = await page.evaluate(() => document.querySelector("[data-screen] [data-edit-mode]")?.getAttribute("data-edit-mode") ?? null);
    if (edit === "skipped") {
      await page.getByRole("button", { name: /^(그대로 결과 보기|다시 보기 마치기)$/ }).first().click();
      await waitKeyChange(page, key);
      continue;
    }
    const ids = await page.evaluate(() => [...document.querySelectorAll("[data-screen] [data-item]")].map((e) => e.getAttribute("data-item")));
    for (const id of ids) {
      const item = bank.byId.get(id);
      const view = resp.views[id];
      if (!item || !view) throw new Error(`응답자에 ${id} 가 없음`);
      await applyView(page.locator(`[data-item="${id}"]`), item, view);
    }
    await sleep(380); // 넘어온 직후 두 번 눌림을 거르는 300밀리초를 넘긴다
    await page.getByRole("button", { name: /^(다음|결과 보기)$/ }).click();
    await waitKeyChange(page, key);
  }
  throw new Error("질문 걷기가 끝나지 않음");
}

// ---------------------------------------------------------------------------------------------
// 화면 읽기와 조작
// ---------------------------------------------------------------------------------------------
const mainText = (page) => page.locator("[data-wedding-code-v40]").innerText().then(norm);

const BANNED = [
  [/[—–]/g, "줄표"],
  [/[-~]/g, "하이픈/물결표"],
  [/당신은/g, "당신은"],
  [/이 기기/g, "이 기기"],
  [/속마음|무의식|본모습|모순|일관성|진짜/g, "금지 낱말"],
  [/맞혔|틀렸|정답|오답|점수|등급|%/g, "맞힘/점수 표현"],
  [/(합니다|입니다|습니다)[.\s]/g, "합쇼체"],
  [/(몇|여러)\s*(가지|개|번|곳|장면)/g, "개수 말"],
];

/** 새 화면 글 점검(숫자는 새 단계 화면에서만 막는다. 받는 사람 화면의 기존 문장에는 문항 수가 있다). */
async function screenCheck(actor, label, { digits = true } = {}) {
  const page = actor.page;
  const s = await page.evaluate(() => {
    const el = document.querySelector("[data-wedding-code-v40] [data-screen]");
    return { screen: el?.getAttribute("data-screen"), text: (el?.innerText ?? "").replace(/\s+/g, " ").trim(), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  });
  if (s.scrollW > s.clientW + 1) fail(`${label}: 가로로 넘침 ${s.scrollW} > ${s.clientW}`);
  // 장면 글(장면 이름, 상황 글, 카드 글)은 자료라서 앱 문구 규칙에서 뺀다. 화면의 나머지 글만 본다.
  let ownText = s.text;
  for (const it of GUESS_SET.items) for (const piece of [it.caption, it.stem, ...it.cards.flatMap((c) => [c.act, c.cost])]) ownText = ownText.split(piece).join(" ");
  // 문항 은행의 글(사용자가 고른 답으로 두 사람 결과에 인용된다)도 앱 문구가 아니라 자료라서 뺀다.
  for (const piece of BANK_STRINGS) ownText = ownText.split(piece).join(" ");
  for (const [re, name] of BANNED) {
    const m = ownText.match(re);
    if (m) fail(`${label}: 금지 표현 ${name} ${JSON.stringify([...new Set(m)].slice(0, 3))}`);
  }
  if (digits && /\d/.test(s.text)) fail(`${label}: 화면 글에 숫자 ${JSON.stringify([...new Set(s.text.match(/\d+/g))].slice(0, 4))}`);
  const dc = (s.text.match(/검증을 마친 심리검사가 아니/g) ?? []).length;
  if (dc > 1) fail(`${label}: 고지가 ${dc}번`);
  if ((s.screen === "letter-guess" || s.screen === "pair-guess") && dc > 0) fail(`${label}: 새 단계 화면에 고지가 있음`);
  return s;
}

const LETTER = { V: "조건 먼저", S: "장면 먼저", W: "같이 하기", D: "나눠 하기", U: "둘이 정하기", F: "가족과 정하기", H: "마음 먼저", A: "할 일 먼저" };
const PAIRS = [["V", "S"], ["W", "D"], ["U", "F"], ["H", "A"]];
const AXES = ["money", "process", "scope", "support"];
const SUBJECT = { money: "돈은", process: "준비는", scope: "함께 정할 때는", support: "지쳤을 때는" };

async function lgRead(page) {
  return page.evaluate(() => {
    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const root = document.querySelector('[data-screen="letter-guess"]');
    if (!root) return null;
    return {
      title: norm(root.querySelector("h1,h2")?.textContent),
      h1: root.querySelectorAll("h1").length,
      storageMode: root.querySelector("[data-letter-guess-storage]")?.getAttribute("data-letter-guess-storage"),
      storageNote: norm(root.querySelector("[data-letter-guess-storage]")?.textContent),
      axes: [...root.querySelectorAll("[data-letter-guess-axis]")].map((a) => [...a.querySelectorAll('[role="radio"]')].map((r) => ({ text: norm(r.textContent), checked: r.getAttribute("aria-checked") === "true" }))),
      text: norm(root.innerText),
    };
  });
}

/** picks: 주제 순서로 글자 | "none" | null. */
async function lgPick(page, picks) {
  const r = await lgRead(page);
  for (let i = 0; i < 4; i += 1) {
    const want = picks[i];
    if (!want) continue;
    const idx = want === "none" ? 2 : r.axes[i].findIndex((x) => x.text.startsWith(`${want} `));
    if (idx < 0) {
      fail(`글자 ${want} 카드가 ${AXES[i]} 에 없음`);
      continue;
    }
    await page.locator(`[data-screen="letter-guess"] [data-letter-guess-axis="${AXES[i]}"]`).getByRole("radio").nth(idx).click();
  }
  await sleep(250);
}

function expectedLetterLines(built, picks) {
  const chosen = picks.some((p) => p && p !== "none");
  if (!chosen) return { kind: "none", lines: [] };
  const lines = [];
  let settledPicked = 0;
  built.axes.forEach((ax, i) => {
    const pick = picks[i];
    if (!pick || pick === "none" || !SETTLED(ax)) return;
    settledPicked += 1;
    if (pick !== ax.letter) lines.push(`${SUBJECT[AXES[i]]} 「${pick} ${LETTER[pick]}」를 먼저 골랐고, 답을 모아 보니 「${ax.letter} ${LETTER[ax.letter]}」 쪽으로 답했어요.`);
  });
  if (settledPicked === 0) return { kind: "unsettledOnly", lines: [] };
  return lines.length ? { kind: "lines", lines } : { kind: "same", lines: [] };
}

async function readResult(page) {
  return page.evaluate(() => {
    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const letter = document.querySelector('[data-result-section="letter-guess"]');
    const entry = document.querySelector('[data-section-card="pair-guess-entry"]');
    const guess = document.querySelector('[data-part="guess"]');
    const closed = document.querySelector('[data-letter-guess="closed-card"]');
    return {
      screen: document.querySelector("[data-wedding-code-v40] [data-screen]")?.getAttribute("data-screen") ?? null,
      order: [...document.querySelectorAll("[data-result-section]")].map((e) => e.getAttribute("data-result-section")),
      letter: letter ? { kind: letter.querySelector("[data-letter-guess-kind]")?.getAttribute("data-letter-guess-kind"), lines: [...letter.querySelectorAll("li")].map((li) => norm(li.textContent)), closing: norm(letter.querySelector("[data-letter-guess-closing]")?.textContent) } : null,
      entry: entry ? { text: norm(entry.innerText), buttons: [...entry.querySelectorAll("button")].map((b) => b.getAttribute("data-entry")) } : null,
      guess: guess ? { empty: !!guess.querySelector("[data-guess-empty]"), scenes: [...guess.querySelectorAll("li[data-scene]")].map((li) => ({ id: li.getAttribute("data-scene"), caption: norm(li.querySelector("p")?.textContent), rows: [...li.querySelectorAll("dt,dd")].map((e) => norm(e.textContent)) })), source: norm(guess.querySelector("[data-guess-source]")?.textContent), unlisted: norm(guess.querySelector("[data-guess-unlisted]")?.textContent), toggle: guess.querySelector("[data-guess-toggle]")?.getAttribute("aria-expanded") ?? null, bodyPresent: !!guess.querySelector("[data-guess-body]"), review: guess.getAttribute("data-review") } : null,
      closed: closed ? { open: closed.getAttribute("data-letter-guess-open"), body: !!closed.querySelector("[data-letter-guess-body]"), text: norm(closed.innerText) } : null,
    };
  });
}

// ---- 짐작 세트 조작 -----------------------------------------------------------------------
const PG = '[data-screen="pair-guess"]';
const pgScene = (page) =>
  page.evaluate(() => {
    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const root = document.querySelector('[data-screen="pair-guess"]');
    if (!root) return null;
    const q = (k) => {
      const el = root.querySelector(`[data-question="${k}"]`);
      return el
        ? { radios: [...el.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute("aria-checked") === "true"), escapes: [...el.querySelectorAll("button[data-escape]")].map((b) => ({ kind: b.getAttribute("data-escape"), pressed: b.getAttribute("aria-pressed") === "true" })), status: norm(el.querySelector(":scope > [role='status']")?.textContent) }
        : null;
    };
    return { step: root.getAttribute("data-step"), scene: root.getAttribute("data-scene"), text: norm(root.innerText), self: q("self"), guess: q("guess"), nav: [...root.querySelectorAll("[data-nav]")].map((b) => ({ nav: b.getAttribute("data-nav"), text: norm(b.textContent), cls: b.className })) };
  });
const pgNav = (page, nav) => page.locator(`${PG} [data-nav="${nav}"]`).first().click();
const pgCard = (page, kind, idx) => page.locator(`${PG} [data-question="${kind}"]`).getByRole("radio").nth(idx).click();
const pgEscape = (page, kind) => page.locator(`${PG} button[data-escape="${kind}"]`).click();
const pgWaitScene = (page, id) => page.waitForFunction((x) => document.querySelector('[data-screen="pair-guess"]')?.getAttribute("data-scene") === x, id, { timeout: 8000 }).catch(() => fail(`장면 ${id} 로 못 감`));

/** 시작 화면에서 시작을 누르고 계획대로 장면 여섯을 걸어 마치기까지 누른다. plan[i] = { self: 0|1|"notmine"|"skip", guess: 0|1|"unsure"|null } (화면 위치 기준). */
async function pgPlay(page, plan) {
  await sleep(450);
  await pgNav(page, "start");
  await pgWaitScene(page, GUESS_SET.items[0].id);
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i];
    if (p.self === "notmine" || p.self === "skip") await pgEscape(page, p.self);
    else if (p.self === 0 || p.self === 1) await pgCard(page, "self", p.self);
    if (p.guess !== undefined && p.guess !== null) {
      await sleep(100);
      if (p.guess === "unsure") await pgEscape(page, "unsure");
      else await pgCard(page, "guess", p.guess);
    }
    await sleep(150);
    await pgNav(page, "next");
    if (i < plan.length - 1) await pgWaitScene(page, GUESS_SET.items[i + 1].id);
    await sleep(200);
  }
  await sleep(900);
}

const cardOfPos = (fb, pos) => (fb === 1 ? 1 - pos : pos);
const answersOf = (fb, plan) => ({
  set: "1",
  slots: plan.map((p) => ({ self: p.self === 0 || p.self === 1 ? cardOfPos(fb, p.self) : null, guess: (p.self === 0 || p.self === 1) && (p.guess === 0 || p.guess === 1) ? cardOfPos(fb, p.guess) : null })),
});

async function sendLink(page, section, option = null) {
  if (option) await section.getByRole("radio", { name: option }).check();
  const boxes = section.getByRole("checkbox");
  for (let i = 0; i < (await boxes.count()); i += 1) await boxes.nth(i).check();
  await section.getByRole("button", { name: "링크 보내기", exact: true }).click();
  await page.waitForFunction(() => /링크를 복사했어요|아래 주소를 선택해서/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  let link = null;
  try {
    link = ((await page.evaluate(() => navigator.clipboard.readText())).match(/https?:\/\/\S+/) ?? [null])[0];
  } catch {}
  if (!link) {
    const field = section.locator("input[readonly]").first();
    if (await field.count()) link = await field.inputValue();
  }
  return link;
}

const hashOf = (link) => {
  const hash = link.slice(link.indexOf("#"));
  const parts = Object.fromEntries(hash.replace(/^#/, "").split("&").map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
  return { hash, ...parts };
};

// ---- 두 사람 결과의 기대 -------------------------------------------------------------------
function expectedScenes(firstAns, secondAns, perspective) {
  const cmp = gref.compareGuesses(firstAns, secondAns);
  if (cmp.kind !== "both") return { kind: cmp.kind, scenes: [] };
  const rows = GUESS_SET.resultBlock.rows;
  const formOf = (d) => (perspective === null ? d : (perspective === "first") === (d === "firstGuessedSecond") ? "meGuessedPartner" : "partnerGuessedMe");
  const order = perspective === "second" ? ["secondGuessedFirst", "firstGuessedSecond"] : ["firstGuessedSecond", "secondGuessedFirst"];
  return {
    kind: "both",
    scenes: cmp.scenes.map((sc) => {
      const item = GUESS_SET.items[sc.index];
      const r = [];
      for (const dir of order) {
        const d = sc.diffs.find((x) => x.direction === dir);
        if (!d) continue;
        const labels = rows[formOf(dir)];
        r.push(labels.actualLabel, item.cards[d.actual].act, labels.guessLabel, item.cards[d.guessed].act);
      }
      return { id: item.id, caption: item.caption, rows: r };
    }),
  };
}

function checkGuessSection(rs, exp, label) {
  const g = rs.guess;
  if (exp.kind !== "both") {
    check(g === null, `${label}: 구역이 없어야 하는데 있음(${exp.kind})`);
    return;
  }
  if (!check(g !== null, `${label}: 짐작과 답 구역이 없음`)) return;
  if (exp.scenes.length === 0) return void check(g.empty, `${label}: 빈 상태 한 줄이 아님`);
  check(JSON.stringify(g.scenes.map((s) => s.id)) === JSON.stringify(exp.scenes.map((s) => s.id)), `${label}: 장면 목록 기대 ${exp.scenes.map((s) => s.id)} / 화면 ${g.scenes.map((s) => s.id)}`);
  exp.scenes.forEach((es, i) => {
    const gs = g.scenes[i];
    if (!gs) return;
    check(gs.caption === es.caption, `${label}: 장면 이름 ${gs.caption} / ${es.caption}`);
    check(JSON.stringify(gs.rows) === JSON.stringify(es.rows), `${label}: 장면 ${es.id} 행 기대 ${JSON.stringify(es.rows)} / 화면 ${JSON.stringify(gs.rows)}`);
  });
  check(g.source.includes("링크에 담긴 답을 그대로 옮겼어요"), `${label}: 출처 문장 「${g.source}」`);
  // 여섯 장면이 모두 줄로 놓였으면 「여기에 없는 장면」 한 줄은 가리킬 것이 없어 그리지 않는다. 일부만 놓였으면 그 한 줄이 있다.
  if (exp.scenes.length === GUESS_SET.items.length) check(!g.unlisted, `${label}: 여섯 장면이 모두 놓였는데 줄 없는 장면 한 줄이 있음 「${g.unlisted}」`);
  else check(g.unlisted.includes("여기에 없는 장면은"), `${label}: 줄 없는 장면 한 줄 「${g.unlisted}」`);
  check(g.toggle === "true" && g.review === "pending", `${label}: 가리기 토글/검토 표시 ${g.toggle} ${g.review}`);
}

async function perspective(page, re) {
  const fs = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: "나 기준으로 보기" }) });
  await fs.locator("label", { hasText: re }).click();
  await sleep(400);
}

// ---------------------------------------------------------------------------------------------
// 흐름들
// ---------------------------------------------------------------------------------------------
const PLAN_A = [{ self: 0, guess: 1 }, { self: 1, guess: 0 }, { self: "notmine" }, { self: 0, guess: "unsure" }, { self: 1, guess: 1 }, { self: "skip" }];
const PLAN_B = [{ self: 1, guess: 1 }, { self: 0, guess: 1 }, { self: 0, guess: 1 }, { self: 1, guess: 0 }, { self: 0, guess: 1 }, { self: 1, guess: 1 }];

/** 보내는 사람 한 명이 짐작이 든 링크를 만든다. 다른 흐름의 재료. */
async function makeSender(width, fb = 1) {
  const resp = respondentFor(fb, "settled");
  const A = await newActor(`보내는 사람 재료(폭 ${width})`, width);
  const out = { resp, ok: false };
  try {
    await A.page.goto(`${BASE}/wedding-code?v=v4.0-tendency`, { waitUntil: "load", timeout: 180000 });
    const kind = await walk(A, resp);
    if (kind !== "letter-guess") throw new Error(`글자 고르기가 안 열림(${kind})`);
    await sleep(450);
    await A.page.getByRole("button", { name: "고르지 않고 결과 보기", exact: true }).click();
    await sleep(900);
    await A.page.locator('[data-entry="start"]').click();
    await A.page.waitForSelector(PG);
    await pgPlay(A.page, PLAN_A);
    const link = await sendLink(A.page, A.page.locator('[data-result-section="send"]'));
    if (!link) throw new Error("링크를 못 얻음");
    const parts = hashOf(link);
    Object.assign(out, { ok: true, link, hash: parts.hash, a70: parts.a, ga: parts.ga, ans: answersOf(fb, PLAN_A) });
    check(parts.ga === gref.encodeGuessCode(out.ans), `보내는 사람 링크의 ga 기대 ${gref.encodeGuessCode(out.ans)} / ${parts.ga}`);
    requestCheck(A, [parts.ga, parts.a]);
  } catch (e) {
    fail(`보내는 사람 재료 예외: ${String(e).slice(0, 300)}`);
  }
  await A.ctx.close();
  return out;
}

async function flowSolo(width) {
  currentTag = `solo-${width}`;
  for (const fb of [0, 1]) {
    currentTag = `solo-${width}-fb${fb}`;
    const resp = respondentFor(fb, "settled");
    const a = await newActor(`혼자(폭 ${width}, 폼 비트 ${fb})`, width);
    try {
      await a.page.goto(`${BASE}/wedding-code?v=v4.0-tendency`, { waitUntil: "load", timeout: 180000 });
      const kind = await walk(a, resp);
      if (!check(kind === "letter-guess", `글자 고르기 화면이 아님(${kind})`)) throw new Error("no stage");
      await sleep(500);
      const lg = await lgRead(a.page);
      check(lg.h1 === 1 && lg.axes.length === 4 && lg.axes.every((ax) => ax.length === 3 && ax.every((x) => !x.checked)), `글자 고르기 화면 모양 ${JSON.stringify({ h1: lg.h1, axes: lg.axes.map((x) => x.length) })}`);
      lg.axes.forEach((ax, i) => check(ax[0].text[0] === PAIRS[i][fb], `${AXES[i]}: 폼 비트 ${fb} 인데 맨 위 카드가 ${ax[0].text[0]}`));
      check(!/짐작/.test(lg.text) && !/검증을 마친/.test(lg.text), "글자 고르기 화면에 「짐작」 낱말이나 고지가 있음");
      check(lg.storageMode === "on" && /이 브라우저에만 남아요/.test(lg.storageNote), `저장 안내 ${lg.storageMode} 「${lg.storageNote}」`);
      await screenCheck(a, "글자 고르기 화면");
      await shot(a, "letter-guess");
      // 두 번 누름: 이전으로 가서 같은 자리를 두 번 눌러도 글자 고르기 화면이 넘어가지 않는다
      for (const delay of [60, 200]) {
        await a.page.getByRole("button", { name: "이전", exact: true }).click();
        await sleep(700);
        const box = await a.page.getByRole("button", { name: /^(다음|결과 보기)$/ }).boundingBox();
        await a.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(delay);
        await a.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(900);
        check((await screenKind(a.page)) === "letter-guess", `두 번 누름(${delay}ms)에 글자 고르기를 넘김`);
      }
      await sleep(500);
      // 설정된 주제 중 하나는 반대 글자, 하나는 같은 글자, 하나는 고르지 않음, 하나는 잘 모르겠어요
      const settled = resp.built.axes.map((ax, i) => (SETTLED(ax) ? i : -1)).filter((i) => i >= 0);
      const picks = [null, null, null, null];
      picks[settled[0]] = PAIRS[settled[0]].find((l) => l !== resp.built.axes[settled[0]].letter);
      picks[settled[1]] = resp.built.axes[settled[1]].letter;
      const rest = [0, 1, 2, 3].filter((i) => !settled.slice(0, 2).includes(i));
      picks[rest[0]] = "none";
      await lgPick(a.page, picks);
      await a.page.getByRole("button", { name: "결과 보기", exact: true }).click();
      await sleep(1100);
      let rs = await readResult(a.page);
      check(rs.screen === "result", `결과 보기 뒤 화면 ${rs.screen}`);
      const exp = expectedLetterLines(resp.built, picks);
      if (check(rs.letter !== null && rs.letter.kind === exp.kind, `먼저 고른 글자 구역 기대 ${exp.kind} / ${rs.letter?.kind}`) && exp.kind === "lines") {
        check(JSON.stringify(rs.letter.lines) === JSON.stringify(exp.lines), `줄 기대 ${JSON.stringify(exp.lines)} / ${JSON.stringify(rs.letter.lines)}`);
      }
      check(rs.letter?.closing.includes("다른 날에는 다르게"), "끝 줄에 다른 날 한계가 없음");
      check(rs.order.indexOf("collected") < rs.order.indexOf("letter-guess") && rs.order.indexOf("letter-guess") < rs.order.indexOf("axis"), `구역 위치 ${rs.order.join(",")}`);
      const dump = await a.page.evaluate((k) => ({ raw: localStorage.getItem(k), session: Object.keys(sessionStorage).length, cookie: document.cookie }), LETTER_KEY);
      const wire = picks.map((p) => (p && p !== "none" ? p : "-")).join("");
      if (check(typeof dump.raw === "string", "글자 고르기 보관본이 없음(자동 저장 켬)")) {
        const env = JSON.parse(dump.raw);
        check(Object.keys(env).sort().join() === "formBit,guess,savedAt,schema,version" && env.guess === wire && env.formBit === fb, `봉투가 기대와 다름 ${dump.raw}`);
      }
      check(dump.session === 0 && dump.cookie === "", "sessionStorage 나 쿠키에 값이 있음");
      await shot(a, "result-letter-lines");

      // 보내는 사람: 카드 → 여섯 장면 → 링크 → 빼기
      check(rs.entry !== null && /해 볼게요/.test(rs.entry.text) && /이 브라우저에는 저장하지 않아요/.test(rs.entry.text), "짐작 카드가 없거나 본문이 다름");
      await a.page.locator('[data-entry="start"]').click();
      await a.page.waitForSelector(PG);
      let sc = await pgScene(a.page);
      check(sc.step === "start" && /링크에만 들어가고/.test(sc.text) && !/저장/.test(sc.text), `시작 화면 ${sc.text.slice(0, 60)}`);
      await screenCheck(a, "짐작 시작 화면");
      await sleep(450);
      await pgNav(a.page, "leave");
      await sleep(800);
      rs = await readResult(a.page);
      check(rs.entry && /해 볼게요/.test(rs.entry.text), "건너뛴 뒤 카드가 처음 상태가 아님");
      await a.page.locator('[data-entry="start"]').click();
      await a.page.waitForSelector(PG);
      await sleep(450);
      await pgNav(a.page, "start");
      await pgWaitScene(a.page, GUESS_SET.items[0].id);
      sc = await pgScene(a.page);
      check(sc.self.radios.every((x) => !x) && sc.guess === null, "다시 열었더니 고른 것이 남음");
      const act0 = GUESS_SET.items[0].cards[0].act;
      const topIsFirst = (await a.page.locator(`${PG} [data-question="self"] [role="radio"]`).first().innerText()).includes(act0);
      check(topIsFirst === (fb === 0), `장면 카드 위아래가 폼 비트 ${fb} 와 맞지 않음`);
      for (let i = 0; i < 6; i += 1) {
        const s = await pgScene(a.page);
        check(s.scene === GUESS_SET.items[i].id, `장면 ${i + 1} id ${s.scene}`);
        check(s.nav.find((n) => n.nav === "next").text === (i === 5 ? "마치기" : "다음"), `장면 ${i + 1} 다음 단추 이름`);
        await screenCheck(a, `짐작 장면 ${i + 1}`);
        const p = PLAN_A[i];
        if (i === 2) {
          // 카드와 짐작을 고른 뒤 내 답을 탈출구로 바꾸면 짐작이 버려지고 물음이 사라진다
          await pgCard(a.page, "self", 0);
          await pgCard(a.page, "guess", 1);
          await pgEscape(a.page, "notmine");
          await sleep(250);
          const after = await pgScene(a.page);
          check(after.guess === null && after.self.escapes.find((e) => e.kind === "notmine").pressed && after.self.status === "제 상황과 맞지 않아서 넘어갔어요.", `내 답을 탈출구로 바꾸면 짐작이 버려져야 함 ${JSON.stringify(after.self.status)}`);
        } else if (p.self === "skip") {
          await pgEscape(a.page, "skip");
          await sleep(200);
          check((await pgScene(a.page)).self.status === "이 장면은 넘어갔어요.", "지금은 넘어갈게요 상태 줄");
        } else {
          await pgCard(a.page, "self", p.self);
          await sleep(150);
          check((await pgScene(a.page)).guess !== null, `장면 ${i + 1}: 내 답을 골랐는데 짐작 물음이 안 나옴`);
          if (p.guess === "unsure") await pgEscape(a.page, "unsure");
          else await pgCard(a.page, "guess", p.guess);
          await sleep(200);
        }
        if (i === 1) {
          await pgNav(a.page, "previous");
          await pgWaitScene(a.page, GUESS_SET.items[0].id);
          const prev = await pgScene(a.page);
          check(prev.self.radios[0] && prev.guess?.radios[1], "이전으로 장면 1 에 돌아갔더니 고른 것이 안 남음");
          await pgNav(a.page, "next");
          await pgWaitScene(a.page, GUESS_SET.items[1].id);
        }
        if (i < 5) {
          await pgNav(a.page, "next");
          await pgWaitScene(a.page, GUESS_SET.items[i + 1].id);
          await sleep(150);
        }
      }
      await pgNav(a.page, "next");
      await sleep(1200);
      rs = await readResult(a.page);
      check(rs.screen === "result" && /내 답과 함께 보내기/.test(rs.entry?.text ?? "") && rs.entry.buttons.includes("edit") && rs.entry.buttons.includes("remove"), `마친 뒤 카드 ${rs.entry?.text.slice(0, 60)}`);
      const send = a.page.locator('[data-result-section="send"]');
      await send.scrollIntoViewIfNeeded();
      const sendText = norm(await send.innerText());
      check(/서로 짐작해 보며 고른 내 답과 내가 한 짐작도 이 링크에 들어가요/.test(sendText), "보내기 구역에 짐작 안내가 없음");
      await send.getByRole("radio", { name: /질문만 보내기/ }).check();
      check(!/서로 짐작해 보며 고른 내 답과/.test(norm(await send.innerText())), "질문만 보내기인데 짐작 안내가 남음");
      await send.getByRole("radio", { name: /내 답과 함께 보내기/ }).check();
      const link = await sendLink(a.page, send);
      if (check(!!link, "링크를 못 얻음")) {
        const parts = hashOf(link);
        const expAns = answersOf(fb, PLAN_A);
        const dec = gref.parseGuessedShareHash(bank, parts.hash);
        check(/^#v=v4\.0-tendency&a=[^&]{70}&ga=[^&]{8}$/.test(parts.hash), "링크 모양");
        check(dec.kind === "partner" && JSON.stringify(dec.firstGuess) === JSON.stringify(expAns), `링크 안 짐작이 화면에서 고른 것과 다름 ${JSON.stringify(dec.firstGuess?.slots)}`);
        check(dec.first && bank.items.every((it) => dec.first.responses[it.id] === resp.stored[it.id]), "링크의 답이 내 답과 다름");
        check((await a.page.evaluate(() => location.hash)) === "", "보낸 뒤 주소 칸에 # 뒤가 있음");
        a.codes = [parts.ga, parts.a];
      }
      await send.getByRole("radio", { name: /질문만 보내기/ }).check();
      const only = await sendLink(a.page, send);
      check(!!only && !only.includes("#"), `질문만 보내기 링크 ${only}`);
      await a.page.locator('[data-entry="remove"]').scrollIntoViewIfNeeded();
      await a.page.locator('[data-entry="remove"]').click();
      await sleep(500);
      rs = await readResult(a.page);
      check(rs.entry && /이제부터 만드는 링크에서 짐작을 뺐어요/.test(rs.entry.text), "빼기 뒤 한 줄이 없음");
      const send2 = a.page.locator('[data-result-section="send"]');
      check((await send2.locator("input[readonly]").count()) === 0 && !(await send2.getByRole("checkbox").isChecked()), "빼기 뒤 보내기 구역이 새로 그려지지 않음(옛 주소 칸/체크)");
      const link3 = await sendLink(a.page, send2);
      check(!!link3 && !/ga=/.test(link3) && hashOf(link3).hash === `#v=v4.0-tendency&a=${hashOf(link).a}`, "짐작을 뺀 링크가 옛 링크와 바이트로 같지 않음");
      requestCheck(a, a.codes ?? []);
    } catch (e) {
      fail(`예외: ${String(e && e.stack ? e.stack : e).slice(0, 400)}`);
    }
    await a.ctx.close();
  }
}

async function flowCouple(width) {
  currentTag = `couple-${width}`;
  const FB_A = 1;
  const FB_B = 0;
  const sender = await makeSender(width, FB_A);
  if (!sender.ok) return;
  const respB = respondentFor(FB_B, "settled");
  const ansA = sender.ans;
  const ansB = answersOf(FB_B, PLAN_B);
  const gbB = gref.encodeGuessCode(ansB);
  const codes = [sender.ga, gbB, sender.a70];
  let bothHash = null;

  // ---- B: 받는 사람
  const B = await newActor(`받는 사람 B(폭 ${width})`, width);
  try {
    await B.page.goto(`${BASE}/wedding-code${sender.hash}`, { waitUntil: "load", timeout: 180000 });
    await B.page.getByRole("button", { name: "나도 답해 보기", exact: true }).waitFor({ timeout: 120000 });
    await sleep(500);
    const html = await B.page.content();
    const text = await mainText(B.page);
    check(await B.page.locator("[data-receive-guess-note]").count(), "받는 사람 화면에 짐작 안내 한 줄이 없음");
    check(!html.includes(sender.ga) && !html.includes(sender.a70), "받는 사람 화면 문서에 상대의 글자열이 있음");
    for (const it of GUESS_SET.items) for (const c of it.cards) check(!text.includes(c.act.slice(0, 14)), `받는 사람 화면에 장면 카드 글이 보임 ${c.act.slice(0, 14)}`);
    check((await B.page.evaluate(() => location.hash)) === "", "받는 사람 화면에서 주소의 # 뒤가 안 지워짐");
    await screenCheck(B, "받는 사람 화면", { digits: false });
    await shot(B, "receiver");
    check((await walk(B, respB, { receiver: true })) === "letter-guess", "받는 사람도 글자 고르기가 열려야 함");
    await sleep(500);
    check(await B.page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), "글자 고르기 화면에서 나가기 경고가 없음");
    const picksB = [null, null, null, null];
    const settledB = respB.built.axes.map((ax, i) => (SETTLED(ax) ? i : -1)).filter((i) => i >= 0);
    picksB[settledB[0]] = PAIRS[settledB[0]].find((l) => l !== respB.built.axes[settledB[0]].letter);
    await lgPick(B.page, picksB);
    await B.page.getByRole("button", { name: "결과 보기", exact: true }).click();
    await B.page.waitForSelector(PG);
    const sc = await pgScene(B.page);
    check(sc.step === "start" && /상대가 보낸 링크에 이어 나도 같은 장면에서/.test(sc.text), "받는 사람용 안내가 아님");
    const cls = Object.fromEntries(sc.nav.map((n) => [n.nav, n.cls]));
    check(cls.start === cls.leave, "받는 사람 첫 화면의 두 단추 무게가 다름(같은 무게여야 함)");
    await screenCheck(B, "짐작 시작 화면(받는 사람)");
    await pgPlay(B.page, PLAN_B);
    await sleep(500);
    check((await screenKind(B.page)) === "couple", `두 사람 결과가 아님(${await screenKind(B.page)})`);
    check((await B.page.evaluate(() => location.hash)) === "", "결과 화면에서 # 뒤가 남음");
    let rs = await readResult(B.page);
    checkGuessSection(rs, expectedScenes(ansA, ansB, "second"), "B 두 사람 결과(나=나중에 답한 사람)");
    await screenCheck(B, "B 두 사람 결과", { digits: false });
    await shot(B, "couple");
    await perspective(B.page, /링크를 먼저 보낸 사람이 나예요/);
    checkGuessSection(await readResult(B.page), expectedScenes(ansA, ansB, "first"), "B 나 기준(먼저)");
    await perspective(B.page, /링크를 받은 사람이 나예요/);
    // 가리기, Escape, 화면 숨김
    const toggle = B.page.locator('[data-part="guess"] [data-guess-toggle]');
    await toggle.click();
    await sleep(250);
    check((await B.page.locator("[data-guess-body]").count()) === 0, "가리기가 DOM 에서 내용을 빼지 않음");
    await toggle.click();
    await toggle.focus();
    await B.page.keyboard.press("Escape");
    await sleep(250);
    check((await B.page.locator("[data-guess-body]").count()) === 0, "Escape 로 안 닫힘");
    await toggle.click();
    await B.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(250);
    check((await B.page.locator("[data-guess-body]").count()) === 0, "화면이 숨겨져도 안 닫힘");
    await B.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // 닫힌 카드
    rs = await readResult(B.page);
    if (check(rs.closed !== null && rs.closed.open === "false" && !rs.closed.body, `먼저 고른 글자 카드가 닫혀 있지 않음 ${JSON.stringify(rs.closed)?.slice(0, 80)}`)) {
      check(!/먼저 골랐고/.test(await B.page.content()), "열기 전에 먼저 고른 글자 줄이 DOM 에 있음");
      await B.page.getByRole("button", { name: "먼저 고른 글자와 나란히 보기", exact: true }).click();
      await sleep(250);
      const opened = (await readResult(B.page)).closed;
      const expLines = expectedLetterLines(respB.built, picksB).lines;
      check(opened.open === "true" && expLines.every((l) => opened.text.includes(l)), `열린 카드 ${opened.text.slice(0, 100)}`);
      await B.page.keyboard.press("Escape");
      await sleep(250);
      check((await readResult(B.page)).closed.open === "false", "Escape 로 카드가 안 닫힘");
    }
    // 두 사람 링크
    const region = B.page.getByRole("region", { name: "이 결과를 상대에게도 보내기" });
    await region.scrollIntoViewIfNeeded();
    check(/서로 짐작해 보며 고른 두 사람의 답과 짐작도 링크를 가진 사람은 그대로 읽을 수 있어요/.test(norm(await region.innerText())), "두 사람 링크 보내기에 짐작 안내가 없음");
    const link = await sendLink(B.page, region);
    if (check(!!link, "두 사람 링크를 못 얻음")) {
      bothHash = hashOf(link).hash;
      const want = `#v=v4.0-tendency&a=${sender.a70}&ga=${sender.ga}&b=${ref.encodeCode(bank, FB_B, respB.stored)}&gb=${gbB}`;
      check(bothHash === want, `두 사람 링크가 기대와 다름 ${bothHash.replace(/[ab]=[^&]{70}/g, "x=<70>")}`);
      check(bothHash.length - 1 <= 185, `해시 길이 ${bothHash.length - 1}`);
    }
    requestCheck(B, codes);
  } catch (e) {
    fail(`B 예외: ${String(e && e.stack ? e.stack : e).slice(0, 400)}`);
  }
  await B.ctx.close();

  // ---- C: 세 번째 문맥이 두 사람 링크를 연다
  if (bothHash) {
    const C = await newActor(`제3자 C(폭 ${width})`, width);
    try {
      await C.page.goto(`${BASE}/wedding-code${bothHash}`, { waitUntil: "load", timeout: 180000 });
      await C.page.waitForSelector('[data-screen="couple"]', { timeout: 90000 });
      await sleep(700);
      let rs = await readResult(C.page);
      checkGuessSection(rs, expectedScenes(ansA, ansB, null), "C 두 사람 결과(나 정하지 않음)");
      check(rs.closed === null && rs.letter === null, "두 사람 링크를 열었는데 먼저 고른 글자 카드가 있음");
      check(!(await C.page.content()).includes(sender.ga), "ga 글자열이 문서에 있음");
      const keys = await C.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hanbang")));
      check(keys.length === 0, `두 사람 링크만 열었는데 저장소에 씀 ${keys}`);
      await perspective(C.page, /링크를 먼저 보낸 사람이 나예요/);
      checkGuessSection(await readResult(C.page), expectedScenes(ansA, ansB, "first"), "C 나 기준(먼저)");
      requestCheck(C, codes);
    } catch (e) {
      fail(`C 예외: ${String(e).slice(0, 300)}`);
    }
    await C.ctx.close();
  }

  // ---- 옛 링크(ga 없음)와 한쪽만 한 링크
  for (const variant of ["old", "skip"]) {
    const R = await newActor(`${variant === "old" ? "옛 링크" : "한쪽만"}(폭 ${width})`, width);
    try {
      const hash = variant === "old" ? `#v=v4.0-tendency&a=${sender.a70}` : sender.hash;
      await R.page.goto(`${BASE}/wedding-code${hash}`, { waitUntil: "load", timeout: 180000 });
      await R.page.getByRole("button", { name: "나도 답해 보기", exact: true }).waitFor({ timeout: 120000 });
      if (variant === "old") check((await R.page.locator("[data-receive-guess-note]").count()) === 0, "옛 링크인데 짐작 안내가 있음");
      const kind = await walk(R, respB, { receiver: true });
      check(kind === "letter-guess", `글자 고르기가 열려야 함(${kind})`);
      await sleep(500);
      await R.page.getByRole("button", { name: "고르지 않고 결과 보기", exact: true }).click();
      if (variant === "skip") {
        await R.page.waitForSelector(PG);
        await sleep(450);
        await pgNav(R.page, "leave");
      }
      await sleep(1300);
      check((await screenKind(R.page)) === "couple", `두 사람 결과가 아님(${await screenKind(R.page)}; 옛 링크에서 짐작 화면이 열림)`);
      const rs = await readResult(R.page);
      check(rs.guess === null, "구역이 그려짐(없어야 함)");
      const region = R.page.getByRole("region", { name: "이 결과를 상대에게도 보내기" });
      await region.scrollIntoViewIfNeeded();
      const link = await sendLink(R.page, region);
      if (check(!!link, "링크를 못 얻음")) {
        const h = hashOf(link).hash;
        const bCode = ref.encodeCode(bank, FB_B, respB.stored);
        if (variant === "old") {
          check(h === `#v=v4.0-tendency&a=${sender.a70}&b=${bCode}`, "옛 링크 응답의 두 사람 링크가 바이트로 같지 않음");
          check(ref.buildShareUrl(bank, BASE, { formBit: FB_A, responses: sender.resp.stored }, { formBit: FB_B, responses: respB.stored }) === link, "기준 계산기의 두 사람 링크와 다름");
        } else {
          const dec = gref.parseGuessedShareHash(bank, h);
          check(dec.kind === "both" && JSON.stringify(dec.firstGuess) === JSON.stringify(ansA) && dec.secondGuess === null, "건너뛴 사람의 gb 가 링크에 실렸거나 ga 가 빠짐");
        }
      }
      requestCheck(R, codes);
    } catch (e) {
      fail(`${variant} 예외: ${String(e).slice(0, 300)}`);
    }
    await R.ctx.close();
  }
}

async function flowLinks(width) {
  currentTag = `links-${width}`;
  const sender = await makeSender(width, 1);
  if (!sender.ok) return;
  const { a70, ga } = sender;
  const respB = respondentFor(0, "settled");
  const b70 = ref.encodeCode(bank, 0, respB.stored);
  const gb = gref.encodeGuessCode(answersOf(0, PLAN_B));
  const flip = (s, i) => s.slice(0, i) + (s[i] === "0" ? "1" : "0") + s.slice(i + 1);
  const cases = [
    ["ga 한 글자 바꿈", `#v=v4.0-tendency&a=${a70}&ga=${flip(ga, 3)}`, "reject"],
    ["ga 잘림 7자", `#v=v4.0-tendency&a=${a70}&ga=${ga.slice(0, 7)}`, "reject"],
    ["ga 중복", `#v=v4.0-tendency&a=${a70}&ga=${ga}&ga=${ga}`, "reject"],
    ["a 없이 ga", `#v=v4.0-tendency&ga=${ga}`, "reject"],
    ["ga 쿼리", `?v=v4.0-tendency&ga=${ga}`, "reject"],
    ["전부 없음 위조(검사 글자 맞음)", `#v=v4.0-tendency&a=${a70}&ga=1888888y`, "reject"],
    ["범위 밖 위조(검사 글자 맞음)", `#v=v4.0-tendency&a=${a70}&ga=1948056d`, "reject"],
    ["다른 세트 글자 위조", `#v=v4.0-tendency&a=${a70}&ga=2148056X`, "reject"],
    ["b 없이 gb", `#v=v4.0-tendency&a=${a70}&gb=${gb}`, "reject"],
    ["두 사람 gb 바꿈", `#v=v4.0-tendency&a=${a70}&ga=${ga}&b=${b70}&gb=${flip(gb, 2)}`, "reject"],
    ["순서만 바꾼 정상 링크", `#v=v4.0-tendency&ga=${ga}&a=${a70}`, "accept"],
    ["정상 링크", `#v=v4.0-tendency&a=${a70}&ga=${ga}`, "accept"],
  ];
  for (const [name, tail, expect] of cases) {
    const T = await newActor(`링크(${name})`, width);
    try {
      const target = `/wedding-code${tail}`;
      await T.page.goto(`${BASE}${target}`, { waitUntil: "load", timeout: 180000 });
      await T.page.waitForSelector("[data-wedding-code-v40] [data-screen], main", { timeout: 60000 }).catch(() => {});
      await sleep(900);
      const kind = await screenKind(T.page);
      const href = await T.page.evaluate(() => location.href);
      const accepted = kind === "receiver" || kind === "couple";
      if (expect === "reject") {
        check(!accepted, `${name}: 바꿔친 링크가 받아들여짐(${kind})`);
        check(!/ga=|gb=/.test(href) && !href.includes(a70.slice(0, 20)), `${name}: 거절한 뒤 주소에 흔적이 남음 ${href.slice(0, 90)}`);
        const keys = await T.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hanbang")));
        check(keys.length === 0, `${name}: 거절한 링크가 저장소에 씀`);
      } else {
        check(accepted && !(await T.page.content()).includes(ga), `${name}: 정상 링크가 열리지 않거나 ga 가 문서에 남음(${kind})`);
      }
      requestCheck(T, [ga, gb, a70], tail.startsWith("?") ? `${BASE}${target}` : null);
    } catch (e) {
      fail(`${name} 예외: ${String(e).slice(0, 200)}`);
    }
    await T.ctx.close();
  }
}

async function flowEscape(width) {
  currentTag = `escape-${width}`;
  // 예식 없는 사람, 부모님이 안 계신 사람: 글자는 잘 모르겠어요만, 장면은 탈출구만
  const resp = respondentFor(0, "settled");
  const a = await newActor(`탈출구만(폭 ${width})`, width);
  try {
    await a.page.goto(`${BASE}/wedding-code?v=v4.0-tendency`, { waitUntil: "load", timeout: 180000 });
    const kind = await walk(a, resp);
    if (!check(kind === "letter-guess", `글자 고르기 화면이 아님(${kind})`)) throw new Error("no stage");
    await sleep(500);
    await lgPick(a.page, ["none", "none", "none", "none"]);
    await a.page.getByRole("button", { name: "결과 보기", exact: true }).click();
    await sleep(1100);
    let rs = await readResult(a.page);
    check(rs.screen === "result" && rs.letter === null, "잘 모르겠어요만 눌렀는데 결과에 못 가거나 구역이 있음");
    check((await a.page.evaluate((k) => localStorage.getItem(k), LETTER_KEY)) === null, "고른 것이 없는데 보관본이 있음");
    await a.page.locator('[data-entry="start"]').click();
    await a.page.waitForSelector(PG);
    await sleep(450);
    await pgNav(a.page, "start");
    await pgWaitScene(a.page, GUESS_SET.items[0].id);
    for (let i = 0; i < 6; i += 1) {
      await pgEscape(a.page, i % 2 === 0 ? "notmine" : "skip");
      await sleep(200);
      const s = await pgScene(a.page);
      check(s.guess === null && s.nav.some((n) => n.nav === "next"), `장면 ${i + 1}: 탈출구만 눌렀는데 짐작 물음이 나오거나 다음 단추가 없음`);
      await pgNav(a.page, "next");
      if (i < 5) await pgWaitScene(a.page, GUESS_SET.items[i + 1].id);
      await sleep(200);
    }
    await sleep(900);
    rs = await readResult(a.page);
    check(rs.screen === "result" && rs.entry && /해 볼게요/.test(rs.entry.text), "탈출구만 누르고 마친 뒤 카드가 처음 상태가 아님");
    const link = await sendLink(a.page, a.page.locator('[data-result-section="send"]'));
    check(!!link && !/ga=/.test(link), "탈출구만 눌렀는데 링크에 ga 가 있음");
    requestCheck(a);
  } catch (e) {
    fail(`예외: ${String(e).slice(0, 300)}`);
  }
  await a.ctx.close();

  // 재혼하는 사람(받는 사람): 짐작 안내를 받고 탈출구만 눌러 두 사람 결과까지
  const sender = await makeSender(width, 1);
  if (!sender.ok) return;
  const respB = respondentFor(0, "settled");
  const B = await newActor(`탈출구만 받는 사람(폭 ${width})`, width);
  try {
    await B.page.goto(`${BASE}/wedding-code${sender.hash}`, { waitUntil: "load", timeout: 180000 });
    await B.page.getByRole("button", { name: "나도 답해 보기", exact: true }).waitFor({ timeout: 120000 });
    check((await walk(B, respB, { receiver: true })) === "letter-guess", "글자 고르기가 안 열림");
    await sleep(500);
    await B.page.getByRole("button", { name: "고르지 않고 결과 보기", exact: true }).click();
    await B.page.waitForSelector(PG);
    await sleep(450);
    await pgNav(B.page, "start");
    await pgWaitScene(B.page, GUESS_SET.items[0].id);
    for (let i = 0; i < 6; i += 1) {
      await pgEscape(B.page, i % 2 === 0 ? "skip" : "notmine");
      await sleep(150);
      await pgNav(B.page, "next");
      if (i < 5) await pgWaitScene(B.page, GUESS_SET.items[i + 1].id);
      await sleep(150);
    }
    await sleep(1200);
    check((await screenKind(B.page)) === "couple", `탈출구만 눌러 두 사람 결과에 못 감(${await screenKind(B.page)})`);
    check((await readResult(B.page)).guess === null, "탈출구만 눌렀는데 짐작과 답 구역이 있음");
    requestCheck(B, [sender.ga, sender.a70]);
  } catch (e) {
    fail(`받는 사람 예외: ${String(e).slice(0, 300)}`);
  }
  await B.ctx.close();
}

async function flowStorage(width) {
  currentTag = `storage-${width}`;
  for (const mode of ["off", "blocked"]) {
    const resp = respondentFor(0, "settled");
    const a = await newActor(`저장 ${mode}(폭 ${width})`, width, { blockStorage: mode === "blocked" });
    try {
      await a.page.goto(`${BASE}/wedding-code?v=v4.0-tendency`, { waitUntil: "load", timeout: 180000 });
      const kind = await walk(a, resp, { autosaveOff: mode === "off" });
      if (!check(kind === "letter-guess", `글자 고르기 화면이 아님(${kind})`)) throw new Error("no stage");
      await sleep(500);
      const lg = await lgRead(a.page);
      const want = mode === "off" ? /자동 저장을 꺼 두어서 고른 글자는 저장하지 않아요/ : /이 브라우저가 저장을 막고 있어서 고른 글자는 저장하지 않아요/;
      check(lg.storageMode === mode && want.test(lg.storageNote), `저장 안내가 ${mode} 상태를 말하지 않음 ${lg.storageMode} 「${lg.storageNote}」`);
      check(!/남아요|저장돼요/.test(lg.storageNote), "저장하지 않는다면서 남는다고 말함");
      const settled = resp.built.axes.map((ax, i) => (SETTLED(ax) ? i : -1)).filter((i) => i >= 0);
      const picks = [null, null, null, null];
      picks[settled[0]] = PAIRS[settled[0]].find((l) => l !== resp.built.axes[settled[0]].letter);
      await lgPick(a.page, picks);
      await a.page.getByRole("button", { name: "결과 보기", exact: true }).click();
      await sleep(1100);
      check((await readResult(a.page)).letter?.kind === "lines", "저장하지 않아도 이번 화면에는 줄이 나와야 함(메모리)");
      if (mode === "off") {
        const keys = await a.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hanbang")));
        check(!keys.some((k) => /letter-guess|progress/.test(k)), `자동 저장이 꺼져 있는데 저장함 ${keys}`);
      }
      await a.page.goto(`${BASE}/wedding-code?v=v4.0-tendency`, { waitUntil: "load", timeout: 120000 });
      await a.page.getByRole("button", { name: /^(시작하기|이어서 하기)$/ }).first().waitFor({ timeout: 60000 });
      check((await a.page.getByRole("button", { name: "이어서 하기", exact: true }).count()) === 0, "새로고침 뒤 이어서 하기가 있음");
      requestCheck(a);
    } catch (e) {
      fail(`${mode} 예외: ${String(e).slice(0, 300)}`);
    }
    await a.ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const executablePath = findChrome();
  try {
    const res = await fetch(`${BASE}/wedding-code?v=v4.0-tendency`, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`개발 서버가 응답하지 않아요(${BASE}): ${String(e).slice(0, 120)}. 서버를 켜거나 끄지 않고 여기서 멈춰요.`);
    process.exit(2);
  }
  browser = await chromium.launch({ executablePath, headless: true });
  const started = Date.now();
  try {
    for (const width of WIDTHS) {
      if (ONLY.has("solo")) await flowSolo(width);
      if (ONLY.has("couple")) await flowCouple(width);
      if (ONLY.has("links")) await flowLinks(width);
      if (ONLY.has("escape")) await flowEscape(width);
      if (ONLY.has("storage")) await flowStorage(width);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(OUT, "stage2-persona.json"), JSON.stringify({ base: BASE, widths: WIDTHS, only: [...ONLY], durationMs: Date.now() - started, problems, notes }, null, 2));
  console.log(JSON.stringify({ base: BASE, widths: WIDTHS, problems: problems.length, durationMs: Date.now() - started, out: OUT }, null, 1));
  for (const p of problems) console.log("PROBLEM:", p);
  for (const n of notes) console.log("note:", n);
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error("점검을 돌리지 못했어요:", e);
  process.exit(2);
});
