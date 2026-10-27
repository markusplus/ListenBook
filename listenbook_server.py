#!/usr/bin/env python3
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class ListenBookHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/api/log-prompt':
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
    server = ThreadingHTTPServer(('127.0.0.1', 8080), ListenBookHandler)
    server.serve_forever()
