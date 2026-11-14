import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  KeyRound,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

type AgentTabId = 'antigravity' | 'claude-code' | 'claude-desktop' | 'cursor' | 'windsurf' | 'gemini-cli' | 'cline' | 'openapi';

const CANONICAL_MCP_URL = 'https://crypto.auraajenticai.cloud/mcp';
const INFO_URL = 'https://crypto.auraajenticai.cloud/mcp/info';
const OPENAPI_URL = 'https://crypto.auraajenticai.cloud/mcp/openapi.json';
const PLUGIN_URL = 'https://crypto.auraajenticai.cloud/mcp/plugin.json';
const GITHUB_REPO_URL = 'https://github.com/khondokartowsif171/cryptotradeanalysis-public';

const AGENT_TABS: Array<{ id: AgentTabId; label: string; pathHint: string; snippet: string }> = [
  {
    id: 'antigravity',
    label: 'Antigravity',
    pathHint: '~/.gemini/antigravity/mcp_config.json',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'aura-cryptox-mcp': {
            serverUrl: CANONICAL_MCP_URL,
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    pathHint: 'Run in terminal (Public Read-Only or VIP Bearer)',
    snippet: `# Public read-only (8 tools)\nclaude mcp add --transport http aura-cryptox ${CANONICAL_MCP_URL}\n\n# Pro / VIP multi-asset & synced portfolio\nclaude mcp add --transport http --header "Authorization: Bearer YOUR_CRX_LIVE_KEY" aura-cryptox ${CANONICAL_MCP_URL}`,
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    pathHint: 'claude_desktop_config.json',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'aura-cryptox': {
            command: 'npx',
            args: ['-y', 'mcp-remote', CANONICAL_MCP_URL],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    pathHint: '~/.cursor/mcp.json',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'aura-cryptox': {
            url: CANONICAL_MCP_URL,
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    pathHint: '~/.codeium/windsurf/mcp_config.json',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'aura-cryptox': {
            serverUrl: CANONICAL_MCP_URL,
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    pathHint: '~/.gemini/settings.json',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'aura-cryptox': {
            httpUrl: CANONICAL_MCP_URL,
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: 'cline',
    label: 'Cline / Continue',
    pathHint: 'cline_mcp_settings.json',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'aura-cryptox': {
            url: CANONICAL_MCP_URL,
            type: 'streamableHttp',
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: 'openapi',
    label: 'OpenAI / LangChain',
    pathHint: 'OpenAPI 3.1.0 Schema URL for GPT Actions & Custom Tools',
    snippet: `OpenAPI Schema URL:\n${OPENAPI_URL}\n\nUniversal Plugin Manifest:\n${PLUGIN_URL}\n\nPOST ${CANONICAL_MCP_URL}\nContent-Type: application/json\nOptional Header: Authorization: Bearer crx_live_...`,
  },
];

const TESTABLE_TOOLS: Array<{ name: string; label: string; defaultArgs: Record<string, unknown> }> = [
  { name: 'crypto_get_live_price', label: 'crypto_get_live_price (Live Binance Spot)', defaultArgs: { symbol: 'BTC' } },
  { name: 'crypto_get_market_overview', label: 'crypto_get_market_overview (Global Market + Fear & Greed)', defaultArgs: {} },
  { name: 'crypto_get_trading_signals', label: 'crypto_get_trading_signals (Closed-Candle Quant)', defaultArgs: { symbol: 'BTC' } },
  { name: 'crypto_get_latest_news', label: 'crypto_get_latest_news (MongoDB / Cointelegraph)', defaultArgs: { limit: 5 } },
  {
    name: 'crypto_check_wallet_portfolio',
    label: 'crypto_check_wallet_portfolio (Public EVM Audit)',
    defaultArgs: { walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  },
  { name: 'crypto_get_token_metadata', label: 'crypto_get_token_metadata (Contract & Explorer)', defaultArgs: { symbol: 'ETH' } },
  {
    name: 'crypto_calculate_dex_swap',
    label: 'crypto_calculate_dex_swap (AMM Price Quote)',
    defaultArgs: { fromToken: 'ETH', toToken: 'USDT', amount: 1 },
  },
  {
    name: 'crypto_simulate_trade',
    label: 'crypto_simulate_trade (Paper Risk Simulator)',
    defaultArgs: { symbol: 'BTC', side: 'BUY', amountUsd: 100, leverage: 2 },
  },
];

export const McpGuidePage: React.FC = () => {
  const [selectedAgent, setSelectedAgent] = useState<AgentTabId>('antigravity');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [probeState, setProbeState] = useState<{
    loading: boolean;
    ok: boolean;
    latencyMs: number | null;
    version?: string;
    protocol?: string;
    capabilitiesCount?: number;
    error?: string;
  }>({ loading: true, ok: false, latencyMs: null });

  const [selectedTool, setSelectedTool] = useState<string>(TESTABLE_TOOLS[0].name);
  const [toolArgsJson, setToolArgsJson] = useState<string>(JSON.stringify(TESTABLE_TOOLS[0].defaultArgs, null, 2));
  const [bearerKey, setBearerKey] = useState<string>('');
  const [executing, setExecuting] = useState<boolean>(false);
  const [toolResult, setToolResult] = useState<{
    ok: boolean;
    status: number;
    latencyMs: number;
    payload: unknown;
  } | null>(null);

  const mcpBaseOrigin =
    typeof window !== 'undefined' && window.location.hostname === 'crypto.auraajenticai.cloud'
      ? ''
      : 'https://crypto.auraajenticai.cloud';

  const probeServer = async () => {
    setProbeState((prev) => ({ ...prev, loading: true, error: undefined }));
    const t0 = performance.now();
    try {
      const res = await fetch(`${mcpBaseOrigin}/mcp/info`, {
        headers: { Accept: 'application/json' },
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProbeState({
        loading: false,
        ok: true,
        latencyMs,
        version: data.version || '1.3.0',
        protocol: data.protocol || '2025-03-26',
        capabilitiesCount: Array.isArray(data.capabilities) ? data.capabilities.length : 8,
      });
    } catch (err: any) {
      setProbeState({
        loading: false,
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        error: err?.message || 'Unable to reach /mcp/info',
      });
    }
  };

  useEffect(() => {
    void probeServer();
  }, []);

  const copyValue = async (id: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      toast({ title: 'Copy failed', description: 'Select and copy the snippet manually.', variant: 'destructive' });
    }
  };

  const handleSelectTool = (name: string) => {
    setSelectedTool(name);
    const meta = TESTABLE_TOOLS.find((t) => t.name === name);
    setToolArgsJson(JSON.stringify(meta?.defaultArgs ?? {}, null, 2));
  };

  const executeLiveMcpTool = async () => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = toolArgsJson.trim() ? JSON.parse(toolArgsJson) : {};
    } catch {
      toast({ title: 'Invalid JSON arguments', description: 'Check the JSON syntax before executing.', variant: 'destructive' });
      return;
    }

    setExecuting(true);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (bearerKey.trim()) {
        headers.Authorization = `Bearer ${bearerKey.trim()}`;
      }
      const res = await fetch(`${mcpBaseOrigin}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: selectedTool,
            arguments: parsedArgs,
          },
        }),
      });
      const latencyMs = Math.round(performance.now() - t0);
      const text = await res.text();
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // Keep raw text if server returned SSE or non-JSON
      }
      setToolResult({ ok: res.ok, status: res.status, latencyMs, payload });
    } catch (err: any) {
      setToolResult({
        ok: false,
        status: 0,
        latencyMs: Math.round(performance.now() - t0),
        payload: { error: err?.message || 'Network request failed' },
      });
    } finally {
      setExecuting(false);
    }
  };

  const activeAgent = AGENT_TABS.find((t) => t.id === selectedAgent) || AGENT_TABS[0];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-card p-6 md:p-8 border-[#F0B90B]/20 relative overflow-hidden">
        <div className="absolute -right-24 -top-24 w-72 h-72 rounded-full bg-[#F0B90B]/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-xs font-medium text-[#F0B90B]">
              <Cpu className="w-3.5 h-3.5" />
              Universal Streamable HTTP MCP · Protocol {probeState.protocol || '2025-03-26'}
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              Connect Any AI Agent to <span className="gold-text">Aura CryptoX</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              One canonical production MCP gateway powering Antigravity, Claude Code, Claude Desktop, Cursor, Windsurf,
              Gemini CLI, Cline, and OpenAI Actions with closed-candle quant signals, Binance live prices, and EVM
              on-chain audits.
            </p>
          </div>

          <div className="glass-card p-4 min-w-[260px] space-y-2 border-white/10">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Live Gateway Status</span>
              <button
                type="button"
                onClick={() => void probeServer()}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${probeState.loading ? 'animate-spin' : ''}`} /> Probe
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  probeState.loading ? 'bg-amber-400 animate-pulse' : probeState.ok ? 'bg-emerald-400' : 'bg-red-500'
                }`}
              />
              <span className="text-sm font-semibold">
                {probeState.loading
                  ? 'Checking MCP gateway...'
                  : probeState.ok
                  ? `ONLINE · v${probeState.version}`
                  : `OFFLINE (${probeState.error || 'Error'})`}
              </span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center justify-between pt-1">
              <span>Latency: {probeState.latencyMs !== null ? `${probeState.latencyMs}ms` : '—'}</span>
              <span>Capabilities: {probeState.capabilitiesCount ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* Canonical URLs Strip */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { id: 'mcp', label: 'Canonical MCP URL', value: CANONICAL_MCP_URL },
            { id: 'info', label: 'Discovery & Info JSON', value: INFO_URL },
            { id: 'openapi', label: 'OpenAPI 3.1 Spec', value: OPENAPI_URL },
            { id: 'plugin', label: 'Universal Plugin Manifest', value: PLUGIN_URL },
          ].map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-secondary/60 border border-border/60"
            >
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
                <div className="text-xs font-mono truncate text-foreground">{item.value}</div>
              </div>
              <button
                type="button"
                onClick={() => void copyValue(item.id, item.value, item.label)}
                className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground shrink-0"
                title={`Copy ${item.label}`}
              >
                {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-Agent Config Selector + VIP Auth */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#F0B90B]" />
              One-Click Agent Configurations
            </h3>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#F0B90B] hover:underline inline-flex items-center gap-1"
            >
              Source Plugin &amp; GitHub Repo <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {AGENT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedAgent(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedAgent === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">{activeAgent.pathHint}</span>
              <button
                type="button"
                onClick={() => void copyValue(`agent-${activeAgent.id}`, activeAgent.snippet, `${activeAgent.label} config`)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-secondary/80 text-foreground"
              >
                {copiedId === `agent-${activeAgent.id}` ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy Snippet
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
              {activeAgent.snippet}
            </pre>
          </div>
        </div>

        {/* Auth Tiers Card */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#F0B90B]" />
            Public vs Pro/VIP Access
          </h3>
          <div className="space-y-3 text-xs leading-relaxed">
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
              <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Public Anonymous (No Key Needed)
              </div>
              <p className="text-muted-foreground">
                8 safe read-only &amp; simulation tools work out of the box: Binance live prices, market overview, BTC/ETH/SOL
                closed-candle quant signals, news, EVM wallet audits, token metadata, swap quotes, and paper trades.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1">
              <div className="font-semibold text-[#F0B90B] flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5" /> Pro / VIP Bearer Mode
              </div>
              <p className="text-muted-foreground">
                Pass <code className="text-foreground">Authorization: Bearer crx_live_...</code> to unlock VIP multi-asset
                quant coverage, higher request context, and synced portfolio/watchlist state. Generate your key inside{' '}
                <strong>Pricing / Client API Keys</strong> when signed in as VIP.
              </p>
            </div>

            <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-3">
              <strong>Note:</strong> Public Streamable HTTP MCP never places real exchange orders (`liveTrading: false`).
            </div>
          </div>
        </div>
      </div>

      {/* Live Interactive MCP Tool Tester */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#F0B90B]" />
              Live Interactive MCP Tool Tester
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Calls <code className="font-mono">POST /mcp</code> directly against live server &amp; Binance feeds (no mocks).
            </p>
          </div>
          {toolResult && (
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`px-2 py-0.5 rounded font-mono ${
                  toolResult.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}
              >
                HTTP {toolResult.status}
              </span>
              <span className="text-muted-foreground font-mono">{toolResult.latencyMs}ms</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">MCP Tool</label>
              <select
                aria-label="MCP Tool"
                value={selectedTool}
                onChange={(e) => handleSelectTool(e.target.value)}
                className="w-full rounded-lg bg-secondary/70 border border-border px-3 py-2 text-xs font-mono"
              >
                {TESTABLE_TOOLS.map((tool) => (
                  <option key={tool.name} value={tool.name}>
                    {tool.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Optional VIP Bearer Token (`crx_live_...` or JWT)
              </label>
              <input
                type="password"
                value={bearerKey}
                onChange={(e) => setBearerKey(e.target.value)}
                placeholder="Leave blank for anonymous public read-only test"
                className="w-full rounded-lg bg-secondary/70 border border-border px-3 py-2 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tool Arguments (JSON)</label>
              <textarea
                rows={4}
                value={toolArgsJson}
                onChange={(e) => setToolArgsJson(e.target.value)}
                className="w-full rounded-lg bg-black/50 border border-border px-3 py-2 text-xs font-mono"
              />
            </div>

            <button
              type="button"
              disabled={executing}
              onClick={() => void executeLiveMcpTool()}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-[#F0B90B] to-[#F8D12F] text-black px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50"
            >
              {executing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {executing ? 'Calling Live MCP...' : 'Execute Live MCP Tool'}
            </button>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground mb-1">
              <span>Live JSON-RPC Response</span>
              <Activity className="w-3.5 h-3.5 text-[#F0B90B]" />
            </div>
            <pre className="flex-1 min-h-[220px] max-h-[360px] overflow-auto p-3.5 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono text-sky-200 whitespace-pre-wrap">
              {toolResult
                ? JSON.stringify(toolResult.payload, null, 2)
                : 'Select a tool and click "Execute Live MCP Tool" to test live JSON-RPC execution from your browser.'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
