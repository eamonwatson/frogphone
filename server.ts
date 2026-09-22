import { createServer } from "node:https";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generate } from "selfsigned";

const PORT = Number(process.env.PORT) || 8080;

const certDir = new URL("./.certs/", import.meta.url);
const keyPath = new URL("key.pem", certDir);
const certPath = new URL("cert.pem", certDir);

async function loadOrCreateCert() {
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  }
  const pems = await generate([], {
    notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
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
  console.log(`frogphone listening on https://0.0.0.0:${PORT}/phone`);
});
