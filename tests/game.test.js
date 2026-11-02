'use strict';
// Se usan dobles de Express y Socket.IO para probar la lógica sin necesidad
// de descargar dependencias ni abrir puertos de red.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
  // Fijamos las adivinanzas a cero sin fijar las IP: los ataques son deterministas.
  .replace('const guess = Math.floor(Math.random() * 100);', 'const guess = 0;');

function setup(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewalls-test-'))) {
  const clock = { now: 1_800_000_000_000 };
  const timers = new Map();
  let nextTimer = 0;
  let nextSocket = 0;
  const setIntervalFake = (fn, duration) => {
    const id = ++nextTimer;
    timers.set(id, { fn, duration, next: clock.now + duration });
    return id;
  };
  const clearIntervalFake = id => timers.delete(id);
  function advance(ms) {
    const end = clock.now + ms;
    while (true) {
      const upcoming = [...timers.entries()].sort((a, b) => a[1].next - b[1].next)[0];
      if (!upcoming || upcoming[1].next > end) break;
      clock.now = upcoming[1].next;
      const due = [...timers.entries()].filter(([, t]) => t.next <= clock.now);
      for (const [id, task] of due) {
        if (!timers.has(id)) continue;
        task.next += task.duration;
        task.fn();
      }
    }
    clock.now = end;
  }

  class FakeSocket {
    constructor(io) {
      this.id = `socket-${++nextSocket}`;
      this.io = io;
      this.handlers = {};
      this.received = [];
      this.rooms = new Set();
    }
    on(name, fn) { this.handlers[name] = fn; }
    emit(name, data) { this.received.push({ name, data }); }
    send(name, data) {
      assert.ok(this.handlers[name], `Falta listener ${name}`);
      this.handlers[name](data);
    }
    last(name) { return this.received.filter(e => e.name === name).at(-1)?.data; }
    disconnect() {
      this.handlers.disconnect?.();
      this.io.sockets.sockets.delete(this.id);
    }
    join(room) { this.rooms.add(room); }
  }
  class FakeIO {
    constructor() {
      this.sockets = { sockets: new Map() };
      this.handlers = {};
    }
    on(name, fn) { this.handlers[name] = fn; }
    connect() {
      const socket = new FakeSocket(this);
      this.sockets.sockets.set(socket.id, socket);
      this.handlers.connection(socket);
      return socket;
    }
    emit(name, data) { for (const socket of this.sockets.sockets.values()) socket.emit(name, data); }
    to(room) {
      return { emit: (name, data) => {
        for (const socket of this.sockets.sockets.values()) {
          if (socket.id === room || socket.rooms.has(room)) socket.emit(name, data);
        }
      } };
    }
  }
  const express = () => ({ use() {}, get() {} });
  express.static = () => () => {};
  const mocks = { express, http: { createServer: () => ({ listen() {} }) }, 'socket.io': { Server: FakeIO } };
  const mockedRequire = name => mocks[name] || require(name);
  const module = { exports: {} };
  const testMath = Object.create(Math);
  let randomCounter = 0;
  testMath.random = () => ((++randomCounter * 991) % 65521) / 65521;
  class FakeDate extends Date { static now() { return clock.now; } }
  vm.runInNewContext(serverCode, {
    require: mockedRequire, module, console, Buffer, Date: FakeDate,
    Math: testMath, setInterval: setIntervalFake, clearInterval: clearIntervalFake,
    __dirname: path.join(__dirname, '..'),
    process: { pid: process.pid, env: { SCORES_FILE: path.join(dir, 'scores.json'), ADMIN_PASSWORD: 'clave-admin-de-prueba' } }
  }, { filename: 'server.js' });
  const game = module.exports;
  function join(socket, username, password, profileToken) {
    socket.send('join_game', { username, password, profileToken });
    return socket.last('init_state');
  }
  function adminStart() {
    const admin = game.io.connect();
    admin.send('admin_login', { password: 'Admin2026' });
    assert.ok(admin.received.some(e => e.name === 'admin_authenticated'));
    admin.send('admin_start_round');
    return admin;
  }
  return { ...game, io: game.io, clock, advance, join, dir, timers, adminStart };
}

test('firewall sin límite de tres, validado en servidor', () => {
  const g = setup();
  const alice = g.io.connect();
  g.join(alice, 'Alice', 12);
  g.adminStart();
  for (let i = 1; i <= 11; i++) {
    alice.send('update_firewall', { action: 'deny', proto: 'TCP', port: '22', src: `10.12.0.${i}` });
  }
  assert.equal(alice.last('firewall_updated').length, 11);
  assert.equal(g.players.get(alice.id).firewall[0].src, '10.12.0.1');
  assert.equal(g.players.get(alice.id).firewall[10].src, '10.12.0.11');
  alice.send('update_firewall', { action: 'deny', proto: 'TCP', port: '99999', src: '10.12.0.50' });
  assert.equal(g.players.get(alice.id).firewall.length, 11);
});

test('al hackearse se detienen sus ataques y debe esperar 60 segundos, incluso al reconectar', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const carol = g.io.connect();
  const aliceInfo = g.join(alice, 'Alice', 0);
  const bobInfo = g.join(bob, 'Bob', 33);
  const carolInfo = g.join(carol, 'Carol', 88);
  g.adminStart();
  alice.send('start_attack', { targetId: carolInfo.id, targetPort: '22', targetProto: 'TCP' });
  bob.send('start_attack', { targetId: aliceInfo.id, targetPort: '80', targetProto: 'TCP' });
  assert.ok(g.players.get(alice.id).attackInterval);
  g.advance(1000); // Math.random -> 0, Bob adivina la contraseña de Alice
  assert.equal(g.players.get(alice.id).status, 'hacked');
  assert.equal(g.players.get(alice.id).attackInterval, null);
  assert.equal(g.players.get(bob.id).hacks, 1);
  assert.equal(bob.last('init_state').totalHacks, 1);
  assert.ok(alice.received.some(e => e.name === 'attack_stopped'));
  const before = carol.received.filter(e => e.name === 'log').length;
  alice.send('start_attack', { targetId: carolInfo.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(3000);
  assert.equal(carol.received.filter(e => e.name === 'log').length, before);
  assert.equal(g.players.get(alice.id).attackInterval, null);
});

test('cooldown post-hack impide reiniciar, sobrevive a recarga y acaba al minuto', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const a = g.join(alice, 'Alice', 0);
  g.join(bob, 'Bob', 2);
  g.adminStart();
  bob.send('start_attack', { targetId: a.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(1000);
  const reviveAt = alice.last('game_over').reviveAt;
  assert.equal(reviveAt, g.clock.now + 60000);
  alice.send('restart_game');
  assert.equal(g.players.get(alice.id).status, 'hacked');
  alice.send('update_firewall', { action: 'deny', proto: 'TCP', port: '22', src: '10.12.0.1' });
  assert.equal(g.players.get(alice.id).firewall.length, 0);
  alice.disconnect();
  const aliceReloaded = g.io.connect();
  g.join(aliceReloaded, 'OtroNombre', 1, a.profileToken);
  assert.equal(g.players.get(aliceReloaded.id).status, 'hacked');
  assert.equal(g.players.get(aliceReloaded.id).username, 'Alice');
  g.advance(59999);
  aliceReloaded.send('restart_game');
  assert.equal(g.players.get(aliceReloaded.id).status, 'hacked');
  g.advance(1);
  aliceReloaded.send('restart_game');
  assert.equal(g.players.get(aliceReloaded.id).status, 'active');
  assert.ok(aliceReloaded.received.some(e => e.name === 'game_resumed'));
});

test('administración protegida, ranking ordenado y puntajes persistidos tras desconexión', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const carol = g.io.connect();
  const a = g.join(alice, 'Alice', 0);
  const b = g.join(bob, 'Bob', 0);
  g.join(carol, 'Carol', 33);
  g.adminStart();
  carol.send('start_attack', { targetId: a.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(1000);
  carol.send('start_attack', { targetId: b.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(1000);
  assert.equal(g.players.get(carol.id).hacks, 2);
  const admin = g.io.connect();
  admin.send('admin_login', { password: 'incorrecta' });
  assert.equal(admin.last('admin_authenticated'), undefined);
  // Debe ignorar la variable de entorno ADMIN_PASSWORD usada en setup().
  admin.send('admin_login', { password: 'clave-admin-de-prueba' });
  assert.equal(admin.last('admin_authenticated'), undefined);
  admin.send('admin_login', { password: 'Admin2026' });
  assert.ok(admin.received.some(ev => ev.name === 'admin_authenticated'));
  carol.disconnect();
  const ranking = admin.last('admin_state').ranking;
  assert.equal(ranking[0].username, 'Carol');
  assert.equal(ranking[0].totalHacks, 2);
  assert.equal(ranking[0].roundHacks, 2);
  assert.equal(ranking[0].online, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(g.dir, 'scores.json'))).length, 3);
  const restartedServer = setup(g.dir);
  assert.equal(restartedServer.adminState().ranking[0].totalHacks, 2);
});

test('rondas de 15 minutos terminan y solo el admin inicia la siguiente preservando totales', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const a = g.join(alice, 'Alice', 0);
  g.join(bob, 'Bob', 3);
  g.adminStart();
  bob.send('update_firewall', { action: 'deny', proto: 'UDP', port: '443', src: '10.12.0.1' });
  bob.send('start_attack', { targetId: a.id, targetPort: '80', targetProto: 'TCP' });
  g.advance(1000);
  assert.equal(g.players.get(bob.id).hacks, 1);
  g.advance(599000); // Se cumplen 10 minutos: aún deben quedar cinco.
  assert.equal(g.roundState().status, 'running');
  g.advance(300000); // Terminan los 15 minutos.
  assert.equal(g.roundState().status, 'finished');
  assert.equal(bob.last('round_state').number, 1);
  assert.equal(g.players.get(bob.id).firewall.length, 1); // Solo se resetea al iniciar otra ronda.
  assert.equal(g.adminState().results.winners[0], 'Bob');
  assert.equal(g.adminState().results.ranking[0].roundHacks, 1);
  const admin = g.io.connect();
  admin.send('admin_login', { password: 'Admin2026' });
  admin.send('admin_start_round');
  assert.equal(g.roundState().status, 'running');
  assert.equal(bob.last('init_state').hacks, 0);
  assert.equal(bob.last('init_state').totalHacks, 1);
  assert.equal(g.players.get(bob.id).firewall.length, 0);
  assert.equal(bob.last('round_state').number, 2);
  assert.equal(g.adminState().ranking.find(x => x.username === 'Bob').totalHacks, 1);
});


test('detener un ataque conserva el cooldown original de cinco segundos', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  g.join(alice, 'Alice', 17);
  const b = g.join(bob, 'Bob', 19);
  g.adminStart();
  alice.send('start_attack', { targetId: b.id, targetPort: '22', targetProto: 'TCP' });
  assert.ok(g.players.get(alice.id).attackInterval);
  alice.send('stop_attack');
  assert.equal(g.players.get(alice.id).attackInterval, null);
  const until = alice.last('cooldown_start').until;
  assert.equal(until, g.clock.now + 5000);
  alice.send('start_attack', { targetId: b.id, targetPort: '22', targetProto: 'TCP' });
  assert.equal(g.players.get(alice.id).attackInterval, null);
  g.advance(5000);
  alice.send('start_attack', { targetId: b.id, targetPort: '22', targetProto: 'TCP' });
  assert.ok(g.players.get(alice.id).attackInterval);
});

test('el cambio de ronda no salta el minuto de cooldown de un hackeo', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const a = g.join(alice, 'Alice', 0);
  g.join(bob, 'Bob', 3);
  g.adminStart();
  g.advance(898000);
  bob.send('start_attack', { targetId: a.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(1000); // hackeo un segundo antes de que acabe la primera ronda
  assert.equal(g.players.get(alice.id).status, 'hacked');
  g.advance(1500); // La ronda terminó, pero no comienza automáticamente otra.
  assert.equal(g.roundState().status, 'finished');
  assert.equal(g.players.get(alice.id).status, 'hacked');
  const admin = g.io.connect();
  admin.send('admin_login', { password: 'Admin2026' });
  admin.send('admin_start_round');
  assert.equal(g.players.get(alice.id).status, 'hacked');
  alice.send('restart_game');
  assert.equal(g.players.get(alice.id).status, 'hacked');
});


test('al entrar, todos esperan: ni reglas ni ataques, y jugador no puede iniciar ronda', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const a = g.join(alice, 'Alice', 0);
  const b = g.join(bob, 'Bob', 9);
  assert.equal(g.roundState().status, 'waiting');
  assert.equal(alice.last('round_state').endsAt, null);
  alice.send('update_firewall', { action: 'deny', proto: 'TCP', port: '22', src: '10.12.0.1' });
  alice.send('start_attack', { targetId: b.id, targetPort: '22', targetProto: 'TCP' });
  alice.send('admin_start_round');
  alice.send('restart_game');
  assert.equal(g.players.get(alice.id).firewall.length, 0);
  assert.equal(g.players.get(alice.id).attackInterval, null);
  assert.equal(g.roundState().status, 'waiting');
  assert.match(alice.last('admin_error'), /autorización/);
  g.advance(11 * 60 * 1000);
  assert.equal(g.roundState().status, 'waiting');
  assert.equal(g.players.get(a.id).hacks, 0);
});

test('start de admin se comunica a todos y está prohibido iniciarlo dos veces durante la partida', () => {
  const g = setup();
  const alice = g.io.connect();
  g.join(alice, 'Alice', 3);
  const admin = g.adminStart();
  const time = g.roundState().endsAt;
  assert.equal(g.roundState().status, 'running');
  assert.equal(time - g.roundState().startedAt, 900000);
  assert.equal(alice.last('round_started').number, 1);
  admin.send('admin_start_round');
  assert.equal(g.roundState().endsAt, time);
  assert.match(admin.last('admin_error'), /en curso/);
  const late = g.io.connect();
  g.join(late, 'Nuevo', 10);
  assert.equal(late.last('round_state').status, 'running');
  assert.equal(late.last('round_state').endsAt, time);
});

test('fin de ronda apaga ataques, congela puntos, muestra ganador y participantes desconectados', () => {
  const g = setup();
  const alice = g.io.connect();
  const bob = g.io.connect();
  const carol = g.io.connect();
  const a = g.join(alice, 'Alice', 0);
  g.join(bob, 'Bob', 5);
  g.join(carol, 'Carol', 3);
  g.adminStart();
  bob.send('start_attack', { targetId: a.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(1000);
  assert.equal(g.players.get(bob.id).hacks, 1);
  carol.disconnect();
  bob.send('start_attack', { targetId: a.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(599000); // Se cumplen 10 minutos: aún deben quedar cinco.
  assert.equal(g.roundState().status, 'running');
  g.advance(300000); // Terminan los 15 minutos.
  assert.equal(g.roundState().status, 'finished');
  const results = g.adminState().results;
  assert.equal(results.winners[0], 'Bob');
  assert.equal(results.ranking.length, 3);
  assert.equal(results.ranking[0].username, 'Bob');
  assert.equal(results.ranking[0].roundHacks, 1);
  assert.ok(results.ranking.some(p => p.username === 'Carol'));
  assert.equal(g.players.get(bob.id).attackInterval, null);
  const score = g.players.get(bob.id).hacks;
  bob.send('update_firewall', { action: 'deny', proto: 'TCP', port: '22', src: '10.12.0.1' });
  assert.equal(g.players.get(bob.id).firewall.length, 0);
  bob.send('start_attack', { targetId: a.id, targetPort: '22', targetProto: 'TCP' });
  g.advance(10000);
  assert.equal(g.players.get(bob.id).hacks, score);
  assert.equal(g.roundState().status, 'finished');
  assert.equal(bob.last('round_finished').number, 1);
});

test('terminar una ronda sin hackeos informa que no hay ganador', () => {
  const g = setup();
  g.join(g.io.connect(), 'Alice', 5);
  g.adminStart();
  g.advance(900000);
  assert.equal(g.adminState().results.topScore, 0);
  assert.equal(g.adminState().results.winners.length, 0);
});

test('las pantallas incluyen espera, START!, control admin y tabla final', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  for (const text of ['id="round-hold-screen"', 'id="round-start-screen"', 'START!', "socket.on('round_started'", "socket.on('round_finished'"]) assert.ok(index.includes(text), text);
  for (const text of ['id="start-round-btn"', "socket.emit('admin_start_round')", 'id="results-panel"', 'id="results-body"', 'GANADOR:']) assert.ok(admin.includes(text), text);
});
