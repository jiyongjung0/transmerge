import { describe, expect, it } from 'vitest';
import { ResultDraft, selectedLines } from './draft';
import { compareFinalResult, extractKorean, mergeKorean } from './merge';

describe('final result editor', () => {
  it('moves one translation above English without changing any line contents', () => {
    const draft = new ResultDraft('English A\nEnglish B\n한국어 A\n한국어 B');
    const at = draft.current.text.indexOf('한국어 A');
    draft.select(at, at);
    expect(draft.move(-1)).toBe(true);
    expect(draft.text).toBe('English A\n한국어 A\nEnglish B\n한국어 B');
    expect(draft.current.origins).toEqual([0, 2, 1, 3]);
    expect(draft.current.marks[1]).toEqual({ moved: true });
    expect(draft.current.start).toBe('English A\n'.length);
  });

  it('moves a multiline selection as a block and excludes the unselected next line', () => {
    const draft = new ResultDraft('앞줄\n선택 하나\n선택 둘\n뒷줄\n');
    const start = draft.current.text.indexOf('선택 하나');
    const end = draft.current.text.indexOf('뒷줄');
    draft.select(start, end);
    expect(selectedLines(draft.current.text, start, end)).toMatchObject({ first: 1, last: 2 });
    draft.move(1);
    expect(draft.text).toBe('앞줄\n뒷줄\n선택 하나\n선택 둘\n');
    expect(draft.current.text.slice(draft.current.start, draft.current.end)).toBe('선택 하나\n선택 둘\n');
  });

  it('does not move past the start, final line, or a terminal newline', () => {
    const draft = new ResultDraft('하나\n둘\n');
    expect(draft.move(-1)).toBe(false);
    draft.select(3, 3);
    expect(draft.move(1)).toBe(false);
    draft.select(5, 5);
    expect(draft.move(1)).toBe(false);
    expect(new ResultDraft('').move(-1)).toBe(false);
  });

  it('undoes edits and moves, restores selections, and discards an abandoned redo branch', () => {
    const draft = new ResultDraft('가나다\nEnglish');
    draft.select(1, 2);
    draft.edit('가나다 수정\nEnglish', 6, 6);
    draft.select(0, 0);
    draft.move(1);
    expect(draft.text).toBe('English\n가나다 수정');
    draft.undo();
    expect(draft.text).toBe('가나다 수정\nEnglish');
    draft.undo();
    expect(draft.current).toMatchObject({ text: '가나다\nEnglish', start: 1, end: 2 });
    draft.redo();
    draft.edit('다른 수정\nEnglish', 5, 5);
    expect(draft.canRedo).toBe(false);
  });

  it('preserves CRLF, BOM and trailing newlines, and returns exact initial bytes after undo', () => {
    const original = '\uFEFFEnglish\r\n한국어\r\n\r\n';
    const draft = new ResultDraft(original);
    expect(draft.text).toBe(original);
    draft.edit(draft.current.text.replace('한국어', '교정한 한국어'), 0, 0);
    expect(draft.text).toBe('\uFEFFEnglish\r\n교정한 한국어\r\n\r\n');
    draft.undo();
    expect(draft.text).toBe(original);
    expect(draft.hasManualChanges).toBe(false);
  });

  it('retains both modification and movement marks and clears them when restored', () => {
    const draft = new ResultDraft('한국어\nEnglish');
    draft.edit('교정한 한국어\nEnglish', 0, 0);
    draft.move(1);
    expect(draft.current.marks[1]).toEqual({ edited: true, moved: true });
    draft.undo();
    draft.undo();
    expect(draft.hasManualChanges).toBe(false);
    expect(draft.current.marks.every(mark => !mark)).toBe(true);
  });

  it('handles duplicated lines by identity while moving them', () => {
    const draft = new ResultDraft('같은 줄\nEnglish\n같은 줄\n끝');
    const at = draft.current.text.lastIndexOf('같은 줄');
    draft.select(at, at);
    draft.move(-1);
    expect(draft.current.origins).toEqual([0, 2, 1, 3]);
    expect(draft.current.marks[0]).toBeUndefined();
    expect(draft.current.marks[1]?.moved).toBe(true);
  });
});

describe('comparison after manual corrections', () => {
  const source = 'English A\n한국어 A\nEnglish B\n한국어 B\nEnglish C\n한국어 C\n';
  const corrected = '한국어 A 수정\n한국어 B\n한국어 C\n';
  const automatic = mergeKorean(source, corrected);

  function assertColumns(draft: ResultDraft, original = source, auto = automatic) {
    const comparison = compareFinalResult(original, auto, draft.current, draft.text);
    const project = (column: 'original' | 'result' | 'corrected') => comparison.rows.map(row => row[column]).filter(line => line !== undefined);
    const split = (text: string) => { const lines = text.replace(/\r\n?/g, '\n').split('\n'); if (text.endsWith('\n')) lines.pop(); return text ? lines : []; };
    expect(project('original')).toEqual(split(original));
    expect(project('result')).toEqual(split(draft.current.text));
    expect(project('corrected')).toEqual(auto.rows.filter(row => row.corrected !== undefined).map(row => row.corrected));
    expect(comparison.text).toBe(draft.text);
    return comparison;
  }

  it('keeps all column orders when translations cross English and other translations', () => {
    const draft = new ResultDraft(automatic.text);
    const at = draft.current.text.indexOf('한국어 C');
    draft.select(at, at);
    draft.move(-1);
    draft.move(-1);
    draft.move(-1);
    draft.move(-1);
    const comparison = assertColumns(draft);
    expect(comparison.rows.some(row => row.result === '한국어 C' && row.manual?.moved)).toBe(true);
    expect(comparison.rows.filter(row => row.original?.startsWith('English') || row.result?.startsWith('English')).every(row => row.kind === 'unchanged')).toBe(true);
  });

  it('supports multiline replacements, removed lines and blank final documents without ghosts entering output', () => {
    const draft = new ResultDraft(automatic.text);
    draft.edit('English A\n한국어 A 새 문장\n추가한 문장\nEnglish C\n', 0, 0);
    assertColumns(draft);
    draft.edit('', 0, 0);
    const comparison = assertColumns(draft);
    expect(comparison.rows.every(row => row.result === undefined)).toBe(true);
    expect(comparison.text).toBe('');
  });

  it('preserves duplicate revised lines and tags manual edits after movement', () => {
    const original = 'English A\n같은 한국어\nEnglish B\n같은 한국어\nEnglish C\n마지막 한국어';
    const auto = mergeKorean(original, extractKorean(original).text);
    const draft = new ResultDraft(auto.text);
    const at = draft.current.text.lastIndexOf('같은 한국어');
    draft.select(at, at);
    draft.move(-1);
    draft.edit(draft.current.text.replace('마지막 한국어', '마지막 한국어 교정'), 0, 0);
    assertColumns(draft, original, auto);
  });

  it('maintains three document projections through deterministic edit and reorder sequences', () => {
    const draft = new ResultDraft(automatic.text);
    let seed = 57;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let step = 0; step < 100; step++) {
      const lines = draft.current.text.split('\n');
      const line = Math.floor(random() * Math.max(1, lines.length - 1));
      const at = lines.slice(0, line).reduce((sum, item) => sum + item.length + 1, 0);
      draft.select(at, at);
      if (step % 4 === 0) {
        lines[line] += ` 수정${step}`;
        draft.edit(lines.join('\n'), at, at);
      } else draft.move(random() < .5 ? -1 : 1);
      assertColumns(draft);
      if (step % 7 === 0) { draft.undo(); assertColumns(draft); draft.redo(); assertColumns(draft); }
    }
  });
});
