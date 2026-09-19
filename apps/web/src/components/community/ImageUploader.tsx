"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Upload, X, Loader2, ImageIcon, Film } from "lucide-react";
import { uploadCommunityMedia } from "@/lib/community/uploadMedia";

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_GIF_SIZE = 6 * 1024 * 1024; // 6MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
// iOS Safari + accept — heic/heif도 picker 진입 허용 (실제 업로드 시 friendly error 처리)
const ACCEPT_STRING =
  "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif";

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

// iPhone PHPicker는 file.type을 비우거나 비표준 값을 보내기도 함. 파일명 확장자로 보정.
function inferMimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
    }[ext] ?? ""
  );
}

export default function ImageUploader({
  images,
  onChange,
  max = 10,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File, idx: number, total: number): Promise<string | null> => {
      // iPhone PHPicker가 file.type을 비우는 케이스 대비 — 확장자로 보정
      const effectiveType = file.type || inferMimeFromName(file.name);

      if (effectiveType === "image/heic" || effectiveType === "image/heif") {
        setError(
          "아이폰 HEIC 사진은 직접 업로드가 안 돼요. iPhone 설정 → 카메라 → 포맷에서 '높은 호환성'으로 바꾸거나, 사진을 한 번 편집해 저장한 뒤 다시 올려주세요."
        );
        return null;
      }

      if (!ACCEPTED_IMAGE_TYPES.includes(effectiveType)) {
        setError("JPG, PNG, GIF, WEBP 파일만 업로드할 수 있습니다.");
        return null;
      }
      const isGif = effectiveType === "image/gif";
      const maxSize = isGif ? MAX_GIF_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        const msg = isGif
          ? "GIF는 6MB 이하여야 합니다."
          : "이미지는 5MB 이하여야 합니다.";
        setError(msg);
        return null;
      }

      setProgress(`${idx + 1}/${total} 업로드 중...`);

      try {
        const data = await uploadCommunityMedia(file);
        return data.url;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "업로드에 실패했습니다."
        );
        return null;
      }
    },
    []
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setProgress(null);
      const fileArray = Array.from(files);
      const remaining = max - images.length;
      if (remaining <= 0) {
        setError(`최대 ${max}개까지 업로드할 수 있습니다.`);
        return;
      }
      const toUpload = fileArray.slice(0, remaining);

      setUploading(true);
      const urls: string[] = [];
      for (let i = 0; i < toUpload.length; i++) {
        const url = await uploadFile(toUpload[i], i, toUpload.length);
        if (url) urls.push(url);
      }
      if (urls.length > 0) {
        onChange([...images, ...urls]);
      }
      setUploading(false);
      setProgress(null);
    },
    [images, onChange, max, uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const removeImage = useCallback(
    (index: number) => {
      onChange(images.filter((_, i) => i !== index));
    },
    [images, onChange]
  );

  return (
    <div className="space-y-3">
      {/* 드래그 앤 드롭 영역 */}
      {images.length < max && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 py-8 px-4 border-2 border-dashed rounded-[6px] cursor-pointer transition-colors ${
            dragOver
              ? "border-[var(--hb-primary)] bg-[var(--hb-primary)]/5"
              : "border-[#F5F2ED] bg-[#FAF8F5] hover:border-[#B5ADA3]"
          }`}
        >
          {uploading ? (
            <Loader2 className="w-8 h-8 text-[var(--hb-text-strong)] animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-[var(--hb-text-muted)]" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--hb-text-muted)]">
              {uploading
                ? progress || "업로드 중..."
                : "클릭하거나 파일을 드래그하세요"}
            </p>
            <p className="mt-1 text-xs text-[var(--hb-text-muted)]">
              이미지 5MB · GIF 6MB / {images.length}/{max}개
            </p>
            <p className="mt-0.5 text-xs text-[var(--hb-text-muted)]">
              JPG, PNG, GIF, WEBP
            </p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* 에러 메시지 */}
      {error && (
        <p className="text-xs text-danger-700">{error}</p>
      )}

      {/* 미리보기 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((url, i) => (
            <div key={url} className="relative group">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-[6px] overflow-hidden bg-[#F5F2ED] border border-[#F5F2ED]">
                {isVideoUrl(url) ? (
                  <div className="w-full h-full flex items-center justify-center bg-[#1A1A1F]/10">
                    <Film className="w-8 h-8 text-[var(--hb-text-muted)]" />
                  </div>
                ) : (
                  <Image
                    src={url}
                    alt={`업로드 ${i + 1}`}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-[var(--hb-primary)] text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`파일 ${i + 1} 삭제`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {/* 추가 버튼 */}
          {images.length < max && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 sm:w-24 sm:h-24 flex flex-col items-center justify-center gap-1 rounded-[6px] border-2 border-dashed border-[#F5F2ED] text-[var(--hb-text-muted)] hover:border-[var(--hb-primary)] hover:text-[var(--hb-text-strong)] transition-colors"
            >
              <ImageIcon className="w-5 h-5" />
              <span className="text-[10px]">추가</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
