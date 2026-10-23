"""Serve the static app on loopback so browser workers are available."""
import argparse
import functools
import http.server
import pathlib
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent
PORT = 7867
URL = f"http://127.0.0.1:{PORT}"
IDENTITY = ("Pixel Forge:" + str(ROOT)).encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            self.send_error(403)
            return
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path == '/__pixel_forge_status':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(IDENTITY)
            return
        resolved = (ROOT / path.lstrip('/')).resolve()
        allowed = resolved in (ROOT, ROOT / 'index.html', ROOT / 'styles.css') or (
            resolved.is_relative_to(ROOT / 'src') and resolved.suffix == '.js')
        if not allowed or (resolved != ROOT and not resolved.is_file()):
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, *_):
        pass


def ready():
    try:
        with urllib.request.urlopen(URL + '/__pixel_forge_status', timeout=1) as response:
            return response.read() == IDENTITY
    except OSError:
        return False


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if args.serve:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
        server.serve_forever()
    else:
        if not ready():
            child = subprocess.Popen([sys.executable, str(ROOT / 'launch.py'), '--serve'],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            for _ in range(40):
                if ready():
                    break
                if child.poll() is not None:
                    raise SystemExit('Nao foi possivel iniciar. A porta 7867 pode estar em uso.')
                time.sleep(.25)
            else:
                child.terminate()
                raise SystemExit('O servidor local nao respondeu.')
        if not args.no_browser:
            webbrowser.open(URL)
        print('Pixel Forge pronto em ' + URL)
