"use client";

// 견적 체크 리포트를 PNG 카드로 저장·공유 — 웨딩코드 카드와 동일한 3단 캐스케이드:
// a) Web Share API(files) → 공유시트에서 사진첩/카톡 직행
// b) 전체화면 오버레이 — 이미지를 길게 눌러 사진 앱에 저장
// c) 오버레이 안 "또는 파일로 저장" (다운로드 폴백)

import { useState } from "react";
import { ImageDown, Loader2, X } from "lucide-react";
import { captureEvent } from "@/lib/analytics";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  type AmoraQuoteCheckResult,
} from "@/lib/amora/quoteCheck";
import {
  canvasToPngBlob,
  downloadCanvasPng,
  renderQuoteReportCard,
} from "@/lib/quoteCheck/reportCard";

const REPORT_BRAND = "웨딩한방 견적 체크 · hanbang.ai/check";

export default function ReportCardButton({ result }: { result: AmoraQuoteCheckResult }) {
  const [saving, setSaving] = useState(false);
  const [overlay, setOverlay] = useState<{ dataUrl: string; canvas: HTMLCanvasElement } | null>(null);

  async function saveReport() {
    if (saving) return;
    setSaving(true);
    try {
      const missingTotal =
        result.missingCriticalCount + result.missingHighCount + result.missingMediumCount;
      const canvas = await renderQuoteReportCard({
        categoryLabel: AMORA_QUOTE_CATEGORY_LABELS[result.category],
        quotePriceManwon: result.quotePriceManwon,
        marketMedianManwon: result.marketMedianManwon,
        marketComparatorLabel: result.marketComparatorLabel,
        summaryTitle: result.summaryTitle,
        missingTotal,
        missingCriticalCount: result.missingCriticalCount,
        items: result.missingItems.map((item) => ({
          name: item.name,
          severity: item.severity,
        })),
        sourceNote: result.sourceNote,
        brand: REPORT_BRAND,
      });

      const blob = await canvasToPngBlob(canvas);
      if (blob && typeof navigator.canShare === "function") {
        const file = new File([blob], "hanbang-quote-report.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            captureEvent("quote_check_report_saved", { method: "share" });
            return;
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return;
            // NotAllowedError 등 → 오버레이 폴백
          }
        }
      }

      setOverlay({ dataUrl: canvas.toDataURL("image/png"), canvas });
      captureEvent("quote_check_report_saved", { method: "longpress_shown" });
    } catch {
      /* 렌더 실패는 조용히 — 텍스트 공유 경로가 남아 있다 */
    } finally {
      setSaving(false);
    }
  }

  function downloadFromOverlay() {
    if (!overlay) return;
    downloadCanvasPng(overlay.canvas, "hanbang-quote-report.png");
    captureEvent("quote_check_report_saved", { method: "download" });
  }

  return (
    <>
      <button
        type="button"
        onClick={saveReport}
        disabled={saving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-action)] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--hb-action-hover)] disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
        리포트 이미지로 저장·공유
      </button>

      {overlay && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#1a1a1f]/92 px-6 py-8">
          <button
            onClick={() => setOverlay(null)}
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL은 next/image 불가 */}
          <img
            src={overlay.dataUrl}
            alt="견적 체크 리포트"
            className="max-h-[70vh] w-auto rounded-[6px] shadow-2xl"
          />
          <p className="mt-4 text-center text-[14px] font-semibold leading-relaxed text-white">
            이미지를 길게 눌러 &lsquo;사진 앱에 저장&rsquo;을 선택하세요
          </p>
          <button
            onClick={downloadFromOverlay}
            className="mt-3 text-[12px] font-medium text-white/60 underline underline-offset-2"
          >
            또는 파일로 저장
          </button>
        </div>
      )}
    </>
  );
}
