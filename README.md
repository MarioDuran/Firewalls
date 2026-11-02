# NETSEC WARGAMES — Firewalls

Juego educativo multijugador con Express y Socket.IO.

## Requisitos y ejecución

1. Instala **Node.js 16 o superior**.
2. En la carpeta del proyecto ejecuta `npm install`.
3. Inicia el servidor con `npm start`. No es necesario configurar la variable de entorno `ADMIN_PASSWORD`.
4. Abre `http://localhost:3000` para que los jugadores entren al lobby y `http://localhost:3000/admin` para controlar la ronda y consultar los resultados.

La contraseña fija del panel de administrador es **`Admin2026`** (definida en `server.js`).

## Inicio y fin de una ronda (solo administrador)

1. Los participantes entran al juego con su usuario y contraseña numérica y ven **ESPERANDO INICIO** y el texto **«Ya estás conectado. Espera a que inicie la ronda.»**. Aunque estén conectados, **no pueden atacar ni modificar el firewall real** hasta que el administrador inicie la ronda. Sí pueden practicar en el modo tutorial.
2. En `/admin`, inicia sesión con `Admin2026` y pulsa **INICIAR RONDA**. Solamente las conexiones autenticadas como administrador pueden enviar esta orden al servidor.
3. Todos los jugadores que ya estén conectados ven **START!** durante unos segundos; el cronómetro de **15:00** comienza a descontarse de inmediato, de forma sincronizada para todos. Quienes se conecten más tarde entran a la ronda que ya esté en curso, sin reiniciar el reloj.
4. Al cumplirse los 15 minutos, el servidor **detiene todos los ataques**, impide nuevas acciones y muestra a los participantes **FIN DE RONDA**. No comienza la ronda siguiente automáticamente.
5. El administrador ve **RESULTADOS FINALES**, la **tabla completa de participantes de esa ronda** (incluidos quienes se desconectaron) ordenada por **puntos de ronda**, y un anuncio de **GANADOR**. Si hay empate en primer lugar se indican todos los ganadores; si no hay hackeos se indica que no hubo ganador. Debajo se mantiene el ranking histórico ordenado por puntos totales.
6. Cuando desee continuar, el administrador pulsa **INICIAR SIGUIENTE RONDA**. Se reinician reglas y puntos de la ronda anterior, se asignan nuevas IP y se conservan los puntos totales y los cooldowns de eliminación aún vigentes.

## Modo tutorial (esquina superior derecha)

Desde la pantalla de **login**, antes de conectarse, cada estudiante dispone del botón **MODO TUTORIAL** en la esquina superior derecha. También permanece visible en la sala de espera, durante el juego y durante el cooldown de eliminación. Se abre una simulación educativa **independiente** de las partidas, por lo que no crea ataques reales, no modifica el firewall del juego ni suma puntos. Puede repetirse cuantas veces quieran.

La simulación utiliza exclusivamente los nombres ficticios **AGENTE NÉBULA** (estudiante) y **BOT ESPECTRO** (rival), y recrea la disposición del scanner, la consola IDS, el firewall y la herramienta de ataque del juego. No solicita usuario ni contraseña.

1. **Observación:** un bot de práctica (`10.12.0.200`) intenta entrar al equipo del estudiante por **TCP/22**; se registran contraseñas incorrectas. **El bot nunca puede hackear al estudiante.**
2. **Defensa:** después de observar los intentos, se pide agregar una regla **DENY**, **IP origen `10.12.0.200`**, **TCP** y **puerto `22`**. El tutorial comprueba que los parámetros coinciden y muestra el siguiente intento como **BLOQUEADO**.
3. **Ataque:** el estudiante selecciona el bot en el scanner, elige **TCP/80**, y pulsa **INICIAR ATAQUE AL BOT**. Tras varios intentos simulados aparece **¡BOT ELIMINADO!** y el tutorial se marca como completado.

Si el administrador inicia una ronda mientras alguien usa el tutorial, éste se cierra para mostrar **START!**. Durante una ronda activa, abrir el tutorial **no pausa** el cronómetro del juego real.

## Funcionamiento

- **Firewall:** cada participante puede agregar tantas reglas como necesite; ya no se eliminan las antiguas al alcanzar tres. Se conserva el orden de las reglas: prevalece la primera coincidencia.
- **Hackeo:** si un jugador es hackeado, queda eliminado temporalmente, sus ataques activos se cancelan en el **servidor** y no puede crear ataques ni reglas nuevas.
- **Reingreso:** el jugador debe esperar **60 segundos** antes de pulsar **VOLVER A JUGAR**. Recibe nueva IP y comienza sin reglas, manteniendo su puntaje acumulado. El temporizador se valida en el servidor, incluso tras recargar la página con el mismo perfil.
- **Rondas:** duran **15 minutos** desde que el administrador las inicia, con un reloj global compartido por todos. Al empezar otra ronda se detienen los ataques, se eliminan las reglas, se reinician los puntos **de ronda** y se asignan nuevas IP. Los puntos totales no se reinician. Un cooldown por hackeo todavía activo sigue vigente al cambiar de ronda.
- **Puntajes:** cada hackeo exitoso suma **1 punto** tanto a la ronda como al total del jugador. El panel `/admin` presenta el ranking histórico de **mayor a menor por puntos totales**, incluyendo cuentas desconectadas, y muestra estado y puntos de la ronda. Al finalizar una ronda también muestra los resultados de todos los participantes ordenados por puntos obtenidos durante esa ronda y resalta al ganador. Se actualiza en vivo.
- **Persistencia:** los totales se guardan automáticamente en `data/scores.json`, incluso si reinicias Node.js. Puedes cambiar la ubicación con la variable `SCORES_FILE`. Haz copias de seguridad de ese archivo. **Importante:** el estado de la ronda y la tabla final de esa sesión se mantienen en memoria: reiniciar el servidor devuelve el juego al lobby y borra la tabla de resultados de la ronda terminada, sin borrar los puntos totales.
- **Cooldown de detener ataque:** se mantiene la pausa anterior de **5 segundos** después de detener manualmente un ataque.

## Identidad y seguridad

Cada navegador recibe un token aleatorio guardado en `localStorage` para conservar el perfil al recargar. No es un sistema de cuentas con registro y contraseña: abrir otro navegador, usar modo incógnito o borrar los datos del sitio permite crear **otro perfil**. Para un torneo con identidad verificada, debe añadirse autenticación real. No publiques el archivo `data/scores.json`, porque contiene los tokens que identifican los perfiles.

La clave fija `Admin2026` se comprueba **en el servidor** y no se incorpora en el HTML. **Advertencia:** una contraseña hardcodeada es fácil de descubrir si alguien obtiene el código y no es adecuada para un despliegue público. Si vas a publicar el juego en internet, cambia a una contraseña configurable y segura, usa HTTPS y añade controles adicionales de acceso y limitación de intentos.

## Pruebas

Ejecuta `npm test` para correr las pruebas automatizadas de las reglas de juego.
