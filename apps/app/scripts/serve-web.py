"""Serves the app's web export on a port, as a host serves a single-page app: a file that exists is
sent as it is, and any other path gets index.html, where Expo Router reads the path. CI's Maestro
flows open screens by their path (`/sunday`), which a plain file server answers with 404.

    python3 apps/app/scripts/serve-web.py apps/app/dist 8082
"""

import http.server
import os
import sys


class SinglePage(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if not os.path.isfile(self.translate_path(self.path)):
            self.path = "/index.html"
        return super().send_head()


if __name__ == "__main__":
    directory, port = sys.argv[1], int(sys.argv[2])
    os.chdir(directory)
    http.server.ThreadingHTTPServer(("", port), SinglePage).serve_forever()
