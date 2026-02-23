export type ShopType = 'studio' | 'dress' | 'makeup';

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'likert_5'
  | 'text_area'
  | 'contact_form';

export interface QuestionOption {
  value: number;
  label: string;
  hasTextInput?: boolean;
}

export interface ContactField {
  id: string;
  label: string;
  placeholder?: string;
  inputType?: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  required: boolean;
  question: string;
  subtitle?: string;
  note?: string;
  placeholder?: string;
  maxLength?: number;
  maxSelect?: number;
  options?: QuestionOption[];
  fields?: ContactField[];
  conditionalDisplay?: {
    questionId: string;
    valueIn: number[];
  };
  reportContents?: string[];
}

export interface Section {
  id: string;
  title: string;
  note?: string;
  sectionNote?: string;
  additionalNotes?: string[];
  exampleBox?: string;
  questions: Question[];
}

export interface ShopConfig {
  shopType: ShopType;
  shopTypeName: string;
  painPoints: string[];
  solutions: string[];
  extraBox?: string;
  sections: Section[];
}

export const LIKERT_LABELS = [
  '전혀 도움 안 될 것 같다',
  '별로',
  '보통',
  '도움 될 것 같다',
  '매우 도움 될 것 같다',
];
