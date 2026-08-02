// first-touch UTM 보존 — 유통 링크는 /check·/wedding으로 들어오는데 사전등록
// 폼은 /beta에 있어, 세션 내 이동 후 제출에도 최초 유입 출처가 실리도록
// sessionStorage에 first-touch만 저장한다 (이후 UTM은 덮어쓰지 않음).
// PostHog $pageview 자동 캡처와 별개로, preregistrations 테이블의 채널 전환
// 측정(G1 판정)에 쓰인다.

import { sanitizeUtmFields } from "@/utils/campaignAttribution";

const STORAGE_KEY = "hanbang_first_utm";

export interface StoredUtm {
  source?: string;
  medium?: string;
  campaign?: string;
}

export function persistFirstTouchUtm(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return; // first-touch 유지
    const params = new URLSearchParams(window.location.search);
    const source = params.get("utm_source");
    if (!source) return;
    const sanitized = sanitizeUtmFields({
      source,
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
    });
    if (!sanitized.source) return;
    const utm: StoredUtm = {
      source: sanitized.source,
      medium: sanitized.medium ?? undefined,
      campaign: sanitized.campaign ?? undefined,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(utm));
  } catch {
    // storage 불가 환경(시크릿 모드 등)은 무시 — 제출 시 URL 폴백이 있다
  }
}

export function readStoredUtm(): StoredUtm | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const record = value as Record<string, unknown>;
    const sanitized = sanitizeUtmFields({
      source: record.source,
      medium: record.medium,
      campaign: record.campaign,
    });
    if (!sanitized.source) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const cleanValue: StoredUtm = {
      source: sanitized.source,
      medium: sanitized.medium ?? undefined,
      campaign: sanitized.campaign ?? undefined,
    };
    const canonical = JSON.stringify(cleanValue);
    if (canonical !== raw) window.sessionStorage.setItem(STORAGE_KEY, canonical);
    return cleanValue;
  } catch {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
    return null;
  }
}
