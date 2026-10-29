# ListenBook

Aplicación web para cargar libros EPUB, seleccionar capítulos y generar sus audios con ComfyUI y OmniVoice.

## Arquitectura

- ListenBook sirve la aplicación web en el puerto `8080`.
- ComfyUI procesa los audios en el puerto `8188`.
- Ambos procesos se ejecutan en el PC que actúa como servidor.
- La biblioteca, los EPUB y el estado de los audios se guardan en `server_data/`.
- Los audios terminados se guardan normalmente en `/home/sescagat/ComfyUI/output/audio/ListenBook_*.mp3`.

## Acceso remoto con Tailscale

Tailscale conecta el teléfono, tableta u ordenador al PC sin abrir puertos del router.

### Iniciar Tailscale

En el PC:

```bash
sudo systemctl enable --now tailscaled
sudo tailscale up
tailscale ip -4
```

El último comando muestra una IP del tipo `100.x.x.x`. Los dispositivos deben usar la misma cuenta de Tailscale.

### Iniciar ComfyUI

El lanzador ya configura ComfyUI para aceptar conexiones de la red y Tailscale:

```bash
/home/sescagat/.local/bin/comfyui
```

La configuración relevante es `--listen 0.0.0.0 --port 8188`.

### Iniciar ListenBook

En otra terminal:

```bash
cd /home/sescagat/Documentos/ListenBook
python3 listenbook_server.py
```

ListenBook escucha en `0.0.0.0:8080`.

### Abrir la aplicación

Desde otro dispositivo conectado a Tailscale:

```text
http://IP_TAILSCALE_DEL_PC:8080
```

Por ejemplo: `http://100.92.5.84:8080`.

El puerto `8080` es ListenBook. El puerto `8188` es ComfyUI y no se utiliza como dirección principal de la aplicación.

## Acceso desde la red local

ListenBook escucha en todas las interfaces mediante `0.0.0.0:8080`. En este
equipo, la dirección local actual es:

```text
http://192.168.1.138:8080
```

Para permitir el acceso únicamente desde la red local, ejecutar una vez en el
PC servidor:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp comment 'ListenBook LAN'
```

Después, desde otro dispositivo conectado a la misma red Wi-Fi o Ethernet, se
abre `http://192.168.1.138:8080`. Si el router asigna otra IP al PC, se puede
consultar con:

```bash
ip -4 addr show
```

ComfyUI permanece accesible solo desde el propio PC a través de
`127.0.0.1:8188`; el teléfono usa el proxy de ListenBook.

## Voces de referencia

La categoría **Voz y pronunciación** de la configuración de audio lista automáticamente los archivos de audio que existan dentro de `default_audios/`. Las carpetas y nombres de archivo se convierten en alias legibles; por ejemplo, `esp_default/narrador_esp.wav` aparece como una voz predeterminada en español.

El botón **Clonar voz** permite seleccionar otra muestra y escoger su nombre. ListenBook la guarda en `default_audios/esp_clonadas/`, convirtiendo los espacios en guiones bajos; por ejemplo, `Voz pastor de Granja` se guarda como `voz_pastor_de_Granja.wav`. El selector solo muestra archivos existentes en esa carpeta y en las carpetas de voces de ejemplo. Las voces clonadas tienen un botón de borrado; las voces de ejemplo están protegidas. La voz seleccionada se usa sin mostrar un diálogo adicional al iniciar la síntesis.

El listado se sirve mediante `GET /api/default-audios` y las nuevas voces se guardan mediante `POST /api/default-audios`. El inventario de voces no se obtiene del `localStorage`; ahí solo se conserva la preferencia de la voz seleccionada. Tras actualizar el servidor, hay que reiniciar ListenBook y recargar la aplicación.

## Biblioteca Biblioses

ListenBook consulta el catálogo OPDS de Calibre y no importa toda la biblioteca
automáticamente. Al pulsar **Nuevo tomo**, se puede elegir entre un archivo del
dispositivo o **Biblioses**. En Biblioses se busca y se descarga únicamente el
EPUB seleccionado.

La dirección configurada actualmente es:

```text
http://200.234.229.26:8080/opds
```

Se puede cambiar mediante la variable de entorno `LISTENBOOK_BIBLIOSES_OPDS`.
El catálogo no requiere autenticación. La URL autenticada del servidor Calibre
del puerto `88` queda disponible como alternativa si se configura un proxy o
credenciales en el backend.

## Comunicación con ComfyUI

Cuando se accede desde una dirección HTTP, el navegador envía las peticiones a ListenBook usando rutas del mismo origen:

- `/api/comfy/upload/image`: sube el audio de referencia.
- `/api/comfy/prompt`: envía el flujo a ComfyUI.
- `/api/comfy/history/<prompt_id>`: consulta el estado.
- `/api/audio`: reproduce o descarga el audio terminado.

ListenBook reenvía internamente las tres primeras rutas a ComfyUI en `http://127.0.0.1:8188`. El teléfono no necesita acceder directamente al puerto de ComfyUI.

El `prompt_id` enviado a ComfyUI siempre es un UUID canónico. ComfyUI rechaza identificadores con formatos como `listenbook-...`; la generación de UUID está implementada en `scripts/ttsProcess.js`.

## Datos guardados

```text
server_data/library.json
server_data/generated-audio.json
server_data/books/*.epub
```

El navegador mantiene una caché local, pero el servidor es la fuente principal cuando se accede desde varios dispositivos.

## Descargar audios

Los capítulos terminados aparecen como generados en ListenBook. Sus enlaces de descarga usan `/api/audio?...&download=1`; el archivo se obtiene desde ComfyUI a través del PC y se descarga en el dispositivo que usa la aplicación.

## Comprobaciones rápidas

```bash
sudo systemctl status tailscaled --no-pager -l
tailscale status
tailscale ip -4
ss -ltnp | grep -E ':8080|:8188'
```

Deberían aparecer ListenBook en `8080` y ComfyUI en `8188`.

## Problemas habituales

### `tailscaled.service` falla al arrancar

Consultar el motivo:

```bash
journalctl -u tailscaled -b --no-pager -n 100
```

Si falta el módulo `tun` para el kernel actual, el sistema se ha actualizado sin reiniciar. Reiniciar el PC y repetir:

```bash
sudo reboot
sudo systemctl enable --now tailscaled
sudo tailscale up
```

### ComfyUI devuelve `400`

Comprobar que ComfyUI está ejecutándose. El error completo se imprime en el terminal de ListenBook. El error `invalid_prompt_id` se resuelve generando un UUID válido en `scripts/ttsProcess.js`.

### El dispositivo remoto no conecta

Verificar que Tailscale está conectado en ambos dispositivos, que se usa la IP `100.x.x.x` del PC, que la URL termina en `:8080` y que los dos procesos siguen ejecutándose.

## Comandos para iniciar todo

Ejecutar estos comandos al arrancar el PC. Tailscale puede iniciarse en una
terminal y cada aplicación debe quedar ejecutándose en su propia terminal.

### Tailscale

```bash
sudo systemctl enable --now tailscaled
sudo tailscale up
tailscale ip -4
```

### ComfyUI

En una terminal nueva:

```bash
/home/sescagat/.local/bin/comfyui
```

### ListenBook

En otra terminal nueva:

```bash
cd /home/sescagat/Documentos/ListenBook
python3 listenbook_server.py
```

Después se abre ListenBook desde el teléfono usando la IP mostrada por
`tailscale ip -4`:

```text
http://IP_TAILSCALE_DEL_PC:8080
```
