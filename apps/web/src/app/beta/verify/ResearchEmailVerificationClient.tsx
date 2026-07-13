"use client";

import { useLayoutEffect, useRef, useState } from "react";

import VerificationResultCard, {
  type VerificationResultKind,
} from "./VerificationResultCard";

const CLIENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{43}$/;

export function consumeVerificationFragment(
  fragment: string,
  clearAddress: () => void
): string | null {
  // Remove the capability from the address bar before parsing or rendering it.
  // The value remains only in the caller's in-memory ref until one explicit POST.
  try {
    clearAddress();
  } catch {
    return null;
  }
  if (!fragment.startsWith("#")) return null;
  try {
    const params = new URLSearchParams(fragment.slice(1));
    const keys = [...params.keys()];
    const tokens = params.getAll("token");
    if (keys.length !== 1 || keys[0] !== "token" || tokens.length !== 1) return null;
    return CLIENT_TOKEN_PATTERN.test(tokens[0]) ? tokens[0] : null;
  } catch {
    return null;
  }
}

function isResultKind(value: unknown): value is VerificationResultKind {
  return value === "verified"
    || value === "expired"
    || value === "invalid"
    || value === "unavailable";
}

export async function postResearchEmailVerification(
  token: string,
  fetchImplementation: typeof fetch = fetch
): Promise<VerificationResultKind> {
  const response = await fetchImplementation("/api/preregister/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Research-Email-Verification": "1",
    },
    body: JSON.stringify({ token }),
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new Error("VERIFICATION_RESPONSE_UNAVAILABLE");
  }
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error("VERIFICATION_RESPONSE_UNAVAILABLE");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("VERIFICATION_RESPONSE_UNAVAILABLE");
  }
  const status = (body as { status?: unknown }).status;
  if (!isResultKind(status) || status === "unavailable") {
    throw new Error("VERIFICATION_RESPONSE_UNAVAILABLE");
  }
  return status;
}

export default function ResearchEmailVerificationClient() {
  const capabilityRef = useRef<string | null>(null);
  const capturedRef = useRef(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "invalid">("loading");
  const [result, setResult] = useState<VerificationResultKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const capability = consumeVerificationFragment(
      window.location.hash,
      () => window.history.replaceState(null, "", window.location.pathname)
    );
    capabilityRef.current = capability;
    setPhase(capability ? "ready" : "invalid");
  }, []);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const capability = capabilityRef.current;
    if (!capability || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const status = await postResearchEmailVerification(capability);
      capabilityRef.current = null;
      window.history.replaceState(null, "", `/beta/verify?status=${status}`);
      setResult(status);
    } catch {
      // Keep the capability only in memory so the person can retry without
      // reopening the email after a transient network failure.
      setError("네트워크 연결을 확인한 뒤 다시 눌러주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <VerificationResultCard resultKind={result} />;
  if (phase === "invalid") return <VerificationResultCard resultKind="invalid" />;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f4ee] px-5 py-12 text-[#263832]">
      <section className="w-full max-w-lg rounded-[2rem] border border-[#e1d8cc] bg-white px-7 py-10 text-center shadow-[0_24px_70px_rgba(48,66,58,0.10)] sm:px-11 sm:py-12">
        <div
          aria-hidden="true"
          className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-full bg-[#e7f0e9] text-xl font-semibold text-[#36534e]"
        >
          {phase === "loading" ? "…" : "→"}
        </div>
        <p className="text-xs font-semibold tracking-[0.18em] text-[#718078]">
          {phase === "loading" ? "확인 링크 보호 중" : "마지막 확인"}
        </p>
        <h1 className="mt-4 text-balance font-serif-kr text-2xl font-medium leading-snug sm:text-3xl">
          {phase === "loading" ? "확인 링크를 안전하게 준비하고 있어요" : "이메일 주소를 확인할까요?"}
        </h1>
        <p className="mt-5 text-pretty text-[15px] leading-7 text-[#59665f]">
          {phase === "loading"
            ? "주소창에서 확인 정보를 지우고 있습니다."
            : "메일 링크를 연 것만으로는 확인되지 않았습니다. 아래 버튼을 직접 눌러야 신청 이메일이 확인됩니다."}
        </p>
        <div className="my-7 h-px bg-[#eee8df]" aria-hidden="true" />
        <p className="text-pretty text-[13px] leading-6 text-[#7d7166]">
          확인 후 선정 검토 대상에 포함되지만, 이메일 확인 자체는 코호트 선정을 의미하지 않습니다.
          이 화면을 새로고침하면 이메일의 링크를 다시 열어야 합니다.
        </p>
        {phase === "ready" && (
          <form onSubmit={confirm} className="mt-8">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#36534e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2b423e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534e] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "확인 중…" : "내 이메일 주소 확인하기"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm leading-6 text-[#795252]">
            {error}
          </p>
        )}
        <noscript>
          <p className="mt-4 text-sm leading-6 text-[#795252]">
            안전한 이메일 확인을 위해 JavaScript를 켠 뒤 메일 링크를 다시 열어주세요.
          </p>
        </noscript>
        <p className="mt-5 text-xs leading-5 text-[#9a9187]">
          확인 링크나 신청 정보를 다른 사람에게 전달하지 마세요.
        </p>
      </section>
    </main>
  );
}
