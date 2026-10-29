#!/usr/bin/env python3
import base64
import binascii
import json
import os
import re
import shutil
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from urllib.error import HTTPError, URLError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen


PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DATA_DIR = os.environ.get('LISTENBOOK_DATA_DIR', os.path.join(PROJECT_DIR, 'server_data'))
BOOKS_DIR = os.path.join(SERVER_DATA_DIR, 'books')
LIBRARY_FILE = os.path.join(SERVER_DATA_DIR, 'library.json')
GENERATED_AUDIO_FILE = os.path.join(SERVER_DATA_DIR, 'generated-audio.json')
DEFAULT_AUDIOS_DIR = os.path.join(PROJECT_DIR, 'default_audios')
COMFYUI_VIEW_BASE = os.environ.get('LISTENBOOK_COMFYUI_VIEW', 'http://127.0.0.1:8188/view')
COMFYUI_API_BASE = os.environ.get('LISTENBOOK_COMFYUI_API', 'http://127.0.0.1:8188')
BIBLIOSES_OPDS_URL = os.environ.get('LISTENBOOK_BIBLIOSES_OPDS', 'http://200.234.229.26:8080/opds')
os.makedirs(BOOKS_DIR, exist_ok=True)


def safe_id(value):
    value = unquote(str(value or ''))
    return value if re.fullmatch(r'[A-Za-z0-9_-]{1,160}', value) else None


def read_json_file(path, fallback):
    try:
        with open(path, 'r', encoding='utf-8') as stream:
            return json.load(stream)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def write_json_file(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.listenbook-', dir=os.path.dirname(path), text=True)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _audio_alias(relative_path):
    """Create a readable, stable alias from a sample's folder and filename."""
    normalized = relative_path.replace(os.sep, '/')
    parts = normalized.rsplit('/', 1)
    folder = parts[0] if len(parts) == 2 else ''
    filename = parts[-1]
    stem = os.path.splitext(filename)[0]
    language_names = {
        'esp': 'Español',
        'es': 'Español',
        'en': 'English',
        'eng': 'English',
        'fr': 'Français',
        'de': 'Deutsch',
        'it': 'Italiano',
        'zh': '中文'
    }
    folder_parts = [item for item in folder.split('/') if item]
    language_key = folder_parts[0].split('_', 1)[0].lower() if folder_parts else ''
    language = language_names.get(language_key, folder_parts[0].replace('_', ' ').title() if folder_parts else '')
    voice_name = stem.replace('_', ' ').replace('-', ' ').strip().title() or 'Voz'
    suffix = ' (predeterminada)' if any('default' in item.lower() for item in folder_parts) else ''
    return f'{language} · {voice_name}{suffix}' if language else f'{voice_name}{suffix}'


def list_default_audios():
    voices = []
    if not os.path.isdir(DEFAULT_AUDIOS_DIR):
        return voices
    extensions = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'}
    for root, _, files in os.walk(DEFAULT_AUDIOS_DIR):
        for filename in files:
            if os.path.splitext(filename)[1].lower() not in extensions:
                continue
            absolute = os.path.join(root, filename)
            relative = os.path.relpath(absolute, DEFAULT_AUDIOS_DIR).replace(os.sep, '/')
            voices.append(_voice_record(relative))
    return sorted(voices, key=lambda voice: voice['alias'].casefold())


def _voice_filename(name, original_filename):
    """Build a safe filename while preserving the chosen capitalization."""
    extension = os.path.splitext(str(original_filename or ''))[1].lower()
    if extension not in {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'}:
        extension = '.wav'
    value = unicodedata.normalize('NFKD', str(name or '')).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'\s+', '_', value.strip())
    value = re.sub(r'[^A-Za-z0-9_-]+', '_', value)
    value = re.sub(r'_+', '_', value).strip('._-')[:120]
    if not value:
        value = 'voz_clonada'
    value = value[0].lower() + value[1:]
    return f'{value}{extension}'


def _voice_record(relative):
    filename = os.path.basename(relative)
    return {
        'id': relative,
        'alias': _audio_alias(relative),
        'filename': filename,
        'url': '/default_audios/' + quote(relative, safe='/'),
        'deletable': relative.startswith('esp_clonadas/')
    }


def audio_proxy_target(path):
    query = parse_qs(urlsplit(path).query)
    filename = query.get('filename', [''])[0]
    subfolder = query.get('subfolder', [''])[0]
    file_type = query.get('type', ['output'])[0]
    if not filename or file_type != 'output':
        return None, None
    params = urlencode({
        'filename': filename,
        'subfolder': subfolder,
        'type': file_type,
    })
    return f'{COMFYUI_VIEW_BASE}?{params}', query.get('download', ['0'])[0] == '1'


def _xml_text(element, name):
    child = next((item for item in list(element) if item.tag.rsplit('}', 1)[-1] == name), None)
    return (child.text or '').strip() if child is not None else ''


def parse_opds_feed(payload, feed_url):
    root = ET.fromstring(payload)
    books = []
    for entry in root.iter():
        if entry.tag.rsplit('}', 1)[-1] != 'entry':
            continue
        links = []
        for link in list(entry):
            if link.tag.rsplit('}', 1)[-1] != 'link' or not link.get('href'):
                continue
            links.append({
                'href': urljoin(feed_url, link.get('href')),
                'rel': link.get('rel', ''),
                'type': link.get('type', '')
            })
        acquisition = next((link for link in links if 'acquisition' in link['rel'] or link['type'] in ('application/epub+zip', 'application/epub')), None)
        if not acquisition:
            continue
        image = next((link for link in links if link['rel'] in ('http://opds-spec.org/image', 'http://opds-spec.org/image/thumbnail')), None)
        author = ''
        for child in list(entry):
            if child.tag.rsplit('}', 1)[-1] == 'author':
                author = _xml_text(child, 'name')
                break
        books.append({
            'id': _xml_text(entry, 'id') or acquisition['href'],
            'title': _xml_text(entry, 'title') or 'Sin título',
            'author': author,
            'coverUrl': image['href'] if image else '',
            'downloadUrl': acquisition['href'],
        })
    return books


def biblioses_url_allowed(value):
    requested = urlsplit(value)
    configured = urlsplit(BIBLIOSES_OPDS_URL)
    return requested.scheme in ('http', 'https') and requested.netloc == configured.netloc


class ListenBookHandler(SimpleHTTPRequestHandler):
    def _send_json(self, value, status=200):
        payload = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def _library_record_path(self, book_id):
        safe = safe_id(book_id)
        return os.path.join(BOOKS_DIR, f'{safe}.epub') if safe else None

    def _handle_library_get(self, path):
        if path == '/api/library':
            self._send_json(read_json_file(LIBRARY_FILE, []))
            return True
        match = re.fullmatch(r'/api/library/files/([^/]+)', path)
        if match:
            file_path = self._library_record_path(match.group(1))
            if not file_path or not os.path.isfile(file_path):
                self.send_error(404, 'EPUB no encontrado')
                return True
            self.send_response(200)
            self.send_header('Content-Type', 'application/epub+zip')
            self.send_header('Content-Length', str(os.path.getsize(file_path)))
            self.send_header('Content-Disposition', 'attachment; filename="book.epub"')
            self.end_headers()
            with open(file_path, 'rb') as stream:
                shutil.copyfileobj(stream, self.wfile, length=64 * 1024)
            return True
        if path == '/api/generated-audio':
            self._send_json(read_json_file(GENERATED_AUDIO_FILE, {}))
            return True
        return False

    def _handle_biblioses_get(self):
        query = parse_qs(urlsplit(self.path).query)
        search = (query.get('q', [''])[0] or '').strip()
        # Calibre Content Server 5.x exposes search as /opds/search/<query>.
        # The trailing slash with no query asks the server for its searchable
        # acquisition feed instead of the root navigation catalog.
        feed_url = f'{BIBLIOSES_OPDS_URL.rstrip("/")}/search/{quote(search, safe="")}'
        try:
            response = urlopen(Request(feed_url, headers={'Accept': 'application/atom+xml'}), timeout=30)
            payload = response.read()
            books = parse_opds_feed(payload, feed_url)
            self._send_json({'books': books, 'query': search})
        except (HTTPError, URLError, ET.ParseError, OSError) as error:
            self.send_error(502, f'No se pudo consultar Biblioses: {error}')

    def _handle_biblioses_download(self):
        requested_url = parse_qs(urlsplit(self.path).query).get('url', [''])[0]
        if not biblioses_url_allowed(requested_url):
            self.send_error(400, 'URL de Biblioses no válida')
            return
        try:
            response = urlopen(Request(requested_url, headers={'Accept': 'application/epub+zip'}), timeout=120)
            payload = response.read()
            filename = os.path.basename(unquote(urlsplit(requested_url).path)) or 'biblioses-book.epub'
            if not filename.lower().endswith('.epub'):
                filename = 'biblioses-book.epub'
            self.send_response(200)
            self.send_header('Content-Type', 'application/epub+zip')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Content-Disposition', f"attachment; filename*=UTF-8''{quote(filename)}")
            self.end_headers()
            self.wfile.write(payload)
        except (HTTPError, URLError, OSError) as error:
            self.send_error(502, f'No se pudo descargar el EPUB de Biblioses: {error}')

    def _read_request_json(self):
        length = int(self.headers.get('Content-Length', '0'))
        return json.loads(self.rfile.read(length) or b'{}')

    def _handle_default_audio_post(self):
        try:
            payload = self._read_request_json()
            data_url = str(payload.get('dataUrl', ''))
            name = str(payload.get('name', '')).strip()
            original_filename = str(payload.get('filename', ''))
            match = re.fullmatch(r'data:audio/[^;,]+;base64,(.+)', data_url, re.DOTALL)
            if not match:
                raise ValueError('El audio no tiene un formato válido')
            if not name:
                raise ValueError('El nombre de la voz es obligatorio')
            encoded = match.group(1)
            raw_audio = base64.b64decode(encoded, validate=True)
            if not raw_audio:
                raise ValueError('El audio está vacío')
            if len(raw_audio) > 30 * 1024 * 1024:
                raise ValueError('El audio supera el límite de 30 MB')

            filename = _voice_filename(name, original_filename)
            relative = f'esp_clonadas/{filename}'
            target_dir = os.path.join(DEFAULT_AUDIOS_DIR, 'esp_clonadas')
            target_path = os.path.join(target_dir, filename)
            os.makedirs(target_dir, exist_ok=True)
            if os.path.exists(target_path):
                self._send_json({'error': 'Ya existe una voz con ese nombre.'}, status=409)
                return

            fd, temporary = tempfile.mkstemp(prefix='.listenbook-', suffix=os.path.splitext(filename)[1], dir=target_dir)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(raw_audio)
                os.replace(temporary, target_path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)

            self._send_json({'voice': _voice_record(relative)})
        except (ValueError, json.JSONDecodeError, OSError, binascii.Error) as error:
            self._send_json({'error': str(error) or 'No se pudo guardar la voz.'}, status=400)

    def _proxy_comfyui(self, method, suffix, body=b''):
        """Forward ComfyUI HTTP calls through the ListenBook server."""
        forward_path = suffix[len('/api/comfy'):] if suffix.startswith('/api/comfy') else suffix
        target = f"{COMFYUI_API_BASE.rstrip('/')}/{forward_path.lstrip('/')}"
        headers = {}
        content_type = self.headers.get('Content-Type')
        if content_type:
            headers['Content-Type'] = content_type
        request = Request(
            target,
            data=body if method in ('POST', 'PUT') else None,
            headers=headers,
            method=method,
        )
        response = None
        try:
            response = urlopen(request, timeout=300)
            payload = response.read()
            self.send_response(getattr(response, 'status', 200))
            self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(payload)
        except HTTPError as error:
            payload = error.read() or b''
            self.send_response(error.code)
            self.send_header('Content-Type', error.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(payload)
            print(f'[ListenBook -> ComfyUI] HTTP {error.code} en {suffix}: {payload.decode("utf-8", "replace")}', flush=True)
        except (URLError, OSError) as error:
            self.send_error(502, f'No se pudo conectar con ComfyUI: {error}')
            print(f'[ListenBook -> ComfyUI] conexión fallida en {suffix}: {error}', flush=True)
        finally:
            if response is not None:
                response.close()

    def do_PUT(self):
        path = urlsplit(self.path).path
        if path == '/api/generated-audio':
            try:
                value = self._read_request_json()
                if not isinstance(value, dict): raise ValueError('JSON no válido')
                write_json_file(GENERATED_AUDIO_FILE, value)
                self._send_json({'ok': True})
            except (ValueError, json.JSONDecodeError, OSError):
                self.send_error(400, 'No se pudo guardar el estado de audios')
            return

        match = re.fullmatch(r'/api/library/records/([^/]+)', path)
        if match:
            book_id = safe_id(match.group(1))
            try:
                record = self._read_request_json()
                if not book_id or not isinstance(record, dict): raise ValueError('Registro no válido')
                record['id'] = book_id
                records = read_json_file(LIBRARY_FILE, [])
                records = [item for item in records if item.get('id') != book_id]
                records.append(record)
                write_json_file(LIBRARY_FILE, records)
                self._send_json({'ok': True, 'record': record})
            except (ValueError, json.JSONDecodeError, OSError):
                self.send_error(400, 'No se pudo guardar el libro')
            return

        match = re.fullmatch(r'/api/library/files/([^/]+)', path)
        if match:
            file_path = self._library_record_path(match.group(1))
            if not file_path:
                self.send_error(400, 'Identificador no válido')
                return
            temporary = f'{file_path}.part'
            try:
                remaining = int(self.headers.get('Content-Length', '0'))
                with open(temporary, 'wb') as stream:
                    while remaining > 0:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk: break
                        stream.write(chunk)
                        remaining -= len(chunk)
                if remaining != 0: raise OSError('Carga incompleta')
                os.replace(temporary, file_path)
                self._send_json({'ok': True})
            except (OSError, ValueError):
                if os.path.exists(temporary): os.unlink(temporary)
                self.send_error(400, 'No se pudo guardar el EPUB')
            return

        self.send_error(404)

    def do_DELETE(self):
        path = urlsplit(self.path).path
        match = re.fullmatch(r'/api/default-audios/(.+)', path)
        if match:
            relative = unquote(match.group(1)).replace('\\', '/')
            if not re.fullmatch(r'esp_clonadas/[A-Za-z0-9_-]+\.(wav|mp3|flac|ogg|m4a|aac)', relative, re.IGNORECASE):
                self.send_error(400, 'Voz no válida')
                return
            file_path = os.path.join(DEFAULT_AUDIOS_DIR, relative)
            if not os.path.isfile(file_path):
                self.send_error(404, 'Voz no encontrada')
                return
            try:
                os.unlink(file_path)
                self._send_json({'ok': True})
            except OSError:
                self.send_error(500, 'No se pudo borrar la voz')
            return

        match = re.fullmatch(r'/api/library/([^/]+)', path)
        if not match:
            self.send_error(404)
            return
        book_id = safe_id(match.group(1))
        if not book_id:
            self.send_error(400, 'Identificador no válido')
            return
        records = read_json_file(LIBRARY_FILE, [])
        write_json_file(LIBRARY_FILE, [item for item in records if item.get('id') != book_id])
        file_path = self._library_record_path(book_id)
        if file_path and os.path.exists(file_path): os.unlink(file_path)
        self._send_json({'ok': True})

    def _proxy_audio(self, include_body):
        target, download = audio_proxy_target(self.path)
        if not target:
            self.send_error(400, 'Audio no válido')
            return

        headers = {}
        if self.headers.get('Range'):
            headers['Range'] = self.headers['Range']
        request_method = 'GET' if include_body else 'HEAD'
        request = Request(target, headers=headers, method=request_method)
        response = None
        try:
            try:
                response = urlopen(request, timeout=30)
            except HTTPError as error:
                if not include_body and error.code in (405, 501):
                    fallback = Request(target, headers=headers, method='GET')
                    response = urlopen(fallback, timeout=30)
                else:
                    self.send_error(error.code, 'No se pudo obtener el audio')
                    return

            status = getattr(response, 'status', 200)
            self.send_response(status)
            content_type = response.headers.get('Content-Type', 'audio/mpeg')
            self.send_header('Content-Type', content_type)
            if response.headers.get('Content-Length'):
                self.send_header('Content-Length', response.headers['Content-Length'])
            for header in ('Accept-Ranges', 'Content-Range', 'Last-Modified'):
                if response.headers.get(header):
                    self.send_header(header, response.headers[header])
            filename = os.path.basename(parse_qs(urlsplit(self.path).query).get('filename', ['audio.mp3'])[0])
            disposition = 'attachment' if download else 'inline'
            self.send_header('Content-Disposition', f"{disposition}; filename*=UTF-8''{quote(filename)}")
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            if include_body:
                shutil.copyfileobj(response, self.wfile, length=64 * 1024)
        except (HTTPError, URLError, OSError) as error:
            if not self.wfile.closed:
                try: self.send_error(502, f'No se pudo conectar con ComfyUI: {error}')
                except OSError: pass
        finally:
            if response is not None:
                response.close()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if urlsplit(self.path).path == '/api/audio':
            self._proxy_audio(False)
            return
        match = re.fullmatch(r'/api/library/files/([^/]+)', path)
        if match:
            file_path = self._library_record_path(match.group(1))
            if not file_path or not os.path.isfile(file_path):
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/epub+zip')
            self.send_header('Content-Length', str(os.path.getsize(file_path)))
            self.end_headers()
            return
        super().do_HEAD()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/default-audios':
            self._send_json({'voices': list_default_audios()})
            return
        if path == '/api/biblioses/search':
            self._handle_biblioses_get()
            return
        if path == '/api/biblioses/download':
            self._handle_biblioses_download()
            return
        if path.startswith('/api/comfy/'):
            self._proxy_comfyui('GET', self.path)
            return
        if path == '/api/audio':
            self._proxy_audio(True)
            return
        if self._handle_library_get(path):
            return
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == '/api/default-audios':
            self._handle_default_audio_post()
            return
        if path.startswith('/api/comfy/'):
            length = int(self.headers.get('Content-Length', '0'))
            self._proxy_comfyui('POST', self.path, self.rfile.read(length))
            return

        if path != '/api/log-prompt':
            self.send_error(404)
            return

        try:
            length = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(length) or b'{}')
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, 'JSON invalido')
            return

        print('\n' + '=' * 72, flush=True)
        print('[ListenBook -> ComfyUI] Prompt de texto enviado:', flush=True)
        print(payload.get('text', ''), flush=True)
        print(f"Idioma: {payload.get('language', '')}", flush=True)
        print(f"Instruct: {payload.get('instruct', '') or '(vacío)'}", flush=True)
        print('=' * 72, flush=True)

        response = json.dumps({'ok': True}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    host = os.environ.get('LISTENBOOK_HOST', '0.0.0.0')
    port = int(os.environ.get('LISTENBOOK_PORT', '8080'))
    server = ThreadingHTTPServer((host, port), ListenBookHandler)
    print(f'ListenBook escuchando en http://{host}:{port}', flush=True)
    server.serve_forever()
