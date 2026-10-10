import { describe, expect, it } from 'vitest';
import { extractKorean, isKorean, mergeKorean } from './merge';
import { sample, reviseSample } from './sample';

describe('Korean extraction', () => {
  it('keeps Hangul lines, mixed Korean labels, document structure, and one paragraph separator', () => {
    const source = 'English heading\n### 한국어 API 제목\n\n\n<box>\nEnglish text\n한국어 내용\n</box>\n';
    expect(extractKorean(source).text).toBe('### 한국어 API 제목\n\n<box>\n한국어 내용\n</box>\n');
    expect(extractKorean(source).koreanCount).toBe(2);
  });
  it('returns empty for English-only or empty input', () => {
    expect(extractKorean('```sql\nSELECT * FROM users;\n```').text).toBe('');
    expect(extractKorean('').text).toBe('');
  });
  it('recognizes decomposed Hangul and consonants', () => {
    expect(isKorean('한')).toBe(true);
    expect(isKorean('ㅋㅋ')).toBe(true);
    expect(isKorean('API contract')).toBe(false);
  });
});

describe('three-way translation merge', () => {
  it('replaces Korean in place without changing English or surrounding blank lines', () => {
    const original = 'English A\n한국어 하나\n\n\nEnglish B\n한국어 둘\n';
    const corrected = '한국어 첫째\n\n한국어 둘\n';
    const merged = mergeKorean(original, corrected);
    expect(merged.text).toBe('English A\n한국어 첫째\n\n\nEnglish B\n한국어 둘\n');
    expect(merged.counts.changed).toBe(1);
  });
  it('preserves no-op text byte for byte, including CRLF and trailing blank lines', () => {
    const original = '\uFEFFEnglish\r\n한국어\r\n\r\n\r\n';
    expect(mergeKorean(original, extractKorean(original).text).text).toBe(original);
  });
  it('preserves a no-op without a final newline', () => {
    const original = 'English\n한국어';
    expect(mergeKorean(original, extractKorean(original).text).text).toBe(original);
  });
  it('inserts and deletes Korean while retaining all English lines in order', () => {
    const original = 'English A\n한국어 하나\nEnglish B\n한국어 둘\nEnglish C\n한국어 셋';
    const merged = mergeKorean(original, '한국어 하나\n새로 추가한 줄\n한국어 셋');
    expect(merged.text).toBe('English A\n한국어 하나\nEnglish B\n새로 추가한 줄\nEnglish C\n한국어 셋');
    expect(merged.rows.filter(row => row.original?.startsWith('English')).every(row => row.original === row.result)).toBe(true);
  });
  it('handles insertions at the beginning and end', () => {
    const original = 'English\n한국어\nEnglish footer';
    const merged = mergeKorean(original, '앞에 추가\n한국어\n뒤에 추가');
    expect(merged.text).toBe('English\n앞에 추가\n한국어\n뒤에 추가\nEnglish footer');
    expect(merged.counts.added).toBe(2);
  });
  it('handles an intentionally empty revision by deleting selected lines', () => {
    const merged = mergeKorean('English A\n한국어 하나\nEnglish B\n한국어 둘', '');
    expect(merged.text).toBe('English A\nEnglish B');
    expect(merged.counts.deleted).toBe(2);
    expect(merged.rows.filter(row => row.kind === 'deleted').every(row => row.result === undefined)).toBe(true);
  });
  it('aligns an added line with two rewritten sentences using similarity', () => {
    const original = 'English A\n첫 번째 문장에 오타가 있어요.\nEnglish B\n두 번째 문장도 교정해요.';
    const next = '새로 추가하는 안내 문장입니다.\n첫 번째 문장에 오타가 있네요.\n두 번째 문장도 교정합니다.';
    const merged = mergeKorean(original, next);
    expect(merged.text).toBe('English A\n새로 추가하는 안내 문장입니다.\n첫 번째 문장에 오타가 있네요.\nEnglish B\n두 번째 문장도 교정합니다.');
  });
  it('does not confuse duplicate Korean lines', () => {
    const original = 'English A\n같은 문장\nEnglish B\n같은 문장\nEnglish C\n마지막 문장';
    expect(mergeKorean(original, '같은 문장\n수정한 문장\n마지막 문장').text).toBe('English A\n같은 문장\nEnglish B\n수정한 문장\nEnglish C\n마지막 문장');
  });
  it('keeps CRLF when edits are applied', () => {
    expect(mergeKorean('English\r\n한국어\r\n', '교정한 한국어\n').text).toBe('English\r\n교정한 한국어\r\n');
  });
  it('merges the full example and preserves every English source line', () => {
    const base = extractKorean(sample).text;
    const revised = reviseSample(base);
    const merged = mergeKorean(sample, revised);
    expect(merged.text.split('\n').filter(isKorean)).toEqual(revised.split('\n').filter(isKorean));
    const english = (text: string) => text.split('\n').filter(line => /[a-zA-Z]/.test(line) && !isKorean(line));
    expect(english(merged.text)).toEqual(english(sample));
    expect(merged.counts.changed).toBe(4);
    expect(merged.counts.added).toBe(1);
  });
  it('rejects sources without Korean instead of replacing English', () => {
    expect(() => mergeKorean('English only', '한국어 교정본')).toThrow('원문에 한국어 줄이 없습니다');
  });
  it('maintains protected source lines and revised Korean ordering over deterministic random edits', () => {
    let seed = 41;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let trial = 0; trial < 150; trial++) {
      const original = Array.from({ length: 15 }, (_, i) => `English ${i}\n한국어 문장 ${i}`).join('\n');
      const revised: string[] = [];
      for (let i = 0; i < 15; i++) {
        if (random() < .2) revised.push(`추가한 줄 ${trial}-${i}`);
        if (random() > .2) revised.push(`한국어 문장 ${i}${random() < .3 ? ' 교정' : ''}`);
      }
      const merged = mergeKorean(original, revised.join('\n'));
      expect(merged.text.split('\n').filter(isKorean)).toEqual(revised);
      expect(merged.text.split('\n').filter(line => line.startsWith('English'))).toEqual(Array.from({ length: 15 }, (_, i) => `English ${i}`));
    }
  });
});
