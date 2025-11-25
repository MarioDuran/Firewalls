const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let players = {}; 

const generateIP = () => `10.12.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

io.on('connection', (socket) => {
  console.log('Nuevo socket:', socket.id);

  socket.on('join_game', ({ username, password }) => {
    if(players[socket.id]) delete players[socket.id];
    
    let safePass = parseInt(password);
    if (isNaN(safePass) || safePass < 0 || safePass > 99) safePass = 0;

    players[socket.id] = {
      id: socket.id,
      username: username.substring(0, 15),
      password: safePass,
      ip: generateIP(),
      hacks: 0,
      status: 'active',
      firewall: [],
      cooldownUntil: 0 
    };

    socket.emit('init_state', players[socket.id]);
    io.emit('update_player_list', getPublicPlayerList());
  });

  socket.on('update_firewall', (rule) => {
    const player = players[socket.id];
    if (!player || player.status !== 'active') return;

    if (player.firewall.length >= 3) player.firewall.shift(); 
    player.firewall.push(rule);
    
    socket.emit('firewall_updated', player.firewall);
    socket.emit('log', `[SYS] Regla: ${rule.action.toUpperCase()} ${rule.proto}/${rule.port} origen ${rule.src}`);
  });

  socket.on('start_attack', ({ targetId, targetPort, targetProto }) => {
    const attacker = players[socket.id];
    const victim = players[targetId];

    if (!attacker || !victim || attacker.status !== 'active') return;

    const now = Date.now();
    if (attacker.cooldownUntil > now) {
      const remaining = Math.ceil((attacker.cooldownUntil - now) / 1000);
      socket.emit('log', `[ERR] Cooldown activo. Espera ${remaining}s.`);
      return;
    }

    if (attacker.id === victim.id) return;

    socket.emit('log', `[ATK] Iniciando ataque a ${victim.ip}:${targetPort} (${targetProto})...`);

    if (attacker.attackInterval) clearInterval(attacker.attackInterval);

    attacker.attackInterval = setInterval(() => {
      if (!players[targetId] || players[targetId].status === 'hacked' || !players[socket.id]) {
        clearInterval(attacker.attackInterval);
        return;
      }

      const guess = Math.floor(Math.random() * 100);
      let blocked = false;
      const victimRules = players[targetId].firewall;
      
      const matchingRule = victimRules.find(r => {
        const portMatch = r.port === '*' || r.port == targetPort;
        const ipMatch = r.src === '*' || r.src === attacker.ip;
        const protoMatch = r.proto === targetProto; 
        return portMatch && ipMatch && protoMatch;
      });

      if (matchingRule && matchingRule.action === 'deny') blocked = true;

      if (blocked) {
        // --- CAMBIO AQUÍ: Feedback a la víctima con PROTOCOLO ---
        io.to(targetId).emit('log', `[FW] BLOQUEADO: Intento (${targetProto}) desde ${attacker.ip}:${targetPort}`);
        
        // Feedback al ATACANTE
        socket.emit('log', `[ERR] BLOQUEADO por host remoto (${victim.ip}:${targetPort})`);
      } else {
        // --- CAMBIO AQUÍ: Log de Intento con PROTOCOLO ---
        io.to(targetId).emit('log', `[WARN] Login fallido: Pass ${guess} desde ${attacker.ip}:${targetPort} (${targetProto})`);
        
        if (guess === players[targetId].password) {
          clearInterval(attacker.attackInterval);
          players[socket.id].hacks += 1;
          socket.emit('hack_result', { success: true, msg: `¡PASSWORD ${guess} ENCONTRADO!` });
          socket.emit('init_state', players[socket.id]);
          handleGameOver(targetId);
        }
      }
    }, 1000); 
  });

  socket.on('stop_attack', () => {
    const player = players[socket.id];
    if (player && player.attackInterval) {
      clearInterval(player.attackInterval);
      player.attackInterval = null;
      
      player.cooldownUntil = Date.now() + 5000;
      
      socket.emit('log', `[SYS] Ataque detenido. Cooldown iniciado (5s)...`);
      socket.emit('cooldown_start', 5);
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]?.attackInterval) clearInterval(players[socket.id].attackInterval);
    delete players[socket.id];
    io.emit('update_player_list', getPublicPlayerList());
  });
});

function handleGameOver(victimId) {
  const victim = players[victimId];
  if (!victim) return;
  
  victim.status = 'hacked';
  io.to(victimId).emit('game_over', {});
  io.emit('update_player_list', getPublicPlayerList());
}

function getPublicPlayerList() {
  return Object.values(players).map(p => ({
    id: p.id,
    username: p.username,
    ip: p.ip,
    hacks: p.hacks,
    status: p.status
  }));
}

server.listen(PORT, () => console.log(`Running on ${PORT}`));
