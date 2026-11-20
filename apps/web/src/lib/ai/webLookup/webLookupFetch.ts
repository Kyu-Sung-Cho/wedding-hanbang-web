import { promises as dnsPromises } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import {
  checkWebLookupUrl,
  isPublicIpAddress,
  type WebLookupUrlRejection,
} from "@/lib/ai/webLookup/webLookupUrlPolicy";

/**
 * 찾아보기의 바깥 요청은 전부 이 함수 하나로 나간다.
 *
 * 지키는 것(08장·D-85):
 * - 주소마다(넘겨주기 포함) `checkWebLookupUrl` 을 다시 건다.
 * - DNS 가 준 IP 가 **하나라도** 공개 주소가 아니면 그 이름을 통째로 거절한다.
 * - 연결은 방금 검사한 IP 로만 한다(`pinnedLookup`). 검사 뒤에 DNS 가 사설 IP 로 바뀌어도
 *   (DNS 다시 묶기) 연결하는 쪽은 다시 묻지 않는다.
 * - 넘겨주기 횟수·받는 크기·전체 시간에 한도를 둔다. 받는 형식은 부르는 쪽이 정한다.
 * - 쿠키를 보내지도 받아 두지도 않는다. 연결 재사용(agent)도 하지 않는다.
 */

export const WEB_LOOKUP_USER_AGENT = "Mozilla/5.0 (compatible; HanbangBot/1.0)";
/** robots.txt 에서 우리를 가리키는 이름(RFC 9309 의 product token). */
export const WEB_LOOKUP_ROBOTS_TOKEN = "hanbangbot";

export interface WebLookupTransportRequest {
  url: URL;
  /** 검사를 통과한 IP. 연결은 이 주소로만 한다. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface WebLookupTransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer | Uint8Array | string>;
  destroy: () => void;
}

export type WebLookupTransport = (
  request: WebLookupTransportRequest,
) => Promise<WebLookupTransportResponse>;

export type WebLookupResolver = (
  host: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export interface WebLookupFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  accept: string;
  /** 받아도 되는 형식인가. 인자는 소문자 `type/subtype` 이다(없으면 빈 문자열). */
  acceptContentType: (mediaType: string) => boolean;
  /** 주소마다(넘겨주기 포함) 연결 전에 부른다. false 면 그 주소로 가지 않는다(robots.txt 등). */
  beforeRequest?: (url: URL) => Promise<boolean>;
  signal?: AbortSignal;
  /** 시험에서만 바꾼다. 기본은 운영 DNS. */
  resolveHost?: WebLookupResolver;
  /** 시험에서만 바꾼다. 기본은 node http/https + 고정 lookup. */
  transport?: WebLookupTransport;
}

export type WebLookupFetchFailureReason =
  | "url_rejected"
  | "hop_denied"
  | "dns_failed"
  | "private_address"
  | "too_many_redirects"
  | "http_status"
  | "content_type"
  | "timeout"
  | "network";

export type WebLookupFetchResult =
  | {
      ok: true;
      finalUrl: string;
      status: number;
      mediaType: string;
      charset: string | null;
      body: Buffer;
      truncated: boolean;
      redirects: number;
    }
  | {
      ok: false;
      reason: WebLookupFetchFailureReason;
      urlRejection?: WebLookupUrlRejection;
      status?: number;
      atUrl: string;
    };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 연결이 DNS 를 다시 묻지 않게, 검사한 주소 하나만 돌려주는 lookup. */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const done = (typeof options === "function" ? options : callback) as (
      error: NodeJS.ErrnoException | null,
      addressOrList: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void;
    const wantsAll = typeof options === "object" && options !== null
      && (options as { all?: boolean }).all === true;
    if (wantsAll) done(null, [{ address, family }]);
    else done(null, address, family);
  }) as LookupFunction;
}

const defaultResolveHost: WebLookupResolver = (host) =>
  dnsPromises.lookup(host, { all: true, verbatim: true });

const nodeTransport: WebLookupTransport = (request) =>
  new Promise((resolve, reject) => {
    const isHttps = request.url.protocol === "https:";
    const options: https.RequestOptions = {
      protocol: request.url.protocol,
      hostname: request.url.hostname,
      port: request.url.port || undefined,
      path: `${request.url.pathname}${request.url.search}`,
      method: "GET",
      headers: request.headers,
      agent: false,
      lookup: pinnedLookup(request.address, request.family),
      signal: request.signal,
      timeout: request.timeoutMs,
      ...(isHttps ? { servername: request.url.hostname } : {}),
    };
    const clientRequest = (isHttps ? https : http).request(options, (response) => {
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        destroy: () => response.destroy(),
      });
    });
    clientRequest.on("timeout", () => clientRequest.destroy(new Error("web_lookup_timeout")));
    clientRequest.on("error", reject);
    clientRequest.end();
  });

function headerValue(headers: WebLookupTransportResponse["headers"], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

export function parseContentType(raw: string): { mediaType: string; charset: string | null } {
  const [type, ...params] = raw.split(";");
  const mediaType = (type ?? "").trim().toLowerCase();
  let charset: string | null = null;
  for (const param of params) {
    const [key, value] = param.split("=");
    if (key?.trim().toLowerCase() === "charset" && value) {
      charset = value.trim().replace(/^["']|["']$/gu, "").toLowerCase() || null;
    }
  }
  return { mediaType, charset };
}

/** 신호가 오면 거절되는 약속과, 신호에 건 걸이를 떼는 함수. 거절은 늘 처리된 것으로 둔다. */
function abortRejection(signal: AbortSignal): { promise: Promise<never>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error("web_lookup_aborted"));
      return;
    }
    const onAbort = () => reject(new Error("web_lookup_aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    release = () => signal.removeEventListener("abort", onAbort);
  });
  promise.catch(() => undefined);
  return { promise, release };
}

/**
 * 시간 제한 신호가 오면 기다리기를 그만둔다. `dns.lookup` 은 멈출 수 없어서, 이름 서버가 답을 미루면
 * 8초 한도가 조회가 끝난 뒤에야 보였다(2026-11-20 보안 검토). 조회 자체는 뒤에서 끝까지 돌 수 있다.
 */
async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const abort = abortRejection(signal);
  try {
    return await Promise.race([promise, abort.promise]);
  } finally {
    abort.release();
  }
}

async function resolvePublicAddress(
  host: string,
  resolveHost: WebLookupResolver,
  signal: AbortSignal,
): Promise<{ address: string; family: 4 | 6 } | "dns_failed" | "private_address"> {
  let records: ReadonlyArray<{ address: string; family: number }>;
  try {
    records = await untilAborted(resolveHost(host), signal);
  } catch {
    return "dns_failed";
  }
  if (!records.length) return "dns_failed";
  // 하나라도 사설이면 거절한다. 공개 주소와 사설 주소를 섞어 주는 이름이 연결 순서를 노린다.
  if (records.some((record) => !isPublicIpAddress(record.address))) return "private_address";
  const chosen = records.find((record) => record.family === 4) ?? records[0];
  return { address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

async function readBodyWithin(
  response: WebLookupTransportResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ body: Buffer; truncated: boolean }> {
  const encoding = headerValue(response.headers, "content-encoding").trim().toLowerCase();
  const source = Readable.from(response.body);
  const decoder = encoding === "gzip" || encoding === "x-gzip"
    ? createGunzip()
    : encoding === "deflate"
      ? createInflate()
      : encoding === "br"
        ? createBrotliDecompress()
        : null;
  // `pipeline` 이라야 원천의 오류(연결 끊김·잘린 압축)가 풀개로 넘어가 아래 읽기가 오류로 끝난다.
  // `source.pipe(decoder)` 는 원천 오류를 넘기지 않아, 잡히지 않는 오류로 서버가 죽거나 읽기가 끝나지
  // 않았다(2026-11-20 보안 검토에서 재현). 오류는 읽는 쪽에서 받으므로 끝 알림은 비워 둔다.
  const stream: AsyncIterable<Buffer | string> = decoder ? pipeline(source, decoder, () => undefined) : source;
  const iterator = stream[Symbol.asyncIterator]();
  // 걸음마다 시간 제한 신호와 겨룬다. 바이트를 조금씩 흘리다 멈춘 서버는 원천을 닫아도 닫힘이 끝나지
  // 않을 수 있어(`Readable.from` 이 원천 정리를 기다린다), 닫힘에 기대지 않고 신호로 바로 빠져나온다.
  const abort = abortRejection(signal);
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const step = await Promise.race([iterator.next(), abort.promise]);
      if (step.done) break;
      const chunk = step.value;
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      if (total + buffer.length > maxBytes) {
        chunks.push(buffer.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(buffer);
      total += buffer.length;
    }
  } finally {
    abort.release();
    // 다 읽었든 한도에서 멈췄든 연결을 닫는다. 남은 바이트를 받지 않는다. 닫힘이 끝나길 기다리지 않는다.
    response.destroy();
    decoder?.destroy();
    source.destroy();
  }
  return { body: Buffer.concat(chunks, total), truncated };
}

export async function fetchWebLookupResource(
  startUrl: string,
  options: WebLookupFetchOptions,
): Promise<WebLookupFetchResult> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const deadline = Date.now() + options.timeoutMs;
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const transport = options.transport ?? nodeTransport;
  let current = startUrl;
  let redirects = 0;
  try {
    for (;;) {
      const check = checkWebLookupUrl(current);
      if (!check.ok) return { ok: false, reason: "url_rejected", urlRejection: check.reason, atUrl: current };
      if (options.beforeRequest && !(await options.beforeRequest(check.url))) {
        return { ok: false, reason: "hop_denied", atUrl: check.url.toString() };
      }
      if (controller.signal.aborted) return { ok: false, reason: "timeout", atUrl: check.url.toString() };
      const resolved = await resolvePublicAddress(check.host, resolveHost, controller.signal);
      if (resolved === "dns_failed" && controller.signal.aborted) {
        return { ok: false, reason: "timeout", atUrl: check.url.toString() };
      }
      if (resolved === "dns_failed" || resolved === "private_address") {
        return { ok: false, reason: resolved, atUrl: check.url.toString() };
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0 || controller.signal.aborted) {
        return { ok: false, reason: "timeout", atUrl: check.url.toString() };
      }
      let response: WebLookupTransportResponse;
      try {
        response = await transport({
          url: check.url,
          address: resolved.address,
          family: resolved.family,
          headers: {
            "User-Agent": WEB_LOOKUP_USER_AGENT,
            Accept: options.accept,
            "Accept-Language": "ko-KR,ko;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
          },
          timeoutMs: remainingMs,
          signal: controller.signal,
        });
      } catch {
        return {
          ok: false,
          reason: controller.signal.aborted ? "timeout" : "network",
          atUrl: check.url.toString(),
        };
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        response.destroy();
        const location = headerValue(response.headers, "location");
        if (!location) return { ok: false, reason: "http_status", status: response.status, atUrl: check.url.toString() };
        if (redirects >= options.maxRedirects) {
          return { ok: false, reason: "too_many_redirects", atUrl: check.url.toString() };
        }
        let next: URL;
        try {
          next = new URL(location, check.url);
        } catch {
          return { ok: false, reason: "url_rejected", urlRejection: "invalid_url", atUrl: location };
        }
        current = next.toString();
        redirects += 1;
        continue;
      }
      if (response.status !== 200) {
        response.destroy();
        return { ok: false, reason: "http_status", status: response.status, atUrl: check.url.toString() };
      }
      const { mediaType, charset } = parseContentType(headerValue(response.headers, "content-type"));
      if (!options.acceptContentType(mediaType)) {
        response.destroy();
        return { ok: false, reason: "content_type", atUrl: check.url.toString() };
      }
      try {
        const { body, truncated } = await readBodyWithin(response, options.maxBytes, controller.signal);
        return {
          ok: true,
          finalUrl: check.url.toString(),
          status: response.status,
          mediaType,
          charset,
          body,
          truncated,
          redirects,
        };
      } catch {
        return {
          ok: false,
          reason: controller.signal.aborted ? "timeout" : "network",
          atUrl: check.url.toString(),
        };
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
