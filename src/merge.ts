import { diffArrays } from 'diff';

export type LineKind = 'unchanged' | 'changed' | 'added' | 'deleted';
export interface ExtractedLine { text: string; sourceIndex: number }
export interface Extraction { text: string; lines: ExtractedLine[]; koreanCount: number }
export interface MergeRow {
  original?: string;
  result?: string;
  corrected?: string;
  originalNumber?: number;
  resultNumber?: number;
  correctedNumber?: number;
  kind: LineKind;
}
export interface MergeResult {
  text: string;
  rows: MergeRow[];
  counts: { changed: number; added: number; deleted: number; preserved: number };
}

const hangul = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/;
export const isKorean = (line: string): boolean => hangul.test(line);

function splitText(text: string): { lines: string[]; trailing: boolean } {
  if (!text) return { lines: [], trailing: false };
  const normalized = text.replace(/\r\n?/g, '\n');
  const trailing = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (trailing) lines.pop();
  return { lines, trailing };
}

function isStructure(line: string): boolean {
  return /^\s*<\/?[\p{L}\p{N}_:-]+(?:\s[^>]*)?\s*\/?>\s*$/u.test(line)
    || /^\s*(?:`{3,}|~{3,})[^`~]*$/.test(line)
    || /^\s*[-*_=:|~]{3,}\s*$/.test(line);
}

/** Blank lines are compacted for editing; their original positions stay protected. */
export function extractKorean(source: string): Extraction {
  const { lines: sourceLines, trailing } = splitText(source);
  const koreanCount = sourceLines.filter(isKorean).length;
  if (!koreanCount) return { text: '', lines: [], koreanCount: 0 };
  const lines: ExtractedLine[] = [];
  let pendingBlank: number | undefined;
  sourceLines.forEach((text, sourceIndex) => {
    if (!text.trim() && lines.length && pendingBlank === undefined) pendingBlank = sourceIndex;
    if (!isKorean(text) && !isStructure(text)) return;
    if (pendingBlank !== undefined) lines.push({ text: sourceLines[pendingBlank], sourceIndex: pendingBlank });
    lines.push({ text, sourceIndex });
    pendingBlank = undefined;
  });
  return { text: lines.map(line => line.text).join('\n') + (trailing ? '\n' : ''), lines, koreanCount };
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const grams = (s: string) => {
    const result = new Map<string, number>();
    for (let i = 0; i < Math.max(1, s.length - 1); i++) {
      const gram = s.slice(i, i + 2);
      result.set(gram, (result.get(gram) ?? 0) + 1);
    }
    return result;
  };
  const aa = grams(a);
  const bb = grams(b);
  let matches = 0;
  aa.forEach((count, key) => { matches += Math.min(count, bb.get(key) ?? 0); });
  return 2 * matches / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}

type Pair = { old?: number; next?: number };

/** Align rewrites within a hunk so an inserted line doesn't shift every translation. */
function alignChanged(old: string[], next: string[]): Pair[] {
  if (old.length * next.length > 40_000) {
    return Array.from({ length: Math.max(old.length, next.length) }, (_, i) => ({
      old: i < old.length ? i : undefined, next: i < next.length ? i : undefined,
    }));
  }
  const width = next.length + 1;
  const scores = new Float64Array((old.length + 1) * width);
  const moves = new Uint8Array(scores.length);
  for (let i = 1; i <= old.length; i++) { scores[i * width] = i * 0.8; moves[i * width] = 1; }
  for (let j = 1; j <= next.length; j++) { scores[j] = j * 0.8; moves[j] = 2; }
  for (let i = 1; i <= old.length; i++) {
    for (let j = 1; j <= next.length; j++) {
      const index = i * width + j;
      const match = scores[(i - 1) * width + j - 1] + 1.1 - similarity(old[i - 1], next[j - 1]);
      const remove = scores[(i - 1) * width + j] + 0.8;
      const add = scores[i * width + j - 1] + 0.8;
      scores[index] = Math.min(match, remove, add);
      moves[index] = match <= remove && match <= add ? 0 : remove <= add ? 1 : 2;
    }
  }
  const pairs: Pair[] = [];
  let i = old.length;
  let j = next.length;
  while (i || j) {
    const move = moves[i * width + j];
    if (move === 0) pairs.push({ old: --i, next: --j });
    else if (move === 1) pairs.push({ old: --i });
    else pairs.push({ next: --j });
  }
  return pairs.reverse();
}

/** Three-way merge: bilingual original + extracted base + corrected translation. */
export function mergeKorean(source: string, corrected: string): MergeResult {
  const { lines: sourceLines } = splitText(source);
  const base = extractKorean(source);
  if (!base.koreanCount) throw new Error('원문에 한국어 줄이 없습니다. 영한 혼합 원문을 입력해 주세요.');
  const next = splitText(corrected);
  const changes = diffArrays(base.lines.map(line => line.text), next.lines, { timeout: 2000 });
  if (!changes) throw new Error('변경량이 너무 큽니다. 문서를 작은 단위로 나누어 병합해 주세요.');
  const replacements = new Map<number, { text?: string; nextIndex?: number; kind: LineKind }>();
  const insertions = new Map<number, { text: string; nextIndex: number }[]>();
  let oldIndex = 0;
  let nextIndex = 0;
  let c = 0;
  while (c < changes.length) {
    const change = changes[c];
    if (!change.added && !change.removed) {
      for (let k = 0; k < change.value.length; k++) {
        replacements.set(base.lines[oldIndex++].sourceIndex, { text: next.lines[nextIndex], nextIndex: nextIndex++, kind: 'unchanged' });
      }
      c++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (c < changes.length && (changes[c].added || changes[c].removed)) {
      const chunk = changes[c++];
      (chunk.removed ? removed : added).push(...chunk.value);
    }
    const pairs = alignChanged(removed, added);
    let insertionPoint = base.lines[oldIndex]?.sourceIndex ?? ((base.lines.at(-1)?.sourceIndex ?? -1) + 1);
    for (const pair of pairs) {
      if (pair.old !== undefined) {
        const sourceIndex = base.lines[oldIndex + pair.old].sourceIndex;
        replacements.set(sourceIndex, {
          text: pair.next === undefined ? undefined : added[pair.next],
          nextIndex: pair.next === undefined ? undefined : nextIndex + pair.next,
          kind: pair.next === undefined ? 'deleted' : 'changed',
        });
        insertionPoint = sourceIndex + 1;
      } else if (pair.next !== undefined) {
        const list = insertions.get(insertionPoint) ?? [];
        list.push({ text: added[pair.next], nextIndex: nextIndex + pair.next });
        insertions.set(insertionPoint, list);
      }
    }
    oldIndex += removed.length;
    nextIndex += added.length;
  }
  const rows: MergeRow[] = [];
  const output: string[] = [];
  const counts = { changed: 0, added: 0, deleted: 0, preserved: 0 };
  for (let i = 0; i <= sourceLines.length; i++) {
    for (const addition of insertions.get(i) ?? []) {
      output.push(addition.text);
      rows.push({ result: addition.text, corrected: addition.text, resultNumber: output.length, correctedNumber: addition.nextIndex + 1, kind: 'added' });
      counts.added++;
    }
    if (i === sourceLines.length) break;
    const replacement = replacements.get(i);
    const result = replacement ? replacement.text : sourceLines[i];
    if (result !== undefined) output.push(result);
    const kind = replacement?.kind ?? 'unchanged';
    if (kind === 'unchanged') counts.preserved++;
    else counts[kind]++;
    rows.push({
      original: sourceLines[i], originalNumber: i + 1,
      result, resultNumber: result === undefined ? undefined : output.length,
      corrected: replacement?.text,
      correctedNumber: replacement?.nextIndex === undefined ? undefined : replacement.nextIndex + 1,
      kind,
    });
  }
  // A no-op is byte-for-byte identical, including BOM, CRLF, and trailing blanks.
  const noChanges = counts.changed + counts.added + counts.deleted === 0;
  const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  return { rows, counts, text: noChanges ? source : output.join(eol) + (output.length && next.trailing ? eol : '') };
}
