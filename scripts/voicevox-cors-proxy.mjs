import http from "node:http";

const listenPort = Number(process.env.VOICEVOX_PROXY_PORT || 5510);
const targetBase = String(process.env.VOICEVOX_TARGET || "http://127.0.0.1:50021").replace(/\/+$/, "");

const sendCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
};

const server = http.createServer(async (req, res) => {
  try {
    sendCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const urlPath = req.url || "/";
    const targetUrl = targetBase + urlPath;

    const bodyChunks = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const bodyBuffer = bodyChunks.length ? Buffer.concat(bodyChunks) : undefined;

    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders.host;
    delete outgoingHeaders.origin;
    delete outgoingHeaders.referer;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: bodyBuffer,
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-length") return;
      res.setHeader(key, value);
    });
    sendCors(res);

    const arr = await response.arrayBuffer();
    res.end(Buffer.from(arr));
  } catch (error) {
    res.statusCode = 502;
    sendCors(res);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: "proxy_failed",
      message: error instanceof Error ? error.message : String(error),
      targetBase,
    }));
  }
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`[voicevox-proxy] listening: http://127.0.0.1:${listenPort}`);
  console.log(`[voicevox-proxy] target: ${targetBase}`);
});
