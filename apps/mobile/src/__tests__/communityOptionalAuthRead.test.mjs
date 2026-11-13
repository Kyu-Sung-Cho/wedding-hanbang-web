import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const mobileRoot = resolve(import.meta.dirname, "../..");
const apiSource = readFileSync(resolve(mobileRoot, "src/lib/api.ts"), "utf8");
const communitySource = readFileSync(
  resolve(mobileRoot, "app/community/index.tsx"),
  "utf8",
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("optional-auth reads are a strict internal GET-only boundary", () => {
  assert.match(
    apiSource,
    /import \{ fetch as expoFetch, type FetchRequestInit \} from "expo\/fetch"/u,
  );
  assert.match(
    apiSource,
    /type OptionalAuthGetOptions = Omit<[\s\S]{0,160}"body" \| "credentials" \| "method"/u,
  );
  assert.match(apiSource, /body\?: never/u);
  assert.match(apiSource, /credentials\?: never/u);
  assert.match(apiSource, /method\?: "GET"/u);

  const helper = sourceBetween(
    apiSource,
    "export async function optionalAuthGetFetch",
    "export async function optionalAuthGetJson",
  );
  assert.match(helper, /options\.method !== undefined && options\.method !== "GET"/u);
  assert.match(helper, /hasOwnProperty\.call\(options, "body"\)/u);
  assert.match(helper, /hasOwnProperty\.call\(options, "credentials"\)/u);
  assert.match(helper, /method: "GET"/u);
  assert.match(helper, /credentials: "omit"/u);
  assert.match(helper, /redirect: "error"/u);
  assert.match(helper, /return expoFetch\(requestUrl,/u);
  assert.doesNotMatch(helper, /return fetch\(requestUrl,/u);
  assert.doesNotMatch(helper, /method:\s*options\.method/u);
});

test("guest reads are credentialless and signed-in reads retry only the exact session once", () => {
  const helper = sourceBetween(
    apiSource,
    "export async function optionalAuthGetFetch",
    "export async function optionalAuthGetJson",
  );

  assert.match(apiSource, /OPTIONAL_AUTH_FORBIDDEN_HEADERS[\s\S]{0,180}"authorization"[\s\S]{0,180}"cookie"[\s\S]{0,180}"proxy-authorization"/u);
  assert.match(apiSource, /if \(headers\.has\(name\)\)[\s\S]{0,100}throw new Error/u);
  assert.match(helper, /if \(accessToken\) headers\.set\("Authorization", `Bearer \$\{accessToken\}`\)/u);
  assert.match(helper, /if \(!initialSession\) return fetchRead\(\)/u);
  assert.match(helper, /const initialResponse = await fetchRead\(initialSession\.accessToken\)/u);
  assert.match(helper, /if \(initialResponse\.status !== 401\) return initialResponse/u);
  assert.match(helper, /refreshWebBridgeSession\(initialSession\)/u);
  assert.equal((helper.match(/refreshWebBridgeSession\(initialSession\)/gu) ?? []).length, 1);
  assert.match(helper, /refreshedSession\.userId !== initialSession\.userId/u);
  assert.match(helper, /return initialResponse/u);
  assert.match(helper, /return fetchRead\(refreshedSession\.accessToken\)/u);
});

test("public community feeds use optional auth while private inbox stays authenticated", () => {
  const postRead = sourceBetween(
    communitySource,
    "async function fetchPostsFromApi",
    "function timeAgo",
  );
  const decisionRead = sourceBetween(
    communitySource,
    "const loadDecisionData",
    "useEffect(() => {",
  );

  assert.match(postRead, /optionalAuthGetJson<[\s\S]{0,100}\/api\/community\/posts/u);
  assert.match(decisionRead, /optionalAuthGetJson<unknown>\(`\/api\/community\/decision-threads\?mode=/u);
  assert.match(decisionRead, /apiJson<unknown>\("\/api\/community\/decision-threads\/inbox"\)/u);
  assert.match(decisionRead, /parseCommunityDecisionFeed\(feedResult\.value, mode\)/u);
  assert.match(decisionRead, /parseCommunityDecisionInbox\(inboxResult\.value\)/u);
  assert.equal(
    (communitySource.match(/optionalAuthGetJson(?:<[^>]+>)?\(/gu) ?? []).length,
    2,
  );
});
