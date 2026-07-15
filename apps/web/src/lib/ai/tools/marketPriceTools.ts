import type { ToolExecutionResult } from "@/types/database.types";
import {
  DRESS_PRICES,
  MAKEUP_PRICES,
  PRICE_PERIODS,
  SDM_PACKAGES,
  SEASONAL_DATA,
  VENUE_NECESSARY,
  getLatestPeriodId,
  getVenueOptionalItems,
} from "@/constants/marketPrices";
import {
  formatMarketPrice,
  normalizeMarketPrice,
} from "@/lib/marketPrices/display";

const MARKET_PRICE_SOURCE = {
  name: "한국소비자원 참가격 결혼서비스 가격조사",
  url: "https://price.go.kr/tprice/portal/wedding/areaStatistic.do",
} as const;

const MARKET_REFERENCE_NOTICE =
  "공개 조사값은 조사 시점·지역·항목 범위의 시장 참고 자료이며, 포함 조건이 다른 개인 견적의 적정성이나 계약 안전성을 판정하지 않습니다.";

function hasAvailableMarketPrice(values: Array<number | null>) {
  return values.some((value) => value !== null);
}

export function executeGetMarketPrice(input: Record<string, unknown>): ToolExecutionResult {
  const category = typeof input.category === "string" ? input.category : "";
  const requestedScope = input.scope ?? "national";
  const supportedCategories = new Set([
    "total", "venue", "sdm", "studio", "dress", "makeup", "options", "seasonal",
  ]);
  if (!supportedCategories.has(category)) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: { requestedCategory: category || null, dataAvailable: false },
      success: false,
      displayMessage: "지원하지 않는 공식 조사 항목입니다. 임의 값이나 유사 항목으로 대신하지 않았습니다.",
    };
  }
  if (requestedScope !== "national" && requestedScope !== "seoul") {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: { requestedScope, dataAvailable: false },
      success: false,
      displayMessage: "현재 공식 조사 범위는 전국 또는 서울만 지원합니다. 다른 지역 값으로 대신하지 않았습니다.",
    };
  }

  const scope = requestedScope;
  const pid = getLatestPeriodId();
  const period = PRICE_PERIODS.find((pricePeriod) => pricePeriod.id === pid);
  if (!period) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: { category, scope, dataAvailable: false },
      success: false,
      displayMessage: "표시할 수 있는 공식 조사 기준월을 찾지 못했습니다. 임의 값을 제공하지 않습니다.",
    };
  }
  const scopeLabel = scope === "seoul" ? "서울" : "전국";

  let displayMessage = "";
  let toolOutput: Record<string, unknown> = {};

  switch (category) {
    case "total": {
      displayMessage = `[${period.label} 조사]\n예식장과 스드메는 조사 항목·단위가 달라 하나의 "총비용"으로 합산하지 않아요. 예식장은 venue, 스드메는 sdm 항목으로 각각 확인해주세요.`;
      toolOutput = {
        periodId: pid,
        periodLabel: period.label,
        totalAvailable: false,
        reason: "예식장과 스드메의 서로 다른 조사 항목을 합산한 총비용은 제공하지 않습니다.",
      };
      break;
    }
    case "venue": {
      const necessary = VENUE_NECESSARY.find(
        (venue) => venue.periodId === pid && venue.scope === scope
      );
      const optional = getVenueOptionalItems(pid, scope);
      if (necessary) {
        const safeNecessary = {
          ...necessary,
          rental: normalizeMarketPrice(necessary.rental),
          minGuests: normalizeMarketPrice(necessary.minGuests),
          perPersonMeal: normalizeMarketPrice(necessary.perPersonMeal),
          totalFood: normalizeMarketPrice(necessary.totalFood),
        };
        const safeOptional = Object.fromEntries(
          Object.entries(optional.items).map(([name, price]) => [
            name,
            normalizeMarketPrice(price),
          ]),
        ) as Record<string, number | null>;
        const hasNecessaryPrice = hasAvailableMarketPrice([
          safeNecessary.rental,
          safeNecessary.minGuests,
          safeNecessary.perPersonMeal,
          safeNecessary.totalFood,
        ]);
        const hasOptionalPrice = hasAvailableMarketPrice(Object.values(safeOptional));
        if (hasNecessaryPrice || hasOptionalPrice) {
          displayMessage = `[${scopeLabel} 예식장 중위값 - ${period.label}]\n대관료 중위가격: ${formatMarketPrice(necessary.rental)}\n1인당 식대 중위가격: ${formatMarketPrice(necessary.perPersonMeal)}\n최소보증인원 중위값: ${formatMarketPrice(necessary.minGuests, "명")}\n식대총액 중위가격: ${formatMarketPrice(necessary.totalFood)}\n\n선택 항목 중위가격(필수 아님·포함 여부는 계약마다 다름):\n- 생화꽃장식: ${formatMarketPrice(optional.items["생화꽃장식"])}\n- 축가: ${formatMarketPrice(optional.items["축가/축하공연"])}\n- 사회자: ${formatMarketPrice(optional.items["본식 사회자"])}\n- 웨딩케이크: ${formatMarketPrice(optional.items["웨딩케이크"])}\n- 폐백음식: ${formatMarketPrice(optional.items["폐백 음식"])}\n- 부케: ${formatMarketPrice(optional.items["부케"])}`;
          toolOutput = { necessary: safeNecessary, optional: safeOptional };
        }
      }
      break;
    }
    case "sdm": {
      const packages = SDM_PACKAGES.filter(
        (packagePrice) => packagePrice.periodId === pid,
      ).map((packagePrice) => ({
        ...packagePrice,
        packageMedian: normalizeMarketPrice(packagePrice.packageMedian),
        dmPackageMedian: normalizeMarketPrice(packagePrice.dmPackageMedian),
        studioBasic: normalizeMarketPrice(packagePrice.studioBasic),
      }));
      const availablePackages = packages.filter((packagePrice) =>
        hasAvailableMarketPrice([
          packagePrice.packageMedian,
          packagePrice.dmPackageMedian,
          packagePrice.studioBasic,
        ]),
      );
      if (availablePackages.length > 0) {
        displayMessage = `[스드메 패키지 중위가격 - ${period.label}]\n${availablePackages
          .map(
            (packagePrice) =>
              `${packagePrice.region}: 패키지 ${formatMarketPrice(packagePrice.packageMedian)} / 드메 ${formatMarketPrice(packagePrice.dmPackageMedian)} / 스튜디오 ${formatMarketPrice(packagePrice.studioBasic)}`,
          )
          .join("\n")}`;
        toolOutput = { packages: availablePackages };
      }
      break;
    }
    case "studio": {
      const region = scope === "seoul" ? "서울" : "전체";
      const studio = SDM_PACKAGES.find(
        (packagePrice) => packagePrice.periodId === pid && packagePrice.region === region
      );
      const studioBasic = normalizeMarketPrice(studio?.studioBasic);
      if (studio && studioBasic !== null) {
        displayMessage = `[${scopeLabel} 스튜디오 기본촬영 - ${period.label}]\n중위가격: ${formatMarketPrice(studioBasic)}`;
        toolOutput = {
          periodId: pid,
          periodLabel: period.label,
          region,
          studioBasic,
        };
      }
      break;
    }
    case "dress": {
      const dress = DRESS_PRICES.find((price) => price.periodId === pid && price.scope === scope);
      if (dress) {
        const safeDress = {
          ...dress,
          photoShoot: normalizeMarketPrice(dress.photoShoot),
          ceremony: normalizeMarketPrice(dress.ceremony),
          secondDress: normalizeMarketPrice(dress.secondDress),
        };
        if (
          hasAvailableMarketPrice([
            safeDress.photoShoot,
            safeDress.ceremony,
            safeDress.secondDress,
          ])
        ) {
          displayMessage = `[${scopeLabel} 드레스 중위가격 - ${period.label}]\n촬영용: ${formatMarketPrice(dress.photoShoot)}\n본식용: ${formatMarketPrice(dress.ceremony)}\n2부 드레스: ${formatMarketPrice(dress.secondDress)}`;
          toolOutput = { periodId: pid, periodLabel: period.label, prices: safeDress };
        }
      }
      break;
    }
    case "makeup": {
      const makeup = MAKEUP_PRICES.find((price) => price.periodId === pid && price.scope === scope);
      if (makeup) {
        const safeMakeup = {
          ...makeup,
          photoShoot: normalizeMarketPrice(makeup.photoShoot),
          ceremony: normalizeMarketPrice(makeup.ceremony),
          rehearsal: normalizeMarketPrice(makeup.rehearsal),
        };
        if (
          hasAvailableMarketPrice([
            safeMakeup.photoShoot,
            safeMakeup.ceremony,
            safeMakeup.rehearsal,
          ])
        ) {
          displayMessage = `[${scopeLabel} 메이크업 중위가격 - ${period.label}]\n촬영: ${formatMarketPrice(makeup.photoShoot)}\n본식: ${formatMarketPrice(makeup.ceremony)}\n리허설(선택·포함 여부 확인): ${formatMarketPrice(makeup.rehearsal)}`;
          toolOutput = { periodId: pid, periodLabel: period.label, prices: safeMakeup };
        }
      }
      break;
    }
    case "options": {
      const options = getVenueOptionalItems(pid, scope);
      const safeOptions = Object.fromEntries(
        Object.entries(options.items).map(([name, price]) => [
          name,
          normalizeMarketPrice(price),
        ]),
      ) as Record<string, number | null>;
      const available = Object.entries(safeOptions).filter(
        (entry): entry is [string, number] => entry[1] !== null,
      );
      if (available.length > 0) {
        displayMessage = `[${scopeLabel} 예식장 선택항목 중위가격 - ${period.label}]\n${available
          .map(([name, price]) => `- ${name}: ${formatMarketPrice(price)}`)
          .join("\n")}`;
        toolOutput = {
          periodId: pid,
          periodLabel: period.label,
          category: "venue",
          options: safeOptions,
        };
      }
      break;
    }
    case "seasonal": {
      const latest = SEASONAL_DATA.find((item) => item.periodId === pid);
      if (latest) {
        const safeSeasonal = {
          ...latest,
          peak: normalizeMarketPrice(latest.peak),
          offPeak: normalizeMarketPrice(latest.offPeak),
          savings: normalizeMarketPrice(latest.savings),
        };
        if (
          hasAvailableMarketPrice([
            safeSeasonal.peak,
            safeSeasonal.offPeak,
            safeSeasonal.savings,
          ])
        ) {
          displayMessage = `[예식장 성수기·비수기 중위 계약금액 - ${period.label}]\n예식장별 성수기·비수기 기준은 다름\n성수기 중위 계약금액: ${formatMarketPrice(latest.peak)}\n비수기 중위 계약금액: ${formatMarketPrice(latest.offPeak)}\n차이: ${formatMarketPrice(latest.savings)} (절약 보장액 아님)`;
          toolOutput = { periodId: pid, periodLabel: period.label, seasonal: safeSeasonal };
        }
      }
      break;
    }
  }

  const commonOutput = {
    category,
    scope,
    scopeLabel,
    periodId: pid,
    periodLabel: period.label,
    statisticType: "published_median",
    crossCategoryAggregationAllowed: false,
    sourceName: MARKET_PRICE_SOURCE.name,
    sourceUrl: MARKET_PRICE_SOURCE.url,
    interpretationBoundary: "market_reference_not_individual_appraisal",
  } as const;

  if (Object.keys(toolOutput).length === 0) {
    return {
      toolName: "get_market_price",
      toolInput: input,
      toolOutput: { ...commonOutput, dataAvailable: false },
      success: false,
      displayMessage: `해당 범위의 ${period.label} 공식 조사값을 찾지 못했습니다. 임의 값으로 대신하지 않았습니다.`,
    };
  }

  toolOutput = { ...commonOutput, ...toolOutput, dataAvailable: true };
  displayMessage = `${displayMessage}\n\n${MARKET_REFERENCE_NOTICE}`;

  return {
    toolName: "get_market_price",
    toolInput: input,
    toolOutput,
    success: true,
    displayMessage,
  };
}
