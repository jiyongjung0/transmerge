/** Resolve a click through inline diff marks to an offset in the plain text. */
export function caretOffsetAtPoint(content: HTMLElement, x: number, y: number): number {
  const doc = content.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  const range = position ? undefined : doc.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? range?.startContainer;
  const offset = position?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !content.contains(node)) return 0;
  const prefix = doc.createRange();
  prefix.selectNodeContents(content);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

/** Native textarea selection does not reliably scroll after replacing its value.
 * Measure the actual wrapped text with identical typography, then reveal it.
 */
export function revealTextareaCaret(editor: HTMLTextAreaElement, offset: number) {
  if (!editor.clientWidth || !editor.clientHeight) return;
  const doc = editor.ownerDocument;
  const style = getComputedStyle(editor);
  const mirror = doc.createElement('div');
  const properties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
    'wordSpacing', 'textIndent', 'textTransform', 'tabSize', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'textAlign', 'direction', 'wordBreak'] as const;
  for (const property of properties) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
    width: `${editor.clientWidth}px`, boxSizing: 'border-box', whiteSpace: 'pre-wrap',
    overflowWrap: style.overflowWrap, border: '0', margin: '0',
  });
  mirror.textContent = editor.value.slice(0, offset);
  const caret = doc.createElement('span');
  caret.textContent = editor.value.slice(offset) || '\u200b';
  mirror.append(caret);
  doc.body.append(mirror);
  try {
    const top = caret.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.95;
    editor.scrollTop = Math.max(0, top - (editor.clientHeight - lineHeight) / 2);
  } finally { mirror.remove(); }
}
