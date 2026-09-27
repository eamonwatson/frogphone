#!/usr/bin/env node
import { createServer } from "node:https";
import type { ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { buffer, json } from "node:stream/consumers";
import { generate } from "selfsigned";

const PORT = Number(process.env.PORT) || 8080;

const certDir = join(homedir(), ".frogphone", "certs");
const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");

const lanIp =
  Object.values(networkInterfaces()).flat().find((i) => i?.family === "IPv4" && !i.internal)?.address ?? "127.0.0.1";

async function loadOrCreateCert() {
  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      const cert = readFileSync(certPath);
      const x509 = new X509Certificate(cert);
      const validTo = Date.parse(x509.validTo);
      const validityDays = (validTo - Date.parse(x509.validFrom)) / (24 * 60 * 60 * 1000);
      if (
        validTo > Date.now() &&
        validityDays <= 398 &&
        x509.checkIP(lanIp) &&
        x509.checkIP("127.0.0.1") &&
        x509.checkHost("localhost")
      ) {
        return { key: readFileSync(keyPath), cert };
      }
    } catch {}
  }
  const ips = [...new Set([lanIp, "127.0.0.1"])];
  const pems = await generate([{ name: "commonName", value: "frogphone" }], {
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: "localhost" }, ...ips.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  mkdirSync(certDir, { recursive: true });
  writeFileSync(keyPath, pems.private);
  writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

const phonePage = readFileSync(new URL("./public/phone.html", import.meta.url), "utf8");
const displayPage = readFileSync(new URL("./public/display.html", import.meta.url), "utf8");

let latestFrame: Buffer | null = null;

type Rect = { x1: number; y1: number; x2: number; y2: number; color: string };

let board = { width: 0, height: 0, pixels: [] as string[] };
const displays = new Set<ServerResponse>();

const frame = () => `data: ${JSON.stringify(board)}\n\n`;

function broadcast() {
  const msg = frame();
  for (const res of displays) res.write(msg);
}

function resize(width: number, height: number) {
  const pixels = Array<string>(width * height).fill("#000");
  for (let y = 0; y < Math.min(height, board.height); y++) {
    for (let x = 0; x < Math.min(width, board.width); x++) {
      pixels[y * width + x] = board.pixels[y * board.width + x];
    }
  }
  board = { width, height, pixels };
}

function fill({ x1, y1, x2, y2, color }: Rect) {
  const left = Math.max(0, Math.min(x1, x2));
  const right = Math.min(board.width - 1, Math.max(x1, x2));
  const top = Math.max(0, Math.min(y1, y2));
  const bottom = Math.min(board.height - 1, Math.max(y1, y2));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) board.pixels[y * board.width + x] = color;
  }
}

function isRect(r: any): r is Rect {
  return (
    ["x1", "y1", "x2", "y2"].every((k) => Number.isInteger(r?.[k])) &&
    typeof r.color === "string" &&
    /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(r.color)
  );
}


const server = createServer(await loadOrCreateCert(), async (req, res) => {
  const url = new URL(req.url ?? "/", "https://x");
  const path = url.pathname;

  if (req.method === "GET" && path === "/phone") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(phonePage);
    return;
  }

  if (req.method === "GET" && path === "/camera") {
    if (!latestFrame) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(latestFrame);
    return;
  }

  if (req.method === "POST" && path === "/ingest") {
    latestFrame = await buffer(req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && path === "/display") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(displayPage);
    return;
  }

  if (req.method === "GET" && path === "/display/events") {
    const width = Number(url.searchParams.get("w"));
    const height = Number(url.searchParams.get("h"));
    if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 1000)) {
      res.writeHead(400);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    displays.add(res);
    req.on("close", () => displays.delete(res));
    if (width === board.width && height === board.height) {
      res.write(frame());
    } else {
      resize(width, height);
      broadcast();
    }
    return;
  }

  if (req.method === "GET" && path === "/display/led") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(board));
    return;
  }

  if (req.method === "POST" && path === "/display/led") {
    const body = await json(req).catch(() => undefined) as any;
    const rects = body?.rects ?? [];
    if (!body || !Array.isArray(rects) || !rects.every(isRect)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end('expected {"clear"?: true, "rects": [{"x1","y1","x2","y2","color":"#rrggbb"}]}\n');
      return;
    }
    if (body.clear) board.pixels.fill("#000");
    rects.forEach(fill);
    broadcast();
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`frogphone listening on https://${lanIp}:${PORT}/phone`);
});
