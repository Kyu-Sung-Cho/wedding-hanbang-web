import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/turnstile.ts", import.meta.url));

function loadTurnstileHelpers() {
  const sourceText = readFileSync(helperPath, "utf8");
  const sourceFile = ts.createSourceFile(
    helperPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    `${compiled.outputText}\nreturn {
      isValidTurnstileToken,
      hasValidTurnstileSiteKey: typeof hasValidTurnstileSiteKey === "function" ? hasValidTurnstileSiteKey : undefined,
      parseTurnstileMessage: typeof parseTurnstileMessage === "function" ? parseTurnstileMessage : undefined,
      buildTurnstileHtml: typeof buildTurnstileHtml === "function" ? buildTurnstileHtml : undefined,
      getTurnstileWebFallbackUrl: typeof getTurnstileWebFallbackUrl === "function" ? getTurnstileWebFallbackUrl : undefined,
      isAllowedTurnstileNavigation: typeof isAllowedTurnstileNavigation === "function" ? isAllowedTurnstileNavigation : undefined,
    };`,
  )();
}

test("only a bounded base64url-style Turnstile token can cross the WebView boundary", () => {
  const { isValidTurnstileToken } = loadTurnstileHelpers();
  const validToken = `0.${"Abc_123-xyz.".repeat(3)}`;

  assert.equal(isValidTurnstileToken(validToken), true);
  assert.equal(isValidTurnstileToken("short"), false);
  assert.equal(isValidTurnstileToken(`0.${"a".repeat(2047)}`), false);
  assert.equal(isValidTurnstileToken(`${validToken}\n`), false);
  assert.equal(isValidTurnstileToken(`${validToken}<script>`), false);
  assert.equal(isValidTurnstileToken(null), false);
});

test("WebView messages are parsed into a closed set and invalid success payloads fail closed", () => {
  const { parseTurnstileMessage } = loadTurnstileHelpers();
  const validToken = `0.${"Abc_123-xyz.".repeat(3)}`;

  assert.equal(typeof parseTurnstileMessage, "function");
  assert.deepEqual(parseTurnstileMessage(JSON.stringify({ type: "success", token: validToken })), {
    type: "success",
    token: validToken,
  });
  assert.deepEqual(parseTurnstileMessage(JSON.stringify({ type: "expired" })), { type: "expired" });
  assert.deepEqual(parseTurnstileMessage(JSON.stringify({ type: "error", code: "private" })), {
    type: "error",
  });
  assert.deepEqual(parseTurnstileMessage(JSON.stringify({ type: "ready" })), { type: "ready" });
  assert.equal(parseTurnstileMessage(JSON.stringify({ type: "success", token: "bad token" })), null);
  assert.equal(parseTurnstileMessage(JSON.stringify({ type: "unknown", token: validToken })), null);
  assert.equal(
    parseTurnstileMessage(JSON.stringify({ type: "error", padding: "x".repeat(3_000) })),
    null,
  );
  assert.equal(parseTurnstileMessage("not-json"), null);
});

test("Turnstile HTML uses the official explicit widget and rejects injectable configuration", () => {
  const { buildTurnstileHtml, hasValidTurnstileSiteKey } = loadTurnstileHelpers();
  assert.equal(typeof buildTurnstileHtml, "function");
  assert.equal(typeof hasValidTurnstileSiteKey, "function");
  assert.equal(hasValidTurnstileSiteKey("1x00000000000000000000AA"), true);
  assert.equal(hasValidTurnstileSiteKey("a".repeat(33)), false);
  assert.equal(hasValidTurnstileSiteKey(`1x000</script>`), false);

  const html = buildTurnstileHtml("1x00000000000000000000AA", "signup");
  assert.equal(typeof html, "string");
  assert.match(html, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?onload=onTurnstileLoad&amp;render=explicit/);
  assert.match(html, /window\.turnstile\.render/);
  assert.match(html, /ReactNativeWebView\.postMessage/);
  assert.match(html, /["']expired-callback["']/);
  assert.match(html, /["']error-callback["']/);
  assert.match(html, /["']timeout-callback["']/);
  assert.match(html, /["']unsupported-callback["']/);
  assert.match(html, /retry:\s*["']never["']/);
  assert.match(html, /action:\s*["']signup["']/);
  assert.doesNotMatch(html, /console\.(?:log|error)/);

  assert.equal(buildTurnstileHtml(`1x000</script><script>alert(1)</script>`, "signup"), null);
  assert.equal(buildTurnstileHtml("1x00000000000000000000AA", `bad</script>`), null);
});

test("mobile auth fallback and WebView navigation stay on explicitly trusted origins", () => {
  const { getTurnstileWebFallbackUrl, isAllowedTurnstileNavigation } = loadTurnstileHelpers();
  assert.equal(typeof getTurnstileWebFallbackUrl, "function");
  assert.equal(typeof isAllowedTurnstileNavigation, "function");

  assert.equal(
    getTurnstileWebFallbackUrl("signup", "https://hanbang.ai"),
    "https://hanbang.ai/login?mode=signup",
  );
  assert.equal(
    getTurnstileWebFallbackUrl("forgot", "https://evil.example/path"),
    "https://hanbang.ai/login?mode=forgot",
  );
  assert.equal(
    getTurnstileWebFallbackUrl("signup", "javascript:alert(1)"),
    "https://hanbang.ai/login?mode=signup",
  );

  for (const allowed of [
    "https://hanbang.ai/",
    "https://hanbang.ai/auth/challenge",
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "about:blank",
    "about:srcdoc",
  ]) {
    assert.equal(isAllowedTurnstileNavigation(allowed), true, allowed);
  }
  for (const blocked of [
    "http://hanbang.ai/",
    "https://hanbang.ai.evil.example/",
    "https://evil.example/",
    "javascript:alert(1)",
    "data:text/html,bad",
  ]) {
    assert.equal(isAllowedTurnstileNavigation(blocked), false, blocked);
  }
});
