"use client";

import { useState, useCallback } from "react";
import { DAYS, HOURS } from "@/data/mockVendors";
import type { TimeSlot } from "@/data/mockVendors";

interface WeeklyTimeGridProps {
  slots: TimeSlot[];
  onChange: (slots: TimeSlot[]) => void;
  readonly?: boolean;
}

export default function WeeklyTimeGrid({ slots, onChange, readonly = false }: WeeklyTimeGridProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(false);

  const getSlot = useCallback((day: number, hour: number) => {
    return slots.find((s) => s.day === day && s.hour === hour);
  }, [slots]);

  const toggleSlot = useCallback((day: number, hour: number, forceValue?: boolean) => {
    if (readonly) return;
    const newSlots = slots.map((s) => {
      if (s.day === day && s.hour === hour) {
        return { ...s, available: forceValue !== undefined ? forceValue : !s.available };
      }
      return s;
    });
    onChange(newSlots);
  }, [slots, onChange, readonly]);

  const handleMouseDown = (day: number, hour: number) => {
    if (readonly) return;
    const slot = getSlot(day, hour);
    const newValue = !slot?.available;
    setIsDragging(true);
    setDragValue(newValue);
    toggleSlot(day, hour, newValue);
  };

  const handleMouseEnter = (day: number, hour: number) => {
    if (!isDragging || readonly) return;
    toggleSlot(day, hour, dragValue);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const toggleFullDay = (day: number) => {
    if (readonly) return;
    const daySlots = slots.filter((s) => s.day === day);
    const allAvailable = daySlots.every((s) => s.available);
    const newSlots = slots.map((s) => {
      if (s.day === day) return { ...s, available: !allAvailable };
      return s;
    });
    onChange(newSlots);
  };

  const toggleFullHour = (hour: number) => {
    if (readonly) return;
    const hourSlots = slots.filter((s) => s.hour === hour);
    const allAvailable = hourSlots.every((s) => s.available);
    const newSlots = slots.map((s) => {
      if (s.hour === hour) return { ...s, available: !allAvailable };
      return s;
    });
    onChange(newSlots);
  };

  return (
    <div
      className="select-none"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 범례 */}
      <div className="flex items-center gap-4 mb-4 text-[27px] text-taupe-500">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-rose-500" />
          예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-ivory-warm border border-black/[0.04]" />
          불가
        </div>
        {!readonly && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-gold" />
            예약 있음
          </div>
        )}
        {!readonly && (
          <span className="text-taupe-400 ml-auto">클릭/드래그로 토글</span>
        )}
      </div>

      {/* 그리드 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr>
              <th className="w-[60px] p-1" />
              {DAYS.map((day, di) => (
                <th key={day} className="p-1">
                  <button
                    onClick={() => toggleFullDay(di)}
                    disabled={readonly}
                    className={`w-full py-2 rounded-lg text-[47px] font-medium transition-colors ${
                      di >= 5
                        ? "text-rose-500 bg-rose-500/5 hover:bg-rose-500/10"
                        : "text-charcoal bg-ivory-warm hover:bg-ivory-deep"
                    } ${readonly ? "cursor-default" : "cursor-pointer"}`}
                  >
                    {day}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour}>
                <td className="p-1">
                  <button
                    onClick={() => toggleFullHour(hour)}
                    disabled={readonly}
                    className={`w-full py-1.5 rounded-lg text-[27px] text-taupe-500 font-medium hover:bg-ivory-deep transition-colors text-center ${
                      readonly ? "cursor-default" : "cursor-pointer"
                    }`}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </button>
                </td>
                {DAYS.map((_, di) => {
                  const slot = getSlot(di, hour);
                  const hasBooking = slot && slot.currentBookings > 0;

                  return (
                    <td key={di} className="p-1">
                      <button
                        onMouseDown={() => handleMouseDown(di, hour)}
                        onMouseEnter={() => handleMouseEnter(di, hour)}
                        disabled={readonly}
                        className={`w-full h-10 rounded-lg transition-all duration-100 relative ${
                          hasBooking
                            ? "bg-gold shadow-[inset_0_0_0_2px_rgba(201,169,110,0.3)]"
                            : slot?.available
                            ? "bg-rose-500 hover:bg-rose-600 shadow-[inset_0_0_0_1px_rgba(196,150,126,0.2)]"
                            : "bg-ivory-warm border border-black/[0.04] hover:border-rose-500/30"
                        } ${readonly ? "cursor-default" : "cursor-pointer"}`}
                      >
                        {hasBooking && (
                          <span className="absolute inset-0 flex items-center justify-center text-[25px] text-white font-bold">
                            {slot.currentBookings}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
