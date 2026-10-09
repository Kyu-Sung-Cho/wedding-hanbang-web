"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  buildConsentReturnPath,
  DEFAULT_CONSENT_RETURN_PATH,
} from "@/lib/auth/consentReturnPath";

export default function ConsentReturnGate() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const [consentHref, setConsentHref] = useState(DEFAULT_CONSENT_RETURN_PATH);

  useEffect(() => {
    let cancelled = false;
    // 정리된 effect의 이동은 취소한다. 같은 layout 안에서 경로를 다시 열어도
    // 현재 주소를 다시 읽으므로 이전 도구의 복귀 주소를 재사용하지 않는다.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const target = buildConsentReturnPath(destination, window.location.origin);
      setConsentHref(target);
      try {
        router.replace(target);
      } catch {
        // 자동 이동에 실패해도 아래 일반 링크로 직접 진행할 수 있다.
      }
    });
    return () => { cancelled = true; };
  }, [pathname, router, search]);

  return (
    <main className="min-h-screen bg-[var(--hb-surface-page)] px-5 py-16">
      <div className="mx-auto w-full max-w-[420px]">
        <h1 className="text-[22px] font-semibold text-[var(--hb-text-strong)]">
          약관 동의를 확인해 주세요
        </h1>
        <p role="status" className="mt-3 text-[14px] leading-relaxed text-[var(--hb-text-body)]">
          약관 동의가 필요해요. 확인을 마치면 열려던 도구로 돌아올 수 있어요.
        </p>
        <a
          href={consentHref}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-[8px] bg-[var(--hb-action)] px-5 py-3 text-[14px] font-semibold text-[var(--hb-on-primary)] hover:bg-[var(--hb-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2"
        >
          약관 동의로 계속하기
        </a>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--hb-text-muted)]">
          이동하지 않으면 위 링크를 눌러 주세요.
        </p>
        <noscript>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--hb-text-muted)]">
            JavaScript가 꺼져 있어 자동으로 이동할 수 없어요. 약관 동의를 완료하려면
            JavaScript를 켜고 이 페이지를 새로고침해 주세요.
          </p>
        </noscript>
      </div>
    </main>
  );
}
