import { describe, expect, it } from "vitest";
import { resolveBookingContact } from "../contact";

const profiles = [
  { id: "bride", name: " 김신부 ", role: "bride", phone: "01011112222" },
  { id: "groom", name: "박신랑", role: "groom", phone: "01033334444" },
];

describe("resolveBookingContact", () => {
  it("uses only the current user's authoritative name and saved phone", () => {
    expect(resolveBookingContact(profiles, "groom")).toEqual({
      brideName: "",
      groomName: "박신랑",
      contactPhone: "01033334444",
    });
  });

  it("never falls back to the partner phone without that partner's explicit consent", () => {
    expect(resolveBookingContact(
      [{ ...profiles[0], phone: null }, profiles[1]],
      "bride",
    )).toEqual({ brideName: "김신부", groomName: "", contactPhone: null });
  });

  it("rejects missing or malformed phones instead of creating a blank booking", () => {
    expect(resolveBookingContact(
      profiles.map((profile) => ({ ...profile, phone: "02-1234-5678" })),
      "bride",
    ).contactPhone).toBeNull();
  });
});
