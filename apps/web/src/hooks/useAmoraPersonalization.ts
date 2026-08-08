"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  mergeAmoraPersonalization,
  parseAmoraPersonalizationProfile,
  type AmoraPersonalizationChanges,
  type AmoraPersonalizationProfile,
} from "@/lib/amora/personalization";

type PersonalizationStatus = "idle" | "loading" | "ready" | "error";

type PersonalizationPayload = {
  profile?: unknown;
  current?: unknown;
  error?: string;
  code?: string;
};

async function readPayload(response: Response): Promise<PersonalizationPayload> {
  try {
    return (await response.json()) as PersonalizationPayload;
  } catch {
    return {};
  }
}

export function useAmoraPersonalization(enabled = true) {
  const [profile, setProfile] = useState<AmoraPersonalizationProfile | null>(
    null,
  );
  const [status, setStatus] = useState<PersonalizationStatus>(
    enabled ? "loading" : "idle",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      setProfile(null);
      setError(null);
      return null;
    }
    const sequence = ++requestSequence.current;
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/amora/personalization", {
        cache: "no-store",
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "도움 방식을 불러오지 못했어요.");
      }
      const nextProfile =
        payload.profile === null
          ? null
          : parseAmoraPersonalizationProfile(payload.profile);
      if (payload.profile !== null && !nextProfile) {
        throw new Error("저장된 도움 방식을 안전하게 읽지 못했어요.");
      }
      if (sequence === requestSequence.current) {
        setProfile(nextProfile);
        setStatus("ready");
      }
      return nextProfile;
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "도움 방식을 불러오지 못했어요.";
      if (sequence === requestSequence.current) {
        setError(message);
        setStatus("error");
      }
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const save = useCallback(
    async (changes: AmoraPersonalizationChanges) => {
      if (!enabled || saving) return null;
      setSaving(true);
      setError(null);
      try {
        const preferences = mergeAmoraPersonalization(
          profile?.preferences ?? null,
          changes,
        );
        const response = await fetch("/api/amora/personalization", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedRevision: profile?.revision ?? null,
            preferences,
          }),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          const current = parseAmoraPersonalizationProfile(payload.current);
          if (current) setProfile(current);
          throw new Error(payload.error ?? "도움 방식을 저장하지 못했어요.");
        }
        const nextProfile = parseAmoraPersonalizationProfile(payload.profile);
        if (!nextProfile) {
          throw new Error("저장 결과를 안전하게 확인하지 못했어요.");
        }
        setProfile(nextProfile);
        setStatus("ready");
        return nextProfile;
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "도움 방식을 저장하지 못했어요.";
        setError(message);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [enabled, profile?.preferences, profile?.revision, saving],
  );

  const reset = useCallback(async () => {
    if (!enabled || saving || !profile) return profile === null;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/amora/personalization", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: profile.revision }),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        const current = parseAmoraPersonalizationProfile(payload.current);
        if (current) setProfile(current);
        throw new Error(payload.error ?? "도움 방식을 초기화하지 못했어요.");
      }
      setProfile(null);
      setStatus("ready");
      return true;
    } catch (resetError) {
      const message =
        resetError instanceof Error
          ? resetError.message
          : "도움 방식을 초기화하지 못했어요.";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [enabled, profile, saving]);

  return {
    profile,
    status,
    saving,
    error,
    load,
    save,
    reset,
    clearError: () => setError(null),
  };
}
