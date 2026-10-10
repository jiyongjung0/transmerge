import { diffWordsWithSpace } from 'diff';
import { extractKorean, mergeKorean, type MergeResult, type MergeRow } from './merge';
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
          <section class="editor-card result-card"><div class="card-header"><div class="card-title"><span class="panel-dot korean-dot"></span><h3>병합 결과</h3><span class="pill blue-pill">MERGED</span></div><button id="copy-merge" class="small-button" disabled>${icon('copy')} 전체 복사</button></div><div class="editor-area merge-editor"><div id="result-diff" class="diff-scroll" role="region" aria-label="병합 결과 변경 비교" tabindex="0" hidden></div><div id="merge-empty" class="empty-state"><div class="empty-icon">${icon('merge')}</div><strong>두 문서가 만나는 곳</strong><p>왼쪽 원문과 오른쪽 교정본을 입력한 뒤<br />병합 버튼을 눌러 변경사항을 확인하세요.</p></div></div><div class="card-footer"><span id="merge-result-count">병합 대기 중</span><span class="blue-text">영어 + 교정한 한국어</span></div></section>
          <section class="editor-card"><div class="card-header"><div class="card-title"><span class="panel-dot corrected-dot"></span><h3>교정한 한국어</h3></div><button id="edit-corrected" class="small-button" hidden>${icon('edit')} 편집</button></div><div class="editor-area merge-editor"><textarea id="merge-corrected" aria-label="교정한 한국어 입력" spellcheck="false" placeholder="추출한 한국어를 교정한 뒤 붙여넣으세요.&#10;&#10;줄 추가와 삭제도 반영됩니다."></textarea><div id="corrected-diff" class="diff-scroll" role="region" aria-label="교정본 변경 비교" tabindex="0" hidden></div></div><div class="card-footer"><span id="merge-corrected-count">0줄</span><span>REVISED</span></div></section>
        </div>
        <div class="workspace-note">${icon('info')}<span>왼쪽에서 추출한 한국어가 비교 기준입니다. 같은 문서에서 나온 교정본을 사용하세요. 삭제 표시 줄은 복사 결과에서 제외됩니다.</span></div>
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
      <li><strong>변경사항 병합과 확인</strong><p><b>변경사항 병합</b>을 누르면 가운데에 영어와 교정한 한국어가 함께 나타납니다. 수정·추가·삭제는 색으로 표시되며, ↑ ↓ 버튼으로 변경 위치를 이동할 수 있습니다.</p></li>
      <li><strong>전체 결과 복사</strong><p>가운데의 <b>전체 복사</b>를 누르세요. 다시 수정하려면 왼쪽 또는 오른쪽의 <b>편집</b>을 누르면 됩니다.</p></li>
    </ol>
    <div class="help-tip">교정본은 왼쪽 원문에서 추출한 한국어를 기준으로 작성하세요.</div>
    <div class="help-footer"><span><kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd>로 현재 작업 실행</span><form method="dialog"><button class="button primary">확인했어요</button></form></div>
  </dialog>
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
  if (deletedGhost) rendered = `<del>${escape(row.original ?? '')}</del>`;
  if (row.kind === 'changed') rendered = wordDiff(row.original ?? '', row.result ?? '', column === 'original' ? 'old' : 'next');
  const active = content !== undefined || deletedGhost;
  const label = { changed: '~', added: '+', deleted: '−', unchanged: '' }[row.kind];
  return `<div class="diff-line ${active ? row.kind : 'spacer'} ${deletedGhost ? 'ghost' : ''}" data-row="${index}"><span class="line-number" aria-hidden="true">${number ?? ''}</span><span class="line-sign" aria-hidden="true">${active ? label : ''}</span><span class="line-content">${rendered || ' '}</span></div>`;
}
function renderMerge() {
  if (!result) return;
  for (const column of ['original', 'result', 'corrected'] as const) {
    $(`#${column}-diff`).innerHTML = result.rows.map((row, index) => lineHTML(row, column, index)).join('');
    $(`#${column}-diff`).hidden = false;
  }
  $('#merge-empty').hidden = true;
  setView(true);
  const { changed, added, deleted } = result.counts;
  $('#merge-summary').innerHTML = changed + added + deleted
    ? `<strong>${changed}줄 수정</strong><span class="summary-divider">/</span>${added}줄 추가<span class="summary-divider">/</span>${deleted}줄 삭제`
    : `${icon('check')} 변경 없음 · 원문과 동일합니다`;
  $('#merge-result-count').textContent = `${lineCount(result.text).toLocaleString()}줄 · 병합 완료`;
  $('#change-nav').hidden = changed + added + deleted === 0;
  selectedChange = -1;
  $('#change-position').textContent = `변경 ${changed + added + deleted}곳`;
  disable('#copy-merge', false);
  requestAnimationFrame(alignRowHeights);
}
function alignRowHeights() {
  if (!mergeView || !result || $('#merge-panel').hidden) return;
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
    disable('#copy-merge', true);
    $('#merge-result-count').textContent = '입력 변경됨 · 다시 병합해 주세요';
    $('#merge-summary').textContent = '입력이 변경되었습니다. 다시 병합해 주세요.';
  }
  updateCounts();
}
function runMerge() {
  const source = value('#merge-original');
  if (!source.trim()) return notify('왼쪽에 영한 혼합 원문을 입력해 주세요.', true);
  // Empty revised text is intentional: it deletes all extracted translation lines.
  try {
    result = mergeKorean(source, value('#merge-corrected'));
    dirty = false;
    renderMerge();
    notify('병합이 완료되었습니다. 강조된 변경사항을 확인하세요.');
  } catch (error) { notify(error instanceof Error ? error.message : '병합 중 오류가 발생했습니다.', true); }
}
function navigateChange(direction: number) {
  if (!result || dirty) return;
  const changed = result.rows.map((row, index) => row.kind !== 'unchanged' ? index : -1).filter(index => index >= 0);
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
$('#copy-merge').onclick = () => { if (result && !dirty) void copyText(result.text); };
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
  setValue('#merge-original', value('#extract-input'));
  setValue('#merge-corrected', extraction);
  setView(false);
  invalidateMerge();
  setMode('merge');
  $('#merge-corrected').focus();
  notify('오른쪽 한국어를 교정한 뒤 병합해 주세요.');
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
    setValue('#merge-original', sample);
    setValue('#merge-corrected', reviseSample(extractKorean(sample).text));
    runMerge();
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
    if (syncing || !mergeView) return;
    syncing = true;
    const top = $(`#${side}-diff`).scrollTop;
    for (const other of ['original', 'result', 'corrected']) if (other !== side) $(`#${other}-diff`).scrollTop = top;
    requestAnimationFrame(() => { syncing = false; });
  };
}
document.addEventListener('keydown', event => {
  if (helpDialog.open) return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    if (mode === 'extract') runExtract(); else runMerge();
  }
});
window.addEventListener('resize', () => requestAnimationFrame(alignRowHeights));
// Web fonts and panel resizing can reflow a line after the initial render.
void document.fonts.ready.then(() => requestAnimationFrame(alignRowHeights));
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
