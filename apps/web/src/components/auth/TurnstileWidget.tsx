"use client";

// Cloudflare Turnstile 위젯 — 가입 폼 봇 차단.
// NEXT_PUBLIC_TURNSTILE_SITE_KEY 없으면 아무것도 렌더하지 않음(no-op).
// 토큰이 발급되면 onVerify(token)로 전달, 만료 시 onVerify("")로 초기화.

import { useEffect, useRef } from "react";
import { isPreviewStubMode } from "@/lib/previewStub";
import type { TurnstileAction } from "@/lib/turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      action?: TurnstileAction;
      theme?: "light" | "dark" | "auto";
    }
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export default function TurnstileWidget({
  action,
  onVerify,
}: {
  action: TurnstileAction;
  onVerify: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isPreviewStubMode() || !SITE_KEY || typeof window === "undefined") return;

    let cancelled = false;
    let readinessInterval: ReturnType<typeof setInterval> | null = null;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return; // 중복 렌더 방지
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        action,
        callback: (token) => onVerify(token),
        "expired-callback": () => onVerify(""),
        "error-callback": () => onVerify(""),
        theme: "light",
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      // 스크립트는 로드 중 — 짧게 폴링해 turnstile 준비되면 렌더
      readinessInterval = setInterval(() => {
        if (window.turnstile) {
          if (readinessInterval) clearInterval(readinessInterval);
          readinessInterval = null;
          renderWidget();
        }
      }, 200);
    }

    return () => {
      cancelled = true;
      if (readinessInterval) clearInterval(readinessInterval);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 이미 제거됨 — 무시
        }
        widgetIdRef.current = null;
      }
    };
  }, [action, onVerify]);

  if (isPreviewStubMode() || !SITE_KEY) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}
