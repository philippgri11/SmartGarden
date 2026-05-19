export function createTextTooltipContent(text: string, ownerDocument: Pick<Document, 'createElement'> = document): HTMLElement {
  const element = ownerDocument.createElement('span');
  element.textContent = text;
  return element;
}
