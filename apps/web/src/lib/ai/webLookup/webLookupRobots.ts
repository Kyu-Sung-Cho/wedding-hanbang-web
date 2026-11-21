import {
  fetchWebLookupResource,
  WEB_LOOKUP_ROBOTS_TOKEN,
  type WebLookupResolver,
  type WebLookupTransport,
} from "@/lib/ai/webLookup/webLookupFetch";
import { stripLeadingBom } from "@/lib/ai/webLookup/webLookupText";

/**
 * robots.txt 를 지킨다(RFC 9309). 페이지를 읽기 전과 넘겨주기마다 그 주소의 규칙을 본다.
 *
 * - 우리 이름(`HanbangBot`) 묶음이 있으면 그것만, 없으면 `*` 묶음을 쓴다. 둘 다 없으면 허용.
 * - 가장 긴 규칙이 이긴다. 길이가 같으면 허용이 이긴다. `*` 와 끝의 `$` 를 안다.
 * - robots.txt 가 4xx 면 "없음"으로 보고 허용한다(RFC 9309 2.3.1.3).
 *   5xx·연결 실패·시간 초과면 "닿지 않음"으로 보고 **읽지 않는다**(같은 절 2.3.1.4).
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

type RobotsVerdict = { kind: "rules"; rules: RobotsRule[] } | { kind: "allow_all" } | { kind: "disallow_all" };

const ROBOTS_MAX_BYTES = 512 * 1024;
const ROBOTS_TIMEOUT_MS = 3_000;
const ROBOTS_MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 60 * 60 * 1000;
const UNREACHABLE_CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 256;

const robotsCache = new Map<string, { expiresAt: number; verdict: RobotsVerdict }>();

export function clearWebLookupRobotsCacheForTests(): void {
  robotsCache.clear();
}

export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of stripLeadingBom(text).split(/\r\n|\r|\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if ((key === "allow" || key === "disallow") && current) {
      // 빈 Disallow 는 "막지 않음" 이다. 규칙으로 넣지 않는다.
      if (!value) continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

function productToken(agent: string): string {
  return (/^[a-z_-]+/u.exec(agent.trim().toLowerCase())?.[0]) ?? "";
}

export function selectRobotsRules(
  groups: readonly RobotsGroup[],
  token: string = WEB_LOOKUP_ROBOTS_TOKEN,
): RobotsRule[] | null {
  const ours = groups.filter((group) => group.agents.some((agent) => productToken(agent) === token));
  if (ours.length) return ours.flatMap((group) => group.rules);
  const everyone = groups.filter((group) => group.agents.some((agent) => agent === "*"));
  if (everyone.length) return everyone.flatMap((group) => group.rules);
  return null;
}

/** 퍼센트 표기의 16진 글자를 대문자로 맞춘다(`%2f` 와 `%2F` 는 같은 글자다). */
function upperPercentHex(value: string): string {
  return value.replace(/%[0-9a-f]{2}/giu, (escape) => escape.toUpperCase());
}

/** 패턴 속 한글 같은 비ASCII 글자는 주소와 같은 퍼센트 표기로 맞춘다. */
function normalizePattern(pattern: string): string {
  return upperPercentHex(Array.from(pattern)
    .map((char) => (/[\x21-\x7e]/u.test(char) ? char : encodeURIComponent(char)))
    .join(""));
}

/**
 * RFC 9309 의 `*`(아무 글자 여럿)와 끝의 `$` 만 다룬다. 정규식으로 바꾸지 않는다: `/*a*a*a…b` 처럼
 * `*` 를 많이 넣은 규칙이 정규식에서 되돌아가기 폭주(ReDoS)를 일으켜 서버 전체를 멈출 수 있었다
 * (2026-11-20 보안 검토). 대신 `*` 로 나눈 조각을 왼쪽부터 차례로 찾는다. 앞에서부터 가장 이른
 * 자리를 고르는 것이 늘 맞는 답이고(뒤 조각에 남는 자리가 가장 넓다), 걸음 수는 경로 길이에 비례한다.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const normalized = normalizePattern(pattern);
  const anchored = normalized.endsWith("$");
  const body = anchored ? normalized.slice(0, -1) : normalized;
  const parts = body.split("*");
  const first = parts[0] ?? "";
  if (!path.startsWith(first)) return false;
  if (parts.length === 1) return anchored ? path.length === first.length : true;
  let position = first.length;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const part = parts[index] ?? "";
    if (!part) continue;
    const found = path.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  const last = parts[parts.length - 1] ?? "";
  if (!anchored) return last === "" || path.indexOf(last, position) >= 0;
  return path.length - last.length >= position && path.endsWith(last);
}

export function isPathAllowedByRobots(rules: readonly RobotsRule[] | null, rawPathAndQuery: string): boolean {
  if (!rules || rules.length === 0) return true;
  const pathAndQuery = upperPercentHex(rawPathAndQuery);
  if (pathAndQuery === "/robots.txt") return true;
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!robotsPatternMatches(rule.pattern, pathAndQuery)) continue;
    const length = normalizePattern(rule.pattern).length;
    const bestLength = best ? normalizePattern(best.pattern).length : -1;
    if (length > bestLength || (length === bestLength && rule.allow && !best?.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export interface RobotsCheckOptions {
  resolveHost?: WebLookupResolver;
  transport?: WebLookupTransport;
  signal?: AbortSignal;
  now?: () => number;
}

async function loadVerdict(origin: string, options: RobotsCheckOptions): Promise<RobotsVerdict> {
  const now = options.now ?? Date.now;
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > now()) return cached.verdict;

  const result = await fetchWebLookupResource(`${origin}/robots.txt`, {
    maxBytes: ROBOTS_MAX_BYTES,
    timeoutMs: ROBOTS_TIMEOUT_MS,
    maxRedirects: ROBOTS_MAX_REDIRECTS,
    accept: "text/plain,*/*;q=0.5",
    acceptContentType: () => true,
    signal: options.signal,
    resolveHost: options.resolveHost,
    transport: options.transport,
  });

  let verdict: RobotsVerdict;
  let ttl = CACHE_TTL_MS;
  if (result.ok) {
    const rules = selectRobotsRules(parseRobotsTxt(result.body.toString("utf8")));
    verdict = rules ? { kind: "rules", rules } : { kind: "allow_all" };
  } else if (result.reason === "http_status" && result.status !== undefined
    && result.status >= 400 && result.status < 500) {
    verdict = { kind: "allow_all" };
  } else {
    verdict = { kind: "disallow_all" };
    ttl = UNREACHABLE_CACHE_TTL_MS;
  }

  if (robotsCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = robotsCache.keys().next().value;
    if (oldest !== undefined) robotsCache.delete(oldest);
  }
  robotsCache.set(origin, { expiresAt: now() + ttl, verdict });
  return verdict;
}

export type RobotsDecision = "allowed" | "robots_disallow" | "robots_unreachable";

export async function checkRobotsForUrl(url: URL, options: RobotsCheckOptions = {}): Promise<RobotsDecision> {
  const verdict = await loadVerdict(url.origin, options);
  if (verdict.kind === "allow_all") return "allowed";
  if (verdict.kind === "disallow_all") return "robots_unreachable";
  return isPathAllowedByRobots(verdict.rules, `${url.pathname}${url.search}`) ? "allowed" : "robots_disallow";
}
