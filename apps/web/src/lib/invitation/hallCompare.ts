import type { CompareModel, CompareSortId, HallCard, HallSource } from "@hanbang/shared/invitation";
import { COMPARE_COPY } from "@hanbang/shared/invitation";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { checkedOnLabel, monthDayLabel } from "./kstFormat";
import { LIVE_COPY, formatWon, withCommas } from "./liveCopy";

/**
 * 웨딩홀 비교(W2). 운영자가 출처 주소와 확인일을 적어 넣은 `hall_listings` 만 읽는다.
 *
 * 예상 총액 = 대관료 + 1인 식대 × max(하객 수, 최소 보증 인원). 보증 인원이 하객 수보다 많으면
 * 그 사실을 칸과 꼬리표로 말한다. 예약 가능일은 업체에 확인해야 한다는 것을 화면 첫 문장이 말한다.
 * 점수, 순위, "추천"·"최고"·"가성비"·"저렴"·"1위" 같은 판정은 만들지 않는다.
 */

export type HallListing = {
  id: string;
  name: string;
  region: string;
  areaLabel: string;
  kindLabel: string;
  mealPriceWon: number;
  rentalFeeWon: number | null;
  rentalIncluded: boolean;
  minimumGuarantee: number | null;
  stationWalkMinutes: number | null;
  transitNote: string | null;
  photoUrl: string | null;
  sourceUrl: string;
  checkedOn: string;
  active: boolean;
};

const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= max ? value.trim() : null;
const httpsUrl = (value: unknown): string | null =>
  typeof value === "string" && /^https:\/\/\S+$/.test(value) && value.length <= 500 ? value : null;

/** DB 줄을 경계에서 검사한다. 모양이 틀린 줄은 비교에 넣지 않는다. */
export function parseHallListing(value: unknown): HallListing | null {
  if (!isRecord(value) || !isUuid(value.id)) return null;
  const name = text(value.name, 60);
  const region = text(value.region, 20);
  const areaLabel = text(value.area_label, 40);
  const kindLabel = text(value.kind_label, 30);
  const mealPriceWon = int(value.meal_price_won, 1_000, 1_000_000);
  const rentalIncluded = value.rental_included === true;
  const rentalFeeWon = rentalIncluded ? null : int(value.rental_fee_won, 0, 200_000_000);
  const sourceUrl = httpsUrl(value.source_url);
  const checkedOn = typeof value.checked_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.checked_on) ? value.checked_on : null;
  if (!name || !region || !areaLabel || !kindLabel || mealPriceWon === null || !sourceUrl || !checkedOn) return null;
  if (!rentalIncluded && rentalFeeWon === null) return null;
  return {
    id: value.id.toLowerCase(),
    name,
    region,
    areaLabel,
    kindLabel,
    mealPriceWon,
    rentalFeeWon,
    rentalIncluded,
    minimumGuarantee: int(value.minimum_guarantee, 1, 3_000),
    stationWalkMinutes: int(value.station_walk_minutes, 0, 120),
    transitNote: text(value.transit_note, 40),
    photoUrl: httpsUrl(value.photo_url),
    sourceUrl,
    checkedOn,
    active: value.active === true,
  };
}

export type HallEstimate = {
  totalWon: number;
  /** 식대를 곱한 인원. 보증 인원이 더 많으면 보증 인원이다. */
  countedGuests: number;
  minimumApplied: boolean;
};

export function estimateHallTotal(hall: HallListing, guests: number): HallEstimate {
  const minimum = hall.minimumGuarantee ?? 0;
  const countedGuests = Math.max(guests, minimum);
  const rent = hall.rentalIncluded ? 0 : hall.rentalFeeWon ?? 0;
  return {
    totalWon: rent + hall.mealPriceWon * countedGuests,
    countedGuests,
    minimumApplied: minimum > guests,
  };
}

/** 예상 총액을 만 원 단위 글자로("1,360"). 만 원 아래는 반올림한다. */
export function totalManwonLabel(totalWon: number): string {
  return withCommas(Math.round(totalWon / 10_000));
}

/** 역에서 걷는 시간이 자료로 둘 이상 있고, 그 가운데 하나만 가장 짧을 때 그 홀. */
export function closestStationHallId(halls: readonly HallListing[]): string | null {
  const known = halls.filter((hall) => hall.stationWalkMinutes !== null);
  if (known.length < 2) return null;
  const shortest = Math.min(...known.map((hall) => hall.stationWalkMinutes as number));
  const winners = known.filter((hall) => hall.stationWalkMinutes === shortest);
  return winners.length === 1 ? winners[0].id : null;
}

export function hallBadge(hall: HallListing, guests: number, closestStationId: string | null): string | null {
  if (hall.minimumGuarantee !== null && hall.minimumGuarantee > guests) return LIVE_COPY.hallBadges.minimumCheck;
  if (closestStationId === hall.id) return LIVE_COPY.hallBadges.closestStation;
  return null;
}

/** 커플이 이 홀에 보낸 문의와 받은 답장의 마지막 모습. */
export type HallInquiryState = {
  dispatchStatus: "queued" | "sent";
  reply: { outcome: "confirmed_time" | "proposed_time" | "declined" | "question" | "conditions_note"; eventAt: string | null } | null;
};

export function hallStatusLine(hall: HallListing, guests: number, state: HallInquiryState | null): string | null {
  const reply = state?.reply ?? null;
  if (reply?.outcome === "confirmed_time" && reply.eventAt) {
    return LIVE_COPY.hallStatus.confirmed(monthDayLabel(new Date(reply.eventAt)));
  }
  if (reply?.outcome === "proposed_time") return LIVE_COPY.hallStatus.proposed;
  if (reply?.outcome === "declined") return LIVE_COPY.hallStatus.declined;
  if (reply) return LIVE_COPY.hallStatus.replied;
  if (state?.dispatchStatus === "sent") return LIVE_COPY.hallStatus.sent;
  if (state?.dispatchStatus === "queued") return LIVE_COPY.hallStatus.queued;
  if (hall.minimumGuarantee !== null && hall.minimumGuarantee > guests) {
    return LIVE_COPY.hallStatus.minimumOver(hall.minimumGuarantee - guests);
  }
  return null;
}

export function buildHallCard(input: {
  hall: HallListing;
  guests: number;
  picked: boolean;
  closestStationId: string | null;
  state: HallInquiryState | null;
}): HallCard {
  const { hall, guests } = input;
  const estimate = estimateHallTotal(hall, guests);
  const over = hall.minimumGuarantee !== null && hall.minimumGuarantee > guests ? hall.minimumGuarantee - guests : 0;
  return {
    id: hall.id,
    name: hall.name,
    area: hall.areaLabel,
    totalManwon: totalManwonLabel(estimate.totalWon),
    meal: formatWon(hall.mealPriceWon),
    rent: hall.rentalIncluded ? LIVE_COPY.rentIncluded : formatWon(hall.rentalFeeWon ?? 0),
    minimum: hall.minimumGuarantee === null
      ? LIVE_COPY.unknownCell
      : over > 0
        ? LIVE_COPY.minimumOver(hall.minimumGuarantee, over)
        : LIVE_COPY.people(hall.minimumGuarantee),
    minimumWarn: over > 0,
    transit: hall.transitNote
      ?? (hall.stationWalkMinutes !== null ? LIVE_COPY.stationWalk(hall.stationWalkMinutes) : LIVE_COPY.unknownCell),
    photo: hall.photoUrl,
    badge: hallBadge(hall, guests, input.closestStationId),
    picked: input.picked,
    status: hallStatusLine(hall, guests, input.state),
  };
}

export const HALL_SORT_IDS: readonly CompareSortId[] = COMPARE_COPY.sorts.map((sort) => sort.id);

export function isHallSortId(value: unknown): value is CompareSortId {
  return typeof value === "string" && (HALL_SORT_IDS as readonly string[]).includes(value);
}

const byName = (left: HallListing, right: HallListing) => left.name.localeCompare(right.name, "ko");
const nullsLast = (left: number | null, right: number | null) =>
  left === right ? 0 : left === null ? 1 : right === null ? -1 : left - right;

/**
 * 사용자가 고른 기준으로만 줄 세운다. "분위기"는 자료가 없어 이름순으로 둔다.
 */
export function sortHalls(halls: readonly HallListing[], sort: CompareSortId, guests: number): HallListing[] {
  const copy = [...halls];
  if (sort === "total") {
    return copy.sort((a, b) => estimateHallTotal(a, guests).totalWon - estimateHallTotal(b, guests).totalWon || byName(a, b));
  }
  if (sort === "transit") return copy.sort((a, b) => nullsLast(a.stationWalkMinutes, b.stationWalkMinutes) || byName(a, b));
  if (sort === "minimum") return copy.sort((a, b) => nullsLast(a.minimumGuarantee, b.minimumGuarantee) || byName(a, b));
  return copy.sort(byName);
}

export function buildCompareModel(input: {
  halls: readonly HallListing[];
  guests: number;
  month: number | null;
  pickedIds: ReadonlySet<string>;
  sort: CompareSortId;
  states: ReadonlyMap<string, HallInquiryState>;
  now?: Date;
}): { compare: CompareModel; sources: HallSource[] } {
  const ordered = sortHalls(input.halls, input.sort, input.guests);
  const closest = closestStationHallId(ordered);
  const oldestChecked = ordered.map((hall) => hall.checkedOn).sort()[0] ?? null;
  return {
    compare: {
      guests: input.guests,
      month: input.month,
      halls: ordered.map((hall) => buildHallCard({
        hall,
        guests: input.guests,
        picked: input.pickedIds.has(hall.id),
        closestStationId: closest,
        state: input.states.get(hall.id) ?? null,
      })),
      // 여러 홀의 확인일이 다르면 가장 오래된 날을 기준일로 말한다.
      sourceDateLabel: oldestChecked ? checkedOnLabel(oldestChecked, input.now) : null,
    },
    sources: ordered.map((hall) => ({ hallId: hall.id, sourceUrl: hall.sourceUrl, checkedOn: hall.checkedOn })),
  };
}
