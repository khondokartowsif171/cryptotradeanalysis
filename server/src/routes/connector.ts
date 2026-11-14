import { createHash } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCryptoMcpServer } from '../mcp/server.js';
import { database } from '../billing/database.js';
import { loadClientUser } from '../billing/store.js';
import type { AuthPayload } from '../middleware/auth.js';

const router = Router();
const endpoint = 'https://crypto.auraajenticai.cloud/mcp';
const allowedOrigins = new Set([
  'https://crypto.auraajenticai.cloud', 'https://cryptox-api.auraajenticai.cloud',
  'https://cryptox.auraajenticai.cloud', 'https://cryptotradeanalysis.vercel.app',
  'https://chatgpt.com', 'https://chat.openai.com',
]);

async function resolveBearerUser(req: Request): Promise<{ userId: string; email: string; tier: 'free' | 'pro' | 'vip' } | null> {
  const auth = req.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  if (/^crx_live_[A-Za-z0-9_-]{43}$/.test(token)) {
    const hash = createHash('sha256').update(token).digest('hex');
    const row = (await database.query('SELECT id, user_id FROM client_api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()', [hash])).rows[0];
    if (!row) throw new Error('Invalid or expired client API key');
    const user = await loadClientUser(database.query, row.user_id);
    if (!user || user.tier !== 'vip') throw new Error('Active VIP subscription required for client API key');
    await database.query('UPDATE client_api_keys SET last_used_at=NOW() WHERE id=$1', [row.id]);
    return { userId: user.id, email: user.email, tier: user.tier };
  }

  try {
    const secret = process.env.JWT_SECRET || 'cryptox-dev-secret-change-in-production';
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AuthPayload;
    const user = await loadClientUser(database.query, payload.userId);
    if (!user) throw new Error('Account not found');
    return { userId: user.id, email: user.email, tier: user.tier };
  } catch {
    throw new Error('Invalid or expired Bearer token');
  }
}

router.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const universalAgentConfigs = {
  antigravity: {
    mcpServers: {
      'aura-cryptox-mcp': {
        serverUrl: endpoint,
      },
    },
  },
  claudeCode: `claude mcp add --transport http aura-cryptox ${endpoint}`,
  claudeDesktop: {
    mcpServers: {
      'aura-cryptox': {
        command: 'npx',
        args: ['-y', 'mcp-remote', endpoint],
      },
    },
  },
  cursor: {
    mcpServers: {
      'aura-cryptox': {
        url: endpoint,
      },
    },
  },
  windsurf: {
    mcpServers: {
      'aura-cryptox': {
        serverUrl: endpoint,
      },
    },
  },
  geminiCli: {
    mcpServers: {
      'aura-cryptox': {
        httpUrl: endpoint,
      },
    },
  },
  cline: {
    mcpServers: {
      'aura-cryptox': {
        url: endpoint,
        type: 'streamableHttp',
      },
    },
  },
  openAiActions: {
    openApiSpecUrl: `${endpoint}/openapi.json`,
    serverUrl: endpoint,
    authScheme: 'Optional Bearer <crx_live_api_key>',
  },
  pluginManifestUrl: `${endpoint}/plugin.json`,
};

router.get('/info', (_req, res) => {
  res.json({
    name: 'Aura CryptoX', version: '1.3.0', endpoint,
    protocol: '2025-03-26',
    transport: 'Streamable HTTP',
    authentication: 'none (public read-only) or optional Bearer <crx_live_api_key | jwt> (Pro/VIP multi-asset quant feed & synced portfolio)',
    capabilities: [
      'live prices',
      'market overview',
      'closed-candle M15/H1/H4 quant signals + futures funding/OI',
      'news',
      'public wallet lookup',
      'token metadata',
      'swap estimates',
      'paper trade simulation',
      'pro/vip multi-asset signals & synced account (Bearer auth)',
    ],
    privateAccountAccess: 'Bearer token optional for VIP/Pro account sync',
    liveTrading: false,
    setup: { name: 'Aura CryptoX', serverUrl: endpoint, authentication: 'Optional Bearer API Key' },
    testPrompt: 'Use Aura CryptoX to analyze BTC with closed-candle multi-timeframe quant signals and simulate a $100 BUY at 2x leverage.',
    discovery: {
      infoUrl: `${endpoint}/info`,
      openApiUrl: `${endpoint}/openapi.json`,
      pluginManifestUrl: `${endpoint}/plugin.json`,
      repository: 'https://github.com/khondokartowsif171/cryptotradeanalysis',
    },
    agentConfigs: universalAgentConfigs,
  });
});

router.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'Aura CryptoX Universal MCP & Agent API',
      version: '1.3.0',
      description: 'Institutional closed-candle crypto quant signals, live Binance prices, EVM portfolio intelligence, and Streamable HTTP MCP gateway.',
    },
    servers: [
      { url: 'https://crypto.auraajenticai.cloud', description: 'Canonical Production Origin' },
      { url: 'https://cryptox-api.auraajenticai.cloud', description: 'Direct Origin API' },
    ],
    paths: {
      '/mcp': {
        post: {
          operationId: 'invokeMcpJsonRpc',
          summary: 'Invoke Aura CryptoX Streamable HTTP MCP (JSON-RPC 2.0)',
          description: 'Send JSON-RPC 2.0 requests (initialize, tools/list, tools/call). Optional Bearer crx_live_... unlocks Pro/VIP tools.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['jsonrpc', 'method'],
                  properties: {
                    jsonrpc: { type: 'string', enum: ['2.0'] },
                    id: { type: ['integer', 'string'] },
                    method: { type: 'string', example: 'tools/list' },
                    params: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'JSON-RPC 2.0 result payload' },
            '401': { description: 'Invalid Bearer token' },
          },
        },
      },
      '/mcp/info': {
        get: {
          operationId: 'getMcpCapabilities',
          summary: 'Discover MCP endpoint metadata and multi-agent installation configs',
          responses: { '200': { description: 'MCP discovery metadata' } },
        },
      },
      '/mcp/plugin.json': {
        get: {
          operationId: 'getUniversalPluginManifest',
          summary: 'Retrieve universal agent plugin manifest',
          responses: { '200': { description: 'Plugin manifest JSON' } },
        },
      },
      '/api/platform-summary': {
        get: {
          operationId: 'getPlatformSummary',
          summary: 'Retrieve real-time live database counts for users, quant signals, news, and alerts',
          responses: { '200': { description: 'Platform metrics JSON' } },
        },
      },
    },
  });
});

router.get('/plugin.json', (_req, res) => {
  res.json({
    schemaVersion: '1.0',
    name: 'aura-cryptox',
    displayName: 'Aura CryptoX — Institutional Quant & Web3',
    version: '1.3.0',
    description: 'Institutional cryptocurrency quantitative analytics, closed-candle multi-timeframe trading signals (EMA, RSI, MACD, ATR, Futures Funding/OI), EVM on-chain portfolio valuation, and paper trade risk simulation.',
    author: { name: 'Aura Agentic AI', url: 'https://crypto.auraajenticai.cloud' },
    homepage: 'https://crypto.auraajenticai.cloud',
    repository: 'https://github.com/khondokartowsif171/cryptotradeanalysis',
    mcp: {
      transport: 'streamable-http',
      protocolVersion: '2025-03-26',
      serverUrl: endpoint,
      authentication: 'optional-bearer',
    },
    openApiSpec: `${endpoint}/openapi.json`,
    agentConfigs: universalAgentConfigs,
  });
});

router.post('/', async (req, res) => {
  let authenticatedUser: { userId: string; email: string; tier: 'free' | 'pro' | 'vip' } | null = null;
  if (req.get('Authorization')) {
    try {
      authenticatedUser = await resolveBearerUser(req);
    } catch (err: any) {
      return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: err?.message || 'Unauthorized' } });
    }
  }

  const server = createCryptoMcpServer({ publicOnly: true, authenticatedUser });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void server.close().catch(console.error); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Public MCP request failed:', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'Internal server error' } });
  }
});

router.all('/', (req, res) => {
  if (req.method === 'GET' && req.accepts('html') && !req.get('Accept')?.includes('text/event-stream')) {
    return res.redirect('/mcp/info');
  }
  res.setHeader('Allow', 'POST');
  return res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use HTTP POST for the stateless MCP endpoint. Documentation: /mcp/info' } });
});

export default router;

// Support a path-based reverse proxy with either preserved or stripped /mcp.
export const canonicalConnector: RequestHandler = (req, res, next) => {
  if (req.hostname !== 'crypto.auraajenticai.cloud') return next();
  if (req.path === '/mcp' || req.path.startsWith('/mcp/')) {
    req.url = req.url.slice('/mcp'.length) || '/';
  }
  return router(req, res, next);
};
