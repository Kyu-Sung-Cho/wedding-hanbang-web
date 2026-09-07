export type PlaceSearchOrder = "region_kind" | "kind_distance" | "kind_provider";
export function readPlaceRequestedCount(value: unknown): number | null;
export function readPlaceSearchFacts(value: unknown): { requestedCount?: number; orderBasis?: PlaceSearchOrder };
export function formatPlaceSearchDate(value: unknown): string | null;
export function getPlaceSearchPresentation(output: unknown, displayedCount: number): {
  countLabel: string; shortageLabel: string | null; orderLabel: string; verificationLabel: string;
};
