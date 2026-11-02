# NETSEC WARGAMES — Firewalls

Juego educativo multijugador con Express y Socket.IO.

## Requisitos y ejecución

1. Instala **Node.js 16 o superior**.
2. En la carpeta del proyecto ejecuta `npm install`.
3. Inicia el servidor con `npm start`. No es necesario configurar la variable de entorno `ADMIN_PASSWORD`.
4. Abre `http://localhost:3000` para jugar y `http://localhost:3000/admin` para ver la clasificación.

La contraseña fija del panel de administrador es **`Admin2026`** (definida en `server.js`).

## Funcionamiento

- **Firewall:** cada participante puede agregar tantas reglas como necesite; ya no se eliminan las antiguas al alcanzar tres. Se conserva el orden de las reglas: prevalece la primera coincidencia.
- **Hackeo:** si un jugador es hackeado, queda eliminado temporalmente, sus ataques activos se cancelan en el **servidor** y no puede crear ataques ni reglas nuevas.
- **Reingreso:** el jugador debe esperar **60 segundos** antes de pulsar **VOLVER A JUGAR**. Recibe nueva IP y comienza sin reglas, manteniendo su puntaje acumulado. El temporizador se valida en el servidor, incluso tras recargar la página con el mismo perfil.
- **Rondas:** duran **10 minutos**, con un reloj global compartido por todos. Al empezar otra ronda se detienen los ataques, se eliminan las reglas, se reinician los puntos **de ronda** y se asignan nuevas IP. Los puntos totales no se reinician. Un cooldown por hackeo todavía activo sigue vigente al cambiar de ronda.
- **Puntajes:** cada hackeo exitoso suma **1 punto** tanto a la ronda como al total del jugador. El panel `/admin` presenta el ranking de **mayor a menor por puntos totales**, incluyendo cuentas desconectadas, y muestra estado y puntos de la ronda. Se actualiza en vivo.
- **Persistencia:** los totales se guardan automáticamente en `data/scores.json`, incluso si reinicias Node.js. Puedes cambiar la ubicación con la variable `SCORES_FILE`. Haz copias de seguridad de ese archivo.
- **Cooldown de detener ataque:** se mantiene la pausa anterior de **5 segundos** después de detener manualmente un ataque.

## Identidad y seguridad

Cada navegador recibe un token aleatorio guardado en `localStorage` para conservar el perfil al recargar. No es un sistema de cuentas con registro y contraseña: abrir otro navegador, usar modo incógnito o borrar los datos del sitio permite crear **otro perfil**. Para un torneo con identidad verificada, debe añadirse autenticación real. No publiques el archivo `data/scores.json`, porque contiene los tokens que identifican los perfiles.

La clave fija `Admin2026` se comprueba **en el servidor** y no se incorpora en el HTML. **Advertencia:** una contraseña hardcodeada es fácil de descubrir si alguien obtiene el código y no es adecuada para un despliegue público. Si vas a publicar el juego en internet, cambia a una contraseña configurable y segura, usa HTTPS y añade controles adicionales de acceso y limitación de intentos.

## Pruebas

Ejecuta `npm test` para correr las pruebas automatizadas de las reglas de juego.
