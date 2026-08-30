"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Link2, MessageSquare } from "lucide-react";
import {
  buildCoupleInviteShareMessage,
  buildCoupleInviteShareUrl,
  isCoupleInviteCode,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";

/**
 * 초대 코드를 "보낼 수 있는 것"으로 만드는 화면 조각.
 *
 * ## 왜 이 컴포넌트가 필요했나
 *
 * 코드는 온보딩 완료 모달과 설정 두 곳에 이미 떠 있었지만, 둘 다 글자와 복사 버튼이
 * 전부였다. 파트너에게 실제로 건네려면 사람이 메신저를 열고, 코드를 붙여넣고, 무엇을
 * 하라는 말인지 직접 써야 했다. 그 사이 어느 단계에서든 멈추면 커플 연결은 끝내
 * 일어나지 않는다. 그래서 링크·QR·붙여넣을 문구까지 여기서 만들어 준다.
 *
 * ## 왜 두 화면이 같은 파일을 쓰나
 *
 * 코드가 두 벌이면 한쪽만 고쳐지는 일이 반드시 생긴다(입력칸 maxLength가 웹 15,
 * 앱 10으로 갈렸던 것과 같은 사고다). 밀도만 `variant`로 나누고 규칙은 한 벌만 둔다.
 *
 * ## 카메라 권한은 쓰지 않는다
 *
 * 우리는 QR을 **그려서 보여주기만** 한다. 읽는 쪽은 파트너 폰의 기본 카메라다 —
 * iOS·Android 모두 기본 카메라가 QR을 인식한다. 우리 앱에 카메라 권한을 넣으면
 * 스토어 개인정보 고지가 바뀌고 OTA 배포가 막히는데, 얻는 것은 "우리 앱으로 찍기"
 * 하나뿐이다.
 *
 * ## 코드가 없으면 아무것도 그리지 않는다
 *
 * 두 사람이 연결된 뒤 `/api/couple/code`는 `inviteCode: null`을 준다(의도된
 * fail-closed). 그때 이 패널은 통째로 사라져야 한다 — 빈 QR이나 "null"이 그려지면
 * 사람은 코드가 있는데 화면이 깨졌다고 읽는다.
 */

type InviteCodePanelVariant = "modal" | "settings";

type InviteCodePanelProps = {
  /** 정본은 `resolveCoupleConnectionState(...).inviteCode`. 없으면 이 패널은 사라진다. */
  code: string | null | undefined;
  /** modal = 온보딩 완료 모달(가운데 정렬·큰 코드), settings = 설정 카드(좌측 정렬). */
  variant?: InviteCodePanelVariant;
  /**
   * 이 코드의 기한에 대해 화면이 해야 할 말. `describeCoupleInviteWindow(...)`가 만든다.
   *
   * **코드를 보내는 그 화면이 기한을 말해야 한다.** 이 패널이 설정 화면의 인라인 코드
   * 표시를 대체하면서 만료 안내를 통째로 지울 뻔했다(2026-08-21 병합). 안내를 만든
   * #136은 "8월 27일에 초대 코드 19개가 조용히 죽는 것을 막는다"였다 — 안내가 사라지면
   * 그 코드들이 경고 없이 죽는다.
   *
   * `tone`이 `"active"`면 담담하게, 그 외(임박·만료)에는 눈에 띄게 적는다.
   */
  notice?: { message: string; tone: string } | null;
  className?: string;
};

/** 복사 버튼이 세 개라 "무엇이 복사됐는지"를 눌린 버튼에서만 보여주기 위한 키. */
type CopyTarget = "code" | "link" | "message";

/** 어떤 코드에 대한 복사였는지까지 남긴다 — 재발급되면 이전 결과는 무효다. */
type CopyState = { code: string; target: CopyTarget; failed: boolean };

/** origin은 페이지가 사는 동안 바뀌지 않으므로 구독할 것이 없다. */
function subscribeToOrigin(): () => void {
  return () => {};
}

function readClientOrigin(): string | null {
  return window.location.origin;
}

/** 서버에는 origin이 없다. 이 값으로 링크·QR은 첫 HTML에서 그려지지 않는다. */
function readServerOrigin(): string | null {
  return null;
}

const COPY_LABELS: Record<CopyTarget, { idle: string; done: string }> = {
  code: { idle: "코드 복사", done: "코드 복사됨" },
  link: { idle: "링크 복사", done: "링크 복사됨" },
  message: { idle: "보낼 문구 복사", done: "문구 복사됨" },
};

const VARIANT_STYLES: Record<
  InviteCodePanelVariant,
  {
    root: string;
    align: string;
    codeText: string;
    qrSize: number;
    actionRow: string;
  }
> = {
  modal: {
    root: "rounded-2xl bg-[var(--hb-surface-hover)] p-5",
    align: "items-center text-center",
    codeText: "text-[26px] tracking-[0.14em]",
    qrSize: 132,
    actionRow: "justify-center",
  },
  settings: {
    root: "rounded-xl bg-white p-4 shadow-sm",
    align: "items-start text-left",
    codeText: "text-[20px] tracking-[0.1em]",
    qrSize: 112,
    actionRow: "justify-start",
  },
};

/**
 * 클립보드가 막힌 환경(비보안 컨텍스트, 일부 인앱 브라우저)에서도 복사가 되게 한다.
 * 온보딩 모달이 갖고 있던 execCommand 폴백을 여기로 합쳤다 — 화면마다 폴백이
 * 있거나 없으면 "어떤 화면에서는 복사가 된다"는 재현 안 되는 제보가 남는다.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = value;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);
      return copied;
    } catch {
      return false;
    }
  }
}

export default function InviteCodePanel({
  code,
  variant = "settings",
  notice = null,
  className = "",
}: InviteCodePanelProps) {
  // 서버 스냅샷은 null이다. 렌더 중에 그냥 window를 읽으면 서버가 그린 첫 HTML과
  // 클라이언트 첫 렌더가 어긋나 하이드레이션이 깨진다. origin은 페이지가 사는 동안
  // 바뀌지 않으므로 구독은 아무것도 하지 않는다.
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    readClientOrigin,
    readServerOrigin,
  );

  // 복사 표시는 "어떤 코드에 대한 복사였는지"까지 들고 있는다. 코드가 재발급되면
  // 이전 "복사됨"은 거짓말이 되는데, 그 정리를 effect로 하면 렌더가 한 번 더 돈다.
  const [copyState, setCopyState] = useState<CopyState | null>(null);

  const handleCopy = useCallback(
    async (forCode: string, target: CopyTarget, value: string) => {
      const copied = await copyText(value);
      setCopyState({ code: forCode, target, failed: !copied });
      if (!copied) return;
      window.setTimeout(() => {
        setCopyState((current) =>
          current && current.code === forCode && current.target === target
            ? null
            : current,
        );
      }, 2000);
    },
    [],
  );

  const normalizedCode = normalizeCoupleInviteCode(code);
  const usableCode = isCoupleInviteCode(normalizedCode) ? normalizedCode : null;
  const currentCopy =
    copyState && copyState.code === usableCode ? copyState : null;
  const copiedTarget = currentCopy && !currentCopy.failed
    ? currentCopy.target
    : null;
  const copyFailed = currentCopy?.failed === true;

  if (!usableCode) return null;

  // origin을 못 구하면(SSR 첫 렌더 등) 링크와 QR은 그리지 않는다. 깨진 링크를
  // 보내는 쪽이 코드만 보내는 쪽보다 나쁘다 — 받은 사람은 어디가 잘못됐는지 모른다.
  const shareUrl = buildCoupleInviteShareUrl({ code: usableCode, origin });
  const shareMessage = buildCoupleInviteShareMessage({
    code: usableCode,
    url: shareUrl,
  });
  const styles = VARIANT_STYLES[variant];

  const copyButtonClass = (target: CopyTarget) =>
    `inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${
      copiedTarget === target
        ? "bg-[#2E7D5A]/10 text-[#2E7D5A]"
        : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] hover:text-[var(--hb-accent-hover)]"
    }`;

  const copyIcon = (target: CopyTarget, Fallback: typeof Copy) =>
    copiedTarget === target ? (
      <Check className="w-4 h-4" aria-hidden="true" />
    ) : (
      <Fallback className="w-4 h-4" aria-hidden="true" />
    );

  return (
    <div className={`${styles.root} ${className}`.trim()}>
      <div className={`flex flex-col ${styles.align}`}>
        <p className="text-sm text-[var(--hb-text-muted)]">초대 코드</p>
        <p
          className={`mt-1 font-mono font-semibold text-[var(--hb-text-strong)] break-all ${styles.codeText}`}
        >
          {usableCode}
        </p>
        {notice && (
          <p
            className={
              notice.tone === "active"
                ? "mt-2 text-sm text-[var(--hb-text-muted)]"
                : "mt-2 text-sm font-medium text-[var(--hb-accent-hover)]"
            }
          >
            {notice.message}
          </p>
        )}

        <div className={`mt-3 flex flex-wrap gap-2 ${styles.actionRow}`}>
          <button
            type="button"
            onClick={() => void handleCopy(usableCode, "code", usableCode)}
            className={copyButtonClass("code")}
          >
            {copyIcon("code", Copy)}
            {copiedTarget === "code"
              ? COPY_LABELS.code.done
              : COPY_LABELS.code.idle}
          </button>

          {shareUrl && (
            <button
              type="button"
              onClick={() => void handleCopy(usableCode, "link", shareUrl)}
              className={copyButtonClass("link")}
            >
              {copyIcon("link", Link2)}
              {copiedTarget === "link"
                ? COPY_LABELS.link.done
                : COPY_LABELS.link.idle}
            </button>
          )}

          {shareUrl && shareMessage && (
            <button
              type="button"
              onClick={() => void handleCopy(usableCode, "message", shareMessage)}
              className={copyButtonClass("message")}
            >
              {copyIcon("message", MessageSquare)}
              {copiedTarget === "message"
                ? COPY_LABELS.message.done
                : COPY_LABELS.message.idle}
            </button>
          )}
        </div>

        {shareUrl && (
          <div className={`mt-4 flex flex-col ${styles.align}`}>
            <span className="rounded-xl border border-[#E8DDD3] bg-white p-3">
              <QRCodeSVG
                value={shareUrl}
                size={styles.qrSize}
                level="M"
                marginSize={0}
                fgColor="#1A1A1F"
                bgColor="#FFFFFF"
                title="초대 코드 QR"
              />
            </span>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--hb-text-muted)]">
              파트너 폰의 기본 카메라로 찍으면 초대 화면이 열려요.
            </p>
          </div>
        )}

        {/* 복사 결과는 눌린 버튼 글자로 보이지만, 화면을 읽어 주는 사람에게는
            버튼 글자 변화가 전달되지 않을 수 있어 별도로 알린다. */}
        <p role="status" aria-live="polite" className="sr-only">
          {copiedTarget ? COPY_LABELS[copiedTarget].done : ""}
        </p>
        {copyFailed && (
          <p className="mt-2 text-[12px] leading-relaxed text-[#B4534B]">
            복사가 막힌 브라우저예요. 위 코드를 길게 눌러 직접 복사해 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
