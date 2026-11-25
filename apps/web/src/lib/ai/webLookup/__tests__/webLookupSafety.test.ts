// @vitest-environment node
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchWebLookupResource,
  pinnedLookup,
  type WebLookupFetchOptions,
  type WebLookupTransport,
  type WebLookupTransportRequest,
} from "@/lib/ai/webLookup/webLookupFetch";
import {
  checkRobotsForUrl,
  clearWebLookupRobotsCacheForTests,
  isPathAllowedByRobots,
  parseRobotsTxt,
  robotsPatternMatches,
  selectRobotsRules,
} from "@/lib/ai/webLookup/webLookupRobots";
import {
  checkWebLookupUrl,
  isPublicIpAddress,
  parseIpv6,
} from "@/lib/ai/webLookup/webLookupUrlPolicy";

/**
 * 찾아보기의 바깥 요청 경계(08장, D-85). 주소 모양, DNS 가 준 IP, 넘겨주기, 크기·시간·형식 한도,
 * 쿠키 없음, robots.txt. 실제 네트워크는 쓰지 않는다 — 해석기와 연결부를 가짜로 끼운다.
 */

describe("주소 모양 검사", () => {
  it("업체 홈페이지 같은 공개 주소는 받는다", () => {
    const check = checkWebLookupUrl("https://www.baileyhouse.co.kr/hall?id=1#top");
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.host).toBe("www.baileyhouse.co.kr");
      expect(check.url.hash).toBe("");
    }
    expect(checkWebLookupUrl("http://www.thehuewedding.com/").ok).toBe(true);
  });

  it.each([
    ["ftp://files.example.co.kr/a", "scheme_not_allowed"],
    ["javascript:alert(1)", "scheme_not_allowed"],
    ["file:///etc/passwd", "scheme_not_allowed"],
    ["https://user:pw@hall.co.kr/", "credentials_in_url"],
    ["https://hall.co.kr:8080/", "port_not_allowed"],
    ["http://hall.co.kr:6379/", "port_not_allowed"],
    ["http://127.0.0.1/", "ip_literal_not_allowed"],
    ["http://[::1]/", "ip_literal_not_allowed"],
    ["http://2130706433/", "ip_literal_not_allowed"],
    ["http://0x7f.0.0.1/", "ip_literal_not_allowed"],
    ["http://169.254.169.254/latest/meta-data/", "ip_literal_not_allowed"],
    ["http://localhost/admin", "internal_host"],
    ["http://metadata.google.internal/computeMetadata/v1/", "internal_host"],
    ["http://intranet/", "internal_host"],
    ["http://db.svc.cluster.local/", "internal_host"],
    ["https://blog.naver.com/someone/123", "blocked_by_terms"],
    ["https://m.place.naver.com/place/1", "blocked_by_terms"],
    ["https://naver.me/abc", "blocked_by_terms"],
    ["https://www.instagram.com/p/xyz/", "blocked_by_terms"],
    ["https://place.map.kakao.com/123", "blocked_by_terms"],
    ["https://hall.tistory.com/1", "blocked_by_terms"],
    ["https://brunch.co.kr/@a/1", "blocked_by_terms"],
    ["not a url", "invalid_url"],
  ])("%s → %s", (raw, reason) => {
    const check = checkWebLookupUrl(raw);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe(reason);
  });

  it("약관 차단은 이름 끝이 맞을 때만이다(비슷한 이름은 막지 않는다)", () => {
    expect(checkWebLookupUrl("https://evilnaver.com/").ok).toBe(true);
    expect(checkWebLookupUrl("https://naver.com.weddinghall.io/").ok).toBe(true);
  });

  it("2,048자를 넘는 주소는 받지 않는다", () => {
    const check = checkWebLookupUrl(`https://hall.co.kr/${"a".repeat(2100)}`);
    expect(check).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("DNS 가 준 IP 판정", () => {
  it.each(["8.8.8.8", "211.231.99.80", "2001:4860:4860::8888", "::ffff:8.8.8.8"])("%s 는 공개 주소", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "127.0.0.1", "127.255.0.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe",
    "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0:4136:e378::1", "2001:db8::1",
    "not-an-ip",
  ])("%s 는 공개 주소가 아니다", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it("IPv6 를 바이트로 푼다(IPv4 꼬리 표기 포함)", () => {
    expect(parseIpv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 1, 2, 3, 4]);
    expect(parseIpv6("2001:db8::1")?.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect(parseIpv6("1.2.3.4")).toBeNull();
  });
});

type FakeResponse = {
  status: number;
  headers?: Record<string, string>;
  chunks?: Array<Buffer | string>;
  hang?: boolean;
};

function fakeTransport(responses: Record<string, FakeResponse>) {
  const calls: WebLookupTransportRequest[] = [];
  const destroyed: string[] = [];
  const transport: WebLookupTransport = async (request) => {
    calls.push(request);
    const response = responses[request.url.toString()];
    if (!response) throw new Error(`unexpected request ${request.url.toString()}`);
    if (response.hang) {
      await new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    return {
      status: response.status,
      headers: response.headers ?? {},
      body: (async function* () {
        for (const chunk of response.chunks ?? []) yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      })(),
      destroy: () => destroyed.push(request.url.toString()),
    };
  };
  return { transport, calls, destroyed };
}

// 203.0.113.0/24 는 문서용이라 공개 주소가 아니다(아래 시험이 그것도 확인한다).
const DOC_RANGE_IP = [{ address: "203.0.113.10", family: 4 }];
const VENDOR_IP = [{ address: "211.231.99.80", family: 4 }];

function options(overrides: Partial<WebLookupFetchOptions> = {}): WebLookupFetchOptions {
  return {
    maxBytes: 1_000,
    timeoutMs: 2_000,
    maxRedirects: 3,
    accept: "text/html",
    acceptContentType: (mediaType) => mediaType === "text/html" || mediaType === "text/plain",
    resolveHost: async () => VENDOR_IP,
    ...overrides,
  };
}

describe("안전한 가져오기", () => {
  it("검사한 IP 로만 연결하고, 우리 이름의 User-Agent 를 보내며, 쿠키는 보내지 않는다", async () => {
    const { transport, calls } = fakeTransport({
      "https://hall.co.kr/": { status: 200, headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "sid=abc" }, chunks: ["<p>안녕</p>"] },
    });
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({ transport }));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].address).toBe("211.231.99.80");
    expect(calls[0].headers["User-Agent"]).toContain("HanbangBot");
    expect(Object.keys(calls[0].headers).map((name) => name.toLowerCase())).not.toContain("cookie");
  });

  it("DNS 가 사설 주소를 주면 연결하지 않는다", async () => {
    const { transport, calls } = fakeTransport({});
    const result = await fetchWebLookupResource("https://evil-rebind.co.kr/", options({
      transport,
      resolveHost: async () => [{ address: "10.0.0.5", family: 4 }],
    }));
    expect(result).toMatchObject({ ok: false, reason: "private_address" });
    expect(calls).toHaveLength(0);
  });

  it("공개 주소와 사설 주소를 섞어 주는 이름도 통째로 거절한다", async () => {
    const { transport, calls } = fakeTransport({});
    const result = await fetchWebLookupResource("https://mixed.co.kr/", options({
      transport,
      resolveHost: async () => [...VENDOR_IP, { address: "169.254.169.254", family: 4 }],
    }));
    expect(result).toMatchObject({ ok: false, reason: "private_address" });
    expect(calls).toHaveLength(0);
  });

  it("DNS 다시 묶기: 검사 뒤 해석기가 사설 주소로 바뀌어도 연결은 처음 검사한 주소로 간다", async () => {
    let lookups = 0;
    const resolveHost = vi.fn(async () => {
      lookups += 1;
      return lookups === 1 ? VENDOR_IP : [{ address: "127.0.0.1", family: 4 }];
    });
    const { transport, calls } = fakeTransport({
      "https://rebind.co.kr/": { status: 200, headers: { "content-type": "text/html" }, chunks: ["ok"] },
    });
    const result = await fetchWebLookupResource("https://rebind.co.kr/", options({ transport, resolveHost }));
    expect(result.ok).toBe(true);
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(calls[0].address).toBe("211.231.99.80");
  });

  it("고정 lookup 은 어떤 물음에도 검사한 주소 하나만 돌려준다", async () => {
    const lookup = pinnedLookup("211.231.99.80", 4) as unknown as (
      hostname: string,
      options: Record<string, unknown>,
      callback: (...args: unknown[]) => void,
    ) => void;
    const single = await new Promise<unknown[]>((resolve) => {
      lookup("rebind.co.kr", {}, (...args: unknown[]) => resolve(args));
    });
    expect(single).toEqual([null, "211.231.99.80", 4]);
    const all = await new Promise<unknown[]>((resolve) => {
      lookup("rebind.co.kr", { all: true }, (...args: unknown[]) => resolve(args));
    });
    expect(all).toEqual([null, [{ address: "211.231.99.80", family: 4 }]]);
  });

  it("넘겨주기마다 주소를 다시 검사한다: 메타데이터 IP·약관 차단·사설 이름으로 가는 넘겨주기를 막는다", async () => {
    for (const [location, expected] of [
      ["http://169.254.169.254/latest/meta-data/", { reason: "url_rejected", urlRejection: "ip_literal_not_allowed" }],
      ["https://blog.naver.com/hall/1", { reason: "url_rejected", urlRejection: "blocked_by_terms" }],
      ["http://localhost:3000/", { reason: "url_rejected" }],
    ] as const) {
      const { transport } = fakeTransport({
        "https://hall.co.kr/": { status: 302, headers: { location } },
      });
      const result = await fetchWebLookupResource("https://hall.co.kr/", options({ transport }));
      expect(result).toMatchObject({ ok: false, ...expected });
    }
    const { transport } = fakeTransport({
      "https://hall.co.kr/": { status: 301, headers: { location: "https://internal.hall.co.kr/" } },
    });
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({
      transport,
      resolveHost: async (host) => (host === "internal.hall.co.kr" ? [{ address: "192.168.0.10", family: 4 }] : VENDOR_IP),
    }));
    expect(result).toMatchObject({ ok: false, reason: "private_address", atUrl: "https://internal.hall.co.kr/" });
  });

  it("넘겨주기는 세 번까지다", async () => {
    const { transport } = fakeTransport({
      "https://a.co.kr/": { status: 302, headers: { location: "https://b.co.kr/" } },
      "https://b.co.kr/": { status: 302, headers: { location: "https://c.co.kr/" } },
      "https://c.co.kr/": { status: 302, headers: { location: "https://d.co.kr/" } },
      "https://d.co.kr/": { status: 302, headers: { location: "https://e.co.kr/" } },
    });
    const result = await fetchWebLookupResource("https://a.co.kr/", options({ transport }));
    expect(result).toMatchObject({ ok: false, reason: "too_many_redirects" });
  });

  it("글이 아닌 형식은 읽지 않는다", async () => {
    const { transport } = fakeTransport({
      "https://hall.co.kr/menu.pdf": { status: 200, headers: { "content-type": "application/pdf" }, chunks: ["%PDF"] },
    });
    const result = await fetchWebLookupResource("https://hall.co.kr/menu.pdf", options({ transport }));
    expect(result).toMatchObject({ ok: false, reason: "content_type" });
  });

  it("크기 한도에서 끊고 연결을 닫는다", async () => {
    const { transport, destroyed } = fakeTransport({
      "https://big.co.kr/": { status: 200, headers: { "content-type": "text/html" }, chunks: ["a".repeat(600), "b".repeat(600), "c".repeat(600)] },
    });
    const result = await fetchWebLookupResource("https://big.co.kr/", options({ transport }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.length).toBe(1_000);
      expect(result.truncated).toBe(true);
    }
    expect(destroyed).toContain("https://big.co.kr/");
  });

  it("압축을 풀되 푼 크기에도 한도를 건다", async () => {
    const html = `<p>${"가".repeat(2_000)}</p>`;
    const { transport } = fakeTransport({
      "https://gz.co.kr/": { status: 200, headers: { "content-type": "text/html", "content-encoding": "gzip" }, chunks: [gzipSync(Buffer.from(html))] },
    });
    const result = await fetchWebLookupResource("https://gz.co.kr/", options({ transport }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.length).toBe(1_000);
      expect(result.truncated).toBe(true);
    }
  });

  it("시간 한도를 넘기면 멈춘다", async () => {
    const { transport } = fakeTransport({ "https://slow.co.kr/": { status: 200, hang: true } });
    const result = await fetchWebLookupResource("https://slow.co.kr/", options({ transport, timeoutMs: 50 }));
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("주소마다 부르는 검사(robots 등)가 거절하면 그 주소로 가지 않는다", async () => {
    const { transport, calls } = fakeTransport({});
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({ transport, beforeRequest: async () => false }));
    expect(result).toMatchObject({ ok: false, reason: "hop_denied" });
    expect(calls).toHaveLength(0);
  });

  it("200 이 아닌 답은 읽지 않는다", async () => {
    const { transport } = fakeTransport({ "https://hall.co.kr/": { status: 403 } });
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({ transport }));
    expect(result).toMatchObject({ ok: false, reason: "http_status", status: 403 });
  });

  it("문서용 주소 범위(203.0.113.0/24)도 공개 주소로 치지 않는다", async () => {
    const { transport, calls } = fakeTransport({});
    const result = await fetchWebLookupResource("https://doc.co.kr/", options({ transport, resolveHost: async () => DOC_RANGE_IP }));
    expect(result).toMatchObject({ ok: false, reason: "private_address" });
    expect(calls).toHaveLength(0);
  });
});

describe("robots.txt", () => {
  beforeEach(() => clearWebLookupRobotsCacheForTests());

  it("가장 긴 규칙이 이기고, 같은 길이면 허용이 이긴다", () => {
    const rules = selectRobotsRules(parseRobotsTxt([
      "User-agent: *",
      "Disallow: /private",
      "Allow: /private/price",
      "Disallow: /same",
      "Allow: /same",
    ].join("\n")));
    expect(isPathAllowedByRobots(rules, "/private/price")).toBe(true);
    expect(isPathAllowedByRobots(rules, "/private/staff")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/same")).toBe(true);
    expect(isPathAllowedByRobots(rules, "/public")).toBe(true);
  });

  it("우리 이름 묶음이 있으면 * 묶음보다 그것을 따른다", () => {
    const rules = selectRobotsRules(parseRobotsTxt([
      "User-agent: HanbangBot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Allow: /",
    ].join("\n")));
    expect(isPathAllowedByRobots(rules, "/hall")).toBe(false);
  });

  it("* 와 끝의 $ 를 안다. 빈 Disallow 는 막지 않는다", () => {
    const rules = selectRobotsRules(parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\nDisallow:\n"));
    expect(isPathAllowedByRobots(rules, "/menu/price.pdf")).toBe(false);
    expect(isPathAllowedByRobots(rules, "/menu/price.pdf?v=2")).toBe(true);
    expect(isPathAllowedByRobots(rules, "/menu")).toBe(true);
  });

  it("한글 경로 규칙도 주소의 퍼센트 표기와 맞춘다", () => {
    const rules = selectRobotsRules(parseRobotsTxt("User-agent: *\nDisallow: /가격\n"));
    expect(isPathAllowedByRobots(rules, new URL("https://hall.co.kr/가격/표").pathname)).toBe(false);
  });

  it("robots.txt 가 404 면 읽고, 5xx·연결 실패면 읽지 않는다", async () => {
    const cases: Array<[FakeResponse | "throw", string]> = [
      [{ status: 404 }, "allowed"],
      [{ status: 503 }, "robots_unreachable"],
      ["throw", "robots_unreachable"],
      [{ status: 200, headers: { "content-type": "text/plain" }, chunks: ["User-agent: *\nDisallow: /\n"] }, "robots_disallow"],
      [{ status: 200, headers: { "content-type": "text/plain" }, chunks: ["User-agent: *\nAllow: /\n"] }, "allowed"],
    ];
    for (const [response, expected] of cases) {
      clearWebLookupRobotsCacheForTests();
      const transport: WebLookupTransport = response === "throw"
        ? async () => { throw new Error("connect ECONNREFUSED"); }
        : fakeTransport({ "https://hall.co.kr/robots.txt": response }).transport;
      const decision = await checkRobotsForUrl(new URL("https://hall.co.kr/price"), {
        transport,
        resolveHost: async () => VENDOR_IP,
      });
      expect(decision, JSON.stringify(response)).toBe(expected);
    }
  });
});

describe("2026-11-20 독립 보안 검토가 찾은 구멍", () => {
  function compressedBody(chunks: () => AsyncGenerator<Buffer>, encoding: string | null): WebLookupTransport {
    return async () => ({
      status: 200,
      headers: { "content-type": "text/html", ...(encoding ? { "content-encoding": encoding } : {}) },
      body: chunks(),
      destroy: () => undefined,
    });
  }

  it("압축 응답이 도중에 끊겨도 잡히지 않는 오류나 멈춤 없이 실패로 끝난다", async () => {
    // `source.pipe(decoder)` 는 원천의 오류를 풀개로 넘기지 않아, 끊긴 연결이 잡히지 않는 오류가 되고 읽기가 끝나지 않았다.
    const gzipped = gzipSync(Buffer.from(`<p>${"가".repeat(2_000)}</p>`));
    const transport = compressedBody(async function* () {
      yield gzipped.subarray(0, 20);
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    }, "gzip");
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({ transport, maxBytes: 100_000 }));
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });

  it.each(["gzip", null])("바이트를 조금씩 흘리는 응답도 전체 시간 한도에서 끊긴다 (압축: %s)", async (encoding) => {
    const first = encoding ? gzipSync(Buffer.from("<p>시작</p>")).subarray(0, 10) : Buffer.from("<p>시작");
    const transport = compressedBody(async function* () {
      yield first;
      await new Promise(() => undefined); // 다음 바이트가 오지 않는다
    }, encoding);
    const started = Date.now();
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({ transport, timeoutMs: 150 }));
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("이름 서버가 답을 미뤄도 전체 시간 한도에서 멈추고 연결하지 않는다", async () => {
    const { transport, calls } = fakeTransport({});
    const started = Date.now();
    const result = await fetchWebLookupResource("https://hall.co.kr/", options({
      transport,
      timeoutMs: 150,
      resolveHost: () => new Promise(() => undefined),
    }));
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(calls).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("robots 규칙에 * 가 많아도 금방 판정한다(정규식 되돌아가기 폭주 없음)", () => {
    // 옛 정규식 판은 이 크기에서 2초 넘게 이벤트 루프를 막았다(크기를 키우면 몇 분). 판정은 그대로여야 한다.
    const rules = selectRobotsRules(parseRobotsTxt(`User-agent: *\nDisallow: /${"*a".repeat(4)}*b\n`));
    const started = Date.now();
    expect(isPathAllowedByRobots(rules, `/${"a".repeat(160)}`)).toBe(true);
    expect(isPathAllowedByRobots(rules, `/${"a".repeat(160)}b`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("새 robots 판정기는 RFC 9309 의 * 와 끝의 $ 를 옛 판과 같게 다룬다", () => {
    const cases: Array<[string, string, boolean]> = [
      ["/fish", "/fish.html", true],
      ["/fish", "/Fish", false],
      ["/fish*", "/fishheads/yummy.html", true],
      ["/*.php", "/folder/filename.php?parameters", true],
      ["/*.php$", "/filename.php", true],
      ["/*.php$", "/filename.php?parameters", false],
      ["/a*b$", "/aXb", true],
      ["/a*b$", "/aXbc", false],
      ["/ab*b$", "/ab", false],
      ["/a**b", "/a-b", true],
      ["*$", "/anything", true],
      ["/가격", "/%EA%B0%80%EA%B2%A9/표", true],
    ];
    for (const [pattern, path, expected] of cases) expect(robotsPatternMatches(pattern, path), `${pattern} ${path}`).toBe(expected);
  });

  it("퍼센트 표기의 대소문자가 달라도 같은 규칙으로 본다", () => {
    const lowerRule = selectRobotsRules(parseRobotsTxt("User-agent: *\nDisallow: /a%2fb\n"));
    expect(isPathAllowedByRobots(lowerRule, "/a%2Fb")).toBe(false);
    const upperRule = selectRobotsRules(parseRobotsTxt("User-agent: *\nDisallow: /a%2Fb\n"));
    expect(isPathAllowedByRobots(upperRule, "/a%2fb")).toBe(false);
  });

  it("Azure 관리 주소와 IPv6 문서용 대역(3fff::/20)은 공개 주소로 치지 않는다", () => {
    expect(isPublicIpAddress("168.63.129.16")).toBe(false);
    expect(isPublicIpAddress("3fff::1")).toBe(false);
    expect(isPublicIpAddress("3fff:0fff::1")).toBe(false);
    // 바로 옆 공개 주소는 그대로 받는다.
    expect(isPublicIpAddress("168.63.129.17")).toBe(true);
    expect(isPublicIpAddress("2606:4700::1111")).toBe(true);
  });

  it("인스타그램·페이스북의 짧은 주소·이미지 서버·메신저도 약관 차단이다", () => {
    for (const url of [
      "https://instagr.am/p/x",
      "https://ig.me/m/hall",
      "https://scontent.cdninstagram.com/v/x.jpg",
      "https://scontent.xx.fbcdn.net/x.jpg",
      "https://wa.me.whatsapp.com/x",
    ]) {
      expect(checkWebLookupUrl(url), url).toMatchObject({ ok: false, reason: "blocked_by_terms" });
    }
  });
});
