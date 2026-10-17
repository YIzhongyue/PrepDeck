// In-memory build and loopback-only server for the isolated discovery prototype.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export async function serve() {
  const { outputFiles } = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Prototype from './Prototype.tsx';
    createRoot(document.getElementById('root')).render(<Prototype/>);
  `, loader: "tsx", resolveDir: fileURLToPath(new URL("./", import.meta.url)) },
  bundle: true, write: false, outfile: "prototype.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    const file = outputFiles.find(output => `/${output.path.split(/[\\/]/).at(-1)}` === request.url);
    if (request.method !== "GET") { response.writeHead(405); response.end("No writes in discovery"); return; }
    if (file) { response.setHeader("Content-Type", request.url.endsWith("css") ? "text/css" : "text/javascript"); response.end(file.contents); return; }
    if (request.url !== "/" && request.url !== "/favicon.ico") { response.writeHead(404); response.end("Not found"); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Component authoring discovery</title><link rel="stylesheet" href="/prototype.css"></head><body><div id="root"></div><script src="/prototype.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv.includes("--serve")) {
  const fixture = await serve();
  console.log(`Synthetic discovery only: ${fixture.origin}`);
  process.on("SIGINT", async () => { await fixture.close(); process.exit(0); });
}
