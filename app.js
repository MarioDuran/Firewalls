const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- ESTADO DEL JUEGO ---
// Almacenamos los usuarios en memoria (suficiente para una clase)
let players = {}; 

// Utilidad: Generar IP Ficticia (ej. 10.12.0.5)
const generateIP = () => `10.12.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

// Utilidad: Generar contraseña aleatoria (para resets)
const generatePass = () => Math.floor(Math.random() * 1000).toString();

io.on('connection', (socket) => {
  console.log('Nuevo socket conectado:', socket.id);

  // 1. LOGIN / REGISTRO
  socket.on('join_game', ({ username, password }) => {
    // Limpiamos si ya existía
    if(players[socket.id]) delete players[socket.id];

    const ip = generateIP();
    
    players[socket.id] = {
      id: socket.id,
      username: username.substring(0, 15), // Limitar longitud
      password: parseInt(password), // El password real (0-999)
      ip: ip,
      hacks: 0,
      status: 'active', // active | hacked
      firewall: [] // Array de reglas (max 3)
    };

    // Enviar al usuario su estado inicial
    socket.emit('init_state', players[socket.id]);
    
    // Avisar a todos que hay un nuevo jugador
    io.emit('update_player_list', getPublicPlayerList());
  });

  // 2. ACTUALIZAR FIREWALL
  socket.on('update_firewall', (rule) => {
    const player = players[socket.id];
    if (!player || player.status !== 'active') return;

    // Regla: { direction: 'inbound', src: '*', port: '22', action: 'deny' }
    // Solo permitimos 3 reglas. Si hay 3, borramos la primera (FIFO)
    if (player.firewall.length >= 3) {
      player.firewall.shift(); 
    }
    player.firewall.push(rule);
    
    socket.emit('firewall_updated', player.firewall);
    socket.emit('log', `[SYS] Regla agregada: ${rule.action.toUpperCase()} ${rule.proto}/${rule.port} desde ${rule.src}`);
  });

  // 3. INICIAR HACKEO
  // El atacante envía: { targetId, targetPort }
  let attackInterval = null;
  
  socket.on('start_attack', ({ targetId, targetPort, targetProto }) => {
    const attacker = players[socket.id];
    const victim = players[targetId];

    if (!attacker || !victim || attacker.status !== 'active' || victim.status !== 'active') {
      socket.emit('log', `[ERR] Objetivo no válido o inactivo.`);
      return;
    }

    if (attacker.id === victim.id) {
      socket.emit('log', `[ERR] No puedes hackearte a ti mismo.`);
      return;
    }

    socket.emit('log', `[ATK] Iniciando fuerza bruta a ${victim.ip} por puerto ${targetPort}...`);

    // Limpiar ataque previo si existía
    if (attacker.attackInterval) clearInterval(attacker.attackInterval);

    // Bucle de ataque (10 intentos por segundo = cada 100ms)
    attacker.attackInterval = setInterval(() => {
      // Verificar si alguno se desconectó o murió
      if (!players[targetId] || players[targetId].status === 'hacked' || !players[socket.id]) {
        clearInterval(attacker.attackInterval);
        return;
      }

      // 1. Generar intento de password
      const guess = Math.floor(Math.random() * 1000);

      // 2. Evaluar Firewall de la Víctima
      let blocked = false;
      
      // Lógica simple de firewall: Por defecto ALLOW, a menos que haya regla DENY
      // O si el alumno configuró "Allow all", se invierte. Asumiremos lógica de bloqueo explícito para el juego.
      
      // Recorremos reglas de la víctima
      const victimRules = players[targetId].firewall;
      
      // Revisamos si hay alguna regla que coincida con este paquete
      const matchingRule = victimRules.find(r => {
        const portMatch = r.port === '*' || r.port == targetPort;
        const ipMatch = r.src === '*' || r.src === attacker.ip;
        // Simplificación: Asumimos protocolo coincide si el puerto es estándar, o el alumno lo define.
        // Para el juego, usamos el protocolo que envía el atacante.
        const protoMatch = r.proto === targetProto; 

        return portMatch && ipMatch && protoMatch;
      });

      if (matchingRule) {
        if (matchingRule.action === 'deny') blocked = true;
        // Si la acción fuera 'log', solo logueamos pero no bloqueamos
      }

      // 3. Feedback a la víctima (EDUCATIVO: Leer logs)
      if (blocked) {
        io.to(targetId).emit('log', `[FW] BLOQUEADO: Intento desde ${attacker.ip} en puerto ${targetPort} (${targetProto}).`);
        // El atacante recibe feedback visual (opcional, para no saturar)
      } else {
        io.to(targetId).emit('log', `[WARN] Intento de login: Pass ${guess} desde ${attacker.ip} en puerto ${targetPort}.`);
        
        // 4. Comprobar éxito
        if (guess === players[targetId].password) {
          // HACK SUCCESS!
          clearInterval(attacker.attackInterval);
          
          // Actualizar atacante
          players[socket.id].hacks += 1;
          socket.emit('hack_result', { success: true, msg: `Password encontrado: ${guess}. Acceso concedido.` });
          socket.emit('init_state', players[socket.id]); // Actualizar contador hacks
          
          // Actualizar víctima (GAME OVER)
          handleGameOver(targetId);
        }
      }
    }, 100); // 100ms = 10 veces por segundo
  });

  socket.on('stop_attack', () => {
    if (players[socket.id] && players[socket.id].attackInterval) {
      clearInterval(players[socket.id].attackInterval);
      socket.emit('log', `[SYS] Ataque detenido.`);
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id] && players[socket.id].attackInterval) {
      clearInterval(players[socket.id].attackInterval);
    }
    delete players[socket.id];
    io.emit('update_player_list', getPublicPlayerList());
    console.log('Socket desconectado:', socket.id);
  });
});

function handleGameOver(victimId) {
  const victim = players[victimId];
  if (!victim) return;

  victim.status = 'hacked';
  
  // Notificar a la víctima
  io.to(victimId).emit('game_over', { msg: 'SISTEMA COMPROMETIDO. REINICIANDO EN 60s...' });
  
  // Notificar a todos (para actualizar lista visual en rojo)
  io.emit('update_player_list', getPublicPlayerList());

  // Reinicio después de 60 segundos
  setTimeout(() => {
    if (players[victimId]) {
      // Resetear datos
      players[victimId].status = 'active';
      players[victimId].ip = generateIP(); // Nueva IP
      players[victimId].firewall = []; // Firewall borrado
      // Opcional: Cambiar password automáticamente o dejar el mismo
      
      io.to(victimId).emit('game_reset', players[victimId]);
      io.emit('update_player_list', getPublicPlayerList());
      io.to(victimId).emit('log', `[SYS] Sistema restaurado. Nueva IP asignada: ${players[victimId].ip}`);
    }
  }, 60000); // 1 minuto
}

// Solo enviamos datos públicos al frontend
function getPublicPlayerList() {
  return Object.values(players).map(p => ({
    id: p.id,
    username: p.username,
    ip: p.ip,
    hacks: p.hacks,
    status: p.status
  }));
}

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});