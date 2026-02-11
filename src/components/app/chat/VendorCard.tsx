"use client";

import { Star, MapPin } from "lucide-react";
import { VendorCard as VendorCardType } from "@/types/chat.types";

interface VendorCardProps {
  vendor: VendorCardType;
}

export default function VendorCard({ vendor }: VendorCardProps) {
  return (
    <div className="rounded-xl border border-platinum bg-white p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        {vendor.thumbnailUrl ? (
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-ivory-200">
            <img
              src={vendor.thumbnailUrl}
              alt={vendor.name}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-ivory-200 text-2xl">
            🏪
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-noir-800">
            {vendor.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-taupe-400">
            <span>{vendor.category}</span>
            <span className="flex items-center gap-0.5">
              <MapPin className="h-3 w-3" />
              {vendor.region}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-gold text-gold" />
              <span className="text-xs font-medium text-noir-800">
                {vendor.rating.toFixed(1)}
              </span>
            </div>
            <span className="text-xs font-medium text-rose-500">
              {vendor.priceRange}
            </span>
          </div>
          {vendor.tags && vendor.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {vendor.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-ivory-100 px-2 py-0.5 text-[10px] text-taupe-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
