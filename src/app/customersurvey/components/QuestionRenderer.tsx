'use client';

import { motion } from 'framer-motion';
import type { Question } from '../data/questions';
import SingleChoice from './QuestionTypes/SingleChoice';
import MultipleChoice from './QuestionTypes/MultipleChoice';
import LikertScale from './QuestionTypes/LikertScale';
import Ranking from './QuestionTypes/Ranking';
import NPS from './QuestionTypes/NPS';
import PriceInput from './QuestionTypes/PriceInput';
import TextArea from './QuestionTypes/TextArea';
import TextInput from './QuestionTypes/TextInput';
import Demographic from './QuestionTypes/Demographic';

interface QuestionRendererProps {
  question: Question;
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  otherText?: string;
  onOtherTextChange?: (questionId: string, text: string) => void;
  error?: string;
  index: number;
}

export default function QuestionRenderer({
  question,
  value,
  onChange,
  otherText,
  onOtherTextChange,
  error,
  index,
}: QuestionRendererProps) {
  const renderQuestion = () => {
    switch (question.type) {
      case 'single_choice':
        return (
          <SingleChoice
            questionId={question.id}
            options={question.options!}
            value={value}
            onChange={onChange}
            otherText={otherText}
            onOtherTextChange={onOtherTextChange}
            error={error}
          />
        );

      case 'multiple_choice':
        return (
          <MultipleChoice
            questionId={question.id}
            options={question.options!}
            value={value}
            onChange={onChange}
            maxSelect={question.maxSelect}
            otherText={otherText}
            onOtherTextChange={onOtherTextChange}
            error={error}
          />
        );

      case 'likert_5':
        return (
          <LikertScale
            questionId={question.id}
            scale={question.scale!}
            value={value}
            onChange={onChange}
            error={error}
          />
        );

      case 'ranking':
        return (
          <Ranking
            questionId={question.id}
            options={question.options!}
            value={value}
            onChange={onChange}
            maxRank={question.maxRank ?? 3}
            error={error}
          />
        );

      case 'nps':
        return (
          <NPS
            questionId={question.id}
            min={question.npsScale!.min}
            max={question.npsScale!.max}
            minLabel={question.npsScale!.minLabel}
            maxLabel={question.npsScale!.maxLabel}
            value={value}
            onChange={onChange}
            error={error}
          />
        );

      case 'price_input':
        return (
          <PriceInput
            questionId={question.id}
            subQuestions={question.subQuestions!}
            value={value}
            onChange={onChange}
            error={error}
          />
        );

      case 'text_area':
        return (
          <TextArea
            questionId={question.id}
            value={value}
            onChange={onChange}
            placeholder={question.placeholder}
            maxLength={question.maxLength}
            error={error}
          />
        );

      case 'text_input':
        return (
          <TextInput
            questionId={question.id}
            value={value}
            onChange={onChange}
            placeholder={question.placeholder}
            error={error}
          />
        );

      case 'demographic':
        return (
          <Demographic
            questionId={question.id}
            subQuestions={question.subQuestions!}
            value={value}
            onChange={onChange}
            error={error}
          />
        );

      default:
        return null;
    }
  };

  return (
    <motion.div
      key={question.id}
      id={`question-${question.id}`}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
      className="mb-10"
    >
      <div className="mb-4">
        <p className="text-[25px] font-medium text-noir-800 leading-relaxed">
          {question.question}
          {question.required && (
            <span className="text-rose-500 ml-1">*</span>
          )}
        </p>
      </div>
      {renderQuestion()}
    </motion.div>
  );
}
