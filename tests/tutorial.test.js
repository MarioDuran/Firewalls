'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const tutorial = fs.readFileSync(path.join(root, 'tutorial.js'), 'utf8');

function setup() {
  class ClassList {
    classes = new Set();
    add(...names) { names.forEach(n => this.classes.add(n)); }
    remove(...names) { names.forEach(n => this.classes.delete(n)); }
    toggle(name, enabled) { enabled ? this.add(name) : this.remove(name); }
    contains(name) { return this.classes.has(name); }
  }
  class Element {
    constructor() {
      this.textContent = ''; this.value = ''; this.style = {}; this.children = [];
      this.classList = new ClassList(); this.listeners = {}; this.disabled = false;
      this.scrollHeight = 200; this.scrollTop = 0;
    }
    set className(value) { this.classList.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classList.classes].join(' '); }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0]; }
    addEventListener(name, cb) { this.listeners[name] = cb; }
    click() { if (this.listeners.click) this.listeners.click({ preventDefault() {} }); if (this.onclick) this.onclick(); }
    appendChild(el) { this.children.push(el); }
    replaceChildren() { this.children = []; }
    remove() { this.removed = true; }
  }
  const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = {
    getElementById(id) { assert.ok(elements[id], `Missing id ${id}`); return elements[id]; },
    createElement() { return new Element(); },
    body: { style: {} }
  };
  const timers = new Map();
  let nextId = 0;
  const socket = {
    handlers: {}, calls: [], connected: false,
    on(event, cb) { this.handlers[event] = cb; },
    emit(event, payload) { this.calls.push({ event, payload }); },
    connect() { this.connected = true; this.handlers.connect(); }
  };
  const ctx = vm.createContext({ document,
    io: opts => { assert.equal(opts.autoConnect, false); return socket; },
    setInterval(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout() { throw new Error('Unexpected timeout'); },
    clearTimeout() {}, Date, console,
    localStorage: { getItem() { return null; }, setItem() {} },
    alert(msg) { throw new Error(`Unexpected alert: ${msg}`); }
  });
  assert.ok(inline, 'Main game script not found');
  vm.runInContext(inline, ctx, { filename: 'index-main.js' });
  vm.runInContext(tutorial, ctx, { filename: 'tutorial.js' });
  const evalJs = expression => vm.runInContext(expression, ctx);
  const run = ms => {
    const entry = [...timers.values()].find(t => t.ms === ms);
    assert.ok(entry, `Timer ${ms}ms not found`);
    entry.fn();
  };
  const logs = () => elements['console-inner'].children.map(x => x.textContent).join('\n');
  return { elements, socket, evalJs, run, logs, timers };
}

test('el modo tutorial usa una sola interfaz: exactamente el mismo tablero y controles del juego', () => {
  assert.match(html, /id="tutorial-launch"[^>]*>MODO TUTORIAL/);
  assert.match(html, /id="player-list"/);
  assert.match(html, /id="console-inner"/);
  assert.match(html, /id="rules-list"/);
  assert.match(html, /id="btn-attack"/);
  assert.match(html, /id="add-rule-btn"/);
  assert.match(html, /src="tutorial\.js"/);
  assert.doesNotMatch(html, /id="tutorial-screen"|tutorial-instructions|tutorial-step|tutorial-feedback/);
  assert.match(html, /Ya estás conectado\. Espera a que inicie la ronda\./);
  assert.doesNotMatch(html, /Espera a que el administrador presione Iniciar ronda/);
});

test('tutorial 100% local: un solo bot falla, el estudiante lo bloquea y lo elimina con la interfaz auténtica', () => {
  const g = setup();
  const e = g.elements;
  e['tutorial-launch'].click();
  assert.equal(g.evalJs('tutorialMode'), true);
  assert.equal(e['login-screen'].style.display, 'none');
  assert.equal(e['my-user'].textContent, 'AGENTE NÉBULA');
  assert.equal(e['my-ip'].textContent, '10.12.0.10');
  assert.equal(e['round-timer'].textContent, '15:00');
  assert.equal(e['player-list'].children.length, 1);
  assert.match(e['player-list'].children[0].textContent, /BOT ESPECTRO/);
  assert.equal(g.socket.connected, false);
  for (let i = 0; i < 4; i++) g.run(1450);
  assert.match(g.logs(), /Login fallido/);
  assert.doesNotMatch(g.logs(), /PASSWORD.*ENCONTRADO/);
  e['fw-action'].value = 'deny';
  e['fw-src'].value = '10.12.0.200';
  e['fw-proto'].value = 'TCP';
  e['fw-port'].value = '22';
  g.evalJs('addRule()');
  assert.equal(e['rule-count'].textContent, 1);
  g.run(1450);
  assert.match(g.logs(), /\[FW\] BLOQUEADO/);
  e['player-list'].children[0].click();
  assert.equal(e['atk-id'].value, 'bot-practica');
  assert.equal(e['atk-ip'].value, '10.12.0.200');
  e['atk-proto'].value = 'TCP';
  e['atk-port'].value = '80';
  g.evalJs('toggleAttack()');
  g.run(1100); g.run(1100); g.run(1100);
  assert.equal(e['my-hacks'].textContent, '1');
  assert.equal(e['my-total'].textContent, '1');
  assert.equal(g.evalJs('tutorialState.botAlive'), false);
  assert.equal(e['player-list'].children[0].classList.contains('hacked'), true);
  assert.match(g.logs(), /PASSWORD 42 ENCONTRADO/);
  assert.equal(e['btn-attack'].disabled, true);
  assert.equal(g.socket.connected, false);
  assert.equal(g.socket.calls.length, 0);
});

test('tutorial se cierra y reinicia sin crear registros reales ni dejar ataques en ejecución', () => {
  const g = setup();
  const e = g.elements;
  e['tutorial-launch'].click();
  e['player-list'].children[0].click();
  g.evalJs('toggleAttack()');
  assert.equal(g.evalJs('isAttacking'), true);
  e['admin-link'].click();
  assert.equal(g.evalJs('tutorialMode'), false);
  assert.equal(e['login-screen'].style.display, 'flex');
  assert.equal(e['tutorial-launch'].style.display, 'block');
  assert.equal(e['admin-link'].textContent, 'Panel de administrador');
  assert.equal(e['player-list'].children.length, 0);
  assert.equal(g.evalJs('isAttacking'), false);
  assert.ok(![...g.timers.values()].some(t => t.ms === 1450 || t.ms === 1100));
  assert.equal(g.socket.calls.length, 0);
  e['tutorial-launch'].click();
  assert.equal(e['rule-count'].textContent, 0);
  assert.equal(e['my-hacks'].textContent, '0');
  assert.equal(e['player-list'].children.length, 1);
});

test('la conexión multijugador se abre normalmente sólo al intentar iniciar sesión real', () => {
  const g = setup();
  g.elements['tutorial-launch'].click();
  g.elements['admin-link'].click();
  assert.equal(g.socket.connected, false);
  g.elements['login-user'].value = 'Alumno';
  g.elements['login-pass'].value = '5';
  g.evalJs('joinGame()');
  assert.equal(g.socket.connected, true);
  assert.equal(g.socket.calls[0].event, 'join_game');
  assert.equal(g.socket.calls[0].payload.username, 'Alumno');
});

test('no existe flujo de pistas ni pantallas didácticas añadidas', () => {
  assert.doesNotMatch(tutorial, /tutorialPhase|tutorial-progress|tutorial-screen|PASO 1|PASO 2|PASO 3/);
  assert.doesNotMatch(html, /Observa el ataque|BLOQUEA AL BOT|ATACA Y ELIMINA|Práctica independiente/);
});
