"use client";

// 업체 수요 신호 비컨: 소비자 행동(노출·클릭·찜·조합)을 업체×지표로 자체 DB에 집계한다.
// 개인 식별 정보는 담지 않으며, 전송 실패는 조용히 무시한다(fire-and-forget).
export type VendorDemandMetric =
  | "impression"
  | "detail_click"
  | "detail_view"
  | "wishlist_add"
  | "combo_add";

const ENDPOINT = "/api/price/vendor-signals";
const FLUSH_DELAY_MS = 4_000;
const MAX_BATCH = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const queue: Array<{ vendor_id: string; metric: VendorDemandMetric }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

function flush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  const payload = JSON.stringify({ events });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
    } else {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // 집계는 최선 노력 — 사용자 경험에 영향 주지 않는다.
  }
  if (queue.length > 0) scheduleFlush();
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = setTimeout(flush, FLUSH_DELAY_MS);
}

function bindLifecycleFlush(): void {
  if (listenersBound || typeof document === "undefined") return;
  listenersBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

export function sendVendorSignal(vendorId: string, metric: VendorDemandMetric): void {
  if (!UUID_PATTERN.test(vendorId)) return;
  queue.push({ vendor_id: vendorId, metric });
  bindLifecycleFlush();
  if (queue.length >= MAX_BATCH) flush();
  else scheduleFlush();
}
