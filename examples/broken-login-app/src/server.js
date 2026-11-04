import { createServer } from "node:http";
import { config } from "./config.js";
import { handleLogin } from "./routes/login.js";

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/login") {
    let raw = "";
    for await (const chunk of req) raw += chunk;

    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid JSON." }));
    }

    const result = handleLogin(body);
    res.writeHead(result.status, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(result.body));
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found." }));
});

server.listen(config.port, () => {
  console.log(`broken-login-app listening on http://localhost:${config.port}`);
});
