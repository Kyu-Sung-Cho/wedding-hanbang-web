"use client";

import { useState } from "react";
import type { InvitationPhoto } from "@/types/invitation.types";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Props {
  photos: InvitationPhoto[];
  colors: string[];
  skipFirst?: boolean;
}

export default function InviteGallery({ photos, colors, skipFirst }: Props) {
  const displayPhotos = skipFirst ? photos.slice(1) : photos;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (displayPhotos.length === 0) return null;

  return (
    <section className="py-12 px-6">
      <div className="animate-fade-in" style={{ animationDuration: "0.6s" }}>
        <h3 className="text-center text-[11px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          Gallery
        </h3>

        <div className="grid grid-cols-2 gap-2">
          {displayPhotos.map((photo, i) => (
            <button
              key={photo.id}
              onClick={() => setSelectedIndex(i)}
              className="relative overflow-hidden rounded-xl aspect-square hover:opacity-90 transition-opacity"
            >
              <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </div>

      {/* 라이트박스 */}
      {selectedIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center animate-fade-in"
          style={{ animationDuration: "0.3s" }}
          onClick={() => setSelectedIndex(null)}
        >
          <button
            onClick={() => setSelectedIndex(null)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>

          {selectedIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedIndex(selectedIndex - 1); }}
              className="absolute left-2 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {selectedIndex < displayPhotos.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedIndex(selectedIndex + 1); }}
              className="absolute right-2 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          <img
            key={selectedIndex}
            src={displayPhotos[selectedIndex].url}
            alt=""
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl animate-fade-in"
            style={{ animationDuration: "0.3s" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
