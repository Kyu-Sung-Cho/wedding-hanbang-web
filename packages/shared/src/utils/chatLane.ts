export type AmoraChatScope = "shared" | "private";
export type AmoraChatTarget = "ai" | "partner";
export type AmoraChatLane = "shared_ai" | "shared_partner" | "private_ai";

export type AmoraChatLaneRecord<T> = Record<AmoraChatLane, T>;

export function resolveAmoraChatLane(
  scope: AmoraChatScope,
  target: AmoraChatTarget,
  hasLinkedPartner: boolean,
): AmoraChatLane | null {
  if (scope === "private") return target === "ai" ? "private_ai" : null;
  if (target === "partner") return hasLinkedPartner ? "shared_partner" : null;
  return "shared_ai";
}

export function createEmptyAmoraChatLaneRecord<T>(
  createValue: (lane: AmoraChatLane) => T,
): AmoraChatLaneRecord<T> {
  return {
    shared_ai: createValue("shared_ai"),
    shared_partner: createValue("shared_partner"),
    private_ai: createValue("private_ai"),
  };
}

export function updateAmoraChatLaneRecord<T>(
  values: AmoraChatLaneRecord<T>,
  lane: AmoraChatLane,
  value: T,
): AmoraChatLaneRecord<T> {
  return { ...values, [lane]: value };
}
