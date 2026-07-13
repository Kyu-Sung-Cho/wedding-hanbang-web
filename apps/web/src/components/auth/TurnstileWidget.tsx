"use client";

// Cloudflare Turnstile 위젯 — 회원가입·비밀번호 복구 발송 표면 봇 차단.
// NEXT_PUBLIC_TURNSTILE_SITE_KEY 없으면 아무것도 렌더하지 않음(no-op).
// 토큰이 발급되면 onVerify(token)로 전달하고, 만료/오류 시 토큰을 지운다.

import { useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/lib/turnstile";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_MARKER = "data-hanbang-turnstile-script";
const SCRIPT_LOAD_TIMEOUT_MS = 8_000;

export type TurnstileFailureReason =
  | "error"
  | "expired"
  | "timeout"
  | "unsupported"
  | "load_timeout";

type TurnstileStatus =
  | "loading"
  | "ready"
  | "verified"
  | "expired"
  | "error";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: (errorCode: string) => boolean | void;
      "timeout-callback"?: () => void;
      "unsupported-callback"?: () => void;
      retry?: "auto" | "never";
      "refresh-expired"?: "auto" | "manual" | "never";
      "refresh-timeout"?: "auto" | "manual" | "never";
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
      language?: string;
      action: TurnstileAction;
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
  onError,
  theme = "light",
}: {
  action: TurnstileAction;
  onVerify: (token: string) => void;
  onError?: (reason: TurnstileFailureReason) => void;
  theme?: "light" | "dark" | "auto";
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<TurnstileStatus>("loading");
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onErrorRef.current = onError;
  }, [onError, onVerify]);

  useEffect(() => {
    if (!siteKey || typeof window === "undefined") return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let observedScript: HTMLScriptElement | null = null;

    const clearWaiters = () => {
      if (pollId !== null) clearInterval(pollId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      pollId = null;
      timeoutId = null;
    };

    const reportFailure = (reason: TurnstileFailureReason) => {
      if (cancelled) return;
      clearWaiters();
      onVerifyRef.current("");
      setStatus(reason === "expired" ? "expired" : "error");
      onErrorRef.current?.(reason);
    };

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return; // 중복 렌더 방지
      clearWaiters();
      try {
        setStatus("ready");
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          callback: (token) => {
            if (cancelled) return;
            onVerifyRef.current(token);
            setStatus("verified");
          },
          "expired-callback": () => reportFailure("expired"),
          "error-callback": () => {
            reportFailure("error");
            return true;
          },
          "timeout-callback": () => reportFailure("timeout"),
          "unsupported-callback": () => reportFailure("unsupported"),
          retry: "auto",
          "refresh-expired": "auto",
          "refresh-timeout": "auto",
          theme,
          size: "flexible",
          language: "ko",
        });
      } catch {
        reportFailure("error");
      }
    };

    const onScriptError = () => reportFailure("error");

    onVerifyRef.current("");
    if (window.turnstile) {
      renderWidget();
    } else {
      observedScript = document.querySelector<HTMLScriptElement>(
        `script[${SCRIPT_MARKER}="true"]`
      );
      if (!observedScript) {
        observedScript = document.createElement("script");
        observedScript.setAttribute(SCRIPT_MARKER, "true");
        observedScript.src = SCRIPT_SRC;
        observedScript.async = true;
        observedScript.defer = true;
        document.head.appendChild(observedScript);
      }
      observedScript.addEventListener("load", renderWidget);
      observedScript.addEventListener("error", onScriptError);

      // A previously inserted script may already be loading. Poll briefly, but
      // never leave the user with an unexplained permanently disabled action.
      pollId = setInterval(() => {
        if (window.turnstile) {
          renderWidget();
        }
      }, 100);
      timeoutId = setTimeout(
        () => reportFailure("load_timeout"),
        SCRIPT_LOAD_TIMEOUT_MS
      );
    }

    return () => {
      cancelled = true;
      clearWaiters();
      observedScript?.removeEventListener("load", renderWidget);
      observedScript?.removeEventListener("error", onScriptError);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 이미 제거됨 — 무시
        }
        widgetIdRef.current = null;
      }
    };
  }, [action, retryAttempt, siteKey, theme]);

  const retry = () => {
    onVerifyRef.current("");
    setStatus("loading");
    if (!window.turnstile) {
      document
        .querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}="true"]`)
        ?.remove();
    }
    setRetryAttempt((attempt) => attempt + 1);
  };

  if (!siteKey) return null;
  const failed = status === "error" || status === "expired";
  const statusText = status === "verified"
    ? "보안 확인이 완료됐어요."
    : status === "ready"
      ? "보안 확인을 진행하고 있어요."
      : status === "loading"
        ? "보안 확인을 불러오고 있어요."
        : status === "expired"
          ? "보안 확인 시간이 지났어요. 다시 확인해 주세요."
          : "보안 확인을 불러오지 못했어요. 네트워크 상태를 확인해 주세요.";
  const statusClassName = theme === "dark"
    ? failed
      ? "text-[12px] text-[#F4D8CF]"
      : "text-[12px] text-white/80"
    : failed
      ? "text-[12px] text-[#9A6B62]"
      : "text-[12px] text-[#6F665F]";
  const retryClassName = theme === "dark"
    ? "min-h-11 rounded-xl border border-white/50 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    : "min-h-11 rounded-xl border border-current px-4 py-2 text-[13px] font-medium text-[#795252] transition-colors hover:bg-[#9A6B62]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795252]/40";

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        ref={containerRef}
        className="flex min-h-[65px] w-full max-w-[320px] justify-center"
        aria-label="Cloudflare 봇 방지 보안 확인"
      />
      <p
        className={statusClassName}
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
      >
        {statusText}
      </p>
      {failed && (
        <button
          type="button"
          onClick={retry}
          className={retryClassName}
        >
          보안 확인 다시 시도
        </button>
      )}
    </div>
  );
}
