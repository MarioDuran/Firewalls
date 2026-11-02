'use strict';

// Simulación local: NO se envía ningún evento Socket.IO al servidor.
// Sus intentos no hackean al estudiante y su eliminación no suma puntos reales.
const practiceBot = Object.freeze({ name: 'BOT ESPECTRO', ip: '10.12.0.200', proto: 'TCP', attackPort: '22', vulnerablePort: '80' });
const tutorial = {
  visible: false,
  phase: 'observe', // observe, block, check-block, attack, attacking, complete
  attempts: 0,
  attackAttempts: 0,
  targetSelected: false,
  timer: null
};

function tutorialLog(message, kind = '') {
  const log = document.createElement('div');
  log.className = `tutorial-log-entry ${kind}`;
  log.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  const container = document.getElementById('tutorial-logs');
  container.appendChild(log);
  container.scrollTop = container.scrollHeight;
  if (container.childElementCount > 120) container.firstElementChild.remove();
}

function tutorialPhase(phase) {
  tutorial.phase = phase;
  const step = phase === 'observe' ? 0 : phase === 'block' || phase === 'check-block' ? 1 : 2;
  for (const [index, name] of ['observe', 'block', 'attack'].entries()) {
    const el = document.getElementById(`tutorial-step-${name}`);
    el.classList.toggle('current', index === step && phase !== 'complete');
    el.classList.toggle('done', index < step || phase === 'complete');
  }
  const messages = {
    observe: 'PASO 1: El bot está intentando acceder a tu equipo. Observa los intentos fallidos en los registros. Nunca logrará hackearte en el tutorial.',
    block: 'PASO 2: Defiéndete creando una regla DENY que bloquee la IP 10.12.0.200, con protocolo TCP y puerto 22.',
    'check-block': 'Regla instalada. Espera al siguiente intento del bot y comprueba que el firewall lo BLOQUEA.',
    attack: 'PASO 3: ¡Ya te defendiste! Selecciona el bot en el scanner, elige TCP/80 (HTTP) y pulsa INICIAR ATAQUE AL BOT.',
    attacking: 'Tu ataque está en marcha. Observa las pruebas de contraseña hasta comprometer al bot.',
    complete: '¡Excelente! Bloqueaste el ataque y eliminaste al bot. Terminaste la práctica.'
  };
  document.getElementById('tutorial-instructions').textContent = messages[phase];
  const canDefend = phase === 'block';
  document.getElementById('tutorial-add-rule').disabled = !canDefend;
  const canAttack = phase === 'attack';
  document.getElementById('tutorial-target').disabled = !canAttack;
  document.getElementById('tutorial-atk-proto').disabled = !canAttack;
  document.getElementById('tutorial-atk-port').disabled = !canAttack;
  document.getElementById('tutorial-attack').disabled = !canAttack || !tutorial.targetSelected;
  document.getElementById('tutorial-success').style.display = phase === 'complete' ? 'block' : 'none';
  if (phase === 'complete') {
    const botButton = document.getElementById('tutorial-target');
    botButton.classList.remove('selected');
    botButton.classList.add('eliminated');
    botButton.textContent = 'BOT ESPECTRO · ELIMINADO · 10.12.0.200';
  }
}

function tutorialTick() {
  if (!tutorial.visible) return;
  if (tutorial.phase === 'observe' || tutorial.phase === 'block') {
    tutorial.attempts++;
    const guess = (19 + tutorial.attempts * 13) % 100;
    tutorialLog(`[WARN] Acceso fallido de ${practiceBot.name}: Pass ${guess} desde ${practiceBot.ip}:${practiceBot.attackPort} (${practiceBot.proto}).`, 'failed');
    if (tutorial.phase === 'observe' && tutorial.attempts >= 2) {
      tutorialLog('[SYS] Ambos intentos fueron fallidos. Ahora configura el firewall para detenerlos.');
      tutorialPhase('block');
    }
  } else if (tutorial.phase === 'check-block') {
    tutorialLog(`[FW] BLOQUEADO: Intento (${practiceBot.proto}) desde ${practiceBot.ip}:${practiceBot.attackPort}.`, 'blocked');
    tutorialLog('[OK] Tu regla DENY detuvo el tráfico. Ya puedes atacar al bot.', 'success');
    tutorialPhase('attack');
  } else if (tutorial.phase === 'attacking') {
    tutorial.attackAttempts++;
    if (tutorial.attackAttempts < 3) {
      const guess = tutorial.attackAttempts === 1 ? '08' : '31';
      tutorialLog(`[ATK] Probando contraseña ${guess} en ${practiceBot.ip}:${practiceBot.vulnerablePort}... Incorrecta.`);
    } else {
      tutorialLog(`[OK] ¡PASSWORD 42 ENCONTRADO! Acceso a ${practiceBot.ip}:${practiceBot.vulnerablePort}.`, 'success');
      tutorialLog('[OK] BOT ELIMINADO. Tutorial completado.', 'success');
      tutorialPhase('complete');
      if (tutorial.timer !== null) { clearInterval(tutorial.timer); tutorial.timer = null; }
      document.getElementById('tutorial-repeat').focus();
    }
  }
}

function resetTutorial() {
  if (tutorial.timer !== null) { clearInterval(tutorial.timer); tutorial.timer = null; }
  tutorial.attempts = 0;
  tutorial.attackAttempts = 0;
  tutorial.targetSelected = false;
  const byId = id => document.getElementById(id);
  byId('tutorial-logs').replaceChildren();
  byId('tutorial-fw-action').value = 'deny';
  byId('tutorial-fw-ip').value = '';
  byId('tutorial-fw-proto').value = 'TCP';
  byId('tutorial-fw-port').value = '';
  byId('tutorial-fw-feedback').textContent = '';
  byId('tutorial-rule-list').textContent = 'Sin reglas de práctica.';
  byId('tutorial-rule-count').textContent = '0';
  byId('tutorial-target-ip').value = '';
  byId('tutorial-atk-proto').value = 'TCP';
  byId('tutorial-atk-port').value = '22';
  byId('tutorial-atk-feedback').textContent = '';
  byId('tutorial-target').textContent = `${practiceBot.name} · ${practiceBot.ip}`;
  byId('tutorial-target').classList.remove('selected', 'eliminated');
  tutorialPhase('observe');
  tutorialLog('[SYS] Tutorial iniciado. Tu equipo no puede ser hackeado por el bot.');
  tutorialLog(`[ATK] ${practiceBot.name} (${practiceBot.ip}) está atacando al AGENTE NÉBULA por TCP/22.`);
  tutorial.timer = setInterval(tutorialTick, 1450);
}

function openTutorial() {
  // Disponible desde el login, sin registrar usuario ni enviar eventos al servidor.
  if (tutorial.visible) return;
  tutorial.visible = true;
  document.getElementById('tutorial-screen').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  resetTutorial();
  document.getElementById('tutorial-close').focus();
}

function closeTutorial() {
  if (tutorial.timer !== null) { clearInterval(tutorial.timer); tutorial.timer = null; }
  if (!tutorial.visible) return;
  tutorial.visible = false;
  document.getElementById('tutorial-screen').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('tutorial-launch').focus();
}

function tutorialAddRule() {
  if (tutorial.phase !== 'block') return;
  const byId = id => document.getElementById(id);
  const action = byId('tutorial-fw-action').value;
  const ip = byId('tutorial-fw-ip').value.trim();
  const proto = byId('tutorial-fw-proto').value;
  const port = byId('tutorial-fw-port').value.trim();
  if (action !== 'deny' || ip !== practiceBot.ip || proto !== practiceBot.proto || port !== practiceBot.attackPort) {
    byId('tutorial-fw-feedback').textContent = 'La regla no corresponde al ataque: selecciona DENY y revisa IP origen, protocolo y puerto en los registros.';
    tutorialLog('[ERR] La regla no bloquea el tráfico TCP/22 del bot. Inténtalo otra vez.', 'failed');
    return;
  }
  byId('tutorial-rule-list').textContent = `1. DENY ${proto}/${port} DESDE ${ip}`;
  byId('tutorial-rule-count').textContent = '1';
  byId('tutorial-fw-feedback').textContent = '¡Regla agregada! Esperando el próximo intento para comprobar el bloqueo.';
  tutorialLog(`[SYS] Regla instalada: DENY ${proto}/${port} desde ${ip}.`, 'success');
  tutorialPhase('check-block');
}

function tutorialSelectTarget() {
  if (tutorial.phase !== 'attack') return;
  tutorial.targetSelected = true;
  document.getElementById('tutorial-target-ip').value = practiceBot.ip;
  document.getElementById('tutorial-target').classList.add('selected');
  document.getElementById('tutorial-atk-feedback').textContent = 'Objetivo seleccionado. Escoge TCP/80 y comienza el ataque.';
  tutorialPhase('attack');
}

function tutorialStartAttack() {
  if (tutorial.phase !== 'attack' || !tutorial.targetSelected) return;
  const proto = document.getElementById('tutorial-atk-proto').value;
  const port = document.getElementById('tutorial-atk-port').value;
  if (proto !== practiceBot.proto || port !== practiceBot.vulnerablePort) {
    document.getElementById('tutorial-atk-feedback').textContent = 'Ese servicio no es vulnerable. Prueba el protocolo TCP y el puerto 80 (HTTP).';
    tutorialLog(`[ERR] Sin respuesta vulnerable en ${practiceBot.ip}:${port} (${proto}).`, 'failed');
    return;
  }
  document.getElementById('tutorial-atk-feedback').textContent = 'Ataque en curso. Observa los registros.';
  tutorialLog(`[ATK] Iniciando ataque a ${practiceBot.ip}:${port} (${proto})...`);
  tutorialPhase('attacking');
}

document.getElementById('tutorial-launch').addEventListener('click', openTutorial);
document.getElementById('tutorial-close').addEventListener('click', closeTutorial);
document.getElementById('tutorial-repeat').addEventListener('click', resetTutorial);
document.getElementById('tutorial-add-rule').addEventListener('click', tutorialAddRule);
document.getElementById('tutorial-target').addEventListener('click', tutorialSelectTarget);
document.getElementById('tutorial-attack').addEventListener('click', tutorialStartAttack);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && tutorial.visible) closeTutorial();
});
