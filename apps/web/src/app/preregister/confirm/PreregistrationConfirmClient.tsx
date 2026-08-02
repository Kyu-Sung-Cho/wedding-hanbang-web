"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type Status = "loading" | "ready" | "processing" | "confirmed" | "cancelled" | "error";

export default function PreregistrationConfirmClient() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = fragment.get("token");
    const valid = [...fragment.keys()].length === 1
      && typeof fragmentToken === "string"
      && TOKEN_PATTERN.test(fragmentToken);

    // Remove the capability from browser history before the user decides.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    queueMicrotask(() => {
      if (!active) return;
      if (!valid) {
        setStatus("error");
        setError("확인 링크가 유효하지 않거나 만료되었습니다.");
        return;
      }
      setToken(fragmentToken);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit(action: "confirm" | "cancel") {
    if (!token || status === "processing") return;
    setStatus("processing");
    setError(null);
    try {
      const response = await fetch("/api/preregister/confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const body = await response.json() as { error?: unknown };
      if (!response.ok) {
        setStatus("error");
        setError(typeof body.error === "string"
          ? body.error
          : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setToken(null);
      setStatus(action === "confirm" ? "confirmed" : "cancelled");
    } catch {
      setStatus("error");
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  return (
    <section className="rounded-3xl border border-black/[0.06] bg-white p-7 shadow-sm md:p-10">
      <p className="mb-3 text-xs font-medium tracking-[0.16em] text-rose-500">
        이메일 소유권 확인
      </p>
      <h1 className="mb-4 text-2xl font-semibold tracking-[-0.02em] text-[#243832]">
        베타 신청을 직접 확인해주세요
      </h1>

      {status === "loading" && (
        <p className="text-sm leading-7 text-taupe-500" role="status">
          안전한 확인 링크를 준비하고 있습니다.
        </p>
      )}

      {(status === "ready" || status === "processing") && (
        <>
          <p className="mb-6 text-sm leading-7 text-charcoal">
            메일의 링크를 여는 것만으로는 신청되지 않습니다. 아래에서 확인을 눌러야
            암호화된 임시 신청 정보가 사전등록으로 이동합니다.
          </p>
          <div className="mb-6 rounded-2xl bg-ivory-100 px-4 py-4 text-xs leading-6 text-taupe-500">
            확인 전 임시 신청은 30분 후 만료됩니다. 신청하지 않았다면 취소를 눌러
            즉시 폐기할 수 있습니다.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void submit("confirm")}
              disabled={status === "processing"}
              className="min-h-12 flex-1 rounded-xl bg-[#36534E] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#243832] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "processing" ? "처리 중" : "베타 신청 확인"}
            </button>
            <button
              type="button"
              onClick={() => void submit("cancel")}
              disabled={status === "processing"}
              className="min-h-12 flex-1 rounded-xl border border-black/10 px-5 py-3 text-sm font-semibold text-charcoal transition-colors hover:bg-ivory-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              신청하지 않음 · 임시정보 삭제
            </button>
          </div>
        </>
      )}

      {status === "confirmed" && (
        <div role="status">
          <p className="mb-3 text-lg font-semibold text-[#36534E]">이메일 확인이 완료되었습니다.</p>
          <p className="text-sm leading-7 text-charcoal">
            베타 참여 가능 여부와 제공 범위를 이메일로 안내드리겠습니다.
          </p>
        </div>
      )}

      {status === "cancelled" && (
        <div role="status">
          <p className="mb-3 text-lg font-semibold text-[#36534E]">임시 신청을 삭제했습니다.</p>
          <p className="text-sm leading-7 text-charcoal">이 링크로는 더 이상 신청할 수 없습니다.</p>
        </div>
      )}

      {status === "error" && (
        <div role="alert">
          <p className="mb-3 text-sm font-semibold text-[#D95F5F]">{error}</p>
          <p className="text-sm leading-7 text-charcoal">
            링크가 만료된 경우 베타 신청 화면에서 새 확인 메일을 요청해주세요.
          </p>
        </div>
      )}

      <div className="mt-8 border-t border-black/[0.06] pt-5 text-xs leading-6 text-taupe-500">
        <Link href="/privacy" className="underline underline-offset-4 hover:text-rose-500">
          개인정보 처리방침
        </Link>
        <span aria-hidden> · </span>
        <a href="mailto:support@hanbang.ai" className="underline underline-offset-4 hover:text-rose-500">
          확인 후 신청 철회 요청
        </a>
      </div>
    </section>
  );
}
