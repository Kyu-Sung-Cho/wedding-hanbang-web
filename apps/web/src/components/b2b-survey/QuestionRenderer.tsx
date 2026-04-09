"use client";

import { Question } from "./data/types";
import SingleChoice from "./QuestionTypes/SingleChoice";
import MultipleChoice from "./QuestionTypes/MultipleChoice";
import LikertScale from "./QuestionTypes/LikertScale";
import TextArea from "./QuestionTypes/TextArea";
import ContactForm from "./QuestionTypes/ContactForm";

interface Props {
  question: Question;
  answer: unknown;
  onChange: (questionId: string, value: unknown) => void;
  otherText?: string;
  onOtherTextChange?: (questionId: string, text: string) => void;
  error?: string;
}

export default function QuestionRenderer({
  question,
  answer,
  onChange,
  otherText,
  onOtherTextChange,
  error,
}: Props) {
  switch (question.type) {
    case "single_choice":
      return (
        <SingleChoice
          options={question.options || []}
          value={(answer as number) ?? null}
          onChange={(v) => onChange(question.id, v)}
          otherText={otherText}
          onOtherTextChange={(t) => onOtherTextChange?.(question.id, t)}
          error={error}
          reportContents={question.reportContents}
        />
      );

    case "multiple_choice":
      return (
        <MultipleChoice
          options={question.options || []}
          value={(answer as number[]) ?? []}
          onChange={(v) => onChange(question.id, v)}
          maxSelect={question.maxSelect}
          otherText={otherText}
          onOtherTextChange={(t) => onOtherTextChange?.(question.id, t)}
          error={error}
        />
      );

    case "likert_5":
      return (
        <LikertScale
          value={(answer as number) ?? null}
          onChange={(v) => onChange(question.id, v)}
          error={error}
          note={question.note}
        />
      );

    case "text_area":
      return (
        <TextArea
          value={(answer as string) ?? ""}
          onChange={(v) => onChange(question.id, v)}
          placeholder={question.placeholder}
          maxLength={question.maxLength}
          error={error}
        />
      );

    case "contact_form":
      return (
        <ContactForm
          fields={question.fields || []}
          value={(answer as Record<string, string>) ?? {}}
          onChange={(v) => onChange(question.id, v)}
        />
      );

    default:
      return null;
  }
}
