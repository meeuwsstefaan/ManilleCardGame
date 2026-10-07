"""Serve only the static web game on loopback and open it in a browser."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import webbrowser


class WebHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent / 'web'
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(WebHandler, directory=str(directory)))
    except OSError as exc:
        parser.exit(1, f'Cannot start the game: {exc}. Try --port 8766.\n')
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'Manille: {url}\nPress Ctrl+C to stop the local server.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()