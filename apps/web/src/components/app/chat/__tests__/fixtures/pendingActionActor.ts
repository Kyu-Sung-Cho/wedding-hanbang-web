import { useAuthStore } from "@/stores/authStore";

export const PENDING_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const PENDING_PARTNER_ID = "55555555-5555-4555-8555-555555555555";
export const PENDING_COUPLE_ID = "22222222-2222-4222-8222-222222222222";

export function setPendingActionActor(id = PENDING_ACTOR_ID, coupleId = PENDING_COUPLE_ID) {
  useAuthStore.setState({
    user: { id, email: "synthetic@example.invalid" },
    profile: { id, couple_id: coupleId, role: id === PENDING_ACTOR_ID ? "bride" : "groom",
      name: "합성 사용자", avatar_url: null, onboarding_completed: true, onboarding_step: 5,
      is_admin: false, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" },
    couple: { id: coupleId, bride_id: PENDING_ACTOR_ID, groom_id: PENDING_PARTNER_ID, invite_code: null,
      membership_sealed_at: "2026-09-21T00:00:00Z", created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" },
    isInitialized: true, isDemo: false,
  });
}
