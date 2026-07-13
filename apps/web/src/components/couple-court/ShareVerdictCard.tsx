"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, Image as ImageIcon, Share2, Sparkles } from "lucide-react";
import { shareFileThenText } from "@/lib/share/nativeShare";
import { wrapText } from "@/lib/weddingCode/shareCard";
import type { CourtVerdict } from "./types";
import { CourtButton, Surface } from "./CourtPrimitives";
import { captureCourtEvent } from "./analytics";

const WIDTH = 1080;
const HEIGHT = 1350;
const PADDING = 88;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

async function renderCourtShareCard(card: NonNullable<CourtVerdict["publicCard"]>): Promise<HTMLCanvasElement> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("공유 이미지를 만들 수 없는 브라우저예요.");

  const font = (weight: number, size: number) => `${weight} ${size}px Paperlogy, "Noto Sans KR", sans-serif`;
  const measure = (text: string, size: number) => {
    ctx.font = font(600, size);
    return ctx.measureText(text).width;
  };

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#FFFDF8");
  gradient.addColorStop(0.55, "#F8F0EC");
  gradient.addColorStop(1, "#EDF4F0");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  roundedRect(ctx, 48, 48, WIDTH - 96, HEIGHT - 96, 42);
  ctx.fill();
  ctx.strokeStyle = "#E0D4C8";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textBaseline = "top";
  ctx.fillStyle = "#8F6662";
  ctx.font = font(700, 28);
  ctx.fillText("WEDDING HANBANG · COUPLE COURT", PADDING, 118);

  ctx.fillStyle = "#36534E";
  ctx.font = font(700, 34);
  ctx.fillText("한방 판결", PADDING, 184);

  ctx.fillStyle = "#F7EFEC";
  roundedRect(ctx, PADDING, 258, WIDTH - PADDING * 2, 112, 24);
  ctx.fill();
  ctx.fillStyle = "#8F6662";
  ctx.font = font(700, 32);
  ctx.fillText(card.resultLabel, PADDING + 34, 296);

  ctx.fillStyle = "#263832";
  const titleLines = wrapText(card.safeTitle, WIDTH - PADDING * 2, 62, measure).slice(0, 3);
  ctx.font = font(700, 62);
  let y = 446;
  for (const line of titleLines) {
    ctx.fillText(line, PADDING, y);
    y += 86;
  }

  y += 42;
  ctx.strokeStyle = "#DED5CB";
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(WIDTH - PADDING, y);
  ctx.stroke();
  y += 54;

  ctx.fillStyle = "#5E6C66";
  const oneLineLines = wrapText(card.oneLine, WIDTH - PADDING * 2, 40, measure).slice(0, 5);
  ctx.font = font(600, 40);
  for (const line of oneLineLines) {
    ctx.fillText(line, PADDING, y);
    y += 62;
  }

  if (card.hashtags.length > 0) {
    const hashtagText = card.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join("   ");
    ctx.fillStyle = "#36534E";
    ctx.font = font(600, 28);
    let hashtagY = HEIGHT - 224;
    for (const line of wrapText(hashtagText, WIDTH - PADDING * 2, 28, measure).slice(0, 2)) {
      ctx.fillText(line, PADDING, hashtagY);
      hashtagY += 40;
    }
  }

  ctx.fillStyle = "#7D8984";
  ctx.font = font(500, 24);
  ctx.fillText("서운함은 판결하고, 결혼 준비는 다시 앞으로.", PADDING, HEIGHT - 142);
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 이미지를 만들지 못했어요.")), "image/png"));
}

export default function ShareVerdictCard({ card }: { card: NonNullable<CourtVerdict["publicCard"]> }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const nextBlob = await canvasBlob(await renderCourtShareCard(card));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setBlob(nextBlob);
      setPreviewUrl(URL.createObjectURL(nextBlob));
      setMessage("공개용 허용 필드만 사용한 공유 카드예요. 저장 전에 이미지를 다시 확인해 주세요.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "공유 카드를 만들지 못했어요.");
    } finally {
      setGenerating(false);
    }
  }

  function download() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wedding-hanbang-couple-court.png";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("공유 카드를 PNG로 저장했어요.");
    captureCourtEvent("couple_court_share_export", { status: "downloaded" });
  }

  async function share() {
    if (!blob) return;
    const file = new File([blob], "wedding-hanbang-couple-court.png", { type: "image/png" });
    const outcome = await shareFileThenText({
      shareNavigator: navigator,
      fileData: { files: [file], title: "웨딩한방 한방 판결" },
      textData: { title: "웨딩한방 한방 판결", text: `${card.safeTitle}\n${card.oneLine}` },
    });
    if (outcome === "unavailable") {
      download();
      return;
    }
    if (outcome !== "cancelled") {
      setMessage("공유 창을 열었어요.");
      captureCourtEvent("couple_court_share_export", { status: "shared" });
    }
  }

  return <Surface className="mt-5"><ImageIcon className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">판결 공유 카드</h2><p className="mt-2 text-base leading-7 text-[#65716C]">진술 원문, 사건 제목, 정확한 날짜와 금액은 넣지 않아요. 공개용으로 검증된 제목과 한 줄 결과만 사용합니다.</p>{!previewUrl ? <CourtButton onClick={() => void generate()} disabled={generating} variant="secondary" className="mt-5">{generating ? <><Sparkles className="h-4 w-4 animate-pulse motion-reduce:animate-none" aria-hidden="true" />이미지 만드는 중…</> : "공유 카드 미리보기"}</CourtButton> : <div className="mt-5"><Image src={previewUrl} width={420} height={525} unoptimized alt={`한방 판결 공유 카드 미리보기: ${card.safeTitle}`} className="mx-auto h-auto w-full max-w-[420px] rounded-[18px] border border-[#D8CDC1]" /><div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center"><CourtButton onClick={() => void share()}><Share2 className="h-4 w-4" aria-hidden="true" />공유하기</CourtButton><CourtButton onClick={download} variant="secondary"><Download className="h-4 w-4" aria-hidden="true" />PNG 저장</CourtButton><CourtButton onClick={() => void generate()} variant="secondary">다시 만들기</CourtButton></div></div>}<div className="mt-4 min-h-7" aria-live="polite">{message && <p className="text-sm font-semibold leading-6 text-[#36534E]">{message}</p>}{error && <p className="text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}</div></Surface>;
}
