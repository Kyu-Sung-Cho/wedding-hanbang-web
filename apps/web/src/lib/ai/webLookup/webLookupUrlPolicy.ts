import { BlockList, isIP } from "node:net";

/**
 * 찾아보기가 읽어도 되는 주소인지 정한다. 08장(바깥 글) + D-85(업체 공식 페이지만).
 *
 * 두 단계로 본다.
 *   1. 주소 모양(`checkWebLookupUrl`) — 요청 전에, 그리고 넘겨주기(redirect)마다.
 *   2. DNS 가 준 IP(`isPublicIpAddress`) — 연결 직전에. 모양 검사만으로는 `evil.example` 이
 *      127.0.0.1 로 풀리는 것을 못 막는다. 실제 연결은 여기서 통과한 IP 로만 한다
 *      (`webLookupFetch.ts` 의 고정 lookup). 그래서 검사와 연결 사이에 DNS 가 바뀌어도
 *      (DNS 다시 묶기) 검사하지 않은 주소로 가지 않는다.
 */

export type WebLookupUrlRejection =
  | "invalid_url"
  | "too_long"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "port_not_allowed"
  | "ip_literal_not_allowed"
  | "internal_host"
  | "blocked_by_terms";

export type WebLookupUrlCheck =
  | { ok: true; url: URL; host: string }
  | { ok: false; reason: WebLookupUrlRejection };

const MAX_URL_LENGTH = 2_048;

/**
 * 약관이 자동 수집을 막는 곳. 읽지 않는다(링크로 보여 주는 것과 다르다).
 *
 * - 네이버: 서비스 이용약관이 사전 허락 없는 자동화 수단(매크로·봇·스크래퍼)을 금지한다
 *   (policy.naver.com/rules/service.html, 2026-10-01 시행판, 2026-11-18 원문 확인). 네이버 글은
 *   검색 API 가 주는 요약만 쓴다. 밴드(band.us)도 네이버 서비스다.
 * - 카카오(다음·티스토리·카카오맵·채널): 운영정책이 허용하지 않은 방법의 이용을 금지한다.
 * - 메타(인스타그램·페이스북·스레드), 구글·유튜브, X, 틱톡: 약관이 허락 없는 자동 수집을 금지한다.
 *
 * 하위 도메인까지 막는다(`m.blog.naver.com`, `place.map.kakao.com` …).
 */
export const TERMS_BLOCKED_DOMAINS: readonly string[] = [
  "naver.com", "naver.me", "naver.net", "navercorp.com", "pstatic.net", "band.us", "blog.me", "modoo.at",
  "kakao.com", "kakaocorp.com", "kakaocdn.net", "kko.to", "daum.net", "daumcdn.net", "tistory.com",
  "brunch.co.kr",
  "instagram.com", "facebook.com", "fb.com", "fb.me", "threads.net", "threads.com",
  // 같은 회사의 짧은 주소·이미지 서버·메신저(2026-11-20 보안 검토).
  "instagr.am", "ig.me", "cdninstagram.com", "fbcdn.net", "whatsapp.com",
  "google.com", "google.co.kr", "goo.gl", "g.co", "youtube.com", "youtu.be",
  "x.com", "twitter.com", "t.co", "tiktok.com",
];

/** 사람이 만든 공개 사이트가 쓰지 않는 이름. 사내망·컨테이너·클라우드 메타데이터 이름이다. */
const INTERNAL_HOST_SUFFIXES: readonly string[] = [
  "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp",
  "svc", "cluster.local", "home.arpa", "in-addr.arpa", "ip6.arpa", "test", "invalid", "example",
];

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/u, "");
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isTermsBlockedHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return TERMS_BLOCKED_DOMAINS.some((domain) => hostMatchesSuffix(host, domain));
}

function isInternalHostName(host: string): boolean {
  // 점이 없는 한 단어 이름(`metadata`, `db`, `redis`)은 사내 DNS 로만 풀린다.
  if (!host.includes(".")) return true;
  if (host === "metadata.google.internal") return true;
  return INTERNAL_HOST_SUFFIXES.some((suffix) => hostMatchesSuffix(host, suffix));
}

/**
 * 주소 모양 검사. 읽기 전과 넘겨주기마다 같은 검사를 건다.
 *
 * IP 로 쓴 주소는 공개 IP 여도 받지 않는다. 업체 공식 페이지는 이름으로 온다. `http://2130706433/`
 * 처럼 십진수·16진수로 쓴 IPv4 도 URL 해석기가 점 표기로 바꿔 주므로 여기서 함께 걸린다.
 */
export function checkWebLookupUrl(raw: string | URL): WebLookupUrlCheck {
  const text = typeof raw === "string" ? raw.trim() : raw.toString();
  if (!text) return { ok: false, reason: "invalid_url" };
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(text) : new URL(raw.toString());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "scheme_not_allowed" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  // 기본 포트만 받는다. 8080·6379 같은 관리 포트로 가는 길을 닫는다.
  if (url.port !== "" && !(url.protocol === "https:" && url.port === "443")
    && !(url.protocol === "http:" && url.port === "80")) {
    return { ok: false, reason: "port_not_allowed" };
  }
  const host = normalizeHostname(url.hostname.replace(/^\[|\]$/gu, ""));
  if (!host) return { ok: false, reason: "invalid_url" };
  if (isIP(host) !== 0) return { ok: false, reason: "ip_literal_not_allowed" };
  if (isInternalHostName(host)) return { ok: false, reason: "internal_host" };
  if (isTermsBlockedHost(host)) return { ok: false, reason: "blocked_by_terms" };
  url.hash = "";
  return { ok: true, url, host };
}

const PRIVATE_IPV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // 이 네트워크
  ["10.0.0.0", 8], // 사설
  ["100.64.0.0", 10], // 통신사 공유 주소(CGNAT)
  ["127.0.0.0", 8], // 루프백
  ["169.254.0.0", 16], // 링크 로컬. 169.254.169.254 클라우드 메타데이터가 여기 있다
  ["172.16.0.0", 12], // 사설
  ["192.0.0.0", 24], // IETF 예약
  ["192.0.2.0", 24], // 문서용
  ["192.88.99.0", 24], // 6to4 중계
  ["192.168.0.0", 16], // 사설
  ["198.18.0.0", 15], // 성능 시험용
  ["198.51.100.0", 24], // 문서용
  ["203.0.113.0", 24], // 문서용
  ["224.0.0.0", 4], // 멀티캐스트
  ["240.0.0.0", 4], // 예약·브로드캐스트
] as const) {
  PRIVATE_IPV4.addSubnet(network, prefix, "ipv4");
}
// Azure 의 가상 머신 관리 주소(WireServer). 공개 대역 안에 있지만 클라우드 안에서는 메타데이터 길이다
// (2026-11-20 보안 검토). 지금 서버는 Azure 가 아니지만 옮겨 가도 열리지 않게 막아 둔다.
PRIVATE_IPV4.addAddress("168.63.129.16", "ipv4");

function isPublicIpv4(address: string): boolean {
  return isIP(address) === 4 && !PRIVATE_IPV4.check(address, "ipv4");
}

/** IPv6 글자를 16바이트로 푼다. `::` 줄임과 끝의 IPv4 표기(`::ffff:1.2.3.4`)를 다룬다. */
export function parseIpv6(address: string): number[] | null {
  let text = address.trim().toLowerCase().replace(/^\[|\]$/gu, "").replace(/%.*$/u, "");
  if (isIP(text) !== 6) return null;
  // 끝의 IPv4 표기(`::ffff:1.2.3.4`)를 16진수 두 묶음(`102:304`)으로 바꿔 한 가지 모양으로 푼다.
  const v4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(text);
  if (v4Tail) {
    const octets = v4Tail.slice(1, 5).map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, v4Tail.index)}${high}:${low}`;
  }
  let groups: string[];
  const gap = text.indexOf("::");
  if (gap === -1) {
    groups = text.split(":");
  } else {
    const left = text.slice(0, gap).split(":").filter((part) => part !== "");
    const right = text.slice(gap + 2).split(":").filter((part) => part !== "");
    const fill = 8 - left.length - right.length;
    // `::` 는 0 묶음 하나 이상을 줄인 것이다. 채울 자리가 없으면 잘못된 주소다.
    if (fill < 1) return null;
    groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function startsWithBits(bytes: number[], prefix: number[], bits: number): boolean {
  for (let bit = 0; bit < bits; bit += 1) {
    const byteIndex = Math.floor(bit / 8);
    const mask = 0x80 >> (bit % 8);
    if ((bytes[byteIndex] & mask) !== ((prefix[byteIndex] ?? 0) & mask)) return false;
  }
  return true;
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes || bytes.length !== 16) return false;
  const embeddedV4 = bytes.slice(12).join(".");
  // ::ffff:a.b.c.d (IPv4 를 담은 IPv6). 안의 IPv4 로 판정한다 — 사설 IPv4 를 감싸 우회하는 길이다.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicIpv4(embeddedV4);
  }
  // ::/96 (미지정·루프백·옛 IPv4 호환 표기)는 받지 않는다.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return false;
  // 전역 단일 주소(2000::/3)만 받는다. fc00::/7(사설), fe80::/10(링크 로컬), ff00::/8(멀티캐스트)는 밖이다.
  if (!startsWithBits(bytes, [0x20], 3)) return false;
  const blockedGlobalPrefixes: Array<[number[], number]> = [
    [[0x20, 0x01, 0x00, 0x00], 32], // Teredo (안에 다른 주소를 싣는다)
    [[0x20, 0x01, 0x0d, 0xb8], 32], // 문서용
    [[0x3f, 0xff], 20], // 문서용(RFC 9637)
    [[0x20, 0x01, 0x00, 0x10], 28], // ORCHID
    [[0x20, 0x01, 0x00, 0x20], 28], // ORCHIDv2
    [[0x20, 0x02], 16], // 6to4 (안에 IPv4 를 싣는다)
  ];
  return !blockedGlobalPrefixes.some(([prefix, bits]) => startsWithBits(bytes, prefix, bits));
}

/** DNS 가 준 IP 가 공개 인터넷 주소인가. 사설·루프백·링크 로컬·메타데이터·예약 범위는 거짓이다. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address.replace(/%.*$/u, ""));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

/** 같은 페이지인지 비교할 때 쓰는 모양. 조각(#)을 떼고 호스트를 소문자로 맞춘다. */
export function canonicalWebLookupUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    url.hostname = normalizeHostname(url.hostname);
    return url.toString();
  } catch {
    return null;
  }
}

/** 화면에 보이는 짧은 출처 이름. `www.` 를 뗀다. */
export function displayDomain(raw: string): string | null {
  try {
    return normalizeHostname(new URL(raw).hostname).replace(/^www\./u, "");
  } catch {
    return null;
  }
}
