#!/usr/bin/env python3
"""ListenBook server with multi-user authentication and isolated storage."""

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import select
import secrets
import shutil
import socket
import sqlite3
import sys
import tempfile
import time
import unicodedata
import xml.etree.ElementTree as ET
import webbrowser
import threading
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def default_data_directory():
    """Return a writable per-user directory when running as a packaged app."""
    if not getattr(sys, 'frozen', False):
        return os.path.join(PROJECT_DIR, 'server_data')
    if sys.platform == 'win32':
        root = os.environ.get('APPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming')
    elif sys.platform == 'darwin':
        root = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support')
    else:
        root = os.environ.get('XDG_DATA_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'share')
    return os.path.join(root, 'ListenBook')


SERVER_DATA_DIR = os.environ.get('LISTENBOOK_DATA_DIR', default_data_directory())
AUTH_DB_FILE = os.path.join(SERVER_DATA_DIR, 'listenbook.sqlite3')
USER_DATA_DIR = os.path.join(SERVER_DATA_DIR, 'users')
LEGACY_BOOKS_DIR = os.path.join(SERVER_DATA_DIR, 'books')
LEGACY_LIBRARY_FILE = os.path.join(SERVER_DATA_DIR, 'library.json')
LEGACY_GENERATED_AUDIO_FILE = os.path.join(SERVER_DATA_DIR, 'generated-audio.json')
DEFAULT_AUDIOS_DIR = os.path.join(PROJECT_DIR, 'default_audios')
COMFYUI_VIEW_BASE = os.environ.get('LISTENBOOK_COMFYUI_VIEW', 'http://127.0.0.1:8188/view')
COMFYUI_API_BASE = os.environ.get('LISTENBOOK_COMFYUI_API', 'http://127.0.0.1:8188')
# Personal catalogue URLs belong in the database or in a deployment environment,
# never in the public source tree.
DEFAULT_BIBLIOSES_OPDS_URL = os.environ.get('LISTENBOOK_BIBLIOSES_OPDS', '').strip()
SESSION_COOKIE_NAME = 'listenbook_session'
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
COOKIE_SECURE = os.environ.get('LISTENBOOK_COOKIE_SECURE', '').lower() in {'1', 'true', 'yes'}

os.makedirs(LEGACY_BOOKS_DIR, exist_ok=True)
os.makedirs(USER_DATA_DIR, exist_ok=True)


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


def database_connection():
    connection = sqlite3.connect(AUTH_DB_FILE, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    return connection


def initialize_database():
    with database_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                biblioses_opds_url TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )
        connection.execute('DELETE FROM sessions WHERE expires_at <= ?', (time.time(),))


def password_hash(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2 ** 14, r=8, p=1)
    encode = lambda value: base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')
    return f'scrypt$16384$8$1${encode(salt)}${encode(digest)}'


def password_matches(password, encoded):
    try:
        algorithm, n_value, r_value, p_value, salt_value, digest_value = encoded.split('$')
        if algorithm != 'scrypt':
            return False
        padding = lambda value: value + '=' * (-len(value) % 4)
        salt = base64.urlsafe_b64decode(padding(salt_value))
        expected = base64.urlsafe_b64decode(padding(digest_value))
        actual = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=int(n_value), r=int(r_value), p=int(p_value))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, binascii.Error):
        return False


def session_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def user_directory(user_id):
    return os.path.join(USER_DATA_DIR, str(int(user_id)))


def user_books_dir(user_id):
    return os.path.join(user_directory(user_id), 'books')


def user_library_file(user_id):
    return os.path.join(user_directory(user_id), 'library.json')


def user_generated_audio_file(user_id):
    return os.path.join(user_directory(user_id), 'generated-audio.json')


def user_voices_dir(user_id):
    return os.path.join(user_directory(user_id), 'default_audios', 'esp_clonadas')


def ensure_user_data(user_id):
    books = user_books_dir(user_id)
    voices = user_voices_dir(user_id)
    os.makedirs(books, exist_ok=True)
    os.makedirs(voices, exist_ok=True)

    if not os.path.exists(user_library_file(user_id)) and os.path.isfile(LEGACY_LIBRARY_FILE):
        records = read_json_file(LEGACY_LIBRARY_FILE, [])
        write_json_file(user_library_file(user_id), records if isinstance(records, list) else [])
        for record in records if isinstance(records, list) else []:
            book_id = safe_id(record.get('id')) if isinstance(record, dict) else None
            source = os.path.join(LEGACY_BOOKS_DIR, f'{book_id}.epub') if book_id else None
            target = os.path.join(books, f'{book_id}.epub') if book_id else None
            if source and target and os.path.isfile(source) and not os.path.exists(target):
                shutil.copy2(source, target)
        print(f'[ListenBook] Datos antiguos migrados a la cuenta {user_id}', flush=True)

    if not os.path.exists(user_generated_audio_file(user_id)) and os.path.isfile(LEGACY_GENERATED_AUDIO_FILE):
        generated = read_json_file(LEGACY_GENERATED_AUDIO_FILE, {})
        write_json_file(user_generated_audio_file(user_id), generated if isinstance(generated, dict) else {})

    # Keep old cloned voices available to the first account, while future
    # uploads are stored only below that account's private directory.
    legacy_voices = os.path.join(DEFAULT_AUDIOS_DIR, 'esp_clonadas')
    if int(user_id) == 1 and os.path.isdir(legacy_voices) and not os.listdir(voices):
        for filename in os.listdir(legacy_voices):
            source = os.path.join(legacy_voices, filename)
            target = os.path.join(voices, filename)
            if os.path.isfile(source) and not os.path.exists(target):
                shutil.copy2(source, target)

    with database_connection() as connection:
        now = time.time()
        connection.execute(
            'INSERT OR IGNORE INTO user_settings(user_id, biblioses_opds_url, created_at, updated_at) VALUES (?, ?, ?, ?)',
            (int(user_id), DEFAULT_BIBLIOSES_OPDS_URL, now, now),
        )


def current_user_from_token(token):
    if not token:
        return None
    now = time.time()
    digest = session_hash(token)
    with database_connection() as connection:
        row = connection.execute(
            'SELECT users.id, users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?',
            (digest, now),
        ).fetchone()
        if not row:
            return None
        connection.execute('UPDATE sessions SET expires_at=? WHERE token_hash=?', (now + SESSION_TTL_SECONDS, digest))
        return {'id': int(row['id']), 'username': row['username']}


def user_count():
    with database_connection() as connection:
        return int(connection.execute('SELECT COUNT(*) FROM users').fetchone()[0])


def create_session(user_id):
    token = secrets.token_urlsafe(40)
    now = time.time()
    with database_connection() as connection:
        connection.execute(
            'INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',
            (session_hash(token), int(user_id), now, now + SESSION_TTL_SECONDS),
        )
    return token


def session_cookie(token, max_age=SESSION_TTL_SECONDS):
    flags = [f'{SESSION_COOKIE_NAME}={token}', 'Path=/', 'HttpOnly', 'SameSite=Lax', f'Max-Age={max_age}']
    if COOKIE_SECURE:
        flags.append('Secure')
    return '; '.join(flags)


def _audio_alias(relative_path):
    normalized = relative_path.replace(os.sep, '/')
    parts = normalized.rsplit('/', 1)
    folder = parts[0] if len(parts) == 2 else ''
    stem = os.path.splitext(parts[-1])[0]
    language_names = {'esp': 'Español', 'es': 'Español', 'en': 'English', 'eng': 'English', 'fr': 'Français', 'de': 'Deutsch', 'it': 'Italiano', 'zh': '中文'}
    folder_parts = [item for item in folder.split('/') if item]
    language_key = folder_parts[0].split('_', 1)[0].lower() if folder_parts else ''
    language = language_names.get(language_key, folder_parts[0].replace('_', ' ').title() if folder_parts else '')
    voice_name = stem.replace('_', ' ').replace('-', ' ').strip().title() or 'Voz'
    suffix = ' (predeterminada)' if any('default' in item.lower() for item in folder_parts) else ''
    return f'{language} · {voice_name}{suffix}' if language else f'{voice_name}{suffix}'


def _voice_record(relative, user_id=None):
    filename = os.path.basename(relative)
    if user_id is None:
        url = '/default_audios/' + quote(relative, safe='/')
        deletable = False
    else:
        url = '/api/default-audios/file/' + quote(relative, safe='/')
        deletable = True
    return {'id': relative, 'alias': _audio_alias(relative), 'filename': filename, 'url': url, 'deletable': deletable}


def list_default_audios(user_id=None):
    voices = []
    extensions = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'}
    if os.path.isdir(DEFAULT_AUDIOS_DIR):
        for root, dirs, files in os.walk(DEFAULT_AUDIOS_DIR):
            dirs[:] = [item for item in dirs if item != 'esp_clonadas']
            for filename in files:
                if os.path.splitext(filename)[1].lower() in extensions:
                    relative = os.path.relpath(os.path.join(root, filename), DEFAULT_AUDIOS_DIR).replace(os.sep, '/')
                    voices.append(_voice_record(relative))
    if user_id is not None:
        voice_dir = user_voices_dir(user_id)
        for filename in os.listdir(voice_dir) if os.path.isdir(voice_dir) else []:
            if os.path.splitext(filename)[1].lower() in extensions:
                voices.append(_voice_record(f'esp_clonadas/{filename}', user_id))
    return sorted(voices, key=lambda voice: voice['alias'].casefold())


def _voice_filename(name, original_filename):
    extension = os.path.splitext(str(original_filename or ''))[1].lower()
    if extension not in {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'}:
        extension = '.wav'
    value = unicodedata.normalize('NFKD', str(name or '')).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'\s+', '_', value.strip())
    value = re.sub(r'[^A-Za-z0-9_-]+', '_', value)
    value = re.sub(r'_+', '_', value).strip('._-')[:120] or 'voz_clonada'
    return f'{value[0].lower() + value[1:]}{extension}'


def audio_proxy_target(path):
    query = parse_qs(urlsplit(path).query)
    filename = query.get('filename', [''])[0]
    subfolder = query.get('subfolder', [''])[0]
    file_type = query.get('type', ['output'])[0]
    if not filename or file_type != 'output':
        return None, None
    return f'{COMFYUI_VIEW_BASE}?{urlencode({"filename": filename, "subfolder": subfolder, "type": file_type})}', query.get('download', ['0'])[0] == '1'


def _xml_text(element, name):
    child = next((item for item in list(element) if item.tag.rsplit('}', 1)[-1] == name), None)
    return (child.text or '').strip() if child is not None else ''


def parse_opds_feed(payload, feed_url):
    root = ET.fromstring(payload)
    books = []
    for entry in root.iter():
        if entry.tag.rsplit('}', 1)[-1] != 'entry':
            continue
        links = [
            {'href': urljoin(feed_url, link.get('href')), 'rel': link.get('rel', ''), 'type': link.get('type', '')}
            for link in list(entry)
            if link.tag.rsplit('}', 1)[-1] == 'link' and link.get('href')
        ]
        acquisition = next((link for link in links if 'acquisition' in link['rel'] or link['type'] in ('application/epub+zip', 'application/epub')), None)
        if not acquisition:
            continue
        image = next((link for link in links if link['rel'] in ('http://opds-spec.org/image', 'http://opds-spec.org/image/thumbnail')), None)
        author = ''
        for child in list(entry):
            if child.tag.rsplit('}', 1)[-1] == 'author':
                author = _xml_text(child, 'name')
                break
        books.append({'id': _xml_text(entry, 'id') or acquisition['href'], 'title': _xml_text(entry, 'title') or 'Sin título', 'author': author, 'coverUrl': image['href'] if image else '', 'downloadUrl': acquisition['href']})
    return books


def biblioses_url_allowed(value, configured_url):
    requested = urlsplit(value)
    configured = urlsplit(configured_url)
    # Calibre/Calibre-Web may expose the OPDS feed below /opds while its
    # acquisition link points to another path on the same host. Restrict by
    # scheme and host, but do not reject a valid download only because its
    # path differs from the catalogue path.
    if requested.scheme not in ('http', 'https') or not requested.netloc or requested.netloc.lower() != configured.netloc.lower():
        return False
    return not requested.username and not requested.password


def settings_for_user(user_id):
    with database_connection() as connection:
        row = connection.execute('SELECT biblioses_opds_url FROM user_settings WHERE user_id=?', (int(user_id),)).fetchone()
        return {'bibliosesOpdsUrl': row['biblioses_opds_url'] if row else ''}


class ListenBookHandler(SimpleHTTPRequestHandler):
    def _send_json(self, value, status=200, headers=None):
        payload = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        for name, header_value in (headers or {}).items():
            self.send_header(name, header_value)
        self.end_headers()
        self.wfile.write(payload)

    def _cookie_token(self):
        cookies = SimpleCookie(self.headers.get('Cookie', ''))
        morsel = cookies.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else ''

    def _current_user(self):
        return current_user_from_token(self._cookie_token())

    def _require_user(self):
        user = self._current_user()
        if not user:
            self._send_json({'error': 'Sesión no iniciada', 'authenticated': False}, status=401)
            return None
        ensure_user_data(user['id'])
        return user

    def _library_record_path(self, user_id, book_id):
        safe = safe_id(book_id)
        return os.path.join(user_books_dir(user_id), f'{safe}.epub') if safe else None

    def _handle_library_get(self, path, user):
        if path == '/api/library':
            self._send_json(read_json_file(user_library_file(user['id']), []))
            return True
        match = re.fullmatch(r'/api/library/files/([^/]+)', path)
        if match:
            file_path = self._library_record_path(user['id'], match.group(1))
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
            self._send_json(read_json_file(user_generated_audio_file(user['id']), {}))
            return True
        return False

    def _handle_biblioses_get(self, user):
        configured = settings_for_user(user['id'])['bibliosesOpdsUrl']
        if not configured:
            self._send_json({'error': 'Configura primero la URL OPDS de Biblioses en Configuración.'}, status=409)
            return
        search = (parse_qs(urlsplit(self.path).query).get('q', [''])[0] or '').strip()
        feed_url = f'{configured.rstrip("/")}/search/{quote(search, safe="")}'
        try:
            response = urlopen(Request(feed_url, headers={'Accept': 'application/atom+xml'}), timeout=30)
            payload = response.read()
            self._send_json({'books': parse_opds_feed(payload, feed_url), 'query': search})
        except (HTTPError, URLError, ET.ParseError, OSError) as error:
            self._send_json({'error': f'No se pudo consultar Biblioses: {error}'}, status=502)

    def _handle_biblioses_download(self, user):
        configured = settings_for_user(user['id'])['bibliosesOpdsUrl']
        requested = parse_qs(urlsplit(self.path).query).get('url', [''])[0]
        if not configured or not biblioses_url_allowed(requested, configured):
            print(f'[ListenBook] Descarga Biblioses rechazada: {requested}', flush=True)
            self.send_error(400, 'URL de Biblioses no válida')
            return
        try:
            response = urlopen(Request(requested, headers={'Accept': 'application/epub+zip'}), timeout=120)
            payload = response.read()
            filename = os.path.basename(unquote(urlsplit(requested).path)) or 'biblioses-book.epub'
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

    def _handle_default_audio_post(self, user):
        try:
            payload = self._read_request_json()
            data_url = str(payload.get('dataUrl', ''))
            name = str(payload.get('name', '')).strip()
            original_filename = str(payload.get('filename', ''))
            match = re.fullmatch(r'data:audio/[^;,]+;base64,(.+)', data_url, re.DOTALL)
            if not match or not name:
                raise ValueError('El audio o el nombre de la voz no son válidos')
            raw_audio = base64.b64decode(match.group(1), validate=True)
            if not raw_audio:
                raise ValueError('El audio está vacío')
            if len(raw_audio) > 30 * 1024 * 1024:
                raise ValueError('El audio supera el límite de 30 MB')
            filename = _voice_filename(name, original_filename)
            relative = f'esp_clonadas/{filename}'
            target_dir = user_voices_dir(user['id'])
            target_path = os.path.join(target_dir, filename)
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
            self._send_json({'voice': _voice_record(relative, user['id'])})
        except (ValueError, json.JSONDecodeError, OSError, binascii.Error) as error:
            self._send_json({'error': str(error) or 'No se pudo guardar la voz.'}, status=400)

    def _serve_user_voice(self, user, path, include_body=True):
        match = re.fullmatch(r'/api/default-audios/file/(esp_clonadas/[A-Za-z0-9_-]+\.(?:wav|mp3|flac|ogg|m4a|aac))', path, re.IGNORECASE)
        if not match:
            self.send_error(400, 'Voz no válida')
            return True
        file_path = os.path.join(user_directory(user['id']), 'default_audios', match.group(1))
        if not os.path.isfile(file_path):
            self.send_error(404, 'Voz no encontrada')
            return True
        content_types = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac'}
        self.send_response(200)
        self.send_header('Content-Type', content_types.get(os.path.splitext(file_path)[1].lower(), 'application/octet-stream'))
        self.send_header('Content-Length', str(os.path.getsize(file_path)))
        self.send_header('Content-Disposition', f"inline; filename*=UTF-8''{quote(os.path.basename(file_path))}")
        self.send_header('Cache-Control', 'private, no-store')
        self.end_headers()
        if include_body:
            with open(file_path, 'rb') as stream:
                shutil.copyfileobj(stream, self.wfile, length=64 * 1024)
        return True

    def _proxy_comfyui(self, method, suffix, body=b''):
        forward_path = suffix[len('/api/comfy'):] if suffix.startswith('/api/comfy') else suffix
        target = f"{COMFYUI_API_BASE.rstrip('/')}/{forward_path.lstrip('/')}"
        headers = {'Content-Type': self.headers['Content-Type']} if self.headers.get('Content-Type') else {}
        request = Request(target, data=body if method in ('POST', 'PUT') else None, headers=headers, method=method)
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

    def _proxy_comfyui_websocket(self):
        """Relay ComfyUI's progress WebSocket through the authenticated app."""
        client_socket = self.connection
        upstream = None
        try:
            comfy_url = urlsplit(COMFYUI_API_BASE)
            comfy_host = comfy_url.hostname or '127.0.0.1'
            comfy_port = comfy_url.port or (443 if comfy_url.scheme == 'https' else 80)
            request_url = urlsplit(self.path)
            forward_path = request_url.path[len('/api/comfy'):] or '/ws'
            if request_url.query:
                forward_path += '?' + request_url.query

            upstream = socket.create_connection((comfy_host, comfy_port), timeout=10)
            upstream.settimeout(10)
            upstream_key = base64.b64encode(secrets.token_bytes(16)).decode('ascii')
            upstream_host = comfy_url.netloc or f'{comfy_host}:{comfy_port}'
            handshake = (
                f'GET {forward_path} HTTP/1.1\r\n'
                f'Host: {upstream_host}\r\n'
                'Upgrade: websocket\r\n'
                'Connection: Upgrade\r\n'
                f'Sec-WebSocket-Key: {upstream_key}\r\n'
                'Sec-WebSocket-Version: 13\r\n\r\n'
            ).encode('ascii')
            upstream.sendall(handshake)

            response = b''
            while b'\r\n\r\n' not in response and len(response) < 64 * 1024:
                chunk = upstream.recv(4096)
                if not chunk:
                    break
                response += chunk
            header_end = response.find(b'\r\n\r\n')
            if not response.startswith(b'HTTP/1.1 101') and not response.startswith(b'HTTP/1.0 101'):
                print(f'[ListenBook -> ComfyUI] WebSocket rechazado: {response[:200]!r}', flush=True)
                self.send_error(502, 'ComfyUI no aceptó el WebSocket de progreso')
                return

            browser_key = self.headers.get('Sec-WebSocket-Key', '')
            if not browser_key:
                self.send_error(400, 'Falta Sec-WebSocket-Key')
                return
            accept_value = base64.b64encode(
                hashlib.sha1((browser_key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode('ascii')).digest()
            ).decode('ascii')
            self.send_response(101, 'Switching Protocols')
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', accept_value)
            self.end_headers()
            self.wfile.flush()
            self.close_connection = True
            if header_end >= 0 and len(response) > header_end + 4:
                client_socket.sendall(response[header_end + 4:])

            client_socket.setblocking(False)
            upstream.setblocking(False)
            sockets = [client_socket, upstream]
            while True:
                readable, _, exceptional = select.select(sockets, [], sockets, 60)
                if exceptional:
                    break
                if not readable:
                    continue
                for source in readable:
                    payload = source.recv(64 * 1024)
                    if not payload:
                        return
                    target = upstream if source is client_socket else client_socket
                    target.sendall(payload)
        except (OSError, ValueError) as error:
            print(f'[ListenBook -> ComfyUI] WebSocket finalizado: {error}', flush=True)
        finally:
            if upstream is not None:
                try:
                    upstream.close()
                except OSError:
                    pass

    def _auth_status(self):
        user = self._current_user()
        self._send_json({'authenticated': bool(user), 'setupRequired': user_count() == 0, 'user': user})

    def _auth_register(self):
        if user_count() and os.environ.get('LISTENBOOK_ALLOW_REGISTRATION', '').lower() not in {'1', 'true', 'yes'}:
            self._send_json({'error': 'El registro público está cerrado.'}, status=403)
            return
        try:
            payload = self._read_request_json()
            username = str(payload.get('username', '')).strip()
            password = str(payload.get('password', ''))
            if not re.fullmatch(r'[A-Za-z0-9_.-]{3,64}', username):
                raise ValueError('El usuario debe tener entre 3 y 64 caracteres: letras, números, punto, guion o guion bajo.')
            if len(password) < 8:
                raise ValueError('La contraseña debe tener al menos 8 caracteres.')
            now = time.time()
            with database_connection() as connection:
                cursor = connection.execute('INSERT INTO users(username,password_hash,created_at) VALUES (?,?,?)', (username, password_hash(password), now))
                user_id = int(cursor.lastrowid)
            ensure_user_data(user_id)
            token = create_session(user_id)
            self._send_json({'authenticated': True, 'user': {'id': user_id, 'username': username}}, headers={'Set-Cookie': session_cookie(token)})
        except sqlite3.IntegrityError:
            self._send_json({'error': 'Ese usuario ya existe.'}, status=409)
        except (ValueError, json.JSONDecodeError, OSError) as error:
            self._send_json({'error': str(error)}, status=400)

    def _auth_login(self):
        try:
            payload = self._read_request_json()
            username = str(payload.get('username', '')).strip()
            password = str(payload.get('password', ''))
            with database_connection() as connection:
                row = connection.execute('SELECT id,username,password_hash FROM users WHERE username=? COLLATE NOCASE', (username,)).fetchone()
            if not row or not password_matches(password, row['password_hash']):
                self._send_json({'error': 'Usuario o contraseña incorrectos.'}, status=401)
                return
            ensure_user_data(row['id'])
            token = create_session(row['id'])
            self._send_json({'authenticated': True, 'user': {'id': int(row['id']), 'username': row['username']}}, headers={'Set-Cookie': session_cookie(token)})
        except (ValueError, json.JSONDecodeError, OSError) as error:
            self._send_json({'error': str(error)}, status=400)

    def _auth_logout(self):
        token = self._cookie_token()
        if token:
            with database_connection() as connection:
                connection.execute('DELETE FROM sessions WHERE token_hash=?', (session_hash(token),))
        self._send_json({'ok': True}, headers={'Set-Cookie': session_cookie('', 0)})

    def _handle_settings_get(self, user):
        self._send_json(settings_for_user(user['id']))

    def _handle_settings_put(self, user):
        try:
            payload = self._read_request_json()
            value = str(payload.get('bibliosesOpdsUrl', payload.get('opdsUrl', '')) or '').strip()
            if value:
                parsed = urlsplit(value)
                if parsed.scheme not in ('http', 'https') or not parsed.netloc:
                    raise ValueError('La URL debe empezar por http:// o https:// y tener un host válido.')
                if parsed.username or parsed.password:
                    raise ValueError('No incluyas credenciales en la URL.')
                value = value.rstrip('/')
            now = time.time()
            with database_connection() as connection:
                connection.execute(
                    'INSERT INTO user_settings(user_id,biblioses_opds_url,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET biblioses_opds_url=excluded.biblioses_opds_url, updated_at=excluded.updated_at',
                    (user['id'], value, now, now),
                )
            self._send_json({'ok': True, **settings_for_user(user['id'])})
        except (ValueError, json.JSONDecodeError, OSError) as error:
            self._send_json({'error': str(error)}, status=400)

    def _proxy_audio(self, include_body):
        target, download = audio_proxy_target(self.path)
        if not target:
            self.send_error(400, 'Audio no válido')
            return
        headers = {'Range': self.headers['Range']} if self.headers.get('Range') else {}
        response = None
        try:
            request_method = 'GET' if include_body else 'HEAD'
            try:
                response = urlopen(Request(target, headers=headers, method=request_method), timeout=30)
            except HTTPError as error:
                if not include_body and error.code in (405, 501):
                    response = urlopen(Request(target, headers=headers, method='GET'), timeout=30)
                else:
                    self.send_error(error.code, 'No se pudo obtener el audio')
                    return
            self.send_response(getattr(response, 'status', 200))
            self.send_header('Content-Type', response.headers.get('Content-Type', 'audio/mpeg'))
            if response.headers.get('Content-Length'):
                self.send_header('Content-Length', response.headers['Content-Length'])
            for header in ('Accept-Ranges', 'Content-Range', 'Last-Modified'):
                if response.headers.get(header):
                    self.send_header(header, response.headers[header])
            filename = os.path.basename(parse_qs(urlsplit(self.path).query).get('filename', ['audio.mp3'])[0])
            self.send_header('Content-Disposition', f"{'attachment' if download else 'inline'}; filename*=UTF-8''{quote(filename)}")
            self.send_header('Cache-Control', 'private, no-store')
            self.end_headers()
            if include_body:
                shutil.copyfileobj(response, self.wfile, length=64 * 1024)
        except (HTTPError, URLError, OSError) as error:
            if not self.wfile.closed:
                try:
                    self.send_error(502, f'No se pudo conectar con ComfyUI: {error}')
                except OSError:
                    pass
        finally:
            if response is not None:
                response.close()

    def do_PUT(self):
        path = urlsplit(self.path).path
        if path == '/api/settings':
            user = self._require_user()
            if user:
                self._handle_settings_put(user)
            return
        user = self._require_user()
        if not user:
            return
        if path == '/api/generated-audio':
            try:
                value = self._read_request_json()
                if not isinstance(value, dict):
                    raise ValueError('JSON no válido')
                write_json_file(user_generated_audio_file(user['id']), value)
                self._send_json({'ok': True})
            except (ValueError, json.JSONDecodeError, OSError):
                self.send_error(400, 'No se pudo guardar el estado de audios')
            return
        match = re.fullmatch(r'/api/library/records/([^/]+)', path)
        if match:
            book_id = safe_id(match.group(1))
            try:
                record = self._read_request_json()
                if not book_id or not isinstance(record, dict):
                    raise ValueError('Registro no válido')
                record['id'] = book_id
                records = read_json_file(user_library_file(user['id']), [])
                records = [item for item in records if item.get('id') != book_id]
                records.append(record)
                write_json_file(user_library_file(user['id']), records)
                self._send_json({'ok': True, 'record': record})
            except (ValueError, json.JSONDecodeError, OSError):
                self.send_error(400, 'No se pudo guardar el libro')
            return
        match = re.fullmatch(r'/api/library/files/([^/]+)', path)
        if match:
            file_path = self._library_record_path(user['id'], match.group(1))
            if not file_path:
                self.send_error(400, 'Identificador no válido')
                return
            temporary = f'{file_path}.part'
            try:
                remaining = int(self.headers.get('Content-Length', '0'))
                with open(temporary, 'wb') as stream:
                    while remaining > 0:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        stream.write(chunk)
                        remaining -= len(chunk)
                if remaining != 0:
                    raise OSError('Carga incompleta')
                os.replace(temporary, file_path)
                self._send_json({'ok': True})
            except (OSError, ValueError):
                if os.path.exists(temporary):
                    os.unlink(temporary)
                self.send_error(400, 'No se pudo guardar el EPUB')
            return
        self.send_error(404)

    def do_DELETE(self):
        user = self._require_user()
        if not user:
            return
        path = urlsplit(self.path).path
        match = re.fullmatch(r'/api/default-audios/(esp_clonadas/[A-Za-z0-9_-]+\.(?:wav|mp3|flac|ogg|m4a|aac))', path, re.IGNORECASE)
        if match:
            file_path = os.path.join(user_directory(user['id']), 'default_audios', match.group(1))
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
        records = read_json_file(user_library_file(user['id']), [])
        write_json_file(user_library_file(user['id']), [item for item in records if item.get('id') != book_id])
        file_path = self._library_record_path(user['id'], book_id)
        if file_path and os.path.exists(file_path):
            os.unlink(file_path)
        self._send_json({'ok': True})

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path == '/api/audio':
            if self._require_user():
                self._proxy_audio(False)
            return
        user = self._require_user() if path.startswith('/api/') else None
        if path.startswith('/api/') and not user:
            return
        if user and path.startswith('/api/default-audios/file/'):
            self._serve_user_voice(user, path, include_body=False)
            return
        match = re.fullmatch(r'/api/library/files/([^/]+)', path)
        if user and match:
            file_path = self._library_record_path(user['id'], match.group(1))
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
        if path == '/api/auth/status':
            self._auth_status()
            return
        if path == '/api/settings':
            user = self._require_user()
            if user:
                self._handle_settings_get(user)
            return
        user = self._require_user() if path.startswith('/api/') else None
        if path.startswith('/api/') and not user:
            return
        if user and path.startswith('/api/default-audios/file/'):
            self._serve_user_voice(user, path)
            return
        if user and path == '/api/default-audios':
            self._send_json({'voices': list_default_audios(user['id'])})
            return
        if user and path == '/api/biblioses/search':
            self._handle_biblioses_get(user)
            return
        if user and path == '/api/biblioses/download':
            self._handle_biblioses_download(user)
            return
        if user and path == '/api/comfy/ws':
            self._proxy_comfyui_websocket()
            return
        if user and path.startswith('/api/comfy/'):
            self._proxy_comfyui('GET', self.path)
            return
        if user and path == '/api/audio':
            self._proxy_audio(True)
            return
        if user and self._handle_library_get(path, user):
            return
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == '/api/auth/register':
            self._auth_register()
            return
        if path == '/api/auth/login':
            self._auth_login()
            return
        if path == '/api/auth/logout':
            self._auth_logout()
            return
        user = self._require_user()
        if not user:
            return
        if path == '/api/default-audios':
            self._handle_default_audio_post(user)
            return
        if path.startswith('/api/comfy/'):
            length = int(self.headers.get('Content-Length', '0'))
            self._proxy_comfyui('POST', self.path, self.rfile.read(length))
            return
        if path != '/api/log-prompt':
            self.send_error(404)
            return
        try:
            payload = self._read_request_json()
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, 'JSON invalido')
            return
        print('\n' + '=' * 72, flush=True)
        print('[ListenBook -> ComfyUI] Prompt de texto enviado:', flush=True)
        print(payload.get('text', ''), flush=True)
        print(f"Usuario: {user['username']}", flush=True)
        print(f"Idioma: {payload.get('language', '')}", flush=True)
        print(f"Instruct: {payload.get('instruct', '') or '(vacío)'}", flush=True)
        print('=' * 72, flush=True)
        self._send_json({'ok': True})


if __name__ == '__main__':
    os.chdir(PROJECT_DIR)
    initialize_database()
    host = os.environ.get('LISTENBOOK_HOST', '0.0.0.0')
    port = int(os.environ.get('LISTENBOOK_PORT', '8080'))
    server = ThreadingHTTPServer((host, port), ListenBookHandler)
    print(f'ListenBook escuchando en http://{host}:{port}', flush=True)
    open_browser = os.environ.get(
        'LISTENBOOK_OPEN_BROWSER',
        '1' if getattr(sys, 'frozen', False) else '0'
    ).lower() in {'1', 'true', 'yes'}
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(f'http://127.0.0.1:{port}')).start()
    server.serve_forever()
