import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LanguageSelector from '../../../entrypoints/popup/components/LanguageSelector';

describe('popup language selector layout', () => {
  it('associates the source language label with its selector', () => {
    const markup = renderToStaticMarkup(createElement(LanguageSelector, {
      label: '源语言',
      value: 'auto',
      languages: [{ code: 'auto', name: 'Auto Detect' }],
      onChange: () => {},
    }));
    const labelId = markup.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(labelId).toBeTruthy();
    expect(markup).toContain(`id="${labelId}"`);
    expect(markup).toContain('源语言</label>');
    expect(markup).toContain('<option value="auto" selected="">Auto Detect</option>');
  });
});
