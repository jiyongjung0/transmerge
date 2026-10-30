import { diffArrays } from 'diff';
import type { DraftSnapshot, ManualMark } from './draft';

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
  manual?: ManualMark;
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

/** Compare the final draft without running automatic translation placement again.
 * All three columns retain their own document order, including moved duplicates.
 */
export function compareFinalResult(source: string, automatic: MergeResult, draft: DraftSnapshot, serialized: string): MergeResult {
  const original = splitText(source).lines;
  const final = splitText(draft.text).lines;
  const autoByOutput = new Map<number, MergeRow>();
  const autoByOriginal = new Map<number, MergeRow>();
  const corrected = new Map<number, string>();
  for (const row of automatic.rows) {
    if (row.resultNumber !== undefined) autoByOutput.set(row.resultNumber - 1, row);
    if (row.originalNumber !== undefined) autoByOriginal.set(row.originalNumber - 1, row);
    if (row.correctedNumber !== undefined) corrected.set(row.correctedNumber - 1, row.corrected!);
  }
  const leftAt = new Map<number, number>();
  const leftBefore = new Map<number, number[]>();
  const addGap = (gaps: Map<number, number[]>, at: number, line: number) => {
    const group = gaps.get(at) ?? [];
    group.push(line);
    gaps.set(at, group);
  };
  const changes: { value: string[]; added?: boolean; removed?: boolean }[] = [];
  let anchorOld = 0;
  let anchorFinal = 0;
  const deadline = Date.now() + 2000;
  const addSegment = (endOld: number, endFinal: number) => {
    const part = diffArrays(original.slice(anchorOld, endOld), final.slice(anchorFinal, endFinal), { timeout: Math.max(1, deadline - Date.now()) });
    if (!part) throw new Error('문서가 커서 비교를 완료하지 못했습니다. 직접 편집과 전체 복사는 계속 사용할 수 있습니다.');
    changes.push(...part);
  };
  // Keep untouched English lines as anchors. A Korean placement correction
  // should be shown as moving Korean, rather than spuriously moving English.
  final.forEach((text, at) => {
    const origin = draft.origins[at];
    const sourceNumber = origin === undefined ? undefined : autoByOutput.get(origin)?.originalNumber;
    if (sourceNumber === undefined || sourceNumber - 1 < anchorOld || draft.marks[at]?.moved
      || isKorean(text) || !/[A-Za-z]/.test(text) || original[sourceNumber - 1] !== text) return;
    addSegment(sourceNumber - 1, at);
    changes.push({ value: [text] });
    anchorOld = sourceNumber;
    anchorFinal = at + 1;
  });
  addSegment(original.length, final.length);
  let oldIndex = 0;
  let finalIndex = 0;
  let c = 0;
  while (c < changes.length) {
    const chunk = changes[c];
    if (!chunk.added && !chunk.removed) {
      chunk.value.forEach(() => leftAt.set(finalIndex++, oldIndex++));
      c++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (c < changes.length && (changes[c].added || changes[c].removed)) {
      const change = changes[c++];
      (change.removed ? removed : added).push(...change.value);
    }
    let gapAt = finalIndex;
    for (const pair of alignChanged(removed, added)) {
      if (pair.next !== undefined) {
        if (pair.old !== undefined) leftAt.set(finalIndex + pair.next, oldIndex + pair.old);
        gapAt = finalIndex + pair.next + 1;
      } else if (pair.old !== undefined) addGap(leftBefore, gapAt, oldIndex + pair.old);
    }
    oldIndex += removed.length;
    finalIndex += added.length;
  }

  const candidates: { at: number; right: number }[] = [];
  const originAt = new Map<number, number>();
  const candidateAt = new Map<number, number>();
  final.forEach((_, at) => {
    const origin = draft.origins[at];
    if (origin === undefined) return;
    originAt.set(origin, at);
    const number = autoByOutput.get(origin)?.correctedNumber;
    if (number !== undefined) { candidates.push({ at, right: number - 1 }); candidateAt.set(number - 1, at); }
  });
  const rightAt = new Map<number, number>();
  const rightBefore = new Map<number, number[]>();
  // Match stable line identities, rather than sentence text, to preserve the
  // corrected document's order when a final line crosses another translation.
  const rightChanges = diffArrays([...corrected.keys()].sort((a, b) => a - b), candidates.map(item => item.right), { timeout: 1000 });
  if (!rightChanges) throw new Error('교정본 비교를 완료하지 못했습니다. 직접 편집한 결과는 보존되어 있습니다.');
  let cursor = 0;
  let pending: number[] = [];
  for (const change of rightChanges) {
    if (change.removed) pending.push(...change.value);
    else if (change.added) cursor += change.value.length;
    else for (const right of change.value) {
      const at = candidates[cursor++].at;
      for (const missing of pending) addGap(rightBefore, at, missing);
      pending = [];
      rightAt.set(at, right);
    }
  }
  for (const missing of pending) addGap(rightBefore, final.length, missing);

  const rows: MergeRow[] = [];
  const counts = { changed: 0, added: 0, deleted: 0, preserved: 0 };
  for (let at = 0; at <= final.length; at++) {
    const leftGaps = leftBefore.get(at) ?? [];
    const rightGaps = rightBefore.get(at) ?? [];
    for (let g = 0; g < Math.max(leftGaps.length, rightGaps.length); g++) {
      const left = leftGaps[g];
      const right = rightGaps[g];
      const autoOrigin = left === undefined ? undefined : autoByOriginal.get(left)?.resultNumber;
      const movedAt = right === undefined ? (autoOrigin === undefined ? undefined : originAt.get(autoOrigin - 1)) : candidateAt.get(right);
      const manual = movedAt !== undefined ? draft.marks[movedAt]
        : (autoOrigin !== undefined || right !== undefined) ? { edited: true } : undefined;
      rows.push({ original: left === undefined ? undefined : original[left], originalNumber: left === undefined ? undefined : left + 1,
        corrected: right === undefined ? undefined : corrected.get(right), correctedNumber: right === undefined ? undefined : right + 1,
        kind: 'deleted', manual });
      if (left !== undefined) counts.deleted++;
    }
    if (at === final.length) break;
    const left = leftAt.get(at);
    const right = rightAt.get(at);
    const kind = left === undefined ? 'added' : original[left] === final[at] ? 'unchanged' : 'changed';
    if (kind === 'unchanged') counts.preserved++; else counts[kind]++;
    rows.push({ original: left === undefined ? undefined : original[left], originalNumber: left === undefined ? undefined : left + 1,
      result: final[at], resultNumber: at + 1,
      corrected: right === undefined ? undefined : corrected.get(right), correctedNumber: right === undefined ? undefined : right + 1,
      kind, manual: draft.marks[at] });
  }
  return { text: serialized, rows, counts };
}
