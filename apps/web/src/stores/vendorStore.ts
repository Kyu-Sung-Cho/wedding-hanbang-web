"use client";

import { create } from "zustand";
import type { Vendor, VendorProduct, Booking, TimeSlot } from "@/types/vendor.types";

interface VendorState {
  vendor: Vendor | null;
  products: VendorProduct[];
  bookings: Booking[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  refreshVendor: () => Promise<void>;
  updateProfile: (data: Partial<Vendor>) => Promise<boolean>;
  createProduct: (data: Partial<VendorProduct>) => Promise<boolean>;
  updateProduct: (id: string, data: Partial<VendorProduct>) => Promise<boolean>;
  deleteProduct: (id: string) => Promise<boolean>;
  saveTimeSlots: (slots: TimeSlot[]) => Promise<boolean>;
  saveProductTimeSlots: (productId: string, slots: TimeSlot[]) => Promise<boolean>;
  createBooking: (data: Partial<Booking>) => Promise<boolean>;
  updateBookingStatus: (id: string, status: "confirmed" | "cancelled") => Promise<boolean>;
  refreshBookings: () => Promise<void>;
  updateSettings: (settings: { booking: boolean; message: boolean; marketing: boolean }) => Promise<boolean>;
  reset: () => void;
}

export const useVendorStore = create<VendorState>((set, get) => ({
  vendor: null,
  products: [],
  bookings: [],
  isLoading: false,
  isInitialized: false,
  error: null,

  initialize: async () => {
    if (get().isInitialized) return;
    set({ isLoading: true, error: null });

    try {
      const res = await fetch("/api/vendor/me");
      if (!res.ok) {
        if (res.status === 404) {
          // 업체 등록 안 된 사용자
          set({ isLoading: false, isInitialized: true });
          return;
        }
        throw new Error("업체 정보를 불러올 수 없습니다.");
      }

      const data = await res.json();
      set({
        vendor: data.vendor,
        products: data.products ?? [],
        bookings: data.bookings ?? [],
      });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  refreshVendor: async () => {
    try {
      const res = await fetch("/api/vendor/me");
      if (!res.ok) return;
      const data = await res.json();
      set({
        vendor: data.vendor,
        products: data.products ?? [],
        bookings: data.bookings ?? [],
      });
    } catch (err) {
      console.error("Vendor refresh error:", err);
    }
  },

  updateProfile: async (data) => {
    try {
      const res = await fetch("/api/vendor/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const result = await res.json();
      set({ vendor: result.vendor });
      return true;
    } catch {
      return false;
    }
  },

  createProduct: async (data) => {
    try {
      const res = await fetch("/api/vendor/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const result = await res.json();
      set((state) => ({ products: [...state.products, result.product] }));
      return true;
    } catch {
      return false;
    }
  },

  updateProduct: async (id, data) => {
    try {
      const res = await fetch(`/api/vendor/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const result = await res.json();
      set((state) => ({
        products: state.products.map((p) => (p.id === id ? result.product : p)),
      }));
      return true;
    } catch {
      return false;
    }
  },

  deleteProduct: async (id) => {
    try {
      const res = await fetch(`/api/vendor/products/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) return false;
      set((state) => ({
        products: state.products.filter((p) => p.id !== id),
      }));
      return true;
    } catch {
      return false;
    }
  },

  saveTimeSlots: async (slots) => {
    try {
      const res = await fetch("/api/vendor/timeslots", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots }),
      });
      if (!res.ok) return false;
      set((state) => ({
        vendor: state.vendor ? { ...state.vendor, timeSlots: slots } : null,
      }));
      return true;
    } catch {
      return false;
    }
  },

  saveProductTimeSlots: async (productId, slots) => {
    try {
      const res = await fetch("/api/vendor/timeslots", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, slots }),
      });
      if (!res.ok) return false;
      set((state) => ({
        products: state.products.map((p) =>
          p.id === productId ? { ...p, timeSlots: slots } : p
        ),
      }));
      return true;
    } catch {
      return false;
    }
  },

  createBooking: async (data) => {
    try {
      const res = await fetch("/api/vendor/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const result = await res.json();
      set((state) => ({ bookings: [result.booking, ...state.bookings] }));
      return true;
    } catch {
      return false;
    }
  },

  updateBookingStatus: async (id, status) => {
    try {
      const res = await fetch(`/api/vendor/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return false;
      set((state) => ({
        bookings: state.bookings.map((b) =>
          b.id === id ? { ...b, status } : b
        ),
      }));
      return true;
    } catch {
      return false;
    }
  },

  refreshBookings: async () => {
    try {
      const res = await fetch("/api/vendor/bookings");
      if (!res.ok) return;
      const data = await res.json();
      set({ bookings: data.bookings ?? [] });
    } catch (err) {
      console.error("Bookings refresh error:", err);
    }
  },

  updateSettings: async (settings) => {
    try {
      const res = await fetch("/api/vendor/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationSettings: settings }),
      });
      if (!res.ok) return false;
      set((state) => ({
        vendor: state.vendor ? { ...state.vendor, notificationSettings: settings } : null,
      }));
      return true;
    } catch {
      return false;
    }
  },

  reset: () => {
    set({
      vendor: null,
      products: [],
      bookings: [],
      isLoading: false,
      isInitialized: false,
      error: null,
    });
  },
}));
