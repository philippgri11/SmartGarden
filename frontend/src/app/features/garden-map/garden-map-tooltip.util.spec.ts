import { describe, expect, it } from 'vitest';

import { createTextTooltipContent } from './garden-map-tooltip.util';

describe('createTextTooltipContent', () => {
  it('keeps tooltip names as text instead of executable HTML', () => {
    const fakeDocument = {
      createElement: () => ({
        children: [],
        textContent: '',
      }),
    } as unknown as Pick<Document, 'createElement'>;

    const element = createTextTooltipContent('<img src=x onerror=alert(1)>', fakeDocument);

    expect(element.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(element.children.length).toBe(0);
  });
});
