"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Upload, X, Loader2, ImageIcon, Film } from "lucide-react";

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_GIF_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ALL_ACCEPTED = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES];
// iOS Safari + accept — heic/heif도 picker 진입 허용 (실제 업로드 시 friendly error 처리)
const ACCEPT_STRING =
  "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,image/heic,image/heif,.heic,.heif";

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
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      heic: "image/heic",
      heif: "image/heif",
    }[ext] ?? ""
  );
}

// FormData에 non-ASCII 파일명을 그대로 넣으면 iOS Safari가 Content-Disposition
// 인코딩에서 "The string did not match the expected pattern." DOMException을 던지는
// 케이스가 있음. 안전하게 영문/숫자/.+_ 만 남기고, 비면 timestamp로 대체.
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]/g, "_");
  return cleaned.length > 0 ? cleaned : `upload_${Date.now()}`;
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

      if (!ALL_ACCEPTED.includes(effectiveType)) {
        setError("JPG, PNG, GIF, WEBP, MP4, MOV, WebM 파일만 업로드할 수 있습니다.");
        return null;
      }
      const isVideo = ACCEPTED_VIDEO_TYPES.includes(effectiveType);
      const isGif = effectiveType === "image/gif";
      const maxSize = isVideo ? MAX_VIDEO_SIZE : isGif ? MAX_GIF_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        const msg = isVideo
          ? "영상은 50MB 이하여야 합니다."
          : isGif
            ? "GIF는 10MB 이하여야 합니다."
            : "이미지는 5MB 이하여야 합니다.";
        setError(msg);
        return null;
      }

      setProgress(`${idx + 1}/${total} 업로드 중...`);

      // 파일명 ASCII 정리 — iOS Safari의 multipart Content-Disposition 인코딩 에러 방지
      const safeName = sanitizeFileName(file.name);
      const safeFile =
        file.type && file.name === safeName
          ? file
          : new File([file], safeName, { type: effectiveType });

      const formData = new FormData();
      formData.append("file", safeFile);

      try {
        const res = await fetch("/api/community/upload", {
          method: "POST",
          body: formData,
        });
        // 응답 파싱은 항상 .catch — iOS Safari가 HTML 응답을 json()으로 파싱하면
        // "The string did not match the expected pattern." DOMException을 던짐.
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.url) {
          throw new Error(
            data?.error ||
              (res.status === 413
                ? "파일이 너무 커요. 더 작은 사이즈로 다시 시도해주세요."
                : `업로드 실패 (HTTP ${res.status})`)
          );
        }
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
          className={`flex flex-col items-center justify-center gap-2 py-8 px-4 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
            dragOver
              ? "border-[#C4967E] bg-[#C4967E]/5"
              : "border-[#F5F2ED] bg-[#FAF8F5] hover:border-[#B5ADA3]"
          }`}
        >
          {uploading ? (
            <Loader2 className="w-8 h-8 text-[#C4967E] animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-[#B5ADA3]" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-[#928980]">
              {uploading
                ? progress || "업로드 중..."
                : "클릭하거나 파일을 드래그하세요"}
            </p>
            <p className="mt-1 text-xs text-[#B5ADA3]">
              이미지 5MB · GIF 10MB · 영상 50MB / {images.length}/{max}개
            </p>
            <p className="mt-0.5 text-xs text-[#B5ADA3]">
              JPG, PNG, GIF, WEBP, MP4, MOV, WebM
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
        <p className="text-xs text-red-500">{error}</p>
      )}

      {/* 미리보기 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((url, i) => (
            <div key={url} className="relative group">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#F5F2ED] border border-[#F5F2ED]">
                {isVideoUrl(url) ? (
                  <div className="w-full h-full flex items-center justify-center bg-[#1A1A1F]/10">
                    <Film className="w-8 h-8 text-[#928980]" />
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
                className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-[#795252]/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
              className="w-20 h-20 sm:w-24 sm:h-24 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[#F5F2ED] text-[#B5ADA3] hover:border-[#C4967E] hover:text-[#C4967E] transition-colors"
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
