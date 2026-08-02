import {
  act,
  createRef,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSurveyState } from './useSurveyState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_DRAFT_STORAGE_KEY = 'wedding_survey_draft';

type SurveyStateApi = ReturnType<typeof useSurveyState>;

const SurveyStateHarness = forwardRef<SurveyStateApi>(function SurveyStateHarness(_props, ref) {
  const surveyState = useSurveyState();
  useImperativeHandle(ref, () => surveyState, [surveyState]);
  return null;
});

function getLatestState(ref: RefObject<SurveyStateApi | null>) {
  if (!ref.current) throw new Error('survey state harness was not rendered');
  return ref.current;
}

describe('useSurveyState browser privacy', () => {
  let root: Root;
  let container: HTMLDivElement;
  let surveyStateRef: RefObject<SurveyStateApi | null>;

  beforeEach(() => {
    surveyStateRef = createRef<SurveyStateApi>();
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('purges legacy drafts instead of restoring sensitive answers', async () => {
    const legacyDraft = JSON.stringify({
      answers: { q22: 'private demographic data', q23: '010-1234-5678' },
      otherTexts: { q23: 'person@example.com' },
      status: 'in_progress',
    });
    window.localStorage.setItem(LEGACY_DRAFT_STORAGE_KEY, legacyDraft);
    window.sessionStorage.setItem(LEGACY_DRAFT_STORAGE_KEY, legacyDraft);

    await act(async () => {
      root.render(<SurveyStateHarness ref={surveyStateRef} />);
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
    expect(getLatestState(surveyStateRef).hasDraft).toBe(false);
    expect(getLatestState(surveyStateRef).answers).toEqual({});
  });

  it('keeps new survey answers in memory only', async () => {
    await act(async () => {
      root.render(<SurveyStateHarness ref={surveyStateRef} />);
      await Promise.resolve();
    });

    await act(async () => {
      getLatestState(surveyStateRef).startSurvey();
      getLatestState(surveyStateRef).setAnswer('q21', 'private free-text answer');
      getLatestState(surveyStateRef).setOtherText('q21', 'additional private detail');
    });

    expect(getLatestState(surveyStateRef).answers.q21).toBe('private free-text answer');
    expect(window.localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
  });
});
