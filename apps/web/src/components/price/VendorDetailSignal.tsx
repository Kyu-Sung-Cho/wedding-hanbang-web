"use client";

import { useEffect } from "react";

import { sendVendorSignal } from "@/lib/price/vendorSignals";

// 업체 상세 페이지 열람을 수요 카운터에 1회/세션 기록한다 (렌더 없음).
export function VendorDetailSignal({ vendorId }: { vendorId: string }) {
  useEffect(() => {
    const storageKey = `hb-price-detail-view:${vendorId}`;
    try {
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // 스토리지 불가 환경에서도 최선 노력으로 1회 전송.
    }
    sendVendorSignal(vendorId, "detail_view");
  }, [vendorId]);
  return null;
}
