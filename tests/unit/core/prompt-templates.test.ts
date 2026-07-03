import { describe, it, expect } from 'vitest';
import { buildBatchPrompt, buildTranslationPrompt } from '../../../core/api/prompt-templates';
import type { SegmentContext } from '../../../shared/types';
import { TextType } from '../../../shared/types';

describe('buildTranslationPrompt', () => {
  const baseContext: SegmentContext = {
    sentence: 'The quick brown fox jumps over the lazy dog.',
    textType: TextType.PARAGRAPH,
    tagName: 'p',
    pageTitle: 'Test Page',
    pageMetaDescription: 'A test page description',
    pageLanguage: 'en',
    headingPath: ['Chapter 1', 'Introduction'],
    beforeSentences: ['Previous sentence one.', 'Previous sentence two.'],
    afterSentences: ['Next sentence one.', 'Next sentence two.'],
  };

  it('builds a prompt with system and user messages', () => {
    const { systemPrompt, userMessage } = buildTranslationPrompt(
      'The quick brown fox jumps over the lazy dog.',
      baseContext,
      'en',
      'zh-CN',
    );

    expect(systemPrompt).toContain('expert translator');
    expect(systemPrompt).toContain('English');
    expect(systemPrompt).toContain('Chinese');

    expect(userMessage).toContain('TEXT TO TRANSLATE');
    expect(userMessage).toContain('quick brown fox');
    expect(userMessage).toContain('Chapter 1 > Introduction');
  });

  it('includes heading hierarchy in user message', () => {
    const { userMessage } = buildTranslationPrompt(
      'Some text',
      baseContext,
      'en',
      'zh-CN',
    );

    expect(userMessage).toContain('Chapter 1 > Introduction');
  });

  it('includes surrounding text markers', () => {
    const { userMessage } = buildTranslationPrompt(
      'target sentence',
      baseContext,
      'en',
      'zh-CN',
    );

    expect(userMessage).toContain('[Before]');
    expect(userMessage).toContain('Previous sentence one');
    expect(userMessage).toContain('[After]');
    expect(userMessage).toContain('Next sentence two');
  });

  it('marks the target sentence with arrows', () => {
    const { userMessage } = buildTranslationPrompt(
      'target sentence',
      baseContext,
      'en',
      'zh-CN',
    );

    expect(userMessage).toContain('>>>');
    expect(userMessage).toContain('THIS IS THE TEXT TO TRANSLATE');
  });

  it('does not put element type labels in numbered batch source lines', () => {
    const { userMessage } = buildBatchPrompt(
      [{ index: 0, text: 'Learn more', context: { ...baseContext, textType: TextType.LINK } }],
      'en',
      'zh-CN',
      {
        pageTitle: '',
        pageMetaDescription: '',
        headingPath: [],
      },
    );

    expect(userMessage).toContain('Context for [#1] (do not translate this context):');
    expect(userMessage).toContain('- Type: hyperlink text (p)');
    expect(userMessage).toContain('[#1] Learn more');
    expect(userMessage).not.toContain('[#1] [link]');
  });

  it('includes compact per-sentence context in batch prompts', () => {
    const { userMessage } = buildBatchPrompt(
      [{
        index: 0,
        text: 'Start now',
        context: {
          ...baseContext,
          textType: TextType.BUTTON,
          tagName: 'button',
          placeholder: 'Primary signup action',
          siblingContext: 'Cancel | Learn more',
        },
      }],
      'en',
      'zh-CN',
      {
        pageTitle: 'Pricing',
        pageMetaDescription: 'Plans for teams',
        headingPath: ['Pricing', 'Enterprise'],
      },
    );

    expect(userMessage).toContain('Page title: "Pricing"');
    expect(userMessage).toContain('- Type: button label (button)');
    expect(userMessage).toContain('- Section: Chapter 1 > Introduction');
    expect(userMessage).toContain('- Element hint: Primary signup action');
    expect(userMessage).toContain('- Before: Previous sentence one. / Previous sentence two.');
    expect(userMessage).toContain('- After: Next sentence one. / Next sentence two.');
    expect(userMessage).toContain('- Related: Cancel | Learn more');
    expect(userMessage).toContain('[#1] Start now');
  });
});
