export declare function parseAmoraCitations(content: unknown): {
  text: string;
  parts: number[];
};



export interface AmoraMannersLink {
  number: number;
  slug: string;
  title: string;
  subtitle: string;
}

export declare function resolveAmoraMannersLinks(parts: unknown): AmoraMannersLink[];
