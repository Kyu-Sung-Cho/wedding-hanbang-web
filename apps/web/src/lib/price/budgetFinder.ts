import { comparableOffers } from "./catalog";
import type { PriceOffer, PriceVendor } from "./catalog";

type BudgetCategory = "studio" | "dress" | "makeup";

export type BudgetChoice = {
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  agencyId: string | null;
  agencyName: string;
  baseKrw: number;
};

export type BudgetCombination = Record<BudgetCategory, BudgetChoice> & {
  totalKrw: number;
};

type BudgetFinderInput = {
  catalogs: Record<BudgetCategory, readonly PriceVendor[]>;
  budgetMaximumKrw: number;
  agencyIds?: readonly string[];
  limit?: number;
};

type HeapNode = {
  indexes: [number, number, number];
  total: number;
};

function compareOffers(left: PriceOffer, right: PriceOffer): number {
  if (left.minimumKrw === null) return 1;
  if (right.minimumKrw === null) return -1;
  return left.minimumKrw - right.minimumKrw
    || left.agencyName.localeCompare(right.agencyName, "ko-KR")
    || left.id.localeCompare(right.id);
}

function choices(
  vendors: readonly PriceVendor[],
  allowedAgencyIds: ReadonlySet<string>,
): BudgetChoice[] {
  return vendors.flatMap((vendor) => {
    // 예산 조합은 "이 값에 살 수 있다"는 주장이다. 대행사 없는 행(예식장 패키지
    // 구성)은 그 값에 살 수 있는 상품이 아니라서 후보에서 뺀다 — 안 빼면 루미디아가
    // 실제 150만인데 "1벌당 30만" 추가금으로 최저가 드레스로 추천된다.
    const offer = comparableOffers(vendor)
      .filter(({ agencyId, minimumKrw }) => minimumKrw !== null
        && (allowedAgencyIds.size === 0 || (agencyId !== null && allowedAgencyIds.has(agencyId))))
      .sort(compareOffers)[0];
    if (!offer || offer.minimumKrw === null) return [];
    return [{
      vendorId: vendor.id,
      vendorSlug: vendor.slug,
      vendorName: vendor.name,
      agencyId: offer.agencyId,
      agencyName: offer.agencyName,
      baseKrw: offer.minimumKrw,
    }];
  }).sort((left, right) => left.baseKrw - right.baseKrw
    || left.vendorName.localeCompare(right.vendorName, "ko-KR")
    || left.vendorId.localeCompare(right.vendorId));
}

class MinimumHeap {
  private readonly values: HeapNode[] = [];

  get size() {
    return this.values.length;
  }

  push(node: HeapNode) {
    this.values.push(node);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent], node) <= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = node;
  }

  pop(): HeapNode | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const smaller = right < this.values.length
        && this.compare(this.values[right], this.values[left]) < 0
        ? right
        : left;
      if (this.compare(last, this.values[smaller]) <= 0) break;
      this.values[index] = this.values[smaller];
      index = smaller;
    }
    this.values[index] = last;
    return first;
  }

  private compare(left: HeapNode, right: HeapNode): number {
    return left.total - right.total
      || left.indexes[0] - right.indexes[0]
      || left.indexes[1] - right.indexes[1]
      || left.indexes[2] - right.indexes[2];
  }
}

export function findBudgetCombinations(input: BudgetFinderInput): BudgetCombination[] {
  if (!Number.isSafeInteger(input.budgetMaximumKrw) || input.budgetMaximumKrw < 0) return [];
  const allowedAgencyIds = new Set(input.agencyIds ?? []);
  const categoryChoices = [
    choices(input.catalogs.studio, allowedAgencyIds),
    choices(input.catalogs.dress, allowedAgencyIds),
    choices(input.catalogs.makeup, allowedAgencyIds),
  ] as const;
  if (categoryChoices.some((items) => items.length === 0)) return [];

  const totalAt = ([studio, dress, makeup]: [number, number, number]) =>
    categoryChoices[0][studio].baseKrw
      + categoryChoices[1][dress].baseKrw
      + categoryChoices[2][makeup].baseKrw;
  const heap = new MinimumHeap();
  const seen = new Set(["0:0:0"]);
  heap.push({ indexes: [0, 0, 0], total: totalAt([0, 0, 0]) });
  const result: BudgetCombination[] = [];
  const limit = Math.min(20, Math.max(1, input.limit ?? 20));

  while (heap.size > 0 && result.length < limit) {
    const node = heap.pop();
    if (!node || node.total > input.budgetMaximumKrw) break;
    const [studioIndex, dressIndex, makeupIndex] = node.indexes;
    result.push({
      studio: categoryChoices[0][studioIndex],
      dress: categoryChoices[1][dressIndex],
      makeup: categoryChoices[2][makeupIndex],
      totalKrw: node.total,
    });

    for (let axis = 0; axis < 3; axis += 1) {
      const next = [...node.indexes] as [number, number, number];
      next[axis] += 1;
      if (next[axis] >= categoryChoices[axis].length) continue;
      const key = next.join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      heap.push({ indexes: next, total: totalAt(next) });
    }
  }

  return result;
}
