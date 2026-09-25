#!/usr/bin/env node
import { createServer } from "node:https";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
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
    notAfterDate: new Date(Date.now() + 397 * 24 * 60 * 60 * 1000),
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

let latestFrame: Buffer | null = null;

const server = createServer(await loadOrCreateCert(), (req, res) => {
  if (req.method === "GET" && req.url === "/phone") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(phonePage);
    return;
  }

  if (req.method === "GET" && req.url === "/camera") {
    if (!latestFrame) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(latestFrame);
    return;
  }

  if (req.method === "POST" && req.url === "/ingest") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      latestFrame = Buffer.concat(chunks);
      res.writeHead(204);
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`frogphone listening on https://${lanIp}:${PORT}/phone`);
});
