/* Start-up screen: shows the steps as the app reports them, and what to do when one fails. */
'use strict';

const bridge = window.algoHunt;
const $ = (sel) => document.querySelector(sel);
const TITLE = { latest: 'Getting the latest version…', install: 'Installing packages…', build: 'Preparing the app…', start: 'Starting Algo Hunt…' };
let started = Date.now();
let current = null;

function reset() {
  document.body.classList.remove('failed');
  for (const row of document.querySelectorAll('.row')) {
    row.className = 'row';
    row.querySelector('em').textContent = '';
  }
  $('#problem-text').textContent = '';
  $('#detail').hidden = true;
  $('#link').hidden = true;
  $('#line').textContent = '';
  $('#sub').textContent = 'Starting…';
  started = Date.now();
  current = null;
}

// "Preparing the app… 1:24" — the long steps say how long they've been going.
setInterval(() => {
  if (!current || document.body.classList.contains('failed')) return;
  const s = Math.floor((Date.now() - started) / 1000);
  $('#sub').textContent = s >= 5 ? `${TITLE[current]} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : TITLE[current];
}, 1000);

bridge?.onProgress((p) => {
  const row = document.querySelector(`.row[data-p="${p.step}"]`);
  if (!row) return;
  if (p.step === 'latest' && p.state === 'run' && current !== 'latest') reset(); // a new attempt
  if (p.state === 'run' && current !== p.step) {
    current = p.step;
    started = Date.now();
    $('#sub').textContent = TITLE[p.step];
  }
  row.className = `row ${p.state}`;
  if (p.state === 'run') $('#line').textContent = p.message || '';
  if (p.state === 'done') {
    row.querySelector('em').textContent = p.message || 'Done';
    $('#line').textContent = '';
    if (p.step === 'start') {
      current = null;
      $('#sub').textContent = 'Opening…';
    }
  }
  if (p.state === 'fail') {
    current = null;
    document.body.classList.add('failed');
    $('#sub').textContent = 'Algo Hunt couldn’t start';
    $('#problem-text').textContent = p.message || 'Something went wrong.';
    if (p.extra?.detail) {
      $('#detail').textContent = p.extra.detail;
      $('#detail').hidden = false;
    }
    if (p.extra?.link) {
      $('#link').textContent = p.extra.link.label;
      $('#link').dataset.url = p.extra.link.url;
      $('#link').hidden = false;
    }
  }
});

$('#retry').addEventListener('click', () => {
  reset();
  void bridge?.retry();
});
$('#link').addEventListener('click', () => void bridge?.openExternal($('#link').dataset.url));
$('#settings').addEventListener('click', () => void bridge?.settings());
$('#logs').addEventListener('click', () => void bridge?.openLogs());
$('#quit').addEventListener('click', () => void bridge?.quit());
