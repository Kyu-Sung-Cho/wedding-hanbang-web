"use client";

import { useState, useRef } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import { ImagePlus, X, Upload, Loader2 } from "lucide-react";

export default function StepGallery() {
  const { current, photos, loadPhotos, removePhoto } = useInvitationStore();
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!current) return null;

  const handleFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setUploading(true);
    for (const file of imageFiles) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        await fetch(`/api/invitations/${current.id}/photos/upload`, {
          method: "POST",
          body: formData,
        });
      } catch {
        // 개별 실패 무시, 나머지 계속 업로드
      }
    }
    await loadPhotos(current.id);
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div>
      <h2 className="text-[16px] font-medium text-noir-800 mb-1">갤러리</h2>
      <p className="text-[13px] text-taupe-500 mb-6">청첩장에 표시될 사진을 업로드하세요. (최대 10MB/장)</p>

      {/* 업로드 영역 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative mb-6 p-8 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all ${
          dragActive
            ? "border-rose-500 bg-rose-50/50"
            : "border-taupe-400/20 hover:border-rose-500/40 hover:bg-ivory-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
            <p className="text-[13px] text-taupe-500">업로드 중...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-8 h-8 text-taupe-400" />
            <p className="text-[13px] text-taupe-500">
              클릭하거나 사진을 드래그하여 업로드
            </p>
            <p className="text-[11px] text-taupe-400">JPG, PNG, WEBP (여러 장 동시 업로드 가능)</p>
          </div>
        )}
      </div>

      {/* 사진 목록 */}
      {photos.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-taupe-400/20 rounded-xl">
          <ImagePlus className="w-8 h-8 text-taupe-400 mx-auto mb-2" />
          <p className="text-[13px] text-taupe-500">아직 사진이 없습니다</p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-taupe-400 mb-3">{photos.length}장 업로드됨</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-black/[0.06]">
                <img
                  src={photo.url}
                  alt={photo.caption ?? ""}
                  className="w-full aspect-square object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <button
                    onClick={() => removePhoto(photo.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 bg-red-500/90 rounded-lg flex items-center justify-center"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
