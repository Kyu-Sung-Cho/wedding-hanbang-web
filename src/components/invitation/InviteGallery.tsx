"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InvitationPhoto } from "@/types/invitation.types";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Props {
  photos: InvitationPhoto[];
  colors: string[];
}

export default function InviteGallery({ photos, colors }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <section className="py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <h3 className="text-center text-[11px] tracking-[0.2em] uppercase mb-6" style={{ color: colors[0] }}>
          Gallery
        </h3>

        {/* 그리드 */}
        <div className="grid grid-cols-2 gap-2">
          {photos.map((photo, i) => (
            <motion.button
              key={photo.id}
              onClick={() => setSelectedIndex(i)}
              className="relative overflow-hidden rounded-xl aspect-square"
              whileHover={{ scale: 1.02 }}
              transition={{ duration: 0.2 }}
            >
              <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover" />
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* 라이트박스 */}
      <AnimatePresence>
        {selectedIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
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

            {selectedIndex < photos.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedIndex(selectedIndex + 1); }}
                className="absolute right-2 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}

            <motion.img
              key={selectedIndex}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              src={photos[selectedIndex].url}
              alt=""
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
