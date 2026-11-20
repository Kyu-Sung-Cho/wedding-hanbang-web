import type { CaptureResult } from "posthog-js";

// 2026-11-17 랜딩이 앱 "시작" 화면 하나가 되면서(파운더 디자인 아티팩트) 자리는 셋만 남았다.
// 2026-11-18 첫 화면 아래 섹션이 생기며(파운더 요청 "랜딩도 만들어야지 비슷하게") 마무리의 두 행동이 더해졌다.
export const LANDING_CTA_SOURCES = [
  "landing_header",
  "landing_hero_primary",
  "landing_hero_secondary",
  "landing_closing_primary",
  "landing_closing_secondary",
] as const;
export type LandingCtaSource = (typeof LANDING_CTA_SOURCES)[number];

const SOURCE_SET = new Set<string>(LANDING_CTA_SOURCES);
const LANDING_OBSERVATION_MARKER = "__hanbang_landing_observation";

type LandingObservation = Readonly<{
  event: "$pageview" | "landing_cta_click";
  source?: LandingCtaSource;
  url: string;
  host: string;
  observedAt: number;
}>;

const pendingObservations = new Map<string, LandingObservation>();
let observationSequence = 0;

function isLandingCtaSource(source: unknown): source is LandingCtaSource {
  return typeof source === "string" && SOURCE_SET.has(source);
}

/** 이동 전에 실제 랜딩에서 관측한 이벤트만 예외 경로로 보낼 수 있다. */
export function observeLandingAnalytics(
  event: LandingObservation["event"],
  location: Pick<Location, "origin" | "pathname">,
  source?: unknown,
): LandingObservation | null {
  if (location.pathname !== "/landing") return null;
  if (event !== "$pageview" && event !== "landing_cta_click") return null;
  const knownSource = isLandingCtaSource(source) ? source : undefined;
  if (event === "landing_cta_click" && !knownSource) return null;
  try {
    const origin = new URL(location.origin);
    if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
    return {
      event,
      ...(event === "landing_cta_click" ? { source: knownSource } : {}),
      url: `${origin.origin}/landing`,
      host: origin.host,
      observedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * SDK capture의 before_send는 동기로 실행된다. 토큰은 그 호출 동안만 유효하고
 * 한 번 소비한 뒤 버린다. 로드 대기 중에는 토큰을 등록하거나 브라우저에 저장하지 않는다.
 */
export function dispatchLandingAnalytics(
  observation: LandingObservation,
  dispatch: (properties: Record<string, unknown>, timestamp: Date) => void,
) {
  const marker = String(++observationSequence);
  pendingObservations.set(marker, observation);
  try {
    dispatch({
      [LANDING_OBSERVATION_MARKER]: marker,
      $current_url: observation.url,
      $pathname: "/landing",
      ...(observation.source ? { source: observation.source } : {}),
    }, new Date(observation.observedAt));
  } finally {
    pendingObservations.delete(marker);
  }
}

/** 잘못 붙은 내부 표식도 일반 전송으로 빠져나가지 않게 이 경계에서 처리한다. */
export function isLandingAnalyticsCapture(capture: CaptureResult | null): boolean {
  return Boolean(capture && (
    capture.event === "landing_cta_click"
    || (capture.properties && Object.prototype.hasOwnProperty.call(capture.properties, LANDING_OBSERVATION_MARKER))
  ));
}

const SDK_STRING_PROPERTIES = new Set([
  "token", "distinct_id", "$session_id", "$window_id", "$device_id", "$pageview_id",
  "$browser", "$os", "$os_name", "$os_version", "$device", "$device_type", "$lib", "$lib_version",
]);
const SDK_NUMBER_PROPERTIES = new Set([
  "$browser_version", "$screen_height", "$screen_width", "$viewport_height", "$viewport_width",
]);

/**
 * 빠르게 이동해도 랜딩 분모와 클릭을 함께 보존하되, SDK가 이동 후 붙인 사적 주소는
 * 받지 않는다. 이 두 이벤트는 UTM·referrer 귀속 대신 고정 경로만 남긴다. 기존 UTM
 * 채널 집계와 직접 비교할 수 없으며, 임의 query를 되살려 귀속을 보충하지 않는다.
 */
export function sanitizeLandingAnalyticsCapture(capture: CaptureResult | null): CaptureResult | null {
  if (!capture?.properties) return null;
  const marker: unknown = capture.properties[LANDING_OBSERVATION_MARKER];
  if (typeof marker !== "string") return null;
  const observation = pendingObservations.get(marker);
  pendingObservations.delete(marker);
  if (!observation || capture.event !== observation.event
    || capture.properties.$current_url !== observation.url
    || capture.properties.$pathname !== "/landing"
    || (observation.event === "landing_cta_click" && capture.properties.source !== observation.source)) return null;

  const properties: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(capture.properties)) {
    if (SDK_STRING_PROPERTIES.has(key) && typeof value === "string"
      && value.length > 0 && value.length <= 256 && !/[?#]|https?:\/\//i.test(value)) {
      properties[key] = value;
    } else if ((SDK_NUMBER_PROPERTIES.has(key) || key === "distinct_id")
      && typeof value === "number" && Number.isFinite(value) && value >= 0) {
      properties[key] = value;
    } else if ((key === "$is_identified" || key === "$process_person_profile") && typeof value === "boolean") {
      properties[key] = value;
    }
  }
  properties.$current_url = observation.url;
  properties.$pathname = "/landing";
  properties.$host = observation.host;
  if (observation.source) properties.source = observation.source;

  // SDK의 $set/$set_once는 properties 밖에도 온다. capture 전체를 펼치면 안 된다.
  return {
    event: observation.event,
    uuid: capture.uuid,
    timestamp: new Date(observation.observedAt),
    properties,
  };
}
