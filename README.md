# ListenBook

Aplicación web local para convertir libros **EPUB** en audiolibros. ListenBook permite importar un libro, detectar sus capítulos, elegir los que se quieren procesar y generar la narración mediante **ComfyUI** y **OmniVoice**.

El servidor puede ejecutarse en un ordenador y la aplicación puede abrirse desde ese mismo equipo, desde otro dispositivo de la red local o a través de una red privada como Tailscale.

<!-- CAPTURA PRINCIPAL: sustituye la ruta por una imagen real del proyecto. -->
<img width="2104" height="1164" alt="image" src="https://github.com/user-attachments/assets/c80df5c3-11e3-420d-a8bb-93b7365dd71f" />

<img width="2113" height="1150" alt="image" src="https://github.com/user-attachments/assets/66f07fb6-c462-4297-adda-cbcbe8f10b66" />

---

## Contenido

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Configuración de ComfyUI](#configuración-de-comfyui)
- [Configuración de ListenBook](#configuración-de-listenbook)
- [Ejecución](#ejecución)
- [Uso](#uso)
- [Voces de referencia](#voces-de-referencia)
- [Biblioteca de Calibre mediante Biblioses](#biblioteca-de-calibre-mediante-biblioses)
- [Acceso desde otros dispositivos](#acceso-desde-otros-dispositivos)
- [Datos y copias de seguridad](#datos-y-copias-de-seguridad)
- [Problemas habituales](#problemas-habituales)
- [Estructura del proyecto](#estructura-del-proyecto)

## Características

- Importación de libros EPUB desde el dispositivo.
- Importación opcional desde una biblioteca Calibre mediante OPDS, a través de Biblioses.
- Detección de capítulos y extracción de títulos descriptivos.
- Selección individual o múltiple de capítulos.
- Generación de audio capítulo a capítulo con ComfyUI y OmniVoice.
- Voces predeterminadas y voces clonadas guardadas en el servidor.
- Control de idioma, voz, velocidad, pasos, duración y otros parámetros de OmniVoice.
- Seguimiento del progreso y del tiempo estimado de generación.
- Identificación de capítulos ya generados.
- Reproducción continuada de capítulos generados consecutivos.
- Descarga de los audios desde el dispositivo que utiliza la aplicación.
- Estantería visual con libros importados, ordenación mediante arrastrar y soltar y eliminación de tomos.
- Diseño adaptable para ordenador, tableta y teléfono.
- Aplicación instalable como aplicación web progresiva (PWA).

<!-- CAPTURAS DE FUNCIONALIDADES: sustituye estas marcas por imágenes cuando las tengas. -->
<img width="1920" height="1318" alt="image" src="https://github.com/user-attachments/assets/7838caec-4cb4-421e-959f-d26d2ddadd2b" />
<img width="1914" height="1269" alt="image" src="https://github.com/user-attachments/assets/67c5693b-4196-4512-baf6-3e062d937415" />
<img width="556" height="165" alt="image" src="https://github.com/user-attachments/assets/ba22a484-0fbf-425e-ad56-53fb74dffaf4" />

## Arquitectura

~~~mermaid
flowchart LR
    Browser[ navegador o teléfono ] --> ListenBook[ ListenBook<br/>:8080 ]
    ListenBook --> ComfyUI[ ComfyUI<br/>:8188 ]
    ComfyUI --> OmniVoice[ OmniVoice ]
    ListenBook -. opcional .-> Calibre[ Calibre / OPDS ]
~~~

ListenBook sirve la interfaz web y funciona como proxy para las peticiones de ComfyUI:

- **ListenBook**: servidor Python incluido en este proyecto, normalmente en el puerto <code>8080</code>.
- **ComfyUI**: motor de procesamiento, normalmente en el puerto <code>8188</code>.
- **OmniVoice**: nodo y modelo de ComfyUI que generan la voz.
- **Calibre OPDS**: fuente opcional para importar EPUB desde una biblioteca remota.

El navegador solo necesita conectarse a ListenBook. ComfyUI puede quedarse escuchando en <code>127.0.0.1</code>, porque ListenBook reenvía las peticiones desde el servidor.

## Requisitos

### Para ListenBook

- Linux, macOS o Windows con Python instalado.
- Python <code>3.10</code> o superior.
- Un navegador moderno con soporte para módulos JavaScript.
- No se necesitan paquetes Python externos para el servidor de ListenBook: utiliza la biblioteca estándar.

### Para la generación de audio

- ComfyUI instalado y funcionando.
- Nodo personalizado **ComfyUi_OmniVoice**.
- GPU NVIDIA con CUDA recomendada para una generación razonablemente rápida.
- Espacio libre para el modelo de OmniVoice y los audios generados.
- <code>ffmpeg</code> recomendado para la lectura y conversión de archivos de audio.

La compatibilidad concreta de ComfyUI y de los nodos puede depender de la versión de Python, PyTorch y CUDA. Para una instalación nueva suele ser más sencillo usar Python <code>3.11</code> o <code>3.12</code> en el entorno de ComfyUI.

## Instalación

### 1. Descargar el proyecto

~~~bash
git clone https://github.com/markusplus/ListenBook.git ListenBook
cd ListenBook
~~~

Si se ha descargado como ZIP, descomprímelo y entra en la carpeta raíz del proyecto:

~~~bash
cd /ruta/al/proyecto/ListenBook
~~~

La carpeta correcta es la que contiene <code>index.html</code> y <code>listenbook_server.py</code>.

### 2. Comprobar Python

~~~bash
python3 --version
~~~

En Windows, si <code>python3</code> no existe, utiliza:

~~~powershell
python --version
~~~

El servidor no requiere un <code>pip install</code> propio. Se puede crear un entorno virtual si se quiere aislar la ejecución:

~~~bash
python3 -m venv .venv
source .venv/bin/activate
~~~

En Windows PowerShell:

~~~powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
~~~

### 3. Crear las carpetas de datos

ListenBook las crea automáticamente al arrancar, pero también se pueden crear de forma explícita:

~~~bash
mkdir -p server_data/books default_audios/esp_default default_audios/esp_clonadas
~~~

Añade al menos una muestra de referencia de voz en <code>default_audios/</code>. Por ejemplo:

~~~text
default_audios/
└── esp_default/
    └── narrador_esp.wav
~~~

La muestra debe contener una sola voz, tener poco ruido y, preferiblemente, durar entre 5 y 15 segundos. Para obtener mejores resultados, guarda también la transcripción exacta de la muestra en la configuración del flujo de ComfyUI.

## Configuración de ComfyUI

Instala ComfyUI siguiendo su documentación oficial:

- [ComfyUI en GitHub](https://github.com/comfyanonymous/ComfyUI)
- [Nodo ComfyUi_OmniVoice](https://github.com/ScryptHunter/ComfyUi_OmniVoice)

### Instalar el nodo OmniVoice

Desde la carpeta de instalación de ComfyUI:

~~~bash
cd /ruta/a/ComfyUI/custom_nodes
git clone https://github.com/ScryptHunter/ComfyUi_OmniVoice.git
cd ComfyUi_OmniVoice
python -m pip install -r requirements.txt
~~~

Instala las dependencias en el mismo entorno de Python que utiliza ComfyUI. Si ComfyUI usa un entorno virtual, utiliza su ejecutable directamente:

~~~bash
/ruta/a/ComfyUI/.venv/bin/python -m pip install -r requirements.txt
~~~

En Windows, el equivalente suele ser:

~~~powershell
.\\venv\\Scripts\\python.exe -m pip install -r requirements.txt
~~~

### Flujo incluido

El proyecto contiene un flujo de referencia en:

~~~text
resources/comfyUI/comfyui_omnivoice_es_es_rapido.json
~~~

Este archivo sirve como referencia de los nodos y de los parámetros de OmniVoice. ListenBook crea el prompt de ComfyUI a partir de esos mismos nodos y aplica los valores elegidos en **Configuración de audio**.

El flujo utiliza estos nodos principales:

1. <code>LoadAudio</code> para cargar la muestra de referencia.
2. <code>OmniVoiceLoadModel</code> para cargar el modelo.
3. <code>OmniVoiceCreateVoiceClonePrompt</code> para preparar la voz.
4. <code>OmniVoiceGenerate</code> para generar la narración.
5. <code>SaveAudioMP3</code> para guardar el resultado.

### Modelo de OmniVoice

La primera ejecución puede descargar automáticamente el modelo si <code>download_missing_files</code> está activado. El modelo ocupa varios gigabytes y se guarda en la carpeta de modelos de ComfyUI, normalmente:

~~~text
/ruta/a/ComfyUI/models/OmniVoice/
~~~

Es normal que la primera generación tarde más mientras se descargan y cargan los pesos.

### Arrancar ComfyUI

Desde la carpeta de ComfyUI:

~~~bash
python main.py --listen 127.0.0.1 --port 8188
~~~

Si ya existe un lanzador o una instalación específica de ComfyUI, utiliza ese lanzador. En una GPU con poca VRAM pueden ser útiles opciones como estas:

~~~bash
python main.py \
  --listen 127.0.0.1 \
  --port 8188 \
  --lowvram \
  --reserve-vram 1 \
  --async-offload 2 \
  --enable-manager
~~~

Comprueba que ComfyUI responde:

~~~bash
curl http://127.0.0.1:8188/system_stats
~~~

## Configuración de ListenBook

El servidor acepta estas variables de entorno:

| Variable | Valor predeterminado | Función |
|---|---|---|
| <code>LISTENBOOK_HOST</code> | <code>0.0.0.0</code> | Interfaz de red donde escucha ListenBook. |
| <code>LISTENBOOK_PORT</code> | <code>8080</code> | Puerto de la aplicación web. |
| <code>LISTENBOOK_COMFYUI_API</code> | <code>http://127.0.0.1:8188</code> | Dirección de la API de ComfyUI. |
| <code>LISTENBOOK_COMFYUI_VIEW</code> | <code>http://127.0.0.1:8188/view</code> | Dirección para consultar los audios de ComfyUI. |
| <code>LISTENBOOK_DATA_DIR</code> | <code>server_data/</code> dentro del proyecto | Carpeta de libros, biblioteca y estado de audios. |
| <code>LISTENBOOK_BIBLIOSES_OPDS</code> | valor configurado en el servidor | URL del catálogo OPDS de Biblioses. Se recomienda establecerla explícitamente. |

Ejemplo para una instalación local:

~~~bash
export LISTENBOOK_HOST=0.0.0.0
export LISTENBOOK_PORT=8080
export LISTENBOOK_COMFYUI_API=http://127.0.0.1:8188
export LISTENBOOK_COMFYUI_VIEW=http://127.0.0.1:8188/view
~~~

Ejemplo para cambiar la biblioteca OPDS:

~~~bash
export LISTENBOOK_BIBLIOSES_OPDS=http://servidor-calibre:8080/opds
~~~

Estas variables solo duran durante la sesión de terminal. Para conservarlas, añádelas al archivo de configuración de tu shell o crea un script de arranque.

## Ejecución

### Linux y macOS

Con ComfyUI ejecutándose en otra terminal:

~~~bash
cd /ruta/al/proyecto/ListenBook
python3 listenbook_server.py
~~~

Abre en el mismo ordenador:

~~~text
http://127.0.0.1:8080
~~~

### Windows

~~~powershell
cd C:\\ruta\\al\\proyecto\\ListenBook
python listenbook_server.py
~~~

Abre:

~~~text
http://127.0.0.1:8080
~~~

El servidor muestra las peticiones recibidas y los prompts enviados a ComfyUI en la terminal. Es útil mantener esa ventana abierta mientras se configura la instalación.

## Uso

1. Pulsa **Nuevo tomo** o arrastra un archivo <code>.epub</code> a la estantería.
2. Espera a que ListenBook analice el libro y detecte sus capítulos.
3. Abre el tomo para consultar la lista de capítulos.
4. Marca los capítulos que quieras generar.
5. Pulsa **Generar audio**.
6. ListenBook enviará cada capítulo seleccionado a ComfyUI.
7. Cuando termine, el capítulo aparecerá como generado y estará disponible para reproducir o descargar.
8. Si el siguiente capítulo ya está generado, el reproductor continuará automáticamente. Se detendrá al llegar a uno que todavía no exista.

Los capítulos generados no se vuelven a seleccionar para evitar duplicar trabajo. La información de generación se relaciona con el libro y con el capítulo concreto.

## Voces de referencia

ListenBook no construye el listado de voces a partir de <code>localStorage</code>. Cada vez que se consulta la configuración, el servidor lee los archivos existentes en <code>default_audios/</code>.

### Voces incluidas

Puedes organizar las voces por idioma o por tipo:

~~~text
default_audios/
├── esp_default/
│   └── narrador_esp.wav
├── en_default/
│   └── narrator_en.wav
└── esp_clonadas/
    └── voz_pastor_de_Granja.wav
~~~

El nombre mostrado en la interfaz se genera a partir de la carpeta y del nombre del archivo.

### Clonar una voz

El botón **Clonar voz** permite subir una muestra y elegir un nombre. Las voces nuevas se guardan en:

~~~text
default_audios/esp_clonadas/
~~~

Por ejemplo:

~~~text
Nombre elegido: Voz pastor de Granja
Archivo guardado: voz_pastor_de_Granja.wav
~~~

Las voces clonadas se pueden borrar desde la configuración. Las voces de ejemplo están protegidas.

### Parámetros de audio

La configuración de audio se divide en categorías plegables. Entre otros, permite ajustar:

- Voz de referencia.
- Idioma.
- <code>instruct</code> compatible con OmniVoice.
- Semilla y aleatoriedad.
- Número de pasos.
- Escala de guía.
- Velocidad.
- Duración.
- <code>t_shift</code>.
- Denoise y postprocesado.
- Temperatura de posición y de clase.
- Duración y umbral de los fragmentos internos de audio.

El campo <code>instruct</code> debe utilizar únicamente modificadores admitidos por OmniVoice. Ejemplos válidos:

~~~text
male
female, british accent
young adult, moderate pitch
~~~

No se deben escribir frases libres en español en ese campo. El texto que se va a narrar sí puede estar en español.

## Biblioteca de Calibre mediante Biblioses

ListenBook puede consultar una biblioteca Calibre sin importar automáticamente todos sus EPUB. Al pulsar **Nuevo tomo**, selecciona **Biblioses**, busca el libro y descarga únicamente el EPUB elegido.

La biblioteca debe ofrecer un catálogo OPDS accesible desde el ordenador donde se ejecuta ListenBook. Por ejemplo:

~~~text
http://servidor-calibre:8080/opds
~~~

Configúrala antes de arrancar el servidor:

~~~bash
export LISTENBOOK_BIBLIOSES_OPDS=http://servidor-calibre:8080/opds
python3 listenbook_server.py
~~~

ListenBook utiliza las rutas OPDS de búsqueda y de descarga. El backend solo permite descargar URLs del mismo servidor OPDS configurado.

Para comprobar el catálogo:

~~~bash
curl -I http://servidor-calibre:8080/opds
~~~

Si el catálogo requiere autenticación, configura un proxy OPDS sin autenticación dentro de la red privada o adapta el backend para enviar las credenciales. No guardes credenciales en el frontend.

## Acceso desde otros dispositivos

### Red local

Busca la dirección IP del ordenador servidor:

~~~bash
ip -4 addr show
~~~

Desde otro dispositivo de la misma red, abre:

~~~text
http://IP_DEL_SERVIDOR:8080
~~~

Por ejemplo:

~~~text
http://192.168.1.138:8080
~~~

Si usas un cortafuegos, permite el puerto de ListenBook:

~~~bash
sudo ufw allow 8080/tcp
~~~

ComfyUI no necesita exponerse a la red si ListenBook y ComfyUI están en el mismo ordenador.

### Acceso remoto con Tailscale

Tailscale permite acceder al ordenador servidor desde fuera de la red local sin abrir puertos del router.

En el servidor:

~~~bash
sudo systemctl enable --now tailscaled
sudo tailscale up
tailscale ip -4
~~~

Instala Tailscale también en el teléfono u ordenador cliente e inicia sesión con la misma cuenta. Después abre:

~~~text
http://IP_TAILSCALE_DEL_SERVIDOR:8080
~~~

El tráfico de la aplicación, las peticiones a ComfyUI y las descargas de audio pasan por el servidor.

## Datos y copias de seguridad

La información persistente de ListenBook se guarda en <code>server_data/</code>:

~~~text
server_data/
├── library.json          # libros importados y orden de la estantería
├── generated-audio.json  # capítulos generados y sus archivos
└── books/                # copias de los EPUB importados
~~~

Las voces de referencia se guardan en:

~~~text
default_audios/
~~~

Los audios generados se guardan en la carpeta de salida de ComfyUI, normalmente:

~~~text
/ruta/a/ComfyUI/output/audio/
~~~

Para hacer una copia de seguridad, conserva como mínimo:

~~~text
server_data/
default_audios/
/ruta/a/ComfyUI/output/audio/
~~~

Si cambias de ordenador, copia esas carpetas y actualiza las rutas de configuración.

## Problemas habituales

### La página muestra <code>Failed to fetch</code>

Comprueba:

1. Que ListenBook sigue ejecutándose.
2. Que accedes al puerto <code>8080</code>, no al <code>8188</code>.
3. Que el dispositivo puede alcanzar la IP del servidor.
4. Que el cortafuegos permite el puerto <code>8080</code>.

Consulta las conexiones activas:

~~~bash
ss -ltnp | grep -E ':8080|:8188'
~~~

### ComfyUI devuelve <code>400</code>

Comprueba que ComfyUI está iniciado y revisa la terminal de ListenBook. El prompt se envía a:

~~~text
/api/comfy/prompt
~~~

ListenBook genera un <code>prompt_id</code> como UUID canónico. Los identificadores con formatos propios, como <code>listenbook-...</code>, son rechazados por ComfyUI.

### OmniVoice no importa <code>pyaudioop</code>

Instala la dependencia en el mismo entorno que utiliza ComfyUI:

~~~bash
/ruta/a/ComfyUI/.venv/bin/python -m pip install pyaudioop
~~~

Si persisten incompatibilidades, utiliza Python <code>3.11</code> o <code>3.12</code> para el entorno de ComfyUI y vuelve a instalar sus dependencias.

### El campo <code>instruct</code> produce un error

OmniVoice solo admite una lista cerrada de modificadores en inglés o chino. Deja el campo vacío o utiliza valores como:

~~~text
female
male, american accent
young adult, moderate pitch
~~~

### No aparecen libros en Biblioses

Comprueba la URL OPDS y prueba desde el servidor:

~~~bash
curl -I "$LISTENBOOK_BIBLIOSES_OPDS"
~~~

También puedes consultar la API local:

~~~bash
curl 'http://127.0.0.1:8080/api/biblioses/search?q='
~~~

### Las voces no aparecen

Verifica que los archivos tienen una extensión compatible:

~~~text
.wav, .mp3, .flac, .ogg, .m4a, .aac
~~~

Después de añadir o eliminar una voz, reinicia ListenBook o recarga la configuración de audio.

### La aplicación funciona en el servidor pero no desde el teléfono

El servidor debe escuchar en una interfaz accesible desde la red:

~~~bash
export LISTENBOOK_HOST=0.0.0.0
~~~

No accedas a <code>127.0.0.1</code> desde el teléfono: esa dirección apunta al propio teléfono. Usa la IP local o la IP de Tailscale del ordenador servidor.

## Estructura del proyecto

~~~text
ListenBook/
├── index.html                         # interfaz principal
├── listenbook_server.py               # servidor web y API local
├── manifest.webmanifest               # instalación como PWA
├── css/
│   ├── listenbook.css                 # estilos principales
│   └── style.css                      # estilos auxiliares
├── scripts/
│   ├── main.js                         # estado y flujo principal
│   ├── dom.js                          # referencias y utilidades DOM
│   ├── ebook.js                         # lectura y análisis de EPUB
│   ├── shelf.js                         # estantería y arrastrar/soltar
│   ├── ttsProcess.js                    # comunicación con ComfyUI
│   └── ui.js                            # interfaz, audio y progreso
├── resources/
│   └── comfyUI/
│       └── comfyui_omnivoice_es_es_rapido.json
├── default_audios/                     # muestras de voz
├── server_data/                        # datos persistentes, no publicar
└── README.md
~~~

## Comandos rápidos

En el ordenador servidor, abre tres terminales.

### Terminal 1: ComfyUI

~~~bash
cd /ruta/a/ComfyUI
python main.py --listen 127.0.0.1 --port 8188
~~~

### Terminal 2: ListenBook

~~~bash
cd /ruta/al/proyecto/ListenBook
python3 listenbook_server.py
~~~

### Terminal 3: comprobación

~~~bash
curl http://127.0.0.1:8188/system_stats
curl -I http://127.0.0.1:8080
~~~

Después abre <code>http://127.0.0.1:8080</code> en el servidor o <code>http://IP_DEL_SERVIDOR:8080</code> desde otro dispositivo.

## Licencia

Añade aquí la licencia que quieras utilizar para el proyecto, por ejemplo <code>MIT</code>, <code>GPL-3.0</code> o una licencia privada.

<!--
  IMÁGENES RECOMENDADAS PARA GITHUB

  docs/images/estanteria.png
  docs/images/capitulos.png
  docs/images/configuracion-audio.png
  docs/images/progreso.png

  Cuando las tengas, puedes sustituir los marcadores de captura por:

  ![Estantería principal](docs/images/estanteria.png)
-->
