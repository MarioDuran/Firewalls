# NETSEC WARGAMES — Firewalls

Juego educativo multijugador con Express y Socket.IO.

## Requisitos y ejecución

1. Instala **Node.js 16 o superior**.
2. En la carpeta del proyecto ejecuta `npm install`.
3. Inicia el servidor con `npm start`. No es necesario configurar la variable de entorno `ADMIN_PASSWORD`.
4. Abre `http://localhost:3000` para que los jugadores entren al lobby y `http://localhost:3000/admin` para controlar la ronda y consultar los resultados.

La contraseña fija del panel de administrador es **`Admin2026`** (definida en `server.js`).

## Inicio y fin de una ronda (solo administrador)

1. Los participantes entran al juego con su usuario y contraseña numérica y ven **ESPERANDO INICIO** y el texto **«Ya estás conectado. Espera a que inicie la ronda.»**. Aunque estén conectados, **no pueden atacar ni modificar el firewall real** hasta que el administrador inicie la ronda. El modo tutorial está disponible desde el login, sin necesidad de iniciar sesión.
2. En `/admin`, inicia sesión con `Admin2026` y pulsa **INICIAR RONDA**. Solamente las conexiones autenticadas como administrador pueden enviar esta orden al servidor.
3. Todos los jugadores que ya estén conectados ven **START!** durante unos segundos; el cronómetro de **15:00** comienza a descontarse de inmediato, de forma sincronizada para todos. Quienes se conecten más tarde entran a la ronda que ya esté en curso, sin reiniciar el reloj.
4. Al cumplirse los 15 minutos, el servidor **detiene todos los ataques**, impide nuevas acciones y muestra a los participantes **FIN DE RONDA**. No comienza la ronda siguiente automáticamente.
5. El administrador ve **RESULTADOS FINALES**, la **tabla completa de participantes de esa ronda** (incluidos quienes se desconectaron) ordenada por **puntos de ronda**, y un anuncio de **GANADOR**. Si hay empate en primer lugar se indican todos los ganadores; si no hay hackeos se indica que no hubo ganador. Debajo se mantiene el ranking histórico ordenado por puntos totales.
6. Cuando desee continuar, el administrador pulsa **INICIAR SIGUIENTE RONDA**. Se reinician reglas y puntos de la ronda anterior, se asignan nuevas IP y se conservan los puntos totales y los cooldowns de eliminación aún vigentes.

## Modo tutorial (interfaz idéntica al juego)

En el login aparece **MODO TUTORIAL** en la esquina superior derecha. Al pulsarlo se abre **el mismo tablero real del juego** (mismo scanner, herramienta de ataque, IDS, firewall, controles, distribuciones y estilos). No hay paneles, guías, letreros de pasos ni pistas: el profesor explica el ejercicio durante la clase. El enlace lateral se convierte en **SALIR DEL TUTORIAL** para volver al login.

La práctica se ejecuta exclusivamente en el navegador. **No se conecta al servidor mediante Socket.IO**, no registra jugadores, no cambia firewall ni puntos del juego competitivo y funciona de forma autónoma incluso si no se dispone de Socket.IO (para abrir el HTML localmente, se deben cargar los archivos del sitio juntos). Solo existen dos identidades ficticias:

- **AGENTE NÉBULA** (alumno): `10.12.0.10`, contraseña de simulación `42`.
- **BOT ESPECTRO** (rival): `10.12.0.200`.

El bot intenta entrar permanentemente en el equipo del alumno por **TCP/22**, con intentos fallidos registrados en la consola auténtica del juego. **Nunca consigue hackear al alumno.** El alumno puede crear reglas con los controles de firewall normales, sin límites, y bloquear al bot creando `DENY`, IP `10.12.0.200`, protocolo `TCP`, puerto `22`. Las reglas se procesan en orden, como en el servidor real.

El bot aparece como único objetivo en el scanner. El alumno puede seleccionarlo y utilizar **INICIAR ATAQUE** en la herramienta existente. El servicio vulnerable del bot en esta práctica es **TCP/80**; tras tres intentos se hackea al bot, se detienen sus ataques, aparece como eliminado en el scanner y el contador local pasa a 1 (sin sumar puntos reales). Se mantiene el cooldown de 5 segundos cuando el alumno detiene manualmente un ataque. Al volver al login y abrir el tutorial otra vez, se reinicia toda la simulación.

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
