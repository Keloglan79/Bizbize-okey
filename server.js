const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const root = __dirname;
const port = process.env.PORT || 8787;
const rooms = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".json": "application/json"
};

function roomOf(code) {
  return rooms.get(String(code || "").toUpperCase());
}
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const p of room.players) {
    if (p.ws !== except && p.ws.readyState === 1) p.ws.send(data);
  }
}
function roster(room) {
  return room.players.map(p => ({ seat: p.seat, name: p.name }));
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  const file = path.normalize(path.join(root, url === "/" ? "index.html" : url));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  ws.room = null;
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === "create") {
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      const room = { code, players: [{ ws, seat: 0, name: msg.name || "Kurucu" }], host: ws };
      rooms.set(code, room);
      ws.room = code;
      ws.seat = 0;
      send(ws, { t: "room", code, seat: 0, host: true, players: roster(room) });
    }
    if (msg.t === "join") {
      const room = roomOf(msg.code);
      if (!room) return send(ws, { t: "error", text: "Oda yok." });
      if (room.players.length >= 4) return send(ws, { t: "error", text: "Masa dolu." });
      const seat = [0, 1, 2, 3].find(n => !room.players.some(p => p.seat === n));
      room.players.push({ ws, seat, name: msg.name || "Oyuncu" });
      ws.room = room.code;
      ws.seat = seat;
      send(ws, { t: "room", code: room.code, seat, host: false, players: roster(room) });
      broadcast(room, { t: "roster", players: roster(room) });
    }
    if (msg.t === "state" || msg.t === "act" || msg.t === "start") {
      const room = roomOf(ws.room);
      if (!room) return;
      broadcast(room, msg, ws);
      if (msg.t !== "act") send(ws, msg);
    }
    if (msg.t === "signal") {
      const room = roomOf(ws.room);
      if (!room) return;
      const target = room.players.find(p => p.seat === msg.to);
      if (target) send(target.ws, { t: "signal", from: ws.seat, data: msg.data });
    }
    if (msg.t === "talk") {
      const room = roomOf(ws.room);
      if (!room) return;
      if (msg.on && room.talker != null && room.talker !== ws.seat) {
        return send(ws, { t: "talk", ok: false, talker: room.talker });
      }
      room.talker = msg.on ? ws.seat : (room.talker === ws.seat ? null : room.talker);
      const out = { t: "talk", seat: ws.seat, on: !!msg.on, talker: room.talker };
      broadcast(room, out);
      send(ws, out);
    }
  });
  ws.on("close", () => {
    const room = roomOf(ws.room);
    if (!room) return;
    room.players = room.players.filter(p => p.ws !== ws);
    if (!room.players.length) rooms.delete(room.code);
    else broadcast(room, { t: "roster", players: roster(room) });
  });
});

server.listen(port, () => console.log("Bizbize Okey " + port));
