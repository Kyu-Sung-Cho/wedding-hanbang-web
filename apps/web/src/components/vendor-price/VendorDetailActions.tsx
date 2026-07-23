"use client";

import { Bell, Heart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AuthGateModal } from "@/components/price/AuthGateModal";
import { track } from "@/lib/analytics/track";
import { mobileAuthenticatedFetch } from "@/lib/mobile/mobileAuthenticatedFetch";

type Props = {
  vendorId: string;
  redirectPath: string;
};

type SavedStateStatus = "loading" | "ready" | "guest" | "error";
type MembershipResult = {
  status: Exclude<SavedStateStatus, "loading">;
  selected: boolean;
};

async function loadMembership(
  url: string,
  vendorId: string,
  signal: AbortSignal,
): Promise<MembershipResult> {
  try {
    const response = await mobileAuthenticatedFetch(url, { cache: "no-store", signal });
    if (response.status === 401) return { status: "guest", selected: false };
    if (!response.ok) return { status: "error", selected: false };
    const body = await response.json() as { vendorIds?: unknown };
    if (
      !Array.isArray(body.vendorIds)
      || !body.vendorIds.every((id): id is string => typeof id === "string" && id.length > 0)
    ) {
      return { status: "error", selected: false };
    }
    return { status: "ready", selected: body.vendorIds.includes(vendorId) };
  } catch {
    return { status: "error", selected: false };
  }
}

export default function VendorDetailActions({ vendorId, redirectPath }: Props) {
  const [favorite, setFavorite] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [favoriteStatus, setFavoriteStatus] = useState<SavedStateStatus>("loading");
  const [alertStatus, setAlertStatus] = useState<SavedStateStatus>("loading");
  const [busy, setBusy] = useState<"favorite" | "alert" | null>(null);
  const [showGate, setShowGate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationBusyRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const latestVendorIdRef = useRef(vendorId);
  latestVendorIdRef.current = vendorId;

  const loadSavedState = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const generation = ++loadGenerationRef.current;
    setFavoriteStatus("loading");
    setAlertStatus("loading");
    setFavorite(false);
    setSubscribed(false);
    setError(null);

    const [favoriteResult, alertResult] = await Promise.all([
      loadMembership("/api/favorites", vendorId, controller.signal),
      loadMembership("/api/price/alerts", vendorId, controller.signal),
    ]);
    if (
      controller.signal.aborted
      || generation !== loadGenerationRef.current
      || latestVendorIdRef.current !== vendorId
    ) return;

    setFavorite(favoriteResult.selected);
    setFavoriteStatus(favoriteResult.status);
    setSubscribed(alertResult.selected);
    setAlertStatus(alertResult.status);
  }, [vendorId]);

  useEffect(() => {
    track("vendor_detail_view", { vendor_id: vendorId, surface: "price_detail" });
    void loadSavedState();
    return () => {
      loadAbortRef.current?.abort();
      loadGenerationRef.current += 1;
    };
  }, [loadSavedState, vendorId]);

  async function toggleFavorite() {
    if (mutationBusyRef.current) return;
    if (favoriteStatus === "guest") {
      setShowGate(true);
      return;
    }
    if (favoriteStatus !== "ready") return;
    const requestedVendorId = vendorId;
    const desiredFavorite = !favorite;
    mutationBusyRef.current = true;
    setBusy("favorite");
    setError(null);
    try {
      const response = await mobileAuthenticatedFetch("/api/favorites", {
        method: desiredFavorite ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      if (latestVendorIdRef.current !== requestedVendorId) return;
      if (response.status === 401) {
        setFavoriteStatus("guest");
        setShowGate(true);
        return;
      }
      if (!response.ok) {
        setError("찜 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const body = await response.json();
      if (latestVendorIdRef.current !== requestedVendorId) return;
      if (body.isFavorite !== desiredFavorite) {
        setError("찜 상태를 확인하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setFavorite(desiredFavorite);
      if (desiredFavorite) {
        track("wishlist_add", { vendor_id: requestedVendorId, surface: "price_detail" });
      }
    } catch {
      if (latestVendorIdRef.current === requestedVendorId) {
        setError("찜 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      mutationBusyRef.current = false;
      setBusy(null);
    }
  }

  async function toggleAlert() {
    if (mutationBusyRef.current) return;
    if (alertStatus === "guest") {
      setShowGate(true);
      return;
    }
    if (alertStatus !== "ready") return;
    const requestedVendorId = vendorId;
    const desiredSubscription = !subscribed;
    mutationBusyRef.current = true;
    setBusy("alert");
    setError(null);
    try {
      const response = await mobileAuthenticatedFetch("/api/price/alerts", {
        method: desiredSubscription ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      if (latestVendorIdRef.current !== requestedVendorId) return;
      if (response.status === 401) {
        setAlertStatus("guest");
        setShowGate(true);
        return;
      }
      if (!response.ok) {
        setError("가격 알림 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const body = await response.json();
      if (latestVendorIdRef.current !== requestedVendorId) return;
      if (body.subscribed !== desiredSubscription) {
        setError("가격 알림 상태를 확인하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setSubscribed(desiredSubscription);
      if (desiredSubscription) {
        track("alert_subscribe", { vendor_id: requestedVendorId, surface: "price_detail" });
      }
    } catch {
      if (latestVendorIdRef.current === requestedVendorId) {
        setError("가격 알림 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      mutationBusyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:flex">
        <button
          type="button"
          onClick={toggleFavorite}
          disabled={favoriteStatus === "loading" || favoriteStatus === "error" || busy !== null}
          aria-busy={favoriteStatus === "loading" || busy === "favorite"}
          aria-pressed={favorite}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#243832]/20 bg-white px-4 text-sm font-bold text-[#243832] disabled:opacity-50"
        >
          <Heart className={`size-4 ${favorite ? "fill-[#B89785] text-[#B89785]" : ""}`} aria-hidden="true" />
          {favorite ? "찜했어요" : "찜하기"}
        </button>
        <button
          type="button"
          onClick={toggleAlert}
          disabled={alertStatus === "loading" || alertStatus === "error" || busy !== null}
          aria-busy={alertStatus === "loading" || busy === "alert"}
          aria-pressed={subscribed}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          <Bell className={`size-4 ${subscribed ? "fill-white" : ""}`} aria-hidden="true" />
          {subscribed ? "가격 알림 받는 중" : "가격변동 알림 받기"}
        </button>
      </div>

      {favoriteStatus === "error" || alertStatus === "error" ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#8F6662]/25 bg-[#F5ECE4] px-4 py-3 text-sm text-[#7A4742]">
          <p className="font-semibold">
            {[favoriteStatus === "error" ? "찜" : null, alertStatus === "error" ? "가격 알림" : null]
              .filter(Boolean)
              .join("·")} 상태를 불러오지 못했어요. 기존 저장은 변경하지 않았어요.
          </p>
          <button
            type="button"
            onClick={() => void loadSavedState()}
            className="inline-flex min-h-11 items-center rounded-full border border-[#8F6662]/30 bg-white px-4 text-xs font-bold hover:bg-[#FBF8F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]"
          >
            다시 불러오기
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-[#8F6662]/25 bg-[#F5ECE4] px-4 py-3 text-sm font-semibold text-[#7A4742]">
          {error}
        </p>
      ) : null}

      <AuthGateModal
        open={showGate}
        redirectPath={redirectPath}
        onClose={() => setShowGate(false)}
      />
    </>
  );
}
