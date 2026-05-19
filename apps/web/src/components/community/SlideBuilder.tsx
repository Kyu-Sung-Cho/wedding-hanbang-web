"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, ArrowLeft, ArrowRight, Loader2, Image as ImageIcon, Film, Play } from "lucide-react";
import type { SlideMedia } from "@/types/community.types";

interface SlideBuilderProps {
  slides: SlideMedia[];
  onChange: (next: SlideMedia[]) => void;
  /** 최대 슬라이드 수 (기본 10) */
  max?: number;
}

/**
 * 인스타 캐러셀 스타일 게시물 작성용 빌더.
 * - 이미지/영상 동시 업로드 (multipart, /api/community/upload)
 * - 슬라이드 썸네일 리스트 + 좌우 화살표로 순서 변경
 * - 슬라이드 삭제
 * - 최대 N장(기본 10)
 */
export default function SlideBuilder({ slides, onChange, max = 10 }: SlideBuilderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = max - slides.length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const accepted = Array.from(files).slice(0, remaining);
    if (accepted.length === 0) {
      setError(`최대 ${max}장까지 추가할 수 있어요.`);
      return;
    }

    setUploading(true);
    const uploaded: SlideMedia[] = [];
    try {
      for (const file of accepted) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/community/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data?.url) {
          throw new Error(data?.error || "업로드 실패");
        }
        const type: "image" | "video" = data.type === "video" ? "video" : "image";
        uploaded.push({ type, url: data.url as string });
      }
      onChange([...slides, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 중 오류가 발생했어요.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function remove(idx: number) {
    onChange(slides.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const next = [...slides];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div>
      {/* 안내 */}
      <p className="text-sm text-[#928980] mb-3 leading-relaxed">
        인스타 캐러셀처럼 이미지·영상을 여러 장 올릴 수 있어요. 옆으로 넘기는 게시물이 됩니다.
        최대 {max}장 · 영상은 한 장당 50MB 이하.
      </p>

      {/* 추가 버튼 */}
      <div className="mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || remaining <= 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-sm font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              업로드 중...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              이미지 · 영상 추가 ({slides.length}/{max})
            </>
          )}
        </button>
      </div>

      {error && (
        <p className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </p>
      )}

      {/* 슬라이드 썸네일 그리드 */}
      {slides.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {slides.map((slide, idx) => (
            <div
              key={`${slide.url}-${idx}`}
              className="relative group rounded-xl overflow-hidden border border-[#F0EFED] bg-[#fcf9f8] aspect-square"
            >
              {/* 미디어 미리보기 */}
              {slide.type === "video" ? (
                <div className="w-full h-full relative bg-black flex items-center justify-center">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    src={slide.url}
                    preload="metadata"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                    <Play className="w-8 h-8 text-white fill-white" />
                  </div>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slide.url}
                  alt={`슬라이드 ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              )}

              {/* 순서 라벨 (좌상단) */}
              <span className="absolute top-2 left-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/60 text-white text-xs font-medium tabular-nums">
                {idx + 1}
              </span>

              {/* 타입 라벨 (우상단) */}
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/85 backdrop-blur-sm text-[10px] font-medium text-[#1A1A1F]">
                {slide.type === "video" ? <Film className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                {slide.type === "video" ? "영상" : "이미지"}
              </span>

              {/* 컨트롤 (하단) */}
              <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label="앞으로"
                    className="w-7 h-7 rounded-full bg-white/85 backdrop-blur-sm flex items-center justify-center disabled:opacity-30 hover:bg-white"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-[#1A1A1F]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === slides.length - 1}
                    aria-label="뒤로"
                    className="w-7 h-7 rounded-full bg-white/85 backdrop-blur-sm flex items-center justify-center disabled:opacity-30 hover:bg-white"
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-[#1A1A1F]" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label="삭제"
                  className="w-7 h-7 rounded-full bg-red-500/90 flex items-center justify-center hover:bg-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-6 py-10 rounded-xl border-2 border-dashed border-[#e4e2e1] bg-[#fcf9f8] text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white border border-[#F0EFED] mb-3">
            <ImageIcon className="w-5 h-5 text-[#928980]" />
          </div>
          <p className="text-sm text-[#504444]">아직 추가된 슬라이드가 없어요</p>
          <p className="text-xs text-[#928980] mt-1">위 버튼으로 이미지·영상을 추가하세요</p>
        </div>
      )}
    </div>
  );
}
