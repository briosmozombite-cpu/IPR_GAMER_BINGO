# v6.0.2 - Corrección del ingreso por enlace

- Se corrigió el orden de inicialización del asistente de ingreso.
- El parámetro `?sala=ABCDE` ahora se procesa sin error al abrir desde WhatsApp.
- El código de sala se completa automáticamente y se conserva el flujo guiado.
- Se actualizó la versión de caché de `app.js`.

# v6.0.1 – Invitación directa a sala

- El enlace compartido incluye el código de sala mediante `?sala=ABCDE`.
- Al abrirlo desde WhatsApp, la aplicación selecciona automáticamente “Unirme a una sala”.
- El código queda cargado y el jugador solo debe confirmar su nombre.
- El mensaje compartido evita duplicar el enlace en Android/WhatsApp.
- Se aceptan también los parámetros `room` y `codigo` por compatibilidad.

# IPR GAMER BINGO v6.0

- Nueva experiencia de ingreso en 3 pasos.
- Portada premium simplificada.
- Elección clara entre crear sala o unirse.
- Nombre y código solicitados solo cuando corresponden.
- Pantalla de confirmación antes de ingresar.
- Se mantiene el lobby, cartillas, créditos, ranking, historial y panel administrador.
