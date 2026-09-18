export interface MannersPartLink {
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string;
}

export declare const MANNERS_PART_LINKS: Readonly<Record<number, MannersPartLink>>;

export declare function mannersPartForCitation(value: unknown): MannersPartLink | undefined;
