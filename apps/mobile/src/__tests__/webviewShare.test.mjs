import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { shareableWebViewUrl } from "../lib/webviewShare.mjs";

/**
 * 웹뷰 머리의 「현재 페이지 공유」가 주소의 `#` 뒤를 내보내지 않는가.
 *
 * 2026-09-26 감사에서 찾았다. 앱에서 웨딩코드 상대 초대를 만들면 웹이 초대자 본인용
 * 주소 `/wedding-code/together#room=…&access=<초대자 키>` 로 옮겨 가고, 머리의 공유 버튼은
 * 웹뷰가 기억한 그 주소를 그대로 보냈다. 받은 사람은 초대자 권한으로 두 사람 답을 보고
 * 연결을 끝낼 수 있었다.
 */

const ORIGIN = "https://hanbang.ai";
const ROOM = "3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b";
const OWNER_KEY = "a".repeat(64);
const INVITE_KEY = "b".repeat(64);

function read(relativeToMobile) {
  return readFileSync(fileURLToPath(new URL(`../../${relativeToMobile}`, import.meta.url)), "utf8");
}

/** 주석을 걷어낸다. 주석에 적힌 옛 코드가 검사에 대신 대답하지 않게 한다. */
function withoutComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function assertNoSecret(shared, secrets) {
  assert.ok(shared, "공유할 주소가 있어야 한다");
  assert.ok(!shared.includes("#"), `${shared} 에 # 가 남았다`);
  for (const secret of secrets) assert.ok(!shared.includes(secret), `${shared} 에 ${secret.slice(0, 12)}… 가 남았다`);
}

test("두 사람 결과 방의 초대자 주소를 공유하면 접근 키가 빠지고 웨딩코드 첫 화면이 나간다", () => {
  const owner = `${ORIGIN}/wedding-code/together#room=${ROOM}&access=${OWNER_KEY}&invitation=${INVITE_KEY}`;
  const shared = shareableWebViewUrl(owner, ORIGIN);
  assertNoSecret(shared, [OWNER_KEY, INVITE_KEY, ROOM, "access="]);
  // `#` 없는 together 는 "잘못된 링크" 화면이라, 받은 사람이 시작할 수 있는 첫 화면을 보낸다.
  assert.equal(shared, `${ORIGIN}/wedding-code`);
});

test("초대받은 사람 주소도 머리 공유로는 키를 싣지 않는다", () => {
  const invitee = `${ORIGIN}/wedding-code/together#room=${ROOM}&invite=${INVITE_KEY}`;
  assert.equal(shareableWebViewUrl(invitee, ORIGIN), `${ORIGIN}/wedding-code`);
});

test("웨딩코드 답이 실린 주소는 답 없이 나간다", () => {
  const answers = `${ORIGIN}/wedding-code#v=v3.1-preferences&a=31_5454-5-44545-45-45_c00.c01`;
  assert.equal(shareableWebViewUrl(answers, ORIGIN), `${ORIGIN}/wedding-code`);
  // 옛 판은 답을 `?` 뒤에 실었다.
  const legacy = `${ORIGIN}/wedding-code?v=v1.2-code&a=ABCDABCDABCDABCDABCD&b=DCBADCBADCBADCBADCBA`;
  assert.equal(shareableWebViewUrl(legacy, ORIGIN), `${ORIGIN}/wedding-code`);
  const taste = `${ORIGIN}/wedding-code/taste#t=abc`;
  assert.equal(shareableWebViewUrl(taste, ORIGIN), `${ORIGIN}/wedding-code/taste`);
});

test("다른 화면도 # 뒤는 보내지 않는다", () => {
  const cases = [
    [`${ORIGIN}/login#access_token=eyJhbGciOi.secret&refresh_token=r3fr35h&type=recovery`, `${ORIGIN}/login`],
    [`${ORIGIN}/onboarding#code=HB-7Q2K`, `${ORIGIN}/onboarding`],
    [`${ORIGIN}/invite#code=HB-7Q2K`, `${ORIGIN}/invite`],
    [`${ORIGIN}/manners/cost-saving#section-2`, `${ORIGIN}/manners/cost-saving`],
    [`${ORIGIN}/start-here#date=2027-05-01`, `${ORIGIN}/start-here`],
  ];
  for (const [current, expected] of cases) assert.equal(shareableWebViewUrl(current, ORIGIN), expected, current);
});

test("평범한 화면의 경로와 검색 조건은 그대로 나간다", () => {
  assert.equal(shareableWebViewUrl(`${ORIGIN}/price?region=seoul&q=%ED%99%80`, ORIGIN), `${ORIGIN}/price?region=seoul&q=%ED%99%80`);
  assert.equal(shareableWebViewUrl(`${ORIGIN}/price/vendor-id/0f8d6c1a-1b2c-4d3e-8f9a-0b1c2d3e4f5a`, ORIGIN), `${ORIGIN}/price/vendor-id/0f8d6c1a-1b2c-4d3e-8f9a-0b1c2d3e4f5a`);
  assert.equal(shareableWebViewUrl(`${ORIGIN}/wedding-code/c/KTFL`, ORIGIN), `${ORIGIN}/wedding-code/c/KTFL`);
  assert.equal(shareableWebViewUrl(`${ORIGIN}/`, ORIGIN), `${ORIGIN}/`);
});

test("이 사이트가 아니거나 공유할 이유가 없는 주소는 보내지 않는다", () => {
  for (const value of [
    "https://evil.example/wedding-code",
    "https://hanbang.ai.evil.example/wedding-code",
    "https://user:pass@hanbang.ai/price",
    `${ORIGIN}/api/auth/callback?code=abc123`,
    `${ORIGIN}/api`,
    "",
    "not a url",
  ]) {
    assert.equal(shareableWebViewUrl(value, ORIGIN), null, value);
  }
});

test("웹이 초대자 키를 싣는 자리가 이 판정이 지우는 자리와 같다", () => {
  // 웹이 키를 `#` 가 아닌 곳(`?` 등)으로 옮기거나 웨딩코드 밖 경로로 옮기면 위 판정이
  // 조용히 틀린다. 그때 여기서 먼저 빨갛게 되도록 웹 쪽 주소 만드는 코드를 본다.
  const client = withoutComments(read("../web/src/lib/weddingCode/pairSessionClient.ts"));
  assert.match(client, /new URL\("\/wedding-code\/together", origin\)/);
  assert.match(client, /url\.hash = params\.toString\(\)/);
  assert.match(client, /\[link\.mode === "invite" \? "invite" : "access"\]: link\.token/);
});

test("머리의 공유 버튼은 정리한 주소만 보낸다", () => {
  const screen = withoutComments(read("app/webview.tsx"));
  assert.match(screen, /import \{ shareableWebViewUrl \} from "@\/lib\/webviewShare\.mjs";/);
  assert.match(screen, /const shareUrl = shareableWebViewUrl\(currentUrl, SITE_ORIGIN\);/);
  const shares = [...screen.matchAll(/Share\.share\(\{([^}]*)\}\)/g)].map(match => match[1]);
  assert.ok(shares.length >= 1, "Share.share 호출을 찾지 못했다");
  for (const args of shares) {
    assert.doesNotMatch(args, /currentUrl/, `공유 인자에 currentUrl 이 그대로 들어갔다: ${args}`);
    assert.match(args, /url: shareUrl/);
    assert.match(args, /message: shareUrl/);
  }
});
