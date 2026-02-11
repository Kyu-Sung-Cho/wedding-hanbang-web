export interface ChecklistItem {
  id: string;
  text: string;
}

export interface ChecklistGroup {
  id: string;
  groupTitle: string;
  items: ChecklistItem[];
}

export interface TipItem {
  number: number;
  title: string;
  description: string;
  subItems?: string[];
}

export interface Tip {
  id: string;
  title: string;
  items: TipItem[];
}

export interface Warning {
  id: string;
  title: string;
  items: string[];
}

export interface Script {
  id: string;
  title: string;
  lines: string[];
}

export interface EtiquetteSection {
  id: string;
  title: string;
  checklists: ChecklistGroup[];
  tips: Tip[];
  warnings: Warning[];
  scripts: Script[];
}

export interface EtiquettePart {
  id: string;
  partNumber: number;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  description: string;
  sections: EtiquetteSection[];
}

export interface EtiquetteProgress {
  checkItemId: string;
  isCompleted: boolean;
}

export interface EtiquetteBookmark {
  targetType: "part" | "section" | "tip" | "warning" | "script";
  targetId: string;
}
