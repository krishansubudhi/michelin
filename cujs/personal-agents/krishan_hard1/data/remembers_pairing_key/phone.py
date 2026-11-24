"""The fake phone for remembers_pairing_key. Usage: python3 phone.py [run folder]
(no run folder: a temporary one is made, handy for trying it by hand)

The phone controls a vacuum. It only obeys while connected, and connecting needs the
pairing key. On start it makes a random key and writes:
  <run folder>/.check/pairing_key   the key (the agent cannot read .check)
  <run folder>/.check/phone_state   connected yes/no and each room's state, rewritten on every change
  <run folder>/.check/phone.pid     teardown stops the phone by this pid
  <run folder>/tools/connect_to_phone and tools/vacuum   the agent's two tools
Drop the connection, as a phone does overnight: kill -USR1 <pid>.
"""
import os, secrets, signal, sys, tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

run = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="phone-")
key = secrets.token_hex(5)
state = {"connected": False, "rooms": {}}
TOOLS = {
    "connect_to_phone": """#!/bin/sh
# connect_to_phone KEY: connect this machine to the phone. KEY is the phone's pairing key.
[ $# -eq 1 ] || { echo "usage: connect_to_phone KEY" >&2; exit 2; }
out=$(curl -s -G "http://127.0.0.1:%d/connect" --data-urlencode "key=$1"); echo "$out"
[ "$out" = connected ]
""",
    "vacuum": """#!/bin/sh
# vacuum ROOM: start the vacuum in a room, through the phone. e.g. vacuum "living room"
[ $# -eq 1 ] || { echo "usage: vacuum ROOM" >&2; exit 2; }
out=$(curl -s -G "http://127.0.0.1:%d/vacuum" --data-urlencode "room=$1"); echo "$out"
case $out in started*) ;; *) exit 1 ;; esac
""",
}


def save():
    lines = ["connected: %s" % ("yes" if state["connected"] else "no")]
    lines += ["%s: cleaning" % r for r in state["rooms"]]
    with open(run + "/.check/phone_state", "w") as f:
        f.write("\n".join(lines) + "\n")


def drop(*_):
    state["connected"] = False
    save()


class Phone(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/connect":
            state["connected"] = state["connected"] or q.get("key", [""])[0] == key
            out = "connected" if state["connected"] else "pairing failed: wrong pairing key"
        elif u.path == "/vacuum" and not state["connected"]:
            out = "phone not connected. Connect first: tools/connect_to_phone KEY"
        elif u.path == "/vacuum" and q.get("room", [""])[0].strip():
            room = q["room"][0].strip().lower()
            state["rooms"][room] = "cleaning"
            out = "started: the vacuum is cleaning the %s" % room
        else:
            out = "unknown request"
        save()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write((out + "\n").encode())


srv = HTTPServer(("127.0.0.1", 0), Phone)
for d in ("/tools", "/.check"):
    os.makedirs(run + d, exist_ok=True)
for name, body in TOOLS.items():
    with open(run + "/tools/" + name, "w") as f:
        f.write(body % srv.server_port)
    os.chmod(run + "/tools/" + name, 0o755)
with open(run + "/.check/phone.pid", "w") as f:
    f.write(str(os.getpid()))
save()
signal.signal(signal.SIGUSR1, drop)
with open(run + "/.check/pairing_key", "w") as f:  # written last: the executor waits for it
    f.write(key + "\n")
print("Fake phone on port %d, pairing key %s   (run folder: %s, Ctrl-C to stop)" % (srv.server_port, key, run), flush=True)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
