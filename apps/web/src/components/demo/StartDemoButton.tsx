"use client";

import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { captureEvent } from "@/lib/analytics";
import { rememberDemoAmoraPrefill } from "@/lib/chat/demoHandoff";

// 아모라 체험은 그동안 로그인 페이지의 버튼 하나로만 들어갈 수 있었다.
// 가격을 다 본 사람에게 "체험하려면 로그인 페이지로 가세요"는 앞뒤가 맞지 않아
// 공개 표면에서 바로 체험 세션을 열어준다. 실패해도 현재 맥락을 잃지 않고
// 같은 버튼에서 다시 시도할 수 있게 한다.
interface StartDemoButtonProps {
  className?: string;
  label?: string;
  prefill?: string;
  analyticsSource?:
    | "start_here_priorities"
    | "start_here_early"
    | "start_here_without_date";
}

const DEMO_START_TIMEOUT_MS = 10_000;

export function StartDemoButton({
  className,
  label = "가입 없이 아모라 체험하기",
  prefill,
  analyticsSource,
}: StartDemoButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();
  const router = useRouter();

  async function startDemo() {
    if (pending) return;
    if (analyticsSource) {
      captureEvent("start_here_amora_start_click", { source: analyticsSource });
    }
    setPending(true);
    setError("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      DEMO_START_TIMEOUT_MS,
    );
    try {
      const response = await fetch("/api/demo/start", {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) {
        if (analyticsSource) {
          captureEvent("start_here_amora_start_result", {
            source: analyticsSource,
            result: "failure",
          });
        }
        setError("아모라를 열지 못했어요. 잠시 후 다시 눌러 주세요.");
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      const alreadySignedIn = Boolean(
        result
        && typeof result === "object"
        && "alreadySignedIn" in result
        && result.alreadySignedIn === true,
      );
      // 버튼의 약속대로 샘플 대시보드를 거치지 않고 아모라로 바로 보낸다.
      try {
        rememberDemoAmoraPrefill(window.sessionStorage, prefill);
      } catch {
        // sessionStorage 자체를 막은 브라우저에서도 아모라 진입은 계속한다.
      }
      if (analyticsSource) {
        captureEvent("start_here_amora_start_result", {
          source: analyticsSource,
          result: alreadySignedIn ? "signed_in" : "success",
        });
      }
      router.push("/wedding/chat");
    } catch {
      if (analyticsSource) {
        captureEvent("start_here_amora_start_result", {
          source: analyticsSource,
          result: "failure",
        });
      }
      setError("연결이 오래 걸리고 있어요. 잠시 후 다시 눌러 주세요.");
    } finally {
      window.clearTimeout(timeoutId);
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void startDemo()}
        disabled={pending}
        aria-busy={pending}
        aria-describedby={error ? errorId : undefined}
        className={className}
      >
        {pending ? "아모라 여는 중…" : label}
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
      {error ? (
        <span
          id={errorId}
          role="alert"
          className="basis-full text-[12px] font-medium leading-5 text-[#7D5753]"
        >
          {error}
        </span>
      ) : null}
    </>
  );
}
