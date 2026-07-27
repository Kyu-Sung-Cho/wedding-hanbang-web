import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import { resolveChromeExecutablePath } from "./resolve-chrome-executable.mjs";
import { isAllowedWeddingCodeResearchRequest } from "./wedding-code-research-safety.mjs";

const baseUrl = process.env.WEDDING_CODE_RESEARCH_URL ??
  "http://127.0.0.1:3106/internal/wedding-code-research?form=A";
const outputRoot = path.resolve(
  process.env.WEDDING_CODE_QA_OUTPUT ?? path.join(process.cwd(), "test-results/wedding-code-candidate6")
);
const executablePath = resolveChromeExecutablePath();

const viewports = [
  {
    name: "320",
    width: 320,
    height: 568,
    form: "A",
    supportOrder: "ES_FIRST",
    applicabilityLabel: "아니요, 둘이 정하기로 했어요",
    expectedJourneyLength: 19,
  },
  {
    name: "390",
    width: 390,
    height: 844,
    form: "B",
    supportOrder: "AS_FIRST",
    applicabilityLabel: "네, 의견을 들을 사람이 있어요",
    expectedJourneyLength: 21,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert(
    sizes.scrollWidth <= sizes.clientWidth,
    `${label}: horizontal overflow ${sizes.scrollWidth}px > ${sizes.clientWidth}px`
  );
}

async function assertQuestionViewportLocked(page, label) {
  const sizes = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  assert(
    sizes.documentHeight <= sizes.viewportHeight + 1,
    `${label}: question document must not have a second vertical scroller ${JSON.stringify(sizes)}`
  );
}

async function selectFirstResearchResponse(page) {
  const response = page.locator(
    'input[value^="bipolar-"], input[value^="impact-"]'
  ).first();
  await response.locator("..").click();
}

async function visibleTargetMetrics(page, selector) {
  return page.locator(selector).evaluateAll((targets) =>
    targets
      .filter((target) => {
        const style = window.getComputedStyle(target);
        const rect = target.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .map((target) => ({
        text: target.textContent?.trim().replace(/\s+/g, " ") ?? "",
        ariaLabel: target.getAttribute("aria-label"),
        height: target.getBoundingClientRect().height,
      }))
  );
}

function smallestTarget(metrics, label) {
  assert(metrics.length > 0, `${label}: no visible interactive targets found`);
  return metrics.reduce((smallest, target) => target.height < smallest.height ? target : smallest);
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const browserRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("request", (request) => browserRequests.push({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
  }));

  const researchUrl = new URL(baseUrl);
  researchUrl.searchParams.set("form", viewport.form);
  researchUrl.searchParams.set("supportOrder", viewport.supportOrder);
  // Wait through client hydration before taking screenshots. Playwright briefly
  // suppresses carets during capture, which can otherwise race React hydration.
  // Next dev keeps development connections open, so networkidle can hang even
  // after the hydrated research screen is ready for interaction.
  const documentResponse = await page.goto(researchUrl.toString(), { waitUntil: "domcontentloaded" });
  assert(documentResponse?.status() === 200, `${viewport.name}: research route must return 200 locally`);
  const responseHeaders = documentResponse.headers();
  assert(
    responseHeaders["cache-control"] === "no-cache, must-revalidate",
    `${viewport.name}: unexpected dev cache policy ${responseHeaders["cache-control"]}`
  );
  assert(
    responseHeaders["x-robots-tag"] === "noindex, nofollow, noarchive, nosnippet",
    `${viewport.name}: missing X-Robots-Tag fence`
  );
  assert(
    responseHeaders["content-security-policy"]?.includes("connect-src 'self'") &&
      !responseHeaders["content-security-policy"]?.includes("posthog") &&
      !responseHeaders["content-security-policy"]?.includes("supabase"),
    `${viewport.name}: research CSP must block external analytics/data hosts`
  );
  await page.getByText("우리 대화는 어디서부터 시작하면 편할까?").waitFor();
  await page.locator('html[data-wedding-code-research-hydrated="true"]').waitFor();
  await page.screenshot({ path: path.join(outputRoot, `${viewport.name}-intro.png`), fullPage: true });
  await assertNoHorizontalOverflow(page, `${viewport.name}/intro`);
  await page.getByLabel(viewport.applicabilityLabel).check();
  const start = page.getByRole("button", { name: "장면 시작하기" });
  assert(await start.isEnabled(), `${viewport.name}: start must enable after applicability`);
  const startBox = await start.boundingBox();
  assert(
    startBox && startBox.y + startBox.height <= viewport.height + 1,
    `${viewport.name}: start CTA must be fully visible in the first viewport: ${JSON.stringify(startBox)}`
  );
  await start.click();

  const progress = page.getByRole("progressbar", { name: "웨딩코드 장면 진행률" });
  assert((await progress.getAttribute("aria-valuenow")) === "1", `${viewport.name}: progress starts at 1`);
  assert(
    (await progress.getAttribute("aria-valuemax")) === String(viewport.expectedJourneyLength),
    `${viewport.name}: journey length is ${viewport.expectedJourneyLength}`
  );
  const next = page.getByRole("button", { name: /선택 확인하고 다음/ });
  assert(await next.isDisabled(), `${viewport.name}: next must be disabled before choice`);
  await page.screenshot({
    path: path.join(outputRoot, `${viewport.name}-question-initial.png`),
    fullPage: true,
  });

  await selectFirstResearchResponse(page);
  assert((await progress.getAttribute("aria-valuenow")) === "1", `${viewport.name}: choice must not auto-advance`);
  assert(await next.isEnabled(), `${viewport.name}: next enables after choice`);
  const nextBox = await next.boundingBox();
  assert(
    nextBox && nextBox.y + nextBox.height <= viewport.height + 1,
    `${viewport.name}: question action dock must remain fully visible without covering choices: ${JSON.stringify(nextBox)}`
  );
  const alternateResponses = page.getByText("딱 맞는 답이 없어요", { exact: true });
  await alternateResponses.scrollIntoViewIfNeeded();
  const primaryScaleVisibility = await page.locator(
    'input[value^="bipolar-"], input[value^="impact-"]'
  ).evaluateAll((inputs) => {
    const region = document.querySelector('[role="region"]')?.getBoundingClientRect();
    return {
      count: inputs.length,
      allVisible: Boolean(region) && inputs.every((input) => {
        const rect = input.closest("label")?.getBoundingClientRect();
        return Boolean(rect && rect.top >= region.top - 1 && rect.bottom <= region.bottom + 1);
      }),
    };
  });
  assert(
    primaryScaleVisibility.count === 5 && primaryScaleVisibility.allVisible,
    `${viewport.name}: all five primary responses must be comparable at once`
  );
  await page.screenshot({ path: path.join(outputRoot, `${viewport.name}-question.png`), fullPage: true });
  await assertNoHorizontalOverflow(page, `${viewport.name}/question`);
  await assertQuestionViewportLocked(page, `${viewport.name}/question`);
  const questionTargets = await visibleTargetMetrics(page, "main button, main label, main summary");
  const smallestQuestionTarget = smallestTarget(questionTargets, `${viewport.name}/question`);
  assert(
    smallestQuestionTarget.height >= 48,
    `${viewport.name}: smallest question target ${JSON.stringify(smallestQuestionTarget)}, expected >=48px`
  );

  await next.click();
  assert((await progress.getAttribute("aria-valuenow")) === "2", `${viewport.name}: explicit next advances`);
  const focused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    text: document.activeElement?.textContent?.trim(),
  }));
  assert(focused.tag === "H1", `${viewport.name}: next question heading must receive focus`);

  const initialImpactScaleVisibility = await page.locator(
    'input[value^="impact-"]'
  ).evaluateAll((inputs) => {
    const region = document.querySelector('[role="region"]')?.getBoundingClientRect();
    return {
      count: inputs.length,
      region: region ? { top: region.top, bottom: region.bottom } : null,
      bounds: inputs.map((input) => {
        const rect = input.closest("label")?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom } : null;
      }),
      allVisible: Boolean(region) && inputs.every((input) => {
        const rect = input.closest("label")?.getBoundingClientRect();
        return Boolean(rect && rect.top >= region.top - 1 && rect.bottom <= region.bottom + 1);
      }),
    };
  });
  assert(
    initialImpactScaleVisibility.count === 5 && initialImpactScaleVisibility.allVisible,
    `${viewport.name}: all five initial impact responses must be fully visible above the action dock: ${JSON.stringify(initialImpactScaleVisibility)}`
  );

  for (let question = 2; question <= viewport.expectedJourneyLength; question += 1) {
    await selectFirstResearchResponse(page);
    const buttonName = question === viewport.expectedJourneyLength
      ? /대화 카드 고르기/
      : /선택 확인하고 다음/;
    await page.getByRole("button", { name: buttonName }).click();
  }

  await page.getByText("오늘 실제로 꺼내고 싶은 대화를 골라주세요").waitFor();
  const showCard = page.getByRole("button", { name: /내 카드 보기/ });
  assert(await showCard.isDisabled(), `${viewport.name}: card requires direct selection`);
  await page.getByRole("button", { name: /이번 선택은 조건부터 맞춰볼까/ }).click();
  await showCard.click();
  await page.getByText("오늘의 대화 카드").waitFor();
  await page.screenshot({ path: path.join(outputRoot, `${viewport.name}-complete.png`), fullPage: true });
  await assertNoHorizontalOverflow(page, `${viewport.name}/complete`);

  const buttonMetrics = await visibleTargetMetrics(page, "main button");
  const smallestButton = smallestTarget(buttonMetrics, `${viewport.name}/complete`);
  assert(
    smallestButton.height >= 48,
    `${viewport.name}: smallest button ${JSON.stringify(smallestButton)}, expected >=48px`
  );
  const storage = await page.evaluate(async () => ({
    localStorageKeys: Object.keys(window.localStorage),
    sessionStorageKeys: Object.keys(window.sessionStorage),
    cookie: document.cookie,
    phNoCapture: document.querySelector("main")?.classList.contains("ph-no-capture") ?? false,
    cacheKeys: "caches" in window ? await window.caches.keys() : [],
    serviceWorkers: "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
    indexedDatabases: "databases" in indexedDB
      ? (await indexedDB.databases()).map((database) => database.name)
      : [],
  }));
  assert(storage.localStorageKeys.length === 0, `${viewport.name}: localStorage must stay empty`);
  assert(storage.sessionStorageKeys.length === 0, `${viewport.name}: sessionStorage must stay empty`);
  assert(storage.cookie === "", `${viewport.name}: document.cookie must stay empty`);
  assert(storage.phNoCapture, `${viewport.name}: PostHog no-capture marker is missing`);
  assert(storage.cacheKeys.length === 0, `${viewport.name}: Cache Storage must stay empty`);
  assert(storage.serviceWorkers === 0, `${viewport.name}: service workers must stay unregistered`);
  assert(storage.indexedDatabases.length === 0, `${viewport.name}: IndexedDB must stay empty`);
  const browserCookies = await context.cookies(researchUrl.toString());
  assert(browserCookies.length === 0, `${viewport.name}: browser cookies must stay empty`);

  const pageOrigin = new URL(researchUrl).origin;
  const unexpectedRequests = browserRequests.filter(
    (request) => !isAllowedWeddingCodeResearchRequest(request, pageOrigin)
  );
  assert(
    unexpectedRequests.length === 0,
    `${viewport.name}: disallowed requests: ${JSON.stringify(unexpectedRequests)}; console errors: ${consoleErrors.join(" | ")}; failed requests: ${failedRequests.join(" | ")}`
  );
  assert(consoleErrors.length === 0, `${viewport.name}: console errors: ${consoleErrors.join(" | ")}`);
  assert(failedRequests.length === 0, `${viewport.name}: request failures: ${failedRequests.join(" | ")}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("우리 대화는 어디서부터 시작하면 편할까?").waitFor();
  await page.locator('html[data-wedding-code-research-hydrated="true"]').waitFor();
  assert(
    await page.getByRole("button", { name: "장면 시작하기" }).isDisabled(),
    `${viewport.name}: refresh must clear in-memory answers`
  );

  await context.close();
  return {
    viewport: viewport.name,
    form: viewport.form,
    journeyLength: viewport.expectedJourneyLength,
    minQuestionTouchTarget: smallestQuestionTarget.height,
    minCompletionTouchTarget: smallestButton.height,
    unexpectedRequests: 0,
    browserPersistence: 0,
    consoleErrors: 0,
    failedRequests: 0,
  };
}

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const results = [];
  for (const viewport of viewports) results.push(await runViewport(browser, viewport));
  process.stdout.write(`${JSON.stringify({ baseUrl, outputRoot, results }, null, 2)}\n`);
} finally {
  await browser.close();
}
