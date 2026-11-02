'use strict';

// Esta práctica comparte el HTML y las funciones de la partida real.
// No inicia una conexión Socket.IO, no envía eventos y no altera puntuaciones.
const tutorialBot = Object.freeze({
  id: 'bot-practica', username: 'BOT ESPECTRO', ip: '10.12.0.200',
  status: 'active', attackProto: 'TCP', attackPort: '22',
  vulnerableProto: 'TCP', vulnerablePort: '80', password: 42
});
const tutorialState = {
  botAlive: false, botTimer: null, attackTimer: null,
  rules: [], botAttempts: 0, attackAttempts: 0
};

function tutorialRenderBot() {
  const list = $('player-list');
  list.replaceChildren();
  const item = document.createElement('div');
  item.className = `player-item ${tutorialState.botAlive ? '' : 'hacked'}`;
  item.textContent = `${tutorialBot.ip} (${tutorialBot.username})`;
  item.onclick = () => selectTarget({ ...tutorialBot, status: tutorialState.botAlive ? 'active' : 'hacked' });
  list.appendChild(item);
}

function tutorialBotAttack() {
  if (!tutorialMode || !tutorialState.botAlive) return;
  tutorialState.botAttempts++;
  // Primera regla coincidente prevalece, igual que en el servidor real.
  const match = tutorialState.rules.find(rule =>
    rule.src === tutorialBot.ip &&
    rule.proto === tutorialBot.attackProto &&
    rule.port === tutorialBot.attackPort
  );
  if (match?.action === 'deny') {
    addLog(`[FW] BLOQUEADO: Intento (${tutorialBot.attackProto}) desde ${tutorialBot.ip}:${tutorialBot.attackPort}`);
  } else {
    // La contraseña del alumno nunca se prueba: el bot jamás puede hackearlo.
    const candidate = (tutorialState.botAttempts * 17 + 11) % 100;
    const guess = candidate === 42 ? 43 : candidate;
    addLog(`[WARN] Login fallido: Pass ${guess} desde ${tutorialBot.ip}:${tutorialBot.attackPort} (${tutorialBot.attackProto})`);
  }
}

function tutorialAddRule(rule) {
  if (!tutorialMode) return;
  const validRule = { action: rule.action, src: rule.src, proto: rule.proto, port: String(Number(rule.port)) };
  tutorialState.rules.push(validRule);
  renderRules(tutorialState.rules);
  addLog(`[SYS] Regla: ${validRule.action.toUpperCase()} ${validRule.proto}/${validRule.port} origen ${validRule.src}`);
}

function tutorialStopAttack(manual = false) {
  if (tutorialState.attackTimer !== null) {
    clearInterval(tutorialState.attackTimer);
    tutorialState.attackTimer = null;
  }
  if (isAttacking) {
    setAttacking(false);
    if (manual) {
      attackCooldownUntil = Date.now() + 5000;
      addLog('[SYS] Ataque detenido. Espera 5 segundos para atacar otra vez.');
      renderControls();
    }
  }
}

function tutorialAttackTick(proto, port) {
  if (!tutorialMode || !tutorialState.botAlive) return tutorialStopAttack();
  tutorialState.attackAttempts++;
  const guess = (tutorialState.attackAttempts * 19 + 4) % 100;
  if (proto === tutorialBot.vulnerableProto && port === tutorialBot.vulnerablePort && tutorialState.attackAttempts >= 3) {
    tutorialStopAttack();
    tutorialState.botAlive = false;
    if (tutorialState.botTimer !== null) {
      clearInterval(tutorialState.botTimer);
      tutorialState.botTimer = null;
    }
    addLog(`[OK] ¡PASSWORD ${tutorialBot.password} ENCONTRADO!`);
    $('my-hacks').textContent = '1';
    $('my-total').textContent = '1';
    tutorialRenderBot();
    renderControls();
    return;
  }
  addLog(`[ATK] Probando Pass ${guess} en ${tutorialBot.ip}:${port} (${proto})...`);
}

function tutorialToggleAttack() {
  if (!tutorialMode) return;
  if (isAttacking) { tutorialStopAttack(true); return; }
  if (!tutorialState.botAlive || attackCooldownUntil > Date.now()) return;
  if ($('atk-id').value !== tutorialBot.id) return;
  const proto = $('atk-proto').value;
  const port = $('atk-port').value;
  tutorialState.attackAttempts = 0;
  setAttacking(true);
  addLog(`[ATK] Iniciando ataque a ${tutorialBot.ip}:${port} (${proto})...`);
  tutorialState.attackTimer = setInterval(() => tutorialAttackTick(proto, port), 1100);
}

function openTutorial() {
  if (tutorialMode || myId) return;
  tutorialMode = true;
  tutorialState.rules = [];
  tutorialState.botAlive = true;
  tutorialState.botAttempts = 0;
  tutorialState.attackAttempts = 0;
  myId = 'alumno-practica';
  myStatus = 'active';
  reviveAt = 0;
  attackCooldownUntil = 0;
  roundStatus = 'running';
  currentRound = 1;
  roundEndsAt = Infinity;
  $('login-screen').style.display = 'none';
  $('tutorial-launch').style.display = 'none';
  $('admin-link').textContent = 'SALIR DEL TUTORIAL';
  $('my-user').textContent = 'AGENTE NÉBULA';
  $('my-ip').textContent = '10.12.0.10';
  $('my-pass').textContent = '42';
  $('my-hacks').textContent = '0';
  $('my-total').textContent = '0';
  $('round-number').textContent = '1';
  $('atk-ip').value = '';
  $('atk-id').value = '';
  $('atk-proto').value = 'TCP';
  $('atk-port').value = '22';
  $('fw-action').value = 'deny';
  $('fw-src').value = '';
  $('fw-proto').value = 'TCP';
  $('fw-port').value = '';
  $('console-inner').replaceChildren();
  renderRules([]);
  tutorialRenderBot();
  setAttacking(false);
  tick();
  addLog('[SYS] Sistema online. IP: 10.12.0.10');
  tutorialState.botTimer = setInterval(tutorialBotAttack, 1450);
}

function closeTutorial() {
  if (!tutorialMode) return;
  tutorialStopAttack();
  if (tutorialState.botTimer !== null) {
    clearInterval(tutorialState.botTimer);
    tutorialState.botTimer = null;
  }
  tutorialState.botAlive = false;
  tutorialState.rules = [];
  tutorialMode = false;
  myId = null;
  myStatus = 'active';
  currentRound = null;
  roundStatus = 'waiting';
  roundEndsAt = 0;
  attackCooldownUntil = 0;
  $('login-screen').style.display = 'flex';
  $('tutorial-launch').style.display = 'block';
  $('admin-link').textContent = 'Panel de administrador';
  $('player-list').replaceChildren();
  $('console-inner').replaceChildren();
  renderRules([]);
  setAttacking(false);
  tick();
}

$('tutorial-launch').addEventListener('click', openTutorial);
$('admin-link').addEventListener('click', event => {
  if (tutorialMode) {
    event.preventDefault();
    closeTutorial();
  }
});
