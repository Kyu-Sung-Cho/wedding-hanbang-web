"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
}

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export default function ImageUploader({
  images,
  onChange,
  max = 5,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("JPG, PNG, GIF, WEBP 파일만 업로드할 수 있습니다.");
        return null;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setError("파일 크기는 5MB 이하여야 합니다.");
        return null;
      }

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/community/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "업로드에 실패했습니다.");
        }
        const data = await res.json();
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
      const fileArray = Array.from(files);
      const remaining = max - images.length;
      if (remaining <= 0) {
        setError(`최대 ${max}장까지 업로드할 수 있습니다.`);
        return;
      }
      const toUpload = fileArray.slice(0, remaining);

      setUploading(true);
      const results = await Promise.all(toUpload.map(uploadFile));
      const urls = results.filter((u): u is string => u !== null);
      if (urls.length > 0) {
        onChange([...images, ...urls]);
      }
      setUploading(false);
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
                ? "업로드 중..."
                : "클릭하거나 이미지를 드래그하세요"}
            </p>
            <p className="mt-1 text-xs text-[#B5ADA3]">
              JPG, PNG, GIF, WEBP / 최대 5MB / {images.length}/{max}장
            </p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
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

      {/* 미리보기 썸네일 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((url, i) => (
            <div key={url} className="relative group">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#F5F2ED] border border-[#F5F2ED]">
                <Image
                  src={url}
                  alt={`업로드 이미지 ${i + 1}`}
                  width={96}
                  height={96}
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-[#1A1A1F]/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`이미지 ${i + 1} 삭제`}
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
              <span className="text-[23px]">추가</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
