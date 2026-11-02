'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const tutorialScript = fs.readFileSync(path.join(root, 'public', 'tutorial.js'), 'utf8');

function setup() {
  class FakeClassList {
    classes = new Set();
    add(...names) { names.forEach(name => this.classes.add(name)); }
    remove(...names) { names.forEach(name => this.classes.delete(name)); }
    toggle(name, enabled) { if (enabled) this.classes.add(name); else this.classes.delete(name); }
    contains(name) { return this.classes.has(name); }
  }
  class FakeElement {
    constructor() {
      this.value = '';
      this.textContent = '';
      this.style = {};
      this.children = [];
      this.disabled = false;
      this.classList = new FakeClassList();
      this.callbacks = {};
      this.scrollHeight = 0;
    }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0]; }
    appendChild(node) { this.children.push(node); this.scrollHeight += 10; }
    replaceChildren() { this.children = []; }
    remove() { this.removed = true; }
    addEventListener(event, callback) { this.callbacks[event] = callback; }
    focus() { this.focused = true; }
  }
  const ids = [...html.matchAll(/id="([a-z0-9-]+)"/gi)].map(m => m[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
  const document = {
    body: { style: {} },
    getElementById: id => { assert.ok(elements[id], `Elemento inexistente ${id}`); return elements[id]; },
    createElement: () => new FakeElement(),
    addEventListener() {}
  };
  let intervalCallback = null;
  const context = vm.createContext({ document,
    setInterval: fn => { intervalCallback = fn; return 1; },
    clearInterval: () => { intervalCallback = null; },
    Date });
  vm.runInContext(tutorialScript, context, { filename: 'tutorial.js' });
  const invoke = expression => vm.runInContext(expression, context);
  elements['tutorial-launch'].style.display = 'block';
  return { elements, invoke, get intervalCallback() { return intervalCallback; } };
}

test('el botón y el texto de espera están presentes y no aparece el texto anterior', () => {
  assert.match(html, /id="tutorial-launch"/);
  assert.match(html, /src="\/tutorial\.js"/);
  assert.match(html, /Ya estás conectado\. Espera a que inicie la ronda\./);
  assert.doesNotMatch(html, /Espera a que el administrador presione Iniciar ronda/);
  assert.match(html, /closeTutorial\(\); \/\/ START!/);
});

test('el bot falla, el alumno bloquea por DENY y solo entonces puede eliminar al bot sin tocar el servidor', () => {
  const t = setup();
  const e = t.elements;
  t.invoke('openTutorial()');
  assert.equal(e['tutorial-screen'].style.display, 'flex');
  assert.equal(e['tutorial-add-rule'].disabled, true);
  t.intervalCallback();
  t.intervalCallback();
  assert.equal(t.invoke('tutorial.phase'), 'block');
  assert.ok(e['tutorial-logs'].children.some(node => node.textContent.includes('Login fallido')));
  e['tutorial-fw-action'].value = 'allow';
  e['tutorial-fw-ip'].value = '10.12.0.200';
  e['tutorial-fw-proto'].value = 'TCP';
  e['tutorial-fw-port'].value = '22';
  t.invoke('tutorialAddRule()');
  assert.equal(t.invoke('tutorial.phase'), 'block');
  assert.match(e['tutorial-fw-feedback'].textContent, /no corresponde/);
  e['tutorial-fw-action'].value = 'deny';
  t.invoke('tutorialAddRule()');
  assert.equal(t.invoke('tutorial.phase'), 'check-block');
  t.intervalCallback();
  assert.equal(t.invoke('tutorial.phase'), 'attack');
  assert.ok(e['tutorial-logs'].children.some(node => node.textContent.includes('BLOQUEADO')));
  assert.equal(e['tutorial-attack'].disabled, true);
  t.invoke('tutorialSelectTarget()');
  assert.equal(e['tutorial-attack'].disabled, false);
  e['tutorial-atk-proto'].value = 'UDP';
  e['tutorial-atk-port'].value = '22';
  t.invoke('tutorialStartAttack()');
  assert.equal(t.invoke('tutorial.phase'), 'attack');
  e['tutorial-atk-proto'].value = 'TCP';
  e['tutorial-atk-port'].value = '80';
  t.invoke('tutorialStartAttack()');
  assert.equal(t.invoke('tutorial.phase'), 'attacking');
  t.intervalCallback();
  t.intervalCallback();
  t.intervalCallback();
  assert.equal(t.invoke('tutorial.phase'), 'complete');
  assert.equal(t.intervalCallback, null);
  assert.equal(e['tutorial-success'].style.display, 'block');
  assert.match(e['tutorial-target'].textContent, /BOT ELIMINADO/);
  t.invoke('closeTutorial()');
  assert.equal(e['tutorial-screen'].style.display, 'none');
});

test('el tutorial puede cerrarse a mitad de práctica y reiniciarse sin intervalos duplicados', () => {
  const t = setup();
  t.invoke('openTutorial()');
  t.intervalCallback();
  t.invoke('closeTutorial()');
  assert.equal(t.intervalCallback, null);
  t.invoke('openTutorial()');
  assert.equal(t.invoke('tutorial.phase'), 'observe');
  assert.equal(t.invoke('tutorial.attempts'), 0);
  assert.ok(t.intervalCallback);
});
