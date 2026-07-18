export interface MarketPriceDistribution {
  sampleSize: number;
  p25Krw: number;
  medianKrw: number;
  p75Krw: number;
}

export interface MarketPriceProvider {
  getDistribution(vendorId: string): Promise<MarketPriceDistribution | null>;
}

export class StubMarketPriceProvider implements MarketPriceProvider {
  async getDistribution(): Promise<null> {
    return null;
  }
}

export const marketPriceProvider: MarketPriceProvider = new StubMarketPriceProvider();
