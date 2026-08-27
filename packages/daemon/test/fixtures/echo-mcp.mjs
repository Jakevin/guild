let buf = Buffer.alloc(0);
function send(obj) {
  const json = JSON.stringify(obj);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx < 0) break;
    const header = buf.subarray(0, idx).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buf = buf.subarray(idx + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = idx + 4;
    if (buf.length < start + length) break;
    const msg = JSON.parse(buf.subarray(start, start + length).toString("utf8"));
    buf = buf.subarray(start + length);
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "echo", version: "0" },
        },
      });
      continue;
    }
    if (msg.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo text",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        },
      });
      continue;
    }
    if (msg.method === "tools/call") {
      const text = String((msg.params && msg.params.arguments && msg.params.arguments.text) || "");
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text }] },
      });
      continue;
    }
    if (typeof msg.id === "number") send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
