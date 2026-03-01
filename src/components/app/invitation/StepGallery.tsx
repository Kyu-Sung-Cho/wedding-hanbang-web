"use client";

import { useState } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import { ImagePlus, X, GripVertical } from "lucide-react";

export default function StepGallery() {
  const { current, photos, addPhoto, removePhoto } = useInvitationStore();
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);

  if (!current) return null;

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true);
    await addPhoto(current.id, urlInput.trim());
    setUrlInput("");
    setAdding(false);
  };

  return (
    <div>
      <h2 className="text-[16px] font-medium text-noir-800 mb-1">갤러리</h2>
      <p className="text-[13px] text-taupe-500 mb-6">
        청첩장에 표시될 사진을 추가하세요. 이미지 URL을 입력하거나 Supabase Storage에 업로드 후 URL을 붙여넣으세요.
      </p>

      {/* 사진 추가 */}
      <div className="flex gap-2 mb-6">
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="이미지 URL을 입력하세요"
          className="flex-1 px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !urlInput.trim()}
          className="px-4 py-2.5 bg-noir-800 text-white rounded-xl text-[13px] font-medium hover:bg-noir-900 disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          <ImagePlus className="w-4 h-4" />
          추가
        </button>
      </div>

      {/* 사진 목록 */}
      {photos.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-taupe-400/20 rounded-xl">
          <ImagePlus className="w-8 h-8 text-taupe-400 mx-auto mb-2" />
          <p className="text-[13px] text-taupe-500">아직 사진이 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-black/[0.06]">
              <img
                src={photo.url}
                alt={photo.caption ?? ""}
                className="w-full aspect-square object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  <button className="w-7 h-7 bg-white/90 rounded-lg flex items-center justify-center">
                    <GripVertical className="w-3.5 h-3.5 text-noir-800" />
                  </button>
                  <button
                    onClick={() => removePhoto(photo.id)}
                    className="w-7 h-7 bg-red-500/90 rounded-lg flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </div>
              {photo.caption && (
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50 text-white text-[10px]">
                  {photo.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
