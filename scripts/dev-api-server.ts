/**
 * Local dev server for /api/* routes (port 3000).
 * Vite proxies /api here during `npm run dev`. Run alongside Vite:
 *   npm run dev:api
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const HOST = '127.0.0.1';
const PORT = Number(process.env.API_DEV_PORT || 3000);

/** Keys that should always come from local files (ignore stale shell env). */
const FORCE_FROM_FILE = new Set(['RIOT_API_KEY']);

function loadEnvFile(filePath: string, forceKeys = false): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (forceKeys && FORCE_FROM_FILE.has(key)) {
      process.env[key] = value;
      continue;
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const cwd = process.cwd();
// .env.local wins for RIOT_API_KEY so a renewed key is not shadowed by shell env.
loadEnvFile(join(cwd, '.env.local'), true);
loadEnvFile(join(cwd, '.env'));
process.env.VERCEL_ENV = process.env.VERCEL_ENV ?? 'development';

type Handler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

/** Auto-register every `api/*.ts` handler (matches Vercel serverless layout). */
function buildRouteLoaders(): Record<string, () => Promise<{ default: Handler }>> {
  const apiDir = join(cwd, 'api');
  const loaders: Record<string, () => Promise<{ default: Handler }>> = {};
  if (!existsSync(apiDir)) return loaders;
  for (const file of readdirSync(apiDir)) {
    if (!file.endsWith('.ts')) continue;
    const routeName = file.replace(/\.ts$/, '');
    const route = `/api/${routeName}`;
    const modulePath = `../api/${routeName}`;
    loaders[route] = () => import(modulePath);
  }
  return loaders;
}

const routeLoaders = buildRouteLoaders();

function toVercelResponse(nodeRes: ServerResponse): VercelResponse {
  let statusCode = 200;
  const res = nodeRes as VercelResponse;
  res.status = (code: number) => {
    statusCode = code;
    nodeRes.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    if (!nodeRes.headersSent) {
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    nodeRes.statusCode = statusCode;
    nodeRes.end(JSON.stringify(body));
  };
  res.send = (body: string) => {
    nodeRes.statusCode = statusCode;
    nodeRes.end(body);
  };
  return res;
}

function toVercelRequest(req: IncomingMessage, query: Record<string, string | string[] | undefined>): VercelRequest {
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: query as VercelRequest['query'],
  };
}

function writeJson(nodeRes: ServerResponse, status: number, body: unknown): void {
  nodeRes.statusCode = status;
  nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
  nodeRes.end(JSON.stringify(body));
}

createServer(async (nodeReq, nodeRes) => {
  const parsed = parseUrl(nodeReq.url ?? '/', true);
  const pathname = parsed.pathname ?? '/';
  const loader = routeLoaders[pathname];

  if (!loader) {
    writeJson(nodeRes, 404, { error: `No local API route for ${pathname}` });
    return;
  }

  try {
    const mod = await loader();
    const handler = mod.default;
    const vercelReq = toVercelRequest(nodeReq, parsed.query);
    const vercelRes = toVercelResponse(nodeRes);
    await handler(vercelReq, vercelRes);
    if (!nodeRes.writableEnded) {
      writeJson(nodeRes, 500, { error: 'API handler did not send a response' });
    }
  } catch (err) {
    console.error(`[dev-api] ${pathname}`, err);
    if (!nodeRes.writableEnded) {
      writeJson(nodeRes, 500, {
        error: 'Local API server error',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
}).listen(PORT, HOST, () => {
  const hasKey = Boolean(process.env.RIOT_API_KEY?.trim());
  const routes = Object.keys(routeLoaders).sort().join(', ');
  console.log(`[dev-api] http://${HOST}:${PORT} (RIOT_API_KEY ${hasKey ? 'loaded' : 'missing — add to .env.local'})`);
  console.log(`[dev-api] routes: ${routes || '(none)'}`);
});
