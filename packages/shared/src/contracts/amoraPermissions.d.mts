export declare const AMORA_PERMISSION_COPY: {
  readonly title: string;
  readonly intro: string;
  readonly sections: { readonly auto: string; readonly ask: string; readonly never: string };
  readonly askNote: string;
  readonly neverNote: string;
  readonly controlsTitle: string;
  readonly memoryLink: string;
  readonly memoryLinkSub: string;
};

export interface AmoraPermissionFeatures {
  /** 인터넷 찾기·공식 페이지 읽기(갈래 3)가 지금 켜져 있는가 */
  webSearch?: boolean;
  /** 맡은 일(갈래 4)이 지금 켜져 있는가 */
  agentTasks?: boolean;
}

export declare function buildAmoraPermissionTable(features?: AmoraPermissionFeatures): {
  auto: string[];
  ask: string[];
  never: string[];
};
