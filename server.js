'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'Admin2026'; // Contraseña fija solicitada para el panel de administración.
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, 'data', 'scores.json');
const ROUND_MS = 15 * 60 * 1000;
const REVIVE_MS = 60 * 1000;
const STOP_ATTACK_MS = 5 * 1000;
const ATTACK_TICK_MS = 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Los perfiles identificados por token preservan su puntuación y cooldown al reconectarse.
// Un perfil es distinto de un jugador conectado a través de Socket.IO.
const profiles = new Map();
const players = new Map();
// Las rondas no arrancan por sí solas: únicamente el administrador las inicia.
let roundNumber = 1;
let roundStatus = 'waiting'; // waiting | running | finished
let roundStartedAt = null;
let roundEndsAt = null;
let lastRoundResults = null;
let roundParticipants = new Set();

function loadProfiles() {
  if (!fs.existsSync(SCORES_FILE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('El archivo de puntuaciones no es una lista');
    for (const entry of saved) {
      if (!entry || typeof entry.token !== 'string' || !/^[a-f0-9]{64}$/.test(entry.token)) continue;
      profiles.set(entry.token, {
        token: entry.token,
        username: String(entry.username || 'Jugador').slice(0, 15),
        totalHacks: Number.isSafeInteger(entry.totalHacks) && entry.totalHacks >= 0 ? entry.totalHacks : 0,
        roundHacks: 0,
        reviveAt: Number.isFinite(entry.reviveAt) && entry.reviveAt > 0 ? entry.reviveAt : 0,
        socketId: null
      });
    }
  } catch (err) {
    console.error('No se pudo leer SCORES_FILE:', err.message);
  }
}

function saveProfiles() {
  try {
    fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
    const serializable = [...profiles.values()].map(p => ({
      token: p.token, username: p.username, totalHacks: p.totalHacks, reviveAt: p.reviveAt
    }));
    const tmp = `${SCORES_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(serializable, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SCORES_FILE);
  } catch (err) {
    console.error('No se pudieron guardar los puntajes:', err.message);
  }
}

loadProfiles();

function generateIP() {
  let ip;
  do {
    ip = `10.12.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  } while ([...players.values()].some(player => player.ip === ip));
  return ip;
}

function playerState(player) {
  return {
    id: player.id,
    username: player.username,
    password: player.password,
    ip: player.ip,
    hacks: player.hacks,
    totalHacks: player.profile.totalHacks,
    status: player.status,
    firewall: player.firewall,
    reviveAt: player.reviveAt,
    attackCooldownUntil: player.attackCooldownUntil,
    profileToken: player.profile.token
  };
}

function publicPlayers() {
  return [...players.values()].map(p => ({
    id: p.id, username: p.username, ip: p.ip, hacks: p.hacks, status: p.status
  }));
}

function roundState() {
  return { number: roundNumber, status: roundStatus, startedAt: roundStartedAt,
    endsAt: roundEndsAt, durationMs: ROUND_MS, serverNow: Date.now() };
}

function isRoundActive() {
  return roundStatus === 'running' && Date.now() < roundEndsAt;
}

function getRoundRanking() {
  return [...roundParticipants].map(token => {
    const p = profiles.get(token);
    if (!p) return null;
    return { username: p.username, roundHacks: p.roundHacks, totalHacks: p.totalHacks };
  }).filter(Boolean).sort((a, b) =>
    b.roundHacks - a.roundHacks || b.totalHacks - a.totalHacks || a.username.localeCompare(b.username, 'es'));
}

function adminState() {
  const ranking = [...profiles.values()].map(p => {
    const active = p.socketId ? players.get(p.socketId) : null;
    return {
      username: p.username,
      totalHacks: p.totalHacks,
      roundHacks: p.roundHacks,
      online: Boolean(active),
      status: active?.status || 'offline'
    };
  });
  ranking.sort((a, b) => b.totalHacks - a.totalHacks || b.roundHacks - a.roundHacks || a.username.localeCompare(b.username, 'es'));
  return { ranking, onlineCount: players.size, round: roundState(), results: lastRoundResults };
}

function broadcastPlayers() {
  io.emit('update_player_list', publicPlayers());
  io.to('admins').emit('admin_state', adminState());
}

function stopAttack(player, notify = true) {
  if (!player?.attackInterval) return false;
  clearInterval(player.attackInterval);
  player.attackInterval = null;
  if (notify) io.to(player.id).emit('attack_stopped');
  return true;
}

function gameOver(victim) {
  if (!victim || victim.status !== 'active') return;
  // Imprescindible cancelar también TODOS los ataques que inició la víctima.
  stopAttack(victim);
  victim.status = 'hacked';
  victim.reviveAt = Date.now() + REVIVE_MS;
  victim.profile.reviveAt = victim.reviveAt;
  victim.attackCooldownUntil = 0;
  saveProfiles();
  io.to(victim.id).emit('game_over', { reviveAt: victim.reviveAt });
  broadcastPlayers();
}

function startNewRound() {
  // La llamada sólo se realiza desde el manejador autorizado del administrador.
  if (roundStatus === 'running') return false;
  if (roundStatus === 'finished') roundNumber += 1;
  roundStatus = 'running';
  roundStartedAt = Date.now();
  roundEndsAt = roundStartedAt + ROUND_MS;
  lastRoundResults = null;
  roundParticipants = new Set([...players.values()].map(p => p.profile.token));

  for (const profile of profiles.values()) profile.roundHacks = 0;
  for (const player of players.values()) {
    stopAttack(player);
    player.hacks = 0;
    player.firewall = [];
    player.attackCooldownUntil = 0;
    player.ip = generateIP();
    // El comienzo de otra ronda no permite eludir el cooldown tras un hackeo.
    player.status = player.reviveAt > Date.now() ? 'hacked' : 'active';
    if (player.status === 'active') {
      player.reviveAt = 0;
      player.profile.reviveAt = 0;
    }
    io.to(player.id).emit('init_state', playerState(player));
    if (player.status === 'hacked') io.to(player.id).emit('game_over', { reviveAt: player.reviveAt });
    io.to(player.id).emit('log', `[RONDA] Comenzó la ronda ${roundNumber}.`);
  }
  saveProfiles();
  io.emit('round_state', roundState());
  io.emit('round_started', { number: roundNumber });
  broadcastPlayers();
  return true;
}

function finishRound() {
  if (roundStatus !== 'running' || Date.now() < roundEndsAt) return false;
  roundStatus = 'finished';
  for (const player of players.values()) stopAttack(player);
  const ranking = getRoundRanking();
  const topScore = ranking.length ? ranking[0].roundHacks : 0;
  const winners = topScore > 0 ? ranking.filter(p => p.roundHacks === topScore).map(p => p.username) : [];
  lastRoundResults = { number: roundNumber, finishedAt: Date.now(), ranking, winners, topScore };
  io.emit('round_state', roundState());
  io.emit('round_finished', { number: roundNumber });
  io.emit('log', `[RONDA] Terminó la ronda ${roundNumber}. Esperando al administrador.`);
  broadcastPlayers();
  return true;
}

// Sólo concluye la ronda; nunca inicia automáticamente la siguiente.
setInterval(() => { if (roundStatus === 'running') finishRound(); }, 250);

function isValidRule(rule) {
  return rule && typeof rule === 'object' &&
    ['deny', 'allow'].includes(rule.action) &&
    ['TCP', 'UDP'].includes(rule.proto) &&
    typeof rule.src === 'string' &&
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(rule.src) &&
    rule.src.split('.').every(part => Number(part) <= 255) &&
    /^(?:[1-9]\d{0,4})$/.test(String(rule.port)) &&
    Number(rule.port) <= 65535;
}

function safePassword(candidate) {
  const raw = String(candidate);
  if (!/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

function samePassword(input) {
  const a = Buffer.from(String(input));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

io.on('connection', socket => {
  socket.emit('round_state', roundState());
  let failedAdminLogins = 0;

  socket.on('admin_login', payload => {
    if (failedAdminLogins >= 5) {
      socket.emit('admin_error', 'Demasiados intentos. Vuelve a conectar más tarde.');
      return;
    }
    if (!payload || typeof payload.password !== 'string' || !samePassword(payload.password)) {
      failedAdminLogins++;
      socket.emit('admin_error', 'Contraseña incorrecta.');
      return;
    }
    socket.join('admins');
    socket.emit('admin_authenticated');
    socket.emit('admin_state', adminState());
  });

  socket.on('admin_start_round', () => {
    if (!socket.rooms.has('admins')) {
      socket.emit('admin_error', 'No tienes autorización para iniciar la ronda.');
      return;
    }
    if (!startNewRound()) socket.emit('admin_error', 'Ya hay una ronda en curso.');
  });

  socket.on('join_game', payload => {
    if (players.has(socket.id)) {
      socket.emit('join_error', 'Ya estás jugando.');
      return;
    }
    const username = typeof payload?.username === 'string' ? payload.username.trim().slice(0, 15) : '';
    const password = safePassword(payload?.password);
    if (!username || password === null) {
      socket.emit('join_error', 'Indica un usuario y una contraseña numérica de 0 a 99.');
      return;
    }

    let profile = typeof payload.profileToken === 'string' ? profiles.get(payload.profileToken) : null;
    if (profile) {
      // Una identidad solo puede tener una conexión activa a la vez.
      if (profile.socketId && profile.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(profile.socketId);
        if (oldSocket) oldSocket.disconnect(true);
      }
    } else {
      const token = crypto.randomBytes(32).toString('hex');
      profile = { token, username, totalHacks: 0, roundHacks: 0, reviveAt: 0, socketId: null };
      profiles.set(token, profile);
      saveProfiles();
    }

    const player = {
      id: socket.id,
      profile,
      username: profile.username,
      password,
      ip: generateIP(),
      hacks: profile.roundHacks,
      status: profile.reviveAt > Date.now() ? 'hacked' : 'active',
      firewall: [],
      reviveAt: profile.reviveAt > Date.now() ? profile.reviveAt : 0,
      attackCooldownUntil: 0,
      attackInterval: null
    };
    if (player.status === 'active') profile.reviveAt = 0;
    profile.socketId = socket.id;
    players.set(socket.id, player);
    if (roundStatus !== 'finished') roundParticipants.add(profile.token);
    socket.emit('init_state', playerState(player));
    socket.emit('round_state', roundState());
    if (player.status === 'hacked') socket.emit('game_over', { reviveAt: player.reviveAt });
    broadcastPlayers();
  });

  socket.on('restart_game', () => {
    const player = players.get(socket.id);
    if (!player || player.status !== 'hacked' || !isRoundActive()) return;
    if (Date.now() < player.reviveAt) {
      socket.emit('game_over', { reviveAt: player.reviveAt });
      return;
    }
    player.status = 'active';
    player.reviveAt = 0;
    player.profile.reviveAt = 0;
    player.ip = generateIP();
    player.firewall = [];
    player.attackCooldownUntil = 0;
    saveProfiles();
    socket.emit('game_resumed');
    socket.emit('init_state', playerState(player));
    socket.emit('log', '[SYS] Equipo restaurado. Ya puedes volver a jugar.');
    broadcastPlayers();
  });

  socket.on('update_firewall', rule => {
    const player = players.get(socket.id);
    if (!player || player.status !== 'active' || !isRoundActive()) return;
    if (!isValidRule(rule)) {
      socket.emit('log', '[ERR] Regla inválida: verifica IP, protocolo y puerto (1-65535).');
      return;
    }
    const validRule = {
      action: rule.action,
      src: rule.src,
      proto: rule.proto,
      port: String(Number(rule.port))
    };
    // Sin límite de tres reglas. No eliminamos las reglas anteriores.
    player.firewall.push(validRule);
    socket.emit('firewall_updated', player.firewall);
    socket.emit('log', `[SYS] Regla: ${validRule.action.toUpperCase()} ${validRule.proto}/${validRule.port} origen ${validRule.src}`);
  });

  socket.on('start_attack', params => {
    const attacker = players.get(socket.id);
    if (!attacker || attacker.status !== 'active' || !isRoundActive()) return;
    const victim = players.get(params?.targetId);
    const targetPort = String(params?.targetPort);
    const targetProto = params?.targetProto;
    if (!victim || victim.status !== 'active' || victim.id === attacker.id ||
        !/^[1-9]\d{0,4}$/.test(targetPort) || Number(targetPort) > 65535 ||
        !['TCP', 'UDP'].includes(targetProto)) {
      socket.emit('attack_stopped');
      socket.emit('log', '[ERR] Objetivo o parámetros de ataque inválidos.');
      return;
    }
    if (attacker.attackCooldownUntil > Date.now()) {
      socket.emit('cooldown_start', { until: attacker.attackCooldownUntil });
      socket.emit('attack_stopped');
      return;
    }
    stopAttack(attacker, false);
    socket.emit('attack_started');
    socket.emit('log', `[ATK] Iniciando ataque a ${victim.ip}:${targetPort} (${targetProto})...`);

    attacker.attackInterval = setInterval(() => {
      // Si el atacante fue hackeado, NO puede seguir atacando ni sumar puntos.
      if (!isRoundActive() || attacker.status !== 'active' || victim.status !== 'active' ||
          players.get(socket.id) !== attacker || players.get(victim.id) !== victim) {
        stopAttack(attacker);
        return;
      }
      const guess = Math.floor(Math.random() * 100);
      // Primera regla coincidente tiene prioridad (ALLOW/DENY).
      const matchingRule = victim.firewall.find(r =>
        (r.port === '*' || r.port === targetPort) &&
        (r.src === '*' || r.src === attacker.ip) &&
        r.proto === targetProto
      );
      if (matchingRule?.action === 'deny') {
        io.to(victim.id).emit('log', `[FW] BLOQUEADO: Intento (${targetProto}) desde ${attacker.ip}:${targetPort}`);
        socket.emit('log', `[ERR] BLOQUEADO por host remoto (${victim.ip}:${targetPort})`);
        return;
      }

      io.to(victim.id).emit('log', `[WARN] Login fallido: Pass ${guess} desde ${attacker.ip}:${targetPort} (${targetProto})`);
      if (guess === victim.password) {
        stopAttack(attacker);
        attacker.hacks += 1;
        attacker.profile.roundHacks += 1;
        attacker.profile.totalHacks += 1;
        saveProfiles();
        socket.emit('hack_result', { success: true, msg: `¡PASSWORD ${guess} ENCONTRADO!` });
        socket.emit('init_state', playerState(attacker));
        gameOver(victim);
      }
    }, ATTACK_TICK_MS);
  });

  socket.on('stop_attack', () => {
    const player = players.get(socket.id);
    if (!player || player.status !== 'active' || !isRoundActive()) return;
    if (stopAttack(player)) {
      player.attackCooldownUntil = Date.now() + STOP_ATTACK_MS;
      socket.emit('log', '[SYS] Ataque detenido. Espera 5 segundos para atacar otra vez.');
      socket.emit('cooldown_start', { until: player.attackCooldownUntil });
    }
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (!player) return;
    stopAttack(player, false);
    if (player.profile.socketId === socket.id) player.profile.socketId = null;
    players.delete(socket.id);
    broadcastPlayers();
  });
});

// Exportar el servidor permite pruebas automatizadas sin alterar el juego.
if (require.main === module) {
  server.listen(PORT, () => console.log(`Firewalls en http://localhost:${PORT} (rondas de 15 minutos iniciadas por administrador)`));
}
module.exports = { app, server, io, profiles, players, startNewRound, finishRound, adminState, roundState };
