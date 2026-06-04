import http from "node:http";
import { URL } from "node:url";

const listenHost = process.env.VOICEVOX_PROXY_HOST || "127.0.0.1";
const listenPort = Number(process.env.VOICEVOX_PROXY_PORT || process.env.PORT || 5510);
const targetBase = String(process.env.VOICEVOX_ENGINE_URL || "http://127.0.0.1:50021").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Accept,Origin,Authorization",
  "Access-Control-Max-Age": "86400"
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  try {
    const targetUrl = new URL(req.url || "/", targetBase);
    const body = await readBody(req);
    const headers = {...req.headers};
    delete headers.host;
    delete headers.origin;

    if (body.length) {
      headers["content-length"] = String(body.length);
    } else {
      delete headers["content-length"];
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body.length ? body : undefined
    });

    const responseHeaders = Object.fromEntries(upstream.headers.entries());
    delete responseHeaders["content-encoding"];
    delete responseHeaders["transfer-encoding"];
    delete responseHeaders["access-control-allow-origin"];

    res.writeHead(upstream.status, {
      ...responseHeaders,
      ...corsHeaders
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    sendJson(res, 502, {
      error: "VOICEVOX proxy failed",
      target: targetBase,
      message: err && err.message ? err.message : String(err)
    });
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(`VOICEVOX CORS proxy listening: http://${listenHost}:${listenPort}`);
  console.log(`Forwarding to: ${targetBase}`);
});
