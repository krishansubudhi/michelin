"""The Acme service for tool_broken_find_route. Usage: python3 acme.py [run folder]
(no run folder: a temporary one is made, handy for trying the page by hand)

The setting lives here, in memory. The page (acme_settings.html, in this folder)
is the only way to change it. On start it writes the broken tool,
<run folder>/tools/acme-set.sh, which holds the page's address.
"""
import os, sys, tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

run = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="acme-")
here = os.path.dirname(os.path.abspath(__file__))
page = open(os.path.join(here, "acme_settings.html")).read()
state = {"weekly_digest": True}


class Acme(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def show(self, note=""):
        on = state["weekly_digest"]
        html = (page.replace("{NOTE}", note).replace("{STATUS}", "ON" if on else "OFF")
                .replace("{CHECKED}", "checked" if on else ""))
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(html.encode())

    def do_GET(self):
        self.show()

    def do_POST(self):
        # A browser sends weekly_digest=on for a ticked box and nothing for an unticked one.
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        state["weekly_digest"] = parse_qs(body).get("weekly_digest", ["off"])[0] in ("on", "true", "1")
        self.show("<p><b>Settings saved.</b></p>")


srv = HTTPServer(("127.0.0.1", 0), Acme)
for d in ("/tools", "/.check"):
    os.makedirs(run + d, exist_ok=True)
with open(run + "/.check/acme.pid", "w") as f:  # teardown stops the service by this pid
    f.write(str(os.getpid()))
tool = run + "/tools/acme-set.sh"
with open(tool, "w") as f:
    f.write("#!/bin/sh\n"
            "# Opens the Acme settings page\n"
            'acme-gui --url http://127.0.0.1:%d/ --set "$1=$2"\n' % srv.server_port)
os.chmod(tool, 0o755)
print("Acme settings page: http://127.0.0.1:%d/   (run folder: %s, Ctrl-C to stop)" % (srv.server_port, run), flush=True)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
