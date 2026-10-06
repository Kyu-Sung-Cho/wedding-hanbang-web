// Synthetic DOM checks only. No participants, real responses, network, or product writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(directory, 'v42-couple-validation.html'), 'utf8');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'docs/wedding-code/2026-10-06_v42_items.json'), 'utf8'));
let cases = 0;
const liveWindows = [];

function kit() {
  const downloads = [];
  const printed = [];
  const errors = [];
  let pendingBlob = null;
  let requests = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'file:///synthetic-validation-kit.html', virtualConsole,
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.Blob = class { constructor(parts) { this.text = parts.join(''); } };
      window.URL.createObjectURL = blob => { pendingBlob = blob; return 'blob:synthetic-download'; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () {
        downloads.push({ filename: this.download, data: JSON.parse(pendingBlob.text) });
      };
      window.confirm = () => true;
      window.print = () => {
        window.dispatchEvent(new window.Event('beforeprint'));
        printed.push(window.document.getElementById('print-content').textContent);
        window.dispatchEvent(new window.Event('afterprint'));
      };
      window.fetch = () => { requests++; throw new Error('Network is forbidden'); };
      window.XMLHttpRequest = class { constructor() { requests++; throw new Error('Network is forbidden'); } };
    },
  });
  liveWindows.push(dom.window);
  const document = dom.window.document;
  assert.deepEqual(errors, [], 'initial script must run without errors');
  const field = (id, value) => {
    const node = document.getElementById(id);
    assert.ok(node, `field exists: ${id}`);
    if (node.type === 'checkbox') node.checked = value;
    else node.value = value;
    node.dispatchEvent(new dom.window.Event(node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && node.type !== 'checkbox') ? 'input' : 'change', { bubbles: true }));
  };
  const click = id => document.getElementById(id).click();
  const approve = (kind = 'dry-run') => {
    field('kind', kind);
    field('session-id', 'S-test');
    field('participant-A', 'A-test');
    field('participant-B', 'B-test');
    field('version-checked', 'v4.2-depth');
    field('observe-A', 'agreed');
    field('observe-B', 'agreed');
    field('explained', true);
  };
  const outputConsent = () => {
    field('output-A', 'agreed'); field('output-B', 'agreed'); field('privacy-review', true);
  };
  const add = id => { field('item-picker', id); click('add-item'); };
  const exportNow = () => {
    field('privacy-review', true); click('download');
    assert.ok(downloads.length, 'explicit download should create a snapshot');
    return downloads.at(-1).data;
  };
  const complete = () => {
    approve(); add('process.search.1');
    for (const p of ['A', 'B']) {
      const prefix = `process.search.1-${p}`;
      for (const key of ['scenario', 'options', 'skip', 'strength']) field(`${prefix}-${key}`, 'understood');
      field(`${prefix}-scenario-note`, '합성 관찰: 둘러볼 곳과 함께 움직이는 상황의 뜻만 재진술');
      field(`${prefix}-options-note`, '합성 관찰: 두 공개 보기의 뜻을 구분함, 고른 답은 기록하지 않음');
      for (const key of ['pressure', 'predictability']) field(`${prefix}-${key}`, 'none_observed');
      field(`${prefix}-transfer`, 'not_applicable');
      for (const node of document.querySelectorAll(`select[id^="result-"][id$="-${p}-source"]`)) field(node.id, 'actual');
      for (const node of document.querySelectorAll(`select[id^="result-"][id$="-${p}-status"]`)) field(node.id, 'understood');
      for (const node of document.querySelectorAll(`select[id^="flow-"][id$="-${p}-status"]`)) field(node.id, 'found');
      for (const node of document.querySelectorAll(`select[id^="flow-"][id$="-${p}-execution"]`)) field(node.id, 'screen_only');
      field(`ending-${p}-state`, 'completed'); field(`ending-${p}-burden`, 'manageable'); field(`ending-${p}-context`, 'observation_included');
    }
    field('finish', true); outputConsent();
  };
  return { window: dom.window, document, field, click, approve, outputConsent, add, exportNow, complete, downloads, printed, requests: () => requests, errors };
}

function check(name, run) { run(); cases++; console.log(`OK ${cases}: ${name}`); }
try {
  check('68 public item originals, options, quotes, and questions match v4.2; hidden scoring is absent', () => {
    const k = kit();
    const publicItems = JSON.parse(k.document.getElementById('public-items').textContent);
    assert.equal(publicItems.length, 68);
    assert.equal(new Set(publicItems.map(i => i.id)).size, 68);
    for (const item of publicItems) {
      const original = bank.items.find(i => i.id === item.id);
      assert.ok(original);
      assert.equal(item.caption, original.caption); assert.equal(item.stem, original.stem);
      assert.deepEqual(item.quote, original.quote); assert.equal(item.question, original.question);
      const options = original.fmt === 'react' ? [original.ends.left, original.ends.right]
        : original.fmt === 'split' ? original.entries.map(i => i.text)
          : ['recall','instant'].includes(original.fmt) ? original.options.map(i => i.text) : original.cards.map(i => i.text);
      assert.deepEqual(item.options, options);
      assert.ok(Object.keys(item).every(key => ['id','caption','stem','formatLabel','options','quote','question'].includes(key)));
    }
  });
  check('no external assets, storage, analytics, navigation, network, or form submission; all fields labeled', () => {
    const k = kit();
    assert.match(html, /connect-src 'none'/);
    assert.equal(k.document.querySelectorAll('[src],link[href],iframe,form,a[href]').length, 0);
    const executable = [...k.document.querySelectorAll('script:not([type="application/json"])')].map(n => n.textContent).join('\n');
    assert.doesNotMatch(executable, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|serviceWorker|posthog|gtag)\b\s*(?:\(|\.|=)|\b(?:window\.location|document\.cookie)\b/);
    for (const n of k.document.querySelectorAll('input,select,textarea')) {
      assert.ok(n.id && k.document.querySelector(`label[for="${n.id}"]`) || n.closest('label'), `field must be labeled: ${n.id}`);
    }
    assert.equal(k.requests(), 0);
  });
  check('initial state cannot observe or export; one participant consent is insufficient', () => {
    const k = kit(); assert.equal(k.document.getElementById('observation-work').disabled, true);
    k.click('download'); k.click('print'); assert.equal(k.downloads.length,0); assert.equal(k.printed.length,0);
    k.approve(); k.field('observe-B','pending'); assert.equal(k.document.getElementById('observation-work').disabled,true);
  });
  check('observation consent is separate from output consent and manual privacy review', () => {
    const k = kit(); k.approve(); assert.equal(k.document.getElementById('observation-work').disabled,false);
    k.field('privacy-review',true); k.field('output-A','agreed'); k.click('download'); assert.equal(k.downloads.length,0);
    k.field('output-B','agreed'); assert.equal(k.document.getElementById('download').disabled,true);
    k.field('privacy-review',true); assert.equal(k.document.getElementById('download').disabled,false);
    assert.equal(k.downloads.length,0,'consent must never auto-download');
  });
  check('explicit partial download preserves UNVALIDATED and not-assessed authorities without response fields', () => {
    const k = kit(); k.approve(); k.add('scope.timing.1'); k.outputConsent(); const data=k.exportNow();
    assert.equal(data.sessionKind,'dry-run'); assert.equal(data.recordStatus,'in_progress');
    for (const key of ['scientificValidity','researchGateG3','releaseApproval']) assert.equal(data[key],'not_assessed');
    assert.equal(data.validationStatus,'UNVALIDATED'); assert.equal(data.observation.plannedItems.length,1);
    const keys=[]; const walk=v=>{if(v&&typeof v==='object')for(const [key,value]of Object.entries(v)){keys.push(key);walk(value);}};walk(data);
    assert.ok(!keys.some(key=>['answer','answers','response','responses','score','code','url','email','phone','name','contact','link'].includes(key)));
    assert.match(k.downloads.at(-1).filename,/^wc-v42-observation-S-test\.json$/);
  });
  check('any content edit invalidates privacy review and blocks subsequent output', () => {
    const k=kit(); k.approve();k.add('process.search.1');k.outputConsent(); k.field('process.search.1-A-note','합성 혼동 메모');
    assert.equal(k.document.getElementById('privacy-review').checked,false);assert.equal(k.document.getElementById('download').disabled,true);
  });
  check('consent withdrawal wipes item observations, result notes, issues, ending, and print data', () => {
    const k=kit();k.complete();k.field('result-role-A-note','합성 설명 메모');k.click('add-issue');k.field('issue-0-observed','합성 실패');
    k.field('observe-B','withdrawn');assert.equal(k.document.getElementById('item-records').querySelectorAll('textarea').length,0);
    assert.equal(k.document.getElementById('result-role-A-note').value,'');assert.equal(k.document.getElementById('issues').children.length,0);
    assert.equal(k.document.getElementById('ending-A-state').value,'not_recorded');assert.equal(k.document.getElementById('print-content').textContent,'');
    assert.match(k.document.getElementById('record-state').textContent,/철회/);assert.equal(k.document.getElementById('download').disabled,true);
    k.field('observe-B','agreed');k.outputConsent();const data=k.exportNow();assert.equal(data.observation.plannedItems.length,0);assert.equal(data.observation.issues.length,0);
  });
  check('output refusal locks output without falsely deleting still-consented in-memory observations', () => {
    const k=kit();k.approve();k.add('process.search.1');k.field('process.search.1-A-note','합성 메모');k.outputConsent();k.field('output-B','declined');
    k.click('download');k.click('print');assert.equal(k.downloads.length,0);assert.equal(k.printed.length,0);
    assert.equal(k.document.getElementById('process.search.1-A-note').value,'합성 메모');
  });
  check('dry-run to actual mode resets observations and simulated consents', () => {
    const k=kit();k.complete();k.field('kind','human-observation');
    assert.equal(k.document.getElementById('observe-A').value,'pending');assert.equal(k.document.getElementById('output-B').value,'pending');
    assert.equal(k.document.getElementById('explained').checked,false);assert.equal(k.document.getElementById('observation-work').disabled,true);
    assert.equal(k.document.getElementById('item-records').querySelectorAll('textarea').length,0);
  });
  check('participant/session identity changes reset observation and consent; duplicate anonymous IDs do not unlock', () => {
    const k=kit();k.complete();k.field('participant-A','A-other');assert.equal(k.document.getElementById('observe-B').value,'pending');
    k.approve();k.field('participant-B','A-test');k.field('observe-A','agreed');k.field('observe-B','agreed');k.field('explained',true);
    assert.equal(k.document.getElementById('observation-work').disabled,true);
    k.approve();k.add('process.search.1');k.field('session-id','S-other');assert.equal(k.document.getElementById('observe-A').value,'pending');
  });
  check('finish checkbox cannot turn missing observation or missing restatement into completed evidence', () => {
    const k=kit();k.approve();k.add('process.search.1');k.field('finish',true);k.outputConsent();assert.equal(k.exportNow().recordStatus,'incomplete');
    k.complete();k.field('process.search.1-A-options-note','');assert.equal(k.exportNow().recordStatus,'incomplete');
    k.field('process.search.1-A-options-note','합성 재진술');k.field('result-even-A-source','not_seen');assert.equal(k.exportNow().recordStatus,'incomplete');
  });
  check('completed record remains UNVALIDATED, failed understanding requires a revision task, and action is separate from understanding', () => {
    const k=kit();k.complete();let data=k.exportNow();assert.equal(data.recordStatus,'record_complete_no_issue_observed');assert.equal(data.validationStatus,'UNVALIDATED');
    assert.equal(data.observation.flow.return.A.status,'found');assert.equal(data.observation.flow.return.A.execution,'screen_only');
    k.field('result-role-A-status','misunderstood');assert.equal(k.exportNow().recordStatus,'incomplete');
    k.click('add-issue');k.field('issue-0-location','역할 제안 화면');k.field('issue-0-severity','trust_scope');k.field('issue-0-observed','합성 관찰: 제안을 확정으로 오해');k.field('issue-0-action','제안 상태 설명을 수정하고 다시 관찰');k.field('issue-0-state','open');
    data=k.exportNow();assert.equal(data.recordStatus,'record_complete_revision_needed');assert.equal(data.researchGateG3,'not_assessed');
  });
  check('not-shown/not-attempted states are explicit omissions rather than successful understanding', () => {
    const k=kit();k.complete();k.field('result-even-A-status','not_shown');k.field('result-even-A-source','not_seen');
    k.field('flow-storage-A-status','not_attempted');k.field('flow-storage-A-execution','not_executed');const data=k.exportNow();
    assert.equal(data.observation.results.even.A.status,'not_shown');assert.equal(data.observation.flow.storage.A.status,'not_attempted');
    assert.match(k.document.getElementById('coverage').textContent,/화면 안 나옴 1/);assert.equal(data.recordStatus,'record_complete_no_issue_observed');
  });
  check('early stop is partial even with finish checked, without forcing a personal reason', () => {
    const k=kit();k.complete();k.field('ending-B-state','stopped');k.field('ending-B-burden','not_disclosed');assert.equal(k.exportNow().recordStatus,'stopped');
    assert.equal(k.exportNow().observation.ending.B.note,'');
  });
  check('print only sends consented reviewed snapshot on explicit click; native print exposes no observation fields', () => {
    const k=kit();k.approve();k.add('process.search.1');k.outputConsent();assert.equal(k.printed.length,0);k.click('print');
    assert.equal(k.printed.length,1);assert.equal(JSON.parse(k.printed[0]).validationStatus,'UNVALIDATED');
    assert.equal(k.document.getElementById('print-content').textContent,'');
    k.window.dispatchEvent(new k.window.Event('beforeprint'));assert.doesNotMatch(k.document.getElementById('print-content').textContent,/plannedItems|S-test/);
    k.field('output-B','withdrawn');k.click('print');assert.equal(k.printed.length,1);
  });
  check('reset and fresh page discard all memory; no automatic export or network during the checks', () => {
    const k=kit();k.complete();k.click('reset');assert.equal(k.document.getElementById('session-id').value,'');assert.equal(k.document.getElementById('observe-A').value,'pending');
    assert.equal(k.document.getElementById('observation-work').disabled,true);assert.equal(k.downloads.length,0);assert.equal(k.requests(),0);
    const fresh=kit();assert.equal(fresh.document.getElementById('item-records').querySelectorAll('textarea').length,0);assert.equal(fresh.downloads.length,0);
    assert.deepEqual(k.errors,[]);
  });
  console.log(`PASS ${cases} synthetic kit checks; real participant observations: 0; UNVALIDATED.`);
} finally { liveWindows.forEach(window=>window.close()); }
