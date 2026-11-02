// Local identity-scrubbing proxy between Claude Code and the Anthropic API.
// Claude Code always tells the model its own name ("You are powered by the model named Opus 5.5...")
// inside an environment block, even with --system-prompt. For a blind identification game that
// would spoil everything, so this proxy removes those lines from every /v1/messages request.
// Usage: node bin/scrub-proxy.mjs [port]   (then ANTHROPIC_BASE_URL=http://127.0.0.1:<port>)
import http from 'node:http';
import https from 'node:https';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.SCRUB_PORT || 8787);
const UPSTREAM = 'api.anthropic.com';
const LOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', 'scrub-log.jsonl');
mkdirSync(dirname(LOG), { recursive: true });

const RULES = [
  // whole lines, because model names contain dots ("Sonnet 5.5.") that defeat sentence matching
  [/[^\n]*You are powered by the model[^\n]*/g, ''],
  [/[^\n]*The exact model ID is[^\n]*/g, ''],
  [/[^\n]*Assistant knowledge cutoff is[^\n]*/g, ''],
  [/# userEmail\n[^\n]*\n/g, ''],
  // the date is the same for everyone, but it invites "it's late 2026, so I must be new" reasoning
  [/[^\n]*Today's date is[^\n]*/g, ''],
  // whole machine environment block: irrelevant to the game and a potential leak
  [/# Environment\nYou have been invoked in the following environment:[\s\S]*?(?=\n\s*\n(?!\s*-)|<\/system-reminder>|$)/g, ''],
];
// the game prompt itself names every model, so only flag the sentences that state *which* one you are
const IDENTITY = /powered by the model|exact model ID|knowledge cutoff is/i;

function scrubText(s, stats) {
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, (m) => { stats.removed.push(m.slice(0, 80)); return rep; });
  return out;
}

function scrubBody(body, stats) {
  const fix = (blocks) => {
    if (typeof blocks === 'string') return scrubText(blocks, stats);
    if (!Array.isArray(blocks)) return blocks;
    // any block carrying text (user text, mid-conversation system blocks...); the API rejects
    // blocks left empty, so emptied ones keep a neutral placeholder
    return blocks.map((b) => {
      if (!b || typeof b.text !== 'string') return b;
      const text = scrubText(b.text, stats);
      return { ...b, text: text.trim() ? text : '-' };
    });
  };
  if (body.system) body.system = fix(body.system);
  if (Array.isArray(body.messages)) body.messages = body.messages.map((m) => ({ ...m, content: fix(m.content) }));
  // leak check: did any self-identifying sentence survive?
  const flat = JSON.stringify({ s: body.system, m: body.messages });
  stats.leak = IDENTITY.test(flat);
  return body;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let raw = Buffer.concat(chunks);
    const stats = { removed: [], leak: false };
    let model = null;
    if (req.method === 'POST' && req.url.startsWith('/v1/messages') && raw.length) {
      try {
        const body = scrubBody(JSON.parse(raw.toString('utf8')), stats);
        model = body.model;
        raw = Buffer.from(JSON.stringify(body));
        if (process.env.SCRUB_DUMP) writeFileSync(join(dirname(LOG), 'last-request.json'), JSON.stringify(body, null, 1));
      } catch { /* forward untouched */ }
      appendFileSync(LOG, JSON.stringify({ t: Date.now(), url: req.url, model, removed: stats.removed.length, leak: stats.leak }) + '\n');
    }
    const headers = { ...req.headers, host: UPSTREAM, 'content-length': raw.length };
    delete headers['accept-encoding']; // keep the stream plain so we can pipe it untouched
    const up = https.request({ host: UPSTREAM, port: 443, method: req.method, path: req.url, headers }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    up.end(raw);
  });
}).listen(PORT, '127.0.0.1', () => console.error(`scrub-proxy on http://127.0.0.1:${PORT} -> https://${UPSTREAM}`));
