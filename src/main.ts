import { diffWordsWithSpace } from 'diff';
import { compareFinalResult, extractKorean, mergeKorean, type MergeResult, type MergeRow } from './merge';
import { ResultDraft, selectedLines } from './draft';
import { caretOffsetAtPoint, revealTextareaCaret } from './caret';
import { sample, reviseSample } from './sample';
import './style.css';

const paths: Record<string, string> = {
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/>',
  merge: '<path d="M5 5h4c6 0 0 14 6 14h4M5 19h4c6 0 0-14 6-14h4m-4-4 4 4-4 4m0 6 4 4-4 4"/>',
  extract: '<path d="M4 5h16M4 10h10M4 15h7M4 20h7m4-5 3 3 4-5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m13 6 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};
const icon = (name: string, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.file}</svg>`;
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let mode: 'extract' | 'merge' = 'extract';
let extraction = '';
let result: MergeResult | undefined;
let mergeView = false;
let dirty = false;
let selectedChange = -1;
let toastTimer: ReturnType<typeof setTimeout>;
let automaticResult: MergeResult | undefined;
let resultDraft: ResultDraft | undefined;
let mergedSource = '';
let editingResult = false;
let composingResult = false;
let pendingReplacement: (() => void) | undefined;
let restoringDraftSelection = false;

$('#app').innerHTML = `
  <header class="topbar"><div class="brand"><span class="brand-symbol">${icon('merge')}</span><span>transmerge<span class="brand-dot">.</span></span></div><div class="header-note">${icon('shield')} 내 브라우저에서 안전하게</div><button id="show-help" class="header-link" type="button" aria-haspopup="dialog" aria-controls="help-dialog">사용 방법 ${icon('chevron')}</button></header>
  <main>
    <section class="workspace" aria-label="번역 작업 공간">
      <div class="workspace-toolbar"><div class="tabs" role="tablist" aria-label="작업 선택"><button id="tab-extract" class="tab active" role="tab" aria-selected="true" aria-controls="extract-panel">${icon('extract')}<span>한국어 추출</span><span class="tab-step">01</span></button><button id="tab-merge" class="tab" role="tab" aria-selected="false" aria-controls="merge-panel">${icon('merge')}<span>교정본 병합</span><span class="tab-step">02</span></button></div><button id="load-sample" class="button text-button">${icon('file')} 예제로 시작하기</button></div>
      <div id="extract-panel" role="tabpanel" aria-labelledby="tab-extract">
        <div class="taskbar"><div><h2>필요한 한국어만, 한 번에.</h2><p>영어와 한국어가 줄 단위로 섞인 원문을 붙여넣으세요.</p></div><button id="extract-button" class="button primary">${icon('extract')} 한국어 추출 ${icon('arrow')}</button></div>
        <div class="extract-grid">
          <section class="editor-card"><div class="card-header"><div class="card-title"><span class="panel-dot original-dot"></span><h3>영한 혼합 원문</h3><span class="pill">INPUT</span></div><button id="clear-extract" class="small-button">비우기</button></div><div class="editor-area"><textarea id="extract-input" aria-label="추출할 영한 혼합 원문" placeholder="English line…&#10;한국어 줄…&#10;&#10;영어와 한국어가 섞인 내용을 여기에 붙여넣으세요." spellcheck="false"></textarea></div><div class="card-footer"><span id="extract-source-count">0줄</span><span>줄 단위 언어 감지</span></div></section>
          <section class="editor-card output-card"><div class="card-header"><div class="card-title"><span class="panel-dot korean-dot"></span><h3>추출한 한국어</h3><span class="pill blue-pill">OUTPUT</span></div><button id="copy-extraction" class="small-button" disabled>${icon('copy')} 복사</button></div><div class="editor-area"><textarea id="extract-output" aria-label="한국어 추출 결과" readonly spellcheck="false" hidden></textarea><div id="extract-empty" class="empty-state"><div class="empty-icon">${icon('extract')}</div><strong>한국어만 모아드립니다</strong><p>왼쪽에 원문을 넣고 추출 버튼을 누르세요.<br />문단과 마크다운 구조를 함께 유지합니다.</p><span class="empty-shortcut">⌘ / Ctrl + Enter로 빠르게 실행</span></div></div><div class="card-footer"><span id="extract-result-count">추출 대기 중</span><button id="continue-merge" class="small-button blue-text" disabled>교정 · 병합으로 이어가기 ${icon('arrow')}</button></div></section>
        </div>
        <div class="workspace-note">${icon('info')}<span>한글이 포함된 줄을 추출합니다. 빈 문단, 코드 펜스, 태그 등 문서 구조는 함께 유지합니다.</span></div>
      </div>
      <div id="merge-panel" role="tabpanel" aria-labelledby="tab-merge" hidden>
        <div class="taskbar"><div><h2>다듬은 문장을, 원래 자리로.</h2><p>원문과 교정본을 비교해 한국어 변경을 반영합니다.</p></div><div class="task-actions"><button id="use-base" class="button secondary">추출본 가져오기</button><button id="merge-button" class="button primary">${icon('merge')} 변경사항 병합 ${icon('arrow')}</button></div></div>
        <div class="merge-status"><div class="legend"><span><i class="legend-dot changed"></i>수정</span><span><i class="legend-dot added"></i>추가</span><span><i class="legend-dot deleted"></i>삭제</span></div><div id="change-nav" class="change-nav" hidden><button id="prev-change" class="small-button" aria-label="이전 변경">↑</button><span id="change-position"></span><button id="next-change" class="small-button" aria-label="다음 변경">↓</button></div><span id="merge-summary">영어 원문은 그대로 보존됩니다</span></div>
        <div class="merge-grid">
          <section class="editor-card"><div class="card-header"><div class="card-title"><span class="panel-dot original-dot"></span><h3>영한 혼합 원문</h3></div><button id="edit-original" class="small-button" hidden>${icon('edit')} 편집</button></div><div class="editor-area merge-editor"><textarea id="merge-original" aria-label="병합할 영한 혼합 원문" spellcheck="false" placeholder="영어와 한국어가 섞인 원문을 붙여넣으세요."></textarea><div id="original-diff" class="diff-scroll" role="region" aria-label="원문 변경 비교" tabindex="0" hidden></div></div><div class="card-footer"><span id="merge-source-count">0줄</span><span>ORIGINAL</span></div></section>
          <section class="editor-card result-card"><div class="card-header"><div class="card-title"><span class="panel-dot korean-dot"></span><h3>병합 결과</h3></div><div class="card-actions"><button id="edit-result" class="small-button blue-text" disabled>${icon('edit')} 직접 편집</button><button id="copy-merge" class="small-button" disabled>${icon('copy')} 전체 복사</button></div></div><div class="editor-area merge-editor"><div id="result-tools" class="result-tools" hidden><div class="result-tools-group"><span class="result-tools-label">결과 보정</span><button id="move-result-up" class="tool-button" aria-label="선택한 줄 위로 이동" title="선택한 줄 위로 이동 (Alt + ↑)" disabled>↑ 한 줄</button><button id="move-result-down" class="tool-button" aria-label="선택한 줄 아래로 이동" title="선택한 줄 아래로 이동 (Alt + ↓)" disabled>↓ 한 줄</button><span class="tools-divider"></span><button id="undo-result" class="tool-button" aria-label="결과 편집 실행 취소" title="실행 취소 (⌘ / Ctrl + Z)" disabled>↶ 취소</button><button id="redo-result" class="tool-button" aria-label="결과 편집 다시 실행" title="다시 실행 (⌘ / Ctrl + Shift + Z)" disabled>↷ 다시</button></div><span id="result-selection" class="result-selection">가운데 줄을 클릭하거나 ‘직접 편집’을 누르세요.</span></div><textarea id="result-editor" aria-label="병합 결과 직접 편집" spellcheck="false" hidden></textarea><div id="result-diff" class="diff-scroll" role="region" aria-label="병합 결과 변경 비교" tabindex="0" hidden></div><div id="merge-empty" class="empty-state"><div class="empty-icon">${icon('merge')}</div><strong>두 문서가 만나는 곳</strong><p>왼쪽 원문과 오른쪽 교정본을 입력한 뒤<br />병합 버튼을 눌러 변경사항을 확인하세요.</p></div></div><div class="card-footer"><span id="merge-result-count">병합 대기 중</span><span id="result-manual-status" class="blue-text">영어 + 교정한 한국어</span></div></section>
          <section class="editor-card"><div class="card-header"><div class="card-title"><span class="panel-dot corrected-dot"></span><h3>교정한 한국어</h3></div><button id="edit-corrected" class="small-button" hidden>${icon('edit')} 편집</button></div><div class="editor-area merge-editor"><textarea id="merge-corrected" aria-label="교정한 한국어 입력" spellcheck="false" placeholder="추출한 한국어를 교정한 뒤 붙여넣으세요.&#10;&#10;줄 추가와 삭제도 반영됩니다."></textarea><div id="corrected-diff" class="diff-scroll" role="region" aria-label="교정본 변경 비교" tabindex="0" hidden></div></div><div class="card-footer"><span id="merge-corrected-count">0줄</span><span>REVISED</span></div></section>
        </div>
        <div class="workspace-note">${icon('info')}<span>가운데 결과는 직접 편집할 수 있습니다. 선택한 줄은 Alt + ↑ / ↓로 이동하고, 비교 보기에서 수동 변경을 확인하세요. 삭제 표시 줄은 복사되지 않습니다.</span></div>
      </div>
    </section>
    <section id="how-it-works" class="how-it-works"><div class="how-heading"><span class="eyebrow">A SIMPLE WORKFLOW</span><h2>세 단계면 충분합니다.</h2></div><div class="workflow-step"><span class="step-number">01</span><div><h3>한국어만 추출</h3><p>영한 혼합 원문을 붙여넣고<br />한국어 작업본을 만드세요.</p></div></div><div class="workflow-step"><span class="step-number">02</span><div><h3>자유롭게 교정</h3><p>추출한 한국어를 다듬고<br />교정본 입력란에 넣으세요.</p></div></div><div class="workflow-step"><span class="step-number">03</span><div><h3>변경 확인 & 복사</h3><p>강조된 변경사항을 확인하고<br />병합한 전체 원문을 복사하세요.</p></div></div></section>
    <footer><span>transmerge. <span class="footer-divider">/</span> 문장에 집중할 수 있도록.</span><span>${icon('shield')} 서버 전송 없이, 브라우저 안에서만 처리</span></footer>
  </main>
  <dialog id="help-dialog" class="help-dialog" aria-labelledby="help-title" aria-describedby="help-description">
    <div class="help-heading"><div><h2 id="help-title">사용 방법</h2><p id="help-description">한국어를 추출하고, 교정한 내용을 원문에 다시 반영하세요.</p></div><button id="close-help" class="help-close" type="button" aria-label="사용 방법 닫기" autofocus>×</button></div>
    <ol class="help-steps">
      <li><strong>영한 혼합 원문에서 한국어 추출</strong><p>‘한국어 추출’ 탭의 왼쪽에 원문을 붙여넣고 <b>한국어 추출</b>을 누르세요. 오른쪽에 한국어 작업본이 나타납니다.</p></li>
      <li><strong>추출한 한국어 교정</strong><p><b>교정 · 병합으로 이어가기</b>를 누른 뒤 오른쪽 입력란에서 한국어를 다듬으세요. 다른 편집기에서 교정한 내용을 붙여넣어도 됩니다.</p></li>
      <li><strong>병합 결과 확인과 수동 보정</strong><p><b>변경사항 병합</b>을 누른 뒤 가운데 줄을 클릭하거나 <b>직접 편집</b>을 누르세요. 선택한 한 줄·여러 줄은 <b>↑ 한 줄 / ↓ 한 줄</b> 또는 <b>Alt + ↑ / ↓</b>로 옮길 수 있습니다. <b>취소 / 다시</b>로 편집과 이동을 되돌릴 수 있습니다.</p></li>
      <li><strong>변경 비교와 전체 복사</strong><p><b>비교 보기</b>에서 수동 수정·이동 표시를 확인하고 <b>전체 복사</b>를 누르세요. 직접 편집 중에도 최종 내용이 복사됩니다. 자동 병합을 다시 하면 수동 보정을 덮어쓰기 전에 확인합니다.</p></li>
    </ol>
    <div class="help-tip">교정본은 왼쪽 원문에서 추출한 한국어를 기준으로 작성하세요.</div>
    <div class="help-footer"><span><kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd>로 현재 작업 실행</span><form method="dialog"><button class="button primary">확인했어요</button></form></div>
  </dialog>
  <dialog id="replace-result-dialog" class="help-dialog replace-result-dialog" aria-labelledby="replace-title" aria-describedby="replace-description"><h2 id="replace-title">수동 보정한 내용이 있습니다</h2><p id="replace-description"></p><div class="replace-actions"><form method="dialog"><button class="button secondary" value="cancel" autofocus>기존 결과 유지</button><button class="button primary" value="replace">보정 내용을 버리고 계속</button></form></div></dialog>
  <div id="toast" role="status" aria-live="polite" hidden></div>`;

function notify(message: string, error = false) {
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
const lineCount = (text: string) => text ? text.replace(/\r\n?/g, '\n').split('\n').length - Number(text.endsWith('\n')) : 0;
const value = (id: string) => $<HTMLTextAreaElement>(id).value;
const setValue = (id: string, text: string) => { $<HTMLTextAreaElement>(id).value = text; };
const disable = (id: string, disabled: boolean) => { $<HTMLButtonElement>(id).disabled = disabled; };

function updateCounts() {
  $('#extract-source-count').textContent = `${lineCount(value('#extract-input')).toLocaleString()}줄`;
  $('#merge-source-count').textContent = `${lineCount(value('#merge-original')).toLocaleString()}줄`;
  $('#merge-corrected-count').textContent = `${lineCount(value('#merge-corrected')).toLocaleString()}줄`;
}
function setMode(next: typeof mode) {
  mode = next;
  for (const current of ['extract', 'merge'] as const) {
    $(`#${current}-panel`).hidden = current !== mode;
    $(`#tab-${current}`).classList.toggle('active', current === mode);
    $(`#tab-${current}`).setAttribute('aria-selected', String(current === mode));
    $(`#tab-${current}`).setAttribute('tabindex', current === mode ? '0' : '-1');
  }
  if (mode === 'merge' && !value('#merge-original')) setValue('#merge-original', value('#extract-input'));
  updateCounts();
}
function runExtract() {
  const source = value('#extract-input');
  if (!source.trim()) return notify('추출할 원문을 먼저 입력해 주세요.', true);
  const extracted = extractKorean(source);
  extraction = extracted.text;
  setValue('#extract-output', extraction);
  $('#extract-output').hidden = !extraction;
  $('#extract-empty').hidden = !!extraction;
  disable('#copy-extraction', !extraction);
  disable('#continue-merge', !extraction);
  $('#extract-result-count').textContent = `한국어 ${extracted.koreanCount}줄 추출`;
  notify(extraction ? `한국어 ${extracted.koreanCount}줄을 추출했습니다.` : '한글이 포함된 줄을 찾지 못했습니다.', !extraction);
}
async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) throw new Error('copy failed');
    }
    notify('클립보드에 복사했습니다.');
  } catch { notify('복사 권한을 확인해 주세요. 추출 결과는 직접 선택해 복사할 수 있습니다.', true); }
}

function wordDiff(old: string, next: string, side: 'old' | 'next') {
  if (old.length + next.length > 10_000) return `<mark>${escape(side === 'old' ? old : next)}</mark>`;
  return diffWordsWithSpace(old, next).filter(part => side === 'old' ? !part.added : !part.removed)
    .map(part => part.added || part.removed ? `<mark>${escape(part.value)}</mark>` : escape(part.value)).join('');
}
function lineHTML(row: MergeRow, column: 'original' | 'result' | 'corrected', index: number) {
  const content = row[column];
  const number = row[`${column}Number`];
  let rendered = content === undefined ? '' : escape(content);
  const deletedGhost = column === 'result' && row.kind === 'deleted';
  if (deletedGhost) rendered = `<del>${escape(row.original ?? row.corrected ?? '')}</del>`;
  if (row.kind === 'changed' && content !== undefined) {
    rendered = column === 'corrected' && row.corrected !== row.result
      ? wordDiff(row.corrected ?? '', row.result ?? '', 'old')
      : wordDiff(row.original ?? '', row.result ?? '', column === 'original' ? 'old' : 'next');
  }
  const active = content !== undefined || deletedGhost;
  const label = { changed: '~', added: '+', deleted: '−', unchanged: '' }[row.kind];
  const manual = column === 'result' && (row.manual?.edited || row.manual?.moved);
  const badge = manual ? `<span class="manual-tag">수동 ${row.manual?.edited && row.manual?.moved ? '수정·이동' : row.manual?.moved ? '이동' : '수정'}</span>` : '';
  return `<div class="diff-line ${active ? row.kind : 'spacer'} ${deletedGhost ? 'ghost' : ''} ${manual ? 'manually-adjusted' : ''}" data-row="${index}" ${column === 'result' && row.resultNumber !== undefined ? `data-result-line="${row.resultNumber}" title="클릭하여 이 줄 편집"` : ''}><span class="line-number" aria-hidden="true">${number ?? ''}</span><span class="line-sign" aria-hidden="true">${active ? label : ''}</span><span class="line-content">${rendered || ' '}${badge}</span></div>`;
}
const changedRows = () => result?.rows.map((row, index) => row.kind !== 'unchanged' || row.manual?.edited || row.manual?.moved ? index : -1).filter(index => index >= 0) ?? [];
function renderMerge() {
  if (!result) return;
  for (const column of ['original', 'result', 'corrected'] as const) {
    $(`#${column}-diff`).innerHTML = result.rows.map((row, index) => lineHTML(row, column, index)).join('');
    $(`#${column}-diff`).hidden = false;
  }
  $('#merge-empty').hidden = true;
  const { changed, added, deleted } = result.counts;
  $('#merge-summary').innerHTML = changed + added + deleted
    ? `<strong>${changed}줄 수정</strong><span class="summary-divider">/</span>${added}줄 추가<span class="summary-divider">/</span>${deleted}줄 삭제`
    : `${icon('check')} 변경 없음 · 원문과 동일합니다`;
  $('#change-nav').hidden = !mergeView || editingResult || dirty || changedRows().length === 0;
  selectedChange = -1;
  $('#change-position').textContent = `비교 ${changedRows().length}곳`;
  updateDraftControls();
  requestAnimationFrame(alignRowHeights);
}
function alignRowHeights() {
  if (!mergeView || !result || editingResult || $('#merge-panel').hidden) return;
  const columns = ['original', 'result', 'corrected'].map(column => Array.from($(`#${column}-diff`).children) as HTMLElement[]);
  columns.forEach(rows => rows.forEach(row => { row.style.minHeight = ''; }));
  const heights = result.rows.map((_, index) => Math.max(...columns.map(rows => rows[index].getBoundingClientRect().height)));
  columns.forEach(rows => rows.forEach((row, index) => { row.style.minHeight = `${heights[index]}px`; }));
}
function setView(show: boolean) {
  mergeView = show;
  $('#merge-original').hidden = show;
  $('#merge-corrected').hidden = show;
  $('#original-diff').hidden = !show;
  $('#corrected-diff').hidden = !show;
  $('#edit-original').hidden = !show;
  $('#edit-corrected').hidden = !show;
  if (!show) $('#change-nav').hidden = true;
}
function invalidateMerge() {
  if (result) {
    dirty = true;
    $('#merge-summary').textContent = '입력 변경됨 · 가운데는 이전 입력의 최종본입니다.';
    $('#change-nav').hidden = true;
  }
  updateDraftControls();
  updateCounts();
}
function executeMerge() {
  const source = value('#merge-original');
  if (!source.trim()) return notify('왼쪽에 영한 혼합 원문을 입력해 주세요.', true);
  // Empty revised text is intentional: it deletes all extracted translation lines.
  try {
    const next = mergeKorean(source, value('#merge-corrected'));
    result = automaticResult = next;
    resultDraft = new ResultDraft(next.text);
    mergedSource = source;
    editingResult = false;
    dirty = false;
    setView(true);
    renderMerge();
    notify('병합이 완료되었습니다. 강조된 변경사항을 확인하세요.');
  } catch (error) { notify(error instanceof Error ? error.message : '병합 중 오류가 발생했습니다.', true); }
}
function protectDraft(action: () => void, description: string) {
  if (!resultDraft?.hasManualChanges) return action();
  pendingReplacement = action;
  $('#replace-description').textContent = description;
  replaceDialog.returnValue = '';
  replaceDialog.showModal();
}
function runMerge() {
  protectDraft(executeMerge, '자동 병합을 다시 실행하면 가운데에서 직접 수정하거나 이동한 내용이 새 병합 결과로 바뀝니다. 계속할까요?');
}
function updateDraftControls() {
  $('#result-tools').hidden = !resultDraft;
  disable('#edit-result', !resultDraft || composingResult);
  disable('#copy-merge', !resultDraft || composingResult);
  disable('#undo-result', !resultDraft?.canUndo || composingResult);
  disable('#redo-result', !resultDraft?.canRedo || composingResult);
  disable('#move-result-up', !editingResult || composingResult || !resultDraft?.canMove(-1));
  disable('#move-result-down', !editingResult || composingResult || !resultDraft?.canMove(1));
  $('#result-editor').hidden = !editingResult;
  $('#result-diff').hidden = editingResult || !result;
  $('.merge-grid').classList.toggle('comparing-result', !!result && !editingResult);
  syncResultToolbarHeight();
  $('#edit-result').innerHTML = editingResult ? `${icon('check')} 비교 보기` : `${icon('edit')} 직접 편집`;
  $('#merge-button').innerHTML = `${icon('merge')} ${resultDraft ? '자동 병합 다시 하기' : '변경사항 병합'} ${icon('arrow')}`;
  if (!resultDraft) return;
  const manual = resultDraft.hasManualChanges;
  $('#merge-result-count').textContent = `${lineCount(resultDraft.text).toLocaleString()}줄 · ${dirty ? '입력 변경됨' : editingResult ? '직접 편집 중' : '병합 완료'}`;
  $('#result-manual-status').textContent = manual ? '수동 보정한 최종본' : '영어 + 교정한 한국어';
  $('#result-manual-status').classList.toggle('manual-status', manual);
  if (editingResult) {
    const lines = selectedLines(resultDraft.current.text, resultDraft.current.start, resultDraft.current.end);
    $('#result-selection').textContent = lines.first <= lines.last ? `${lines.first + 1}${lines.last > lines.first ? `–${lines.last + 1}` : ''}줄 선택 · Alt + ↑ / ↓로 이동` : resultDraft.current.text ? '이동할 줄을 선택하세요.' : '내용을 입력하세요.';
    $('#change-nav').hidden = true;
  } else $('#result-selection').textContent = '가운데 줄을 클릭하거나 ‘직접 편집’을 누르세요.';
}
function syncDraftSelection() {
  if (!resultDraft || !editingResult || restoringDraftSelection) return;
  const editor = $<HTMLTextAreaElement>('#result-editor');
  resultDraft.select(editor.selectionStart, editor.selectionEnd);
  updateDraftControls();
}
function displayDraft() {
  if (!resultDraft) return;
  const editor = $<HTMLTextAreaElement>('#result-editor');
  // Capture before assigning .value/focusing: native selection events can fire
  // during those operations and otherwise overwrite the intended caret.
  const { text, start, end } = resultDraft.current;
  restoringDraftSelection = true;
  try {
    if (editor.value !== text) editor.value = text;
    editor.setSelectionRange(start, end);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(start, end);
    revealTextareaCaret(editor, start);
  } finally { restoringDraftSelection = false; }
  updateDraftControls();
  requestAnimationFrame(() => {
    // Do not interrupt typing or a subsequent selection while layout settles.
    if (document.activeElement === editor && editor.value === text && editor.selectionStart === start && editor.selectionEnd === end) revealTextareaCaret(editor, start);
  });
}
function openResultEditor(line?: number, column = 0) {
  if (!resultDraft) return;
  if (line !== undefined) {
    const lines = resultDraft.current.text.split('\n');
    const at = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
    const caret = at + Math.max(0, Math.min(column, lines[line - 1]?.length ?? 0));
    resultDraft.select(caret, caret);
  }
  editingResult = true;
  updateDraftControls();
  for (const column of ['original', 'corrected']) for (const row of $(`#${column}-diff`).children) (row as HTMLElement).style.minHeight = '';
  displayDraft();
}
function showDraftComparison() {
  if (!resultDraft || !automaticResult) return;
  try {
    const next = resultDraft.hasManualChanges ? compareFinalResult(mergedSource, automaticResult, resultDraft.current, resultDraft.text) : automaticResult;
    result = next;
    editingResult = false;
    renderMerge();
    if (dirty) $('#merge-summary').textContent = '입력 변경됨 · 이전 자동 병합 기준과 최종본을 비교합니다.';
  } catch (error) { notify(error instanceof Error ? error.message : '비교를 완료하지 못했습니다.', true); }
}
function moveDraft(direction: -1 | 1) {
  if (!resultDraft || !editingResult || composingResult) return;
  syncDraftSelection();
  if (resultDraft.move(direction)) displayDraft();
}
function historyDraft(redo: boolean) {
  if (!resultDraft || composingResult) return;
  if (!(redo ? resultDraft.redo() : resultDraft.undo())) return;
  if (editingResult) displayDraft(); else showDraftComparison();
}
function clearMergeResult() {
  result = automaticResult = undefined;
  resultDraft = undefined;
  editingResult = dirty = false;
  for (const column of ['original', 'result', 'corrected']) $(`#${column}-diff`).innerHTML = '';
  $('#merge-empty').hidden = false;
  $('#change-nav').hidden = true;
  $('#merge-result-count').textContent = '병합 대기 중';
  $('#merge-summary').textContent = '영어 원문은 그대로 보존됩니다';
  $('#result-manual-status').textContent = '영어 + 교정한 한국어';
  $('#result-manual-status').classList.remove('manual-status');
  updateDraftControls();
}
function navigateChange(direction: number) {
  if (!result || dirty) return;
  const changed = changedRows();
  if (!changed.length) return;
  selectedChange = (selectedChange + direction + changed.length) % changed.length;
  document.querySelectorAll('.selected-change').forEach(el => el.classList.remove('selected-change'));
  for (const column of ['original', 'result', 'corrected']) {
    const container = $(`#${column}-diff`);
    const row = container.children[changed[selectedChange]] as HTMLElement;
    row.classList.add('selected-change');
    container.scrollTop = row.offsetTop - container.offsetTop - 40;
  }
  $('#change-position').textContent = `${selectedChange + 1} / ${changed.length}`;
}

const helpDialog = $<HTMLDialogElement>('#help-dialog');
const replaceDialog = $<HTMLDialogElement>('#replace-result-dialog');
replaceDialog.onclose = () => {
  const action = pendingReplacement;
  pendingReplacement = undefined;
  if (replaceDialog.returnValue === 'replace') action?.();
};
$('#show-help').onclick = () => helpDialog.showModal();
$('#close-help').onclick = () => helpDialog.close();
helpDialog.onclick = event => {
  if (event.target !== helpDialog) return;
  const bounds = helpDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) helpDialog.close();
};

$('#tab-extract').onclick = () => setMode('extract');
$('#tab-merge').onclick = () => { setMode('merge'); requestAnimationFrame(alignRowHeights); };
for (const tab of ['extract', 'merge']) {
  $(`#tab-${tab}`).onkeydown = event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setMode(mode === 'extract' ? 'merge' : 'extract');
      $(`#tab-${mode}`).focus();
      requestAnimationFrame(alignRowHeights);
    }
  };
}
$('#extract-button').onclick = runExtract;
$('#merge-button').onclick = runMerge;
$('#copy-extraction').onclick = () => { void copyText(extraction); };
$('#copy-merge').onclick = () => { if (resultDraft) void copyText(resultDraft.text); };
$('#edit-result').onclick = () => {
  if (editingResult) { syncDraftSelection(); showDraftComparison(); } else openResultEditor();
};
$('#move-result-up').onclick = () => moveDraft(-1);
$('#move-result-down').onclick = () => moveDraft(1);
$('#undo-result').onclick = () => historyDraft(false);
$('#redo-result').onclick = () => historyDraft(true);
for (const id of ['move-result-up', 'move-result-down', 'undo-result', 'redo-result']) {
  $(`#${id}`).onmousedown = event => event.preventDefault();
}
$('#result-diff').onclick = event => {
  const row = (event.target as Element).closest<HTMLElement>('[data-result-line]');
  if (row) {
    const content = row.querySelector<HTMLElement>('.line-content')!;
    const column = caretOffsetAtPoint(content, event.clientX, event.clientY);
    openResultEditor(Number(row.dataset.resultLine), column);
  }
};
const resultEditor = $<HTMLTextAreaElement>('#result-editor');
const commitResultInput = () => {
  if (!resultDraft || composingResult) return;
  resultDraft.edit(resultEditor.value, resultEditor.selectionStart, resultEditor.selectionEnd);
  updateDraftControls();
};
resultEditor.onbeforeinput = event => {
  if (composingResult || event.isComposing) return;
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault();
    historyDraft(event.inputType === 'historyRedo');
  } else syncDraftSelection();
};
resultEditor.oninput = commitResultInput;
resultEditor.addEventListener('compositionstart', () => { composingResult = true; updateDraftControls(); });
resultEditor.addEventListener('compositionend', () => { composingResult = false; commitResultInput(); });
resultEditor.onselect = syncDraftSelection;
resultEditor.onclick = syncDraftSelection;
resultEditor.onkeyup = syncDraftSelection;
resultEditor.onkeydown = event => {
  if (composingResult || event.isComposing) return;
  if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    moveDraft(event.key === 'ArrowUp' ? -1 : 1);
  } else if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
    event.preventDefault();
    historyDraft(event.shiftKey || event.key.toLowerCase() === 'y');
  }
};
$('#clear-extract').onclick = () => {
  setValue('#extract-input', '');
  extraction = '';
  setValue('#extract-output', '');
  $('#extract-output').hidden = true;
  $('#extract-empty').hidden = false;
  disable('#copy-extraction', true);
  disable('#continue-merge', true);
  $('#extract-result-count').textContent = '추출 대기 중';
  updateCounts();
  $('#extract-input').focus();
};
$('#continue-merge').onclick = () => {
  protectDraft(() => {
    setValue('#merge-original', value('#extract-input'));
    setValue('#merge-corrected', extraction);
    clearMergeResult();
    setView(false);
    setMode('merge');
    $('#merge-corrected').focus();
    notify('오른쪽 한국어를 교정한 뒤 병합해 주세요.');
  }, '추출본을 새로 가져오면 기존 병합 결과와 수동 보정 내용이 초기화됩니다. 계속할까요?');
};
$('#use-base').onclick = () => {
  const base = extractKorean(value('#merge-original'));
  if (!base.koreanCount) return notify('왼쪽 원문에서 한국어 줄을 찾지 못했습니다.', true);
  setValue('#merge-corrected', base.text);
  setView(false);
  invalidateMerge();
  $('#merge-corrected').focus();
  notify('원문에서 추출한 한국어를 가져왔습니다. 오른쪽에서 교정하세요.');
};
$('#load-sample').onclick = () => {
  if (mode === 'extract') { setValue('#extract-input', sample); runExtract(); }
  else {
    protectDraft(() => {
      setValue('#merge-original', sample);
      setValue('#merge-corrected', reviseSample(extractKorean(sample).text));
      executeMerge();
      updateCounts();
    }, '예제로 시작하면 입력과 수동 보정한 최종본이 예제 문서로 바뀝니다. 계속할까요?');
  }
  updateCounts();
};
for (const side of ['original', 'corrected']) {
  $(`#edit-${side}`).onclick = () => { setView(false); $(`#merge-${side}`).focus(); };
  $(`#merge-${side}`).oninput = invalidateMerge;
}
$('#extract-input').oninput = () => {
  updateCounts();
  if (extraction) {
    disable('#continue-merge', true);
    $('#extract-result-count').textContent = '원문 변경됨 · 다시 추출해 주세요';
  }
};
$('#prev-change').onclick = () => navigateChange(-1);
$('#next-change').onclick = () => navigateChange(1);
let syncing = false;
for (const side of ['original', 'result', 'corrected']) {
  $(`#${side}-diff`).onscroll = () => {
    if (syncing || !mergeView || editingResult) return;
    syncing = true;
    const top = $(`#${side}-diff`).scrollTop;
    for (const other of ['original', 'result', 'corrected']) if (other !== side) $(`#${other}-diff`).scrollTop = top;
    requestAnimationFrame(() => { syncing = false; });
  };
}
document.addEventListener('keydown', event => {
  if (helpDialog.open || replaceDialog.open || event.isComposing || composingResult) return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    if (mode === 'extract') runExtract(); else runMerge();
  }
});
function refreshEditorLayout() {
  syncResultToolbarHeight();
  alignRowHeights();
  if (editingResult && document.activeElement === resultEditor) revealTextareaCaret(resultEditor, resultEditor.selectionStart);
}
window.addEventListener('resize', () => requestAnimationFrame(refreshEditorLayout));
function syncResultToolbarHeight() {
  const height = $('#result-tools').getBoundingClientRect().height;
  const grid = $('.merge-grid');
  const value = `${height}px`;
  if (grid.style.getPropertyValue('--result-tools-height') !== value) {
    grid.style.setProperty('--result-tools-height', value);
    requestAnimationFrame(alignRowHeights);
  }
}
new ResizeObserver(syncResultToolbarHeight).observe($('#result-tools'));
// Web fonts and panel resizing can reflow a line after the initial render.
void document.fonts.ready.then(() => requestAnimationFrame(refreshEditorLayout));
const panelWidths = new WeakMap<Element, number>();
const panelObserver = new ResizeObserver(entries => {
  let resized = false;
  for (const entry of entries) {
    if (panelWidths.get(entry.target) !== entry.contentRect.width) {
      panelWidths.set(entry.target, entry.contentRect.width);
      resized = true;
    }
  }
  if (resized) requestAnimationFrame(alignRowHeights);
});
document.querySelectorAll('.merge-editor').forEach(panel => panelObserver.observe(panel));
setMode('extract');
