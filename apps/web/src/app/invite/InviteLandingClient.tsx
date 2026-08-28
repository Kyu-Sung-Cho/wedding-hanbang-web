"use client";

import Button from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  buildCoupleInviteAppLink,
  parseCoupleInviteFragment,
} from "@hanbang/shared";
import { rememberPendingCoupleInviteCode } from "@/lib/couples/pendingInvite";

/** 웹에서 계속할 때 도착하는 곳. 코드는 주소에 담지 않는다. */
const ONBOARDING_PATH = "/wedding/onboarding";

/**
 * 주소창의 `#` 뒤에서 코드를 읽어 보여준다. 서버는 이 값을 모른다.
 *
 * 세 갈래를 준비한다:
 *  1) 앱이 깔려 있다 → `hanbang://invite#CODE`로 넘긴다
 *  2) 앱이 없다 → 웹에서 그대로 이어간다
 *  3) 둘 다 안 된다(사내망, 인앱 브라우저 등) → 코드를 복사해 직접 넣는다
 *
 * 앱이 깔려 있는지 확인할 방법은 없다. 그래서 자동으로 앱을 열려고 시도하지 않는다 —
 * 실패하면 사람은 "아무 일도 안 일어났다"만 겪고 무엇을 해야 할지 모른다. 대신 셋을
 * 나란히 두고 고르게 한다.
 *
 * ## 왜 웹으로 계속할 때 코드를 주소에서 빼는가
 *
 * 온보딩은 보호 경로다. 아직 로그인하지 않은 사람 — 초대를 받는 쪽의 주 경로다 —
 * 에게는 미들웨어가 **서버 307**로 `/login`을 돌려주고, 그러면 온보딩 화면은 마운트조차
 * 되지 않아 주소의 `#`를 읽을 기회가 없다. 그래서 이 화면이 코드를 한 번 쓰는 보관에
 * 넣고 깨끗한 주소로 보낸다. 보관에 넣지 못했을 때만 옛 경로(`#`)로 그대로 간다 —
 * 이미 로그인한 사람은 307을 안 맞고 온보딩에 바로 도착하므로 그 길도 살아 있다.
 */
export default function InviteLandingClient() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function readFromHash() {
      setCode(parseCoupleInviteFragment(window.location.hash));
      setReady(true);
    }
    readFromHash();
    // 같은 페이지에서 해시만 바뀌는 경우(공유 앱들이 종종 그렇게 연다)도 따라간다.
    window.addEventListener("hashchange", readFromHash);
    return () => window.removeEventListener("hashchange", readFromHash);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드가 막힌 환경(비보안 컨텍스트, 일부 인앱 브라우저)에서는 조용히 넘어간다.
      // 코드는 이미 화면에 크게 떠 있어서 눈으로 옮겨 적을 수 있다.
      setCopied(false);
    }
  }, [code]);

  const handleContinueOnWeb = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!code) return;
      // 새 탭·다른 창으로 여는 조작은 가로채지 않는다. sessionStorage는 그쪽으로
      // 따라가지 않으므로, 그때는 주소의 `#`가 유일하게 남는 길이다.
      if (
        event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || event.button !== 0
      ) {
        return;
      }
      if (!rememberPendingCoupleInviteCode(code)) return;
      event.preventDefault();
      router.push(ONBOARDING_PATH);
    },
    [code, router],
  );

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#F7F3EE] px-6">
        <p className="text-[14px] text-[var(--hb-text-muted)]">초대를 확인하고 있어요…</p>
      </main>
    );
  }

  if (!code) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#F7F3EE] px-6 py-16">
        <div className="w-full max-w-[420px] rounded-[24px] border border-[#e3ddd3] bg-white p-7 shadow-[0_18px_44px_rgba(54,83,78,0.08)]">
          <h1 className="text-[20px] font-semibold text-[#2b3a36]">
            초대 코드를 찾지 못했어요
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-[#6f665c]">
            링크가 중간에 잘렸을 수 있어요. 파트너가 보낸 메시지에서 링크 전체를
            다시 눌러보시거나, 코드를 직접 입력해 주세요.
          </p>
          <Button variant="primary" fullWidth href={ONBOARDING_PATH} className="mt-6">
            코드 직접 입력하기
          </Button>
        </div>
      </main>
    );
  }

  const appLink = buildCoupleInviteAppLink(code);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F7F3EE] px-6 py-16">
      <div className="w-full max-w-[420px] rounded-[24px] border border-[#e3ddd3] bg-white p-7 shadow-[0_18px_44px_rgba(54,83,78,0.08)]">
        <p className="text-[13px] font-semibold text-[var(--color-rose-700)]">웨딩한방</p>
        <h1 className="mt-2 text-[22px] font-semibold leading-8 text-[#2b3a36]">
          같이 결혼 준비하자고
          <br />
          초대가 왔어요
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[#6f665c]">
          이 코드로 들어오면 두 사람이 같은 화면을 봐요. 준비한 내용을 두 번
          말하지 않아도 돼요.
        </p>

        <div className="mt-6 rounded-[18px] border border-[var(--hb-hairline)] bg-[#fffdf7] px-5 py-4">
          <p className="text-[12px] font-semibold text-[#9d6f36]">초대 코드</p>
          <p className="mt-1 break-all font-mono text-[20px] font-semibold tracking-[0.04em] text-[#2b3a36]">
            {code}
          </p>
          <Button variant="secondary" size="sm" onClick={handleCopy} className="mt-3">
            {copied ? "복사했어요" : "코드 복사"}
          </Button>
        </div>

        {/* 웹에서 계속하기가 **기본 행동**이다.

            초대받은 사람이 처음 보는 화면인데, 예전에는 진한 버튼이
            `hanbang://` 딥링크였다. 웹 베타에는 설치할 앱이 없어서(저장소에
            App Store·Play 링크가 없다) iOS 는 "주소가 유효하지 않습니다",
            안드로이드는 아무 일도 일어나지 않았다. 커플의 두 번째 사람이
            첫 화면에서 한 번 막히고 되돌아와 보조 버튼을 찾아야 했다
            (2026-08-24 감사). */}
        <div className="mt-6 flex flex-col gap-2.5">
          <Button
            variant="primary"
            fullWidth
            // 눌렀을 때는 보관에 넣고 깨끗한 주소로 간다. 이 href는 그게 안 될 때
            // (저장소가 막혔거나 새 탭으로 열었을 때)만 쓰이는 대비책이다.
            href={`${ONBOARDING_PATH}#${code}`}
            onClick={handleContinueOnWeb}
            data-testid="invite-continue-on-web"
          >
            웹에서 계속하기
          </Button>
          {appLink ? (
            <Button variant="secondary" fullWidth href={appLink}>
              앱에서 열기
            </Button>
          ) : null}
        </div>

        <p className="mt-5 text-[12px] leading-5 text-[#8b857c]">
          웹에서 바로 시작할 수 있어요. 앱을 이미 쓰고 계시면 &lsquo;앱에서
          열기&rsquo;로 같은 계정에서 이어집니다.
        </p>
      </div>
    </main>
  );
}
