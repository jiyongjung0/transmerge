import { diffArrays } from 'diff';

export interface ManualMark { edited?: boolean; moved?: boolean }
export interface DraftSnapshot {
  text: string;
  start: number;
  end: number;
  origins: (number | undefined)[];
  marks: (ManualMark | undefined)[];
}

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

export function selectedLines(text: string, start: number, end: number) {
  start = Math.max(0, Math.min(text.length, start));
  end = Math.max(start, Math.min(text.length, end));
  const first = text.slice(0, start).split('\n').length - 1;
  // A selection ending at the next line's beginning does not include that line.
  const last = text.slice(0, end > start && text[end - 1] === '\n' ? end - 1 : end).split('\n').length - 1;
  const count = text ? text.split('\n').length - Number(text.endsWith('\n')) : 0;
  return { first, last: Math.min(last, count - 1), count };
}

/** An authoritative final document. Comparison rows never become editor text. */
export class ResultDraft {
  private readonly original: string;
  private readonly baseline: string;
  private readonly eol: string;
  private history: DraftSnapshot[];
  private position = 0;

  constructor(text: string) {
    this.original = text;
    this.baseline = normalize(text);
    this.eol = text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
    this.history = [this.initial()];
  }

  private initial(): DraftSnapshot {
    return { text: this.baseline, start: 0, end: 0, origins: this.baseline.split('\n').map((_, i) => i), marks: this.baseline.split('\n').map(() => undefined) };
  }

  get current(): DraftSnapshot { return this.history[this.position]; }
  get canUndo() { return this.position > 0; }
  get canRedo() { return this.position < this.history.length - 1; }
  get hasManualChanges() { return this.current.text !== this.baseline; }
  get text() { return this.hasManualChanges ? this.current.text.replace(/\n/g, this.eol) : this.original; }

  select(start: number, end: number) {
    const length = this.current.text.length;
    this.history[this.position] = { ...this.current, start: Math.max(0, Math.min(start, length)), end: Math.max(0, Math.min(end, length)) };
  }

  private push(snapshot: DraftSnapshot) {
    if (snapshot.text === this.baseline) snapshot = { ...this.initial(), start: snapshot.start, end: snapshot.end };
    this.history = this.history.slice(0, this.position + 1);
    this.history.push(snapshot);
    // Bound both entry count and retained document size for long manuscripts.
    let size = this.history.reduce((sum, item) => sum + item.text.length, 0);
    while (this.history.length > 2 && (this.history.length > 100 || size > 8_000_000)) size -= this.history.shift()!.text.length;
    this.position = this.history.length - 1;
  }

  edit(text: string, start: number, end: number) {
    text = normalize(text);
    if (text === this.current.text) { this.select(start, end); return false; }
    const old = this.current;
    const changes = diffArrays(old.text.split('\n'), text.split('\n'), { timeout: 150 });
    const origins: (number | undefined)[] = [];
    const marks: (ManualMark | undefined)[] = [];
    let oldIndex = 0;
    let c = 0;
    if (!changes) {
      text.split('\n').forEach(() => { origins.push(undefined); marks.push({ edited: true }); });
    } else while (c < changes.length) {
      const change = changes[c];
      if (!change.added && !change.removed) {
        change.value.forEach(() => { origins.push(old.origins[oldIndex]); marks.push(old.marks[oldIndex++]); });
        c++;
      } else {
        let removed = 0;
        let added = 0;
        while (c < changes.length && (changes[c].added || changes[c].removed)) {
          const chunk = changes[c++];
          if (chunk.removed) removed += chunk.value.length; else added += chunk.value.length;
        }
        for (let i = 0; i < added; i++) {
          origins.push(i < removed ? old.origins[oldIndex + i] : undefined);
          marks.push({ ...(i < removed ? old.marks[oldIndex + i] : undefined), edited: true });
        }
        oldIndex += removed;
      }
    }
    this.push({ text, start, end, origins, marks });
    return true;
  }

  canMove(direction: -1 | 1) {
    const { text, start, end } = this.current;
    const { first, last, count } = selectedLines(text, start, end);
    return count > 0 && first <= last && (direction < 0 ? first > 0 : last < count - 1);
  }

  move(direction: -1 | 1) {
    if (!this.canMove(direction)) return false;
    const old = this.current;
    const { first, last } = selectedLines(old.text, old.start, old.end);
    const lines = old.text.split('\n');
    const origins = [...old.origins];
    const marks = [...old.marks];
    const count = last - first + 1;
    for (let i = first; i <= last; i++) marks[i] = { ...marks[i], moved: true };
    for (const list of [lines, origins, marks]) {
      const block = list.splice(first, count);
      // All three lists have matching positions and element-specific types.
      (list as unknown[]).splice(first + direction, 0, ...block);
    }
    const text = lines.join('\n');
    const blockStart = lines.slice(0, first + direction).reduce((sum, line) => sum + line.length + 1, 0);
    const oldBlockStart = old.text.split('\n').slice(0, first).reduce((sum, line) => sum + line.length + 1, 0);
    const shift = blockStart - oldBlockStart;
    this.push({ text, start: Math.max(blockStart, old.start + shift), end: Math.min(text.length, old.end + shift), origins, marks });
    return true;
  }

  undo() { if (!this.canUndo) return false; this.position--; return true; }
  redo() { if (!this.canRedo) return false; this.position++; return true; }
}
