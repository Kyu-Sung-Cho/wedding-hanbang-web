#!/usr/bin/env node
/**
 * 화면을 전부 돌며 **눈으로 볼 것을 숫자로** 잰다.
 *
 *   node apps/web/scripts/audit-screens.mjs [--base http://localhost:3500] [--width 1280]
 *
 * 재는 것
 *   1. 색 언어 — 종이인가 옛 팔레트인가 (그려진 픽셀 기준)
 *   2. 대비 위반 — 합성된 실제 색으로, **화면에 진짜 보이는 글자만**
 *   3. 가로 넘침 · 너무 작은 글씨 · 작은 터치 표적
 *   4. 깨진 화면 — 빈 본문, 오류 경계
 *
 * ## 이 검사가 스스로를 못 믿게 만든 것들 (전부 실제로 당했다)
 *
 * - **숨은 복제 요소가 대신 답한다.** /price 에서 "흰 글자에 흰 바탕" 위반 5건이
 *   나왔는데 전부 화면 밖 모바일 메뉴 사본이었고, 보이는 쪽은 진한 색이었다.
 *   → `elementFromPoint` 로 **실제로 맨 위에 있는지** 확인한다.
 * - **엉뚱한 서버를 잰다.** 포트 3000 에 다른 워크트리의 dev 서버가 떠 있어서
 *   155개 파일을 고쳤는데 "아무것도 안 바뀌었다"는 결과가 나왔다.
 *   → 시작할 때 `--hb-*` 값을 찍어 **어느 코드를 재는지 먼저 보여 준다.**
 * - **헛초록불.** 위반이 0이면 검사가 꺼진 건지 진짜 0인지 알 수 없다.
 *   → 화면마다 확실한 위반을 심어 잡히는지 확인하고, 안 잡히면 그 화면 결과를 버린다.
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const BASE = argOf("--base", "http://localhost:3500").replace(/\/$/, "");
const WIDTH = Number(argOf("--width", "1280"));
const HEIGHT = Number(argOf("--height", WIDTH < 500 ? "844" : "900"));

/** 로그인 없이 볼 수 있는 화면. 로그인 뒤 화면은 별도 인증이 필요해 여기 없다. */
const ROUTES = [
  "/", "/landing", "/price", "/start-here", "/wedding-code", "/manners",
  "/community", "/community/quote-check", "/about", "/ai-policy",
  "/terms", "/privacy", "/login", "/beta", "/demo", "/today",
];

// 2026-09-16: 잉크가 따뜻해지고(#26251F→#3A2A27) 누를 수 있는 면이 모브로 갈렸다.
// 이 목록이 낡으면 감사기가 **현재 색을 구색이라고 말한다** — 실제로 그 상태였다.
const PAPER = ["#3A2A27","#5A4742","#6E5A54","#251A18","#8F6662","#7D5753","#A77B74","#FDFCF7","#F8F4EA","#FFFFFF","#E2DED2","#EDEAE0","#35638A","#24465F","#637465"];
const OLD = ["#36534E","#243832","#263832","#26251F","#4A483F","#605E54","#12110D","#795252","#FBF8F2","#F6EFE5","#E5D8CA","#EADFC9","#B5ADA3","#928980","#635B51","#504444","#1A1A1F","#6D806E","#2B423E","#5F5B52","#7D7166"];

/** 브라우저 안에서 도는 측정기. 문자열로 넘겨 평가한다. */
const PROBE = ([paperList, oldList]) => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const rgba = (css) => {
    if (cache.has(css)) return cache.get(css);
    ctx.clearRect(0,0,1,1); ctx.fillStyle = "#000"; ctx.fillStyle = css; ctx.fillRect(0,0,1,1);
    const d = ctx.getImageData(0,0,1,1).data;
    const v = [d[0],d[1],d[2],d[3]/255]; cache.set(css, v); return v;
  };
  const hexOf = (c) => "#" + c.slice(0,3).map((x) => x.toString(16).padStart(2,"0")).join("").toUpperCase();
  const over = (f,b) => [0,1,2].map((i) => Math.round(f[i]*f[3] + b[i]*(1-f[3])));
  const lum = (c) => { const s = c.map((v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2]; };
  const ratio = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  // ⚠️ 그라디언트를 빼면 **버튼이 투명한 것으로 읽힌다.**
  // 2026-08-28 실제로 그랬다 — `bg-gradient-to-br from-[#795252] ... text-white` 버튼을
  // "흰 글자에 크림 바탕 1.03:1" 이라고 보고했다. 그 버튼은 로즈 바탕이라 멀쩡했다.
  // `background-image` 의 첫 색 정지점을 대표값으로 쓴다(완벽하진 않지만 투명보다 훨씬 낫다).
  const gradientColor = (cs) => {
    const bi = cs.backgroundImage;
    if (!bi || bi === "none" || !/gradient/.test(bi)) return null;
    const m = bi.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
    return m ? rgba(m[1]) : null;
  };
  const bgOf = (el) => { const st=[]; let n=el; while(n&&n!==document.documentElement){st.push(n);n=n.parentElement;}
    let acc=[255,255,255];
    for(let i=st.length-1;i>=0;i--){
      const cs = getComputedStyle(st[i]);
      const c = rgba(cs.backgroundColor); if(c[3]>0) acc=over(c,acc);
      const g = gradientColor(cs); if(g && g[3]>0) acc=over(g,acc);
    }
    return acc; };

  // 화면 밖·가려진 복제 요소를 걸러 낸다. 이게 없으면 숨은 사본이 대신 답한다.
  const reallyVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cx = Math.min(Math.max(r.left + r.width/2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height/2, 1), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };

  const paper = new Set(paperList), old = new Set(oldList);
  const tally = { paper: 0, old: 0, other: 0 };
  const oldSeen = {};
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    for (const p of ["color","backgroundColor","borderTopColor"]) {
      const v = cs[p]; if (!v || v === "rgba(0, 0, 0, 0)") continue;
      const h = hexOf(rgba(v));
      if (paper.has(h)) tally.paper++;
      else if (old.has(h)) { tally.old++; oldSeen[h] = (oldSeen[h] ?? 0) + 1; }
      else tally.other++;
    }
  }

  const contrast = []; const seen = new Set();
  const tiny = []; const taps = [];
  let checkedText = 0;
  for (const el of document.querySelectorAll("p,li,span,a,button,h1,h2,h3,h4,small,td,th,dt,dd,label")) {
    const txt = (el.textContent ?? "").trim();
    if (!txt || txt.length < 3 || el.children.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (!reallyVisible(el)) continue;
    checkedText++;
    const fs = parseFloat(cs.fontSize);
    if (fs < 12) tiny.push({ px: fs, text: txt.slice(0,28) });
    const bg = bgOf(el); const fg = over(rgba(cs.color), bg);
    const cr = ratio(fg, bg);
    const bold = parseInt(cs.fontWeight) >= 700;
    const need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5;
    const key = cs.color + "|" + bg.join(",") + "|" + Math.round(fs);
    if (cr < need && !seen.has(key)) { seen.add(key);
      contrast.push({ ratio: +cr.toFixed(2), need, px: fs, fg: hexOf(fg), bg: hexOf(bg), text: txt.slice(0,28),
        cls: (el.className ?? "").toString().slice(0, 90),
        parentCls: (el.parentElement?.className ?? "").toString().slice(0, 90) }); }
  }
  for (const el of document.querySelectorAll("a,button,[role='button'],input,select")) {
    if (!reallyVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 40 || r.width < 24) {
      taps.push({ w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0,24) });
    }
  }

  // 자가 검증 — 확실한 위반을 심어 잡히는지 본다. 안 잡히면 이 화면 결과는 못 믿는다.
  const probe = document.createElement("p");
  probe.textContent = "대비 자가검증 문장";
  probe.style.cssText = "position:fixed;top:120px;left:80px;z-index:2147483647;color:#cfcfcf;background:#ffffff;font-size:14px;padding:6px";
  document.body.appendChild(probe);
  const pbg = bgOf(probe), pfg = over(rgba(getComputedStyle(probe).color), pbg);
  const selfTest = { ratio: +ratio(pfg, pbg).toFixed(2), visible: reallyVisible(probe) };
  probe.remove();

  const main = document.querySelector("main") ?? document.body;
  return {
    tally, oldSeen, contrast, tiny, taps, checkedText,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    bodyChars: (main.innerText ?? "").trim().length,
    selfTest,
  };
};

// playwright-core 는 브라우저를 안 들고 온다. 이미 받아 둔 것 중 하나를 쓴다.
// (`--chrome <경로>` 로 직접 줄 수도 있다.)
const CHROME_CANDIDATES = [
  argOf("--chrome", ""),
  process.env.PLAYWRIGHT_CHROME ?? "",
  "C:/Users/kcho1/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe",
  "C:/Users/kcho1/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const { existsSync } = await import("node:fs");
const executablePath = CHROME_CANDIDATES.find((c) => existsSync(c));
if (!executablePath) {
  console.error("  실행할 크롬을 못 찾았습니다. --chrome <경로> 로 지정하세요.");
  process.exit(1);
}
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

// 어느 코드를 재는지 먼저 못 박는다 — 엉뚱한 서버를 재고 결론 낸 적이 있다.
await page.goto(`${BASE}/landing`, { waitUntil: "domcontentloaded" }).catch(() => {});
const serving = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    primary: cs.getPropertyValue("--hb-primary").trim(),
    surfacePage: cs.getPropertyValue("--hb-surface-page").trim(),
  };
});
console.log(`  대상: ${BASE}  (${WIDTH}x${HEIGHT})`);
console.log(`  서버가 주는 값: --hb-primary=${serving.primary || "(없음)"} · --hb-surface-page=${serving.surfacePage || "(없음)"}`);
if (serving.primary.toUpperCase() !== "#8F6662") {
  console.log("  ⚠️ 기대(#8F6662)와 다르다 — 다른 워크트리의 서버를 재고 있을 수 있다.");
}
console.log("");
console.log("  화면                       종이   대비   작은글씨  작은버튼  넘침  본문");
console.log("  " + "-".repeat(72));

const rows = [];
for (const route of ROUTES) {
  let r;
  try {
    const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(600);
    r = await page.evaluate(PROBE, [PAPER, OLD]).catch(() => null);
    if (!r) throw new Error("측정 실패");
    r.status = res?.status() ?? 0;
  } catch (e) {
    console.log(`  ${route.padEnd(26)} 오류: ${String(e.message).slice(0, 40)}`);
    rows.push({ route, error: String(e.message) });
    continue;
  }
  const total = r.tally.paper + r.tally.old + r.tally.other || 1;
  const pct = Math.round(r.tally.paper * 100 / total);
  const trusted = r.selfTest.ratio < 4.5 && r.selfTest.visible;
  console.log(
    `  ${route.padEnd(26)} ${String(pct + "%").padStart(4)}  ${String(r.contrast.length).padStart(4)}  ${String(r.tiny.length).padStart(7)}  ${String(r.taps.length).padStart(7)}  ${(r.overflow ? "예" : "-").padStart(4)}  ${String(r.bodyChars).padStart(5)}${trusted ? "" : "  ⚠검사못믿음"}`,
  );
  rows.push({ route, pct, ...r, trusted });
}

console.log("");
const bad = rows.filter((r) => !r.error && r.contrast?.length);
if (bad.length) {
  console.log("  === 대비 위반 상세 ===");
  for (const r of bad) {
    for (const c of r.contrast.slice(0, 3)) {
      console.log(`    ${r.route}  ${c.ratio}:1 (필요 ${c.need}) ${c.px}px  ${c.fg} on ${c.bg}  "${c.text}"`);
      console.log(`        class: ${c.cls}`);
      if (c.parentCls) console.log(`        부모:  ${c.parentCls}`);
    }
  }
  console.log("");
}
const empty = rows.filter((r) => !r.error && r.bodyChars < 120);
if (empty.length) {
  console.log("  === 본문이 거의 빈 화면 ===");
  for (const r of empty) console.log(`    ${r.route}  ${r.bodyChars}자 (status ${r.status})`);
  console.log("");
}
const worst = rows.filter((r) => !r.error).sort((a, b) => a.pct - b.pct).slice(0, 5);
console.log("  === 종이 비율이 낮은 화면 ===");
for (const r of worst) {
  const top = Object.entries(r.oldSeen ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`    ${r.route.padEnd(26)} ${r.pct}%   남은 옛색: ${top.map(([c, n]) => `${c}×${n}`).join(" ") || "-"}`);
}

await browser.close();
