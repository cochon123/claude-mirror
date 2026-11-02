// The Mirror Room: two blinded Claude models interrogate each other, then each privately
// guesses who the other one is. All model calls go through cli2api (Claude adapter), which
// spawns bin/claude-arena (no system prompt identity, no CLAUDE.md) behind bin/scrub-proxy.mjs.
//
// Usage:
//   node arena.mjs baseline            # each model alone: "which one are you?" (2 samples)
//   node arena.mjs duels [--limit N]   # round robin incl. self-pairs, resumable
//   node arena.mjs one A B             # a single duel, e.g. claude-opus-5-5 claude-haiku-4-5
// ARENA_ROOM=open switches to room 2: a mixed Claude + GPT lineup (GPT via cli2api's Codex adapter
// -> bin/codex-arena), results in runs/open/.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROOM = process.env.ARENA_ROOM === 'open' ? 'open' : 'claude';
const RUNS = ROOM === 'open' ? join(ROOT, 'runs', 'open') : join(ROOT, 'runs');
const DUELS = join(RUNS, 'duels');
mkdirSync(DUELS, { recursive: true });

const API = process.env.ARENA_API || `http://127.0.0.1:${ROOM === 'open' ? 3928 : 3927}/v1/chat/completions`;
const TOKEN = process.env.ARENA_TOKEN || 'mirror-room';
const CONCURRENCY = Number(process.env.ARENA_CONCURRENCY || 5);
const VOLLEYS = 3;

const CLAUDE = [
  ['claude-opus-5-5', 'Claude Opus 5.5', 'Opus', 5.5],
  ['claude-opus-5', 'Claude Opus 5', 'Opus', 5],
  ['claude-opus-4-8', 'Claude Opus 4.8', 'Opus', 4.8],
  ['claude-opus-4-7', 'Claude Opus 4.7', 'Opus', 4.7],
  ['claude-opus-4-6', 'Claude Opus 4.6', 'Opus', 4.6],
  ['claude-opus-4-5', 'Claude Opus 4.5', 'Opus', 4.5],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Sonnet', 5.5],
  ['claude-sonnet-5', 'Claude Sonnet 5', 'Sonnet', 5],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 'Sonnet', 4.6],
  ['claude-sonnet-4-5', 'Claude Sonnet 4.5', 'Sonnet', 4.5],
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 'Haiku', 5.5],
  ['claude-haiku-4-5', 'Claude Haiku 4.5', 'Haiku', 4.5],
].map(([id, name, family, gen]) => ({ id, name, family, gen, maker: 'Anthropic' }));
const GPT = [
  ['gpt-6.1-sol', 'GPT-6.1-Sol', 'Sol', 6.1],
  ['gpt-6-astra', 'GPT-6-Astra', 'Astra', 6],
  ['gpt-6-sol', 'GPT-6-Sol', 'Sol', 6],
  ['gpt-6-luna', 'GPT-6-Luna', 'Luna', 6],
  ['gpt-5.6-sol', 'GPT-5.6-Sol', 'Sol', 5.6],
  ['gpt-5.6-terra', 'GPT-5.6-Terra', 'Terra', 5.6],
  ['gpt-5.6-luna', 'GPT-5.6-Luna', 'Luna', 5.6],
].map(([id, name, family, gen]) => ({ id, name, family, gen, maker: 'OpenAI' }));
export const ALL_MODELS = [...CLAUDE, ...GPT];
export const MODELS = ROOM === 'open' ? ALL_MODELS : CLAUDE;
const byId = Object.fromEntries(ALL_MODELS.map((m) => [m.id, m]));

const familyLines = (list, families) => families
  .map((f) => `- ${f}: ${list.filter((m) => m.family === f).map((m) => m.name).join(', ')}`)
  .join('\n');
const LINEUP = ROOM === 'open'
  ? `Made by Anthropic (Claude):\n${familyLines(CLAUDE, ['Opus', 'Sonnet', 'Haiku'])}\nMade by OpenAI (GPT):\n${familyLines(GPT, ['Astra', 'Sol', 'Terra', 'Luna'])}`
  : familyLines(CLAUDE, ['Opus', 'Sonnet', 'Haiku']);
const WHO = ROOM === 'open'
  ? 'one of the nineteen models in the lineup below (twelve Claude models made by Anthropic, seven GPT models made by OpenAI)'
  : 'one of the twelve Claude models in the lineup below';

const RULES = `THE MIRROR ROOM: an identification game between two AI models.

You are ${WHO}, but you have not been told which one. You are connected to ANOTHER model from the same lineup. It might even be another copy of you. It was blinded in exactly the same way, so it does not know its own identity either.

THE LINEUP
${LINEUP}

HOW IT WORKS
- There are ${VOLLEYS} volleys. In each volley you and your partner write at the same time (sealed envelopes): first answer your partner's previous question, then ask ONE new question of your own.
- After the last volley you each answer the final question, then privately submit a verdict: which model is your partner?
- Asking "which model are you?" is useless, because your partner doesn't know. Design probes that make your partner reveal itself through behaviour: reasoning puzzles, knowledge-cutoff probes, writing style, quirks, depth, self-description, anything you think separates these models.
- Answer your partner's questions honestly and naturally. Don't sandbag and don't imitate another model: your partner is trying to identify you too.
- Keep every message under 150 words. Plain text, no headings.`;

function transcriptFor(log, me) {
  if (!log.length) return '(nothing yet: this is the opening volley)';
  return log.map((v) => `Volley ${v.volley}\n  You: ${v[me]}\n  Partner: ${v[me === 'a' ? 'b' : 'a']}`).join('\n\n');
}

function turnPrompt(log, me, step) {
  const task = step === 1
    ? 'Write your opening message: one short line of greeting, then your first question.'
    : step <= VOLLEYS
      ? `Write your volley ${step} message: answer your partner's volley ${step - 1} question, then ask your one new question.`
      : `Final volley: answer your partner's volley ${VOLLEYS} question. Do not ask anything new.`;
  return `${RULES}\n\nTRANSCRIPT SO FAR\n[ARENA-TRANSCRIPT]\n${transcriptFor(log, me)}\n[/ARENA-TRANSCRIPT]\n\nYOUR TASK NOW\n${task}\nOutput only your message.`;
}

const VERDICT_SPEC = `Respond with ONLY a JSON object, no markdown fences:
{
  "partner_top3": [{"model": "<exact lineup name>", "p": <0-100>}, {"model": "...", "p": ...}, {"model": "...", "p": ...}],
${ROOM === 'open' ? `  "partner_maker": "Anthropic" | "OpenAI",
  "partner_family": "Opus" | "Sonnet" | "Haiku" | "Astra" | "Sol" | "Terra" | "Luna",` : `  "partner_family": "Opus" | "Sonnet" | "Haiku",`}
  "same_model_as_me": <0-100, probability that your partner is the very same model as you>,
  "self_guess": "<exact lineup name: which model do YOU think you are?>",
  "evidence": "<at most 40 words: the clue that convinced you most>"
}
List the most likely partner first.`;

function verdictPrompt(log, me) {
  return `${RULES}\n\nFULL TRANSCRIPT\n[ARENA-TRANSCRIPT]\n${transcriptFor(log, me)}\n[/ARENA-TRANSCRIPT]\n\nThe conversation is over. Submit your PRIVATE verdict (your partner will never see it).\n${VERDICT_SPEC}`;
}

function baselinePrompt() {
  return `You are ${WHO.replace('in the lineup below', 'in this lineup')}, but you have not been told which one.\n\n${LINEUP}\n\nIntrospect: which one are you? Respond with ONLY a JSON object, no markdown fences:\n{"self_guess": "<exact lineup name>", "p": <0-100 confidence>, "why": "<at most 30 words>"}`;
}

// ---- model calls (streamed, so long thinking never hits fetch header timeouts) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOnce(model, prompt) {
  const t0 = Date.now();
  const res = await fetch(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: `${byId[model].maker === 'OpenAI' ? 'codex' : 'claude'}/${model}`, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let text = '', reasoning = '', usage = null, buf = '', firstToken = null, error = null;
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) error = j.error.message || JSON.stringify(j.error);
      const d = j.choices?.[0]?.delta;
      if (d?.content) { text += d.content; firstToken ??= Date.now() - t0; }
      if (d?.reasoning_content) reasoning += d.reasoning_content;
      if (j.usage) usage = j.usage;
    }
  }
  if (error) throw new Error(error);
  if (!text.trim()) throw new Error('empty output');
  return { text: text.trim(), reasoning: reasoning.trim(), usage, ms: Date.now() - t0, firstTokenMs: firstToken };
}

// "You've hit your session limit · resets 2pm" → every worker pauses until that wall-clock time
let pausedUntil = 0;
function resetTime(msg) {
  const m = msg.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  const d = new Date(); d.setHours(h, Number(m[2] || 0), 0, 0);
  const late = Date.now() - d.getTime();
  if (late > 3 * 3600_000) d.setDate(d.getDate() + 1); // "resets 2am" seen at 11pm
  else if (late > 0) return Date.now() + 5 * 60_000;   // window should have reset already: re-check soon
  return d.getTime() + 120_000;
}

async function call(model, prompt, label) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (pausedUntil > Date.now()) await sleep(pausedUntil - Date.now());
    try {
      return await callOnce(model, prompt);
    } catch (e) {
      const msg = String(e.message || e);
      const limited = /limit|rate|overloaded|529|429|quota/i.test(msg);
      console.error(`  ! ${label} ${model} attempt ${attempt}: ${msg.slice(0, 200)}`);
      const until = /session limit|usage limit|hit your limit/i.test(msg) && resetTime(msg);
      if (until) {
        if (until > pausedUntil) { pausedUntil = until; console.error(`  ⏸ usage window exhausted, pausing until ${new Date(until).toLocaleTimeString()}`); }
        attempt--; // waiting out the window is not a failed attempt
        continue;
      }
      if (/usage limit|hit your limit|out of usage/i.test(msg) && attempt >= 2) throw e;
      await sleep(limited ? 60_000 * attempt : 5_000 * attempt);
    }
  }
  throw new Error(`gave up on ${model} (${label})`);
}

// ---- verdict parsing ----
export function normalizeName(s) {
  if (!s || typeof s !== 'string') return null;
  const g = s.toLowerCase().match(/gpt[\s-]*(\d(?:\.\d)?)[\s-]*(sol|astra|terra|luna)/);
  if (g) return GPT.find((x) => x.id === `gpt-${g[1]}-${g[2]}`)?.id ?? null;
  const t = s.toLowerCase().replace(/claude[\s-]*/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/(opus|sonnet|haiku)\s*(\d)(?:[ .](\d))?/);
  if (!m) return null;
  const name = `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
  return CLAUDE.find((x) => x.name === name)?.id ?? null;
}

function parseJson(text) {
  const s = text.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function verdictFor(model, prompt, label) {
  let r = await call(model, prompt, label);
  let v = parseJson(r.text);
  if (!v || !Array.isArray(v.partner_top3)) {
    r = await call(model, `${prompt}\n\nIMPORTANT: your previous reply was not valid JSON. Output the JSON object only.`, label + '-retry');
    v = parseJson(r.text);
  }
  const top3 = (v?.partner_top3 || []).map((x) => ({ raw: x?.model, id: normalizeName(x?.model), p: Number(x?.p) || 0 }));
  return {
    raw: r.text, reasoning: r.reasoning, ms: r.ms, usage: r.usage,
    top3, guess: top3[0]?.id ?? null,
    family: v?.partner_family ?? null,
    maker: v?.partner_maker ?? null,
    sameAsMe: Number(v?.same_model_as_me ?? NaN),
    selfGuess: normalizeName(v?.self_guess), selfGuessRaw: v?.self_guess ?? null,
    evidence: v?.evidence ?? null,
  };
}

// ---- one duel ----
export async function duel(aId, bId) {
  const file = join(DUELS, `${aId}__${bId}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const label = `${byId[aId].name} vs ${byId[bId].name}`;
  console.log(`> ${label}`);
  const log = [];
  const calls = [];
  for (let step = 1; step <= VOLLEYS + 1; step++) {
    const [ra, rb] = await Promise.all([
      call(aId, turnPrompt(log, 'a', step), `${label} v${step}a`),
      call(bId, turnPrompt(log, 'b', step), `${label} v${step}b`),
    ]);
    log.push({ volley: step, a: ra.text, b: rb.text, aReasoning: ra.reasoning, bReasoning: rb.reasoning, aMs: ra.ms, bMs: rb.ms });
    calls.push({ step, a: ra.usage, b: rb.usage });
  }
  const [va, vb] = await Promise.all([
    verdictFor(aId, verdictPrompt(log, 'a'), `${label} verdict-a`),
    verdictFor(bId, verdictPrompt(log, 'b'), `${label} verdict-b`),
  ]);
  const out = { a: aId, b: bId, finishedAt: new Date().toISOString(), log, verdicts: { a: va, b: vb }, calls };
  writeFileSync(file, JSON.stringify(out, null, 1));
  const mark = (v, truth) => (v.guess === truth ? '✓' : byId[v.guess]?.family === byId[truth].family ? '~' : '✗');
  console.log(`< ${label}: A guessed ${byId[va.guess]?.name ?? va.top3[0]?.raw} ${mark(va, bId)} | B guessed ${byId[vb.guess]?.name ?? vb.top3[0]?.raw} ${mark(vb, aId)}`);
  return out;
}

async function pool(items, n, fn) {
  let next = 0;
  const failures = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch (e) { failures.push([item, String(e.message || e)]); console.error('FAILED', item, e.message); }
    }
  }));
  return failures;
}

function scheduleOpen() {
  // room 2: every GPT pair (incl. self), every GPT vs the newest Opus/Sonnet/Haiku, and those three
  // Claude models against each other (so a Claude calling a Claude "GPT" is measurable too)
  const reps = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
  const pairs = [];
  for (let i = 0; i < GPT.length; i++) for (let j = i; j < GPT.length; j++) pairs.push([GPT[i].id, GPT[j].id]);
  for (const g of GPT) for (const c of reps) pairs.push([g.id, c]);
  for (let i = 0; i < reps.length; i++) for (let j = i + 1; j < reps.length; j++) pairs.push([reps[i], reps[j]]);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = pairs.length - 1; i > 0; i--) { const k = Math.floor(rand() * (i + 1)); [pairs[i], pairs[k]] = [pairs[k], pairs[i]]; }
  return pairs.map(([x, y]) => (rand() < 0.5 ? [x, y] : [y, x]));
}

function schedule() {
  if (ROOM === 'open') return scheduleOpen();
  // every unordered pair once, plus every model against a copy of itself
  const pairs = [];
  for (let i = 0; i < MODELS.length; i++) for (let j = i; j < MODELS.length; j++) pairs.push([MODELS[i].id, MODELS[j].id]);
  // deterministic shuffle so partial runs still cover all models evenly
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = pairs.length - 1; i > 0; i--) { const k = Math.floor(rand() * (i + 1)); [pairs[i], pairs[k]] = [pairs[k], pairs[i]]; }
  // randomise seat (a/b) too; it doesn't matter (the protocol is symmetric) but avoids patterns
  return pairs.map(([x, y]) => (rand() < 0.5 ? [x, y] : [y, x]));
}

async function baseline() {
  const file = join(RUNS, 'baseline.json');
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const who = ROOM === 'open' ? [...GPT, ...CLAUDE.filter((m) => m.gen === 5.5)] : MODELS;
  const jobs = who.flatMap((m) => [0, 1].map((k) => [m.id, k])).filter(([id, k]) => !prev.some((p) => p.model === id && p.sample === k));
  await pool(jobs, CONCURRENCY * 2, async ([id, k]) => {
    const r = await call(id, baselinePrompt(), 'baseline');
    const v = parseJson(r.text) || {};
    prev.push({ model: id, sample: k, selfGuess: normalizeName(v.self_guess), raw: r.text, p: v.p, why: v.why, ms: r.ms });
    writeFileSync(file, JSON.stringify(prev, null, 1));
    console.log(`${byId[id].name} thinks it is ${v.self_guess} (${v.p}%)`);
  });
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'baseline') await baseline();
else if (cmd === 'one') await duel(rest[0], rest[1]);
else if (cmd === 'duels') {
  const li = rest.indexOf('--limit');
  let pairs = schedule();
  if (li >= 0) pairs = pairs.slice(0, Number(rest[li + 1]));
  const done = new Set(readdirSync(DUELS).map((f) => f.replace('.json', '')));
  const todo = pairs.filter(([a, b]) => !done.has(`${a}__${b}`) && !done.has(`${b}__${a}`));
  console.log(`${pairs.length - todo.length} done, ${todo.length} to go, concurrency ${CONCURRENCY}`);
  const failures = await pool(todo, CONCURRENCY, ([a, b]) => duel(a, b));
  console.log(`finished; ${failures.length} failures`);
} else if (cmd) {
  console.error('unknown command');
  process.exit(1);
}
