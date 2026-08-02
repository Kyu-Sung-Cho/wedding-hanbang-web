"use client";

import { Bell, Heart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUserScopedClientActor } from "@/components/common/UserScopedClientStateBoundary";
import { expectedActorHeaders } from "@/lib/auth/actorFence";
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
  const actor = useUserScopedClientActor();
  const actorKey = actor.status === "ready" ? actor.actorKey : null;
  const actorUserId = actor.status === "ready" && actor.kind === "user" ? actor.userId : null;
  const [favorite, setFavorite] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [stateActorKey, setStateActorKey] = useState<string | null>(null);
  const [favoriteStatus, setFavoriteStatus] = useState<SavedStateStatus>("loading");
  const [alertStatus, setAlertStatus] = useState<SavedStateStatus>("loading");
  const [busy, setBusy] = useState<"favorite" | "alert" | null>(null);
  const [showGate, setShowGate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationBusyRef = useRef(false);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const latestVendorIdRef = useRef(vendorId);
  const actorKeyRef = useRef(actorKey);
  latestVendorIdRef.current = vendorId;
  actorKeyRef.current = actorKey;
  const canUsePrivateState = actorKey !== null && stateActorKey === actorKey;
  const currentFavorite = canUsePrivateState ? favorite : false;
  const currentSubscribed = canUsePrivateState ? subscribed : false;
  const currentFavoriteStatus: SavedStateStatus = canUsePrivateState ? favoriteStatus : "loading";
  const currentAlertStatus: SavedStateStatus = canUsePrivateState ? alertStatus : "loading";
  const currentBusy = canUsePrivateState ? busy : null;
  const currentError = canUsePrivateState ? error : null;

  const loadSavedState = useCallback(async () => {
    loadAbortRef.current?.abort();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = null;
    mutationBusyRef.current = false;
    setBusy(null);
    setShowGate(false);
    if (!actorKey) {
      loadGenerationRef.current += 1;
      setStateActorKey(null);
      setFavoriteStatus("loading");
      setAlertStatus("loading");
      setFavorite(false);
      setSubscribed(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const requestedActorKey = actorKey;
    const generation = ++loadGenerationRef.current;
    setStateActorKey(requestedActorKey);
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
      || actorKeyRef.current !== requestedActorKey
    ) return;

    setFavorite(favoriteResult.selected);
    setFavoriteStatus(favoriteResult.status);
    setSubscribed(alertResult.selected);
    setAlertStatus(alertResult.status);
  }, [actorKey, vendorId]);

  useEffect(() => {
    track("vendor_detail_view", { vendor_id: vendorId, surface: "price_detail" });
    void loadSavedState();
    return () => {
      loadAbortRef.current?.abort();
      mutationAbortRef.current?.abort();
      loadGenerationRef.current += 1;
    };
  }, [loadSavedState, vendorId]);

  async function toggleFavorite() {
    if (!actorKey || !canUsePrivateState) return;
    if (mutationBusyRef.current) return;
    if (currentFavoriteStatus === "guest") {
      setShowGate(true);
      return;
    }
    if (currentFavoriteStatus !== "ready") return;
    const requestedVendorId = vendorId;
    const requestedActorKey = actorKey;
    const requestedGeneration = loadGenerationRef.current;
    const controller = new AbortController();
    const isCurrentMutation = () => (
      !controller.signal.aborted
      && mutationAbortRef.current === controller
      && latestVendorIdRef.current === requestedVendorId
      && actorKeyRef.current === requestedActorKey
      && loadGenerationRef.current === requestedGeneration
    );
    const desiredFavorite = !currentFavorite;
    mutationBusyRef.current = true;
    mutationAbortRef.current = controller;
    setBusy("favorite");
    setError(null);
    try {
      const response = await mobileAuthenticatedFetch("/api/favorites", {
        method: desiredFavorite ? "POST" : "DELETE",
        headers: {
          "content-type": "application/json",
          ...(actorUserId ? expectedActorHeaders(actorUserId) : {}),
        },
        body: JSON.stringify({ vendorId }),
        signal: controller.signal,
      });
      if (!isCurrentMutation()) return;
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
      if (!isCurrentMutation()) return;
      if (body.isFavorite !== desiredFavorite) {
        setError("찜 상태를 확인하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setFavorite(desiredFavorite);
      if (desiredFavorite) {
        track("wishlist_add", { vendor_id: requestedVendorId, surface: "price_detail" });
      }
    } catch (caught: unknown) {
      if (isCurrentMutation() && !(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("찜 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      if (mutationAbortRef.current === controller) {
        mutationAbortRef.current = null;
        mutationBusyRef.current = false;
        setBusy(null);
      }
    }
  }

  async function toggleAlert() {
    if (!actorKey || !canUsePrivateState) return;
    if (mutationBusyRef.current) return;
    if (currentAlertStatus === "guest") {
      setShowGate(true);
      return;
    }
    if (currentAlertStatus !== "ready") return;
    const requestedVendorId = vendorId;
    const requestedActorKey = actorKey;
    const requestedGeneration = loadGenerationRef.current;
    const controller = new AbortController();
    const isCurrentMutation = () => (
      !controller.signal.aborted
      && mutationAbortRef.current === controller
      && latestVendorIdRef.current === requestedVendorId
      && actorKeyRef.current === requestedActorKey
      && loadGenerationRef.current === requestedGeneration
    );
    const desiredSubscription = !currentSubscribed;
    mutationBusyRef.current = true;
    mutationAbortRef.current = controller;
    setBusy("alert");
    setError(null);
    try {
      const response = await mobileAuthenticatedFetch("/api/price/alerts", {
        method: desiredSubscription ? "POST" : "DELETE",
        headers: {
          "content-type": "application/json",
          ...(actorUserId ? expectedActorHeaders(actorUserId) : {}),
        },
        body: JSON.stringify({ vendorId }),
        signal: controller.signal,
      });
      if (!isCurrentMutation()) return;
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
      if (!isCurrentMutation()) return;
      if (body.subscribed !== desiredSubscription) {
        setError("가격 알림 상태를 확인하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setSubscribed(desiredSubscription);
      if (desiredSubscription) {
        track("alert_subscribe", { vendor_id: requestedVendorId, surface: "price_detail" });
      }
    } catch (caught: unknown) {
      if (isCurrentMutation() && !(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("가격 알림 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      if (mutationAbortRef.current === controller) {
        mutationAbortRef.current = null;
        mutationBusyRef.current = false;
        setBusy(null);
      }
    }
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:flex">
        <button
          type="button"
          onClick={toggleFavorite}
          disabled={currentFavoriteStatus === "loading" || currentFavoriteStatus === "error" || currentBusy !== null}
          aria-busy={currentFavoriteStatus === "loading" || currentBusy === "favorite"}
          aria-pressed={currentFavorite}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#243832]/20 bg-white px-4 text-sm font-bold text-[#243832] disabled:opacity-50"
        >
          <Heart className={`size-4 ${currentFavorite ? "fill-[#B89785] text-[#B89785]" : ""}`} aria-hidden="true" />
          {currentFavorite ? "찜했어요" : "찜하기"}
        </button>
        <button
          type="button"
          onClick={toggleAlert}
          disabled={currentAlertStatus === "loading" || currentAlertStatus === "error" || currentBusy !== null}
          aria-busy={currentAlertStatus === "loading" || currentBusy === "alert"}
          aria-pressed={currentSubscribed}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          <Bell className={`size-4 ${currentSubscribed ? "fill-white" : ""}`} aria-hidden="true" />
          {currentSubscribed ? "가격 알림 받는 중" : "가격변동 알림 받기"}
        </button>
      </div>

      {currentFavoriteStatus === "error" || currentAlertStatus === "error" ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#8F6662]/25 bg-[#F5ECE4] px-4 py-3 text-sm text-[#7A4742]">
          <p className="font-semibold">
            {[currentFavoriteStatus === "error" ? "찜" : null, currentAlertStatus === "error" ? "가격 알림" : null]
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

      {currentError ? (
        <p role="alert" className="mt-3 rounded-xl border border-[#8F6662]/25 bg-[#F5ECE4] px-4 py-3 text-sm font-semibold text-[#7A4742]">
          {currentError}
        </p>
      ) : null}

      <AuthGateModal
        open={canUsePrivateState && showGate}
        redirectPath={redirectPath}
        onClose={() => setShowGate(false)}
      />
    </>
  );
}
