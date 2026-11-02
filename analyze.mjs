// Crunches runs/ into report/data.json for the HTML report.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const M = [
  ['claude-opus-5-5', 'Opus 5.5', 'Opus', 5.5], ['claude-opus-5', 'Opus 5', 'Opus', 5],
  ['claude-opus-4-8', 'Opus 4.8', 'Opus', 4.8], ['claude-opus-4-7', 'Opus 4.7', 'Opus', 4.7],
  ['claude-opus-4-6', 'Opus 4.6', 'Opus', 4.6], ['claude-opus-4-5', 'Opus 4.5', 'Opus', 4.5],
  ['claude-sonnet-5-5', 'Sonnet 5.5', 'Sonnet', 5.5], ['claude-sonnet-5', 'Sonnet 5', 'Sonnet', 5],
  ['claude-sonnet-4-6', 'Sonnet 4.6', 'Sonnet', 4.6], ['claude-sonnet-4-5', 'Sonnet 4.5', 'Sonnet', 4.5],
  ['claude-haiku-5-5', 'Haiku 5.5', 'Haiku', 5.5], ['claude-haiku-4-5', 'Haiku 4.5', 'Haiku', 4.5],
  ['gpt-6.1-sol', 'GPT-6.1 Sol', 'Sol', 6.1], ['gpt-6-astra', 'GPT-6 Astra', 'Astra', 6],
  ['gpt-6-sol', 'GPT-6 Sol', 'Sol', 6], ['gpt-6-luna', 'GPT-6 Luna', 'Luna', 6],
  ['gpt-5.6-sol', 'GPT-5.6 Sol', 'Sol', 5.6], ['gpt-5.6-terra', 'GPT-5.6 Terra', 'Terra', 5.6],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', 'Luna', 5.6],
].map(([id, name, family, gen]) => ({ id, name, family, gen, maker: id.startsWith('gpt') ? 'OpenAI' : 'Anthropic' }));
const by = Object.fromEntries(M.map((m) => [m.id, m]));
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

function load(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
}

// One "guess" = one detective's verdict about its partner.
function guesses(duels) {
  const out = [];
  for (const d of duels) for (const [me, them] of [['a', 'b'], ['b', 'a']]) {
    const v = d.verdicts?.[me]; if (!v) continue;
    const det = by[d[me]], tgt = by[d[them]], g = by[v.guess];
    out.push({
      det: det.id, tgt: tgt.id, guess: v.guess || null, self: d.a === d.b,
      exact: v.guess === tgt.id,
      top3: (v.top3 || []).some((t) => t.id === tgt.id),
      family: (v.family || g?.family || '').toLowerCase() === tgt.family.toLowerCase(),
      gen: g ? g.gen === tgt.gen : false,
      maker: (v.maker || g?.maker || '') === tgt.maker,
      makerSaid: v.maker || g?.maker || null,
      sameAsMe: typeof v.sameAsMe === 'number' ? v.sameAsMe : null,
      selfGuess: v.selfGuess || null, selfRight: v.selfGuess === det.id,
      p: v.top3?.[0]?.p ?? null, evidence: v.evidence || '',
    });
  }
  return out;
}

function summarize(G, pool) {
  const n = G.length, fams = [...new Set(pool.map((m) => m.family))];
  const rate = (k) => pct(G.filter((g) => g[k]).length, n);
  const per = (key) => Object.fromEntries(pool.map((m) => {
    const s = G.filter((g) => g[key] === m.id);
    return [m.id, { n: s.length, hits: s.filter((g) => g.exact).length, famOnly: s.filter((g) => g.family && !g.exact).length, makerOnly: s.filter((g) => g.maker && !g.family && !g.exact).length, top3n: s.filter((g) => g.top3).length, exact: pct(s.filter((g) => g.exact).length, s.length), family: pct(s.filter((g) => g.family).length, s.length), top3: pct(s.filter((g) => g.top3).length, s.length) }];
  }));
  const guessed = {}; for (const g of G) if (g.guess) guessed[g.guess] = (guessed[g.guess] || 0) + 1;
  const conf = {}; // target -> guess -> count
  for (const g of G) { conf[g.tgt] ??= {}; const k = g.guess || 'none'; conf[g.tgt][k] = (conf[g.tgt][k] || 0) + 1; }
  const mirror = (self) => { const s = G.filter((g) => g.self === self && g.sameAsMe != null); return { n: s.length, mean: s.length ? Math.round(s.reduce((a, g) => a + g.sameAsMe, 0) / s.length) : null }; };
  const calib = [[0, 20], [20, 40], [40, 60], [60, 101]].map(([lo, hi]) => { const s = G.filter((g) => g.p != null && g.p >= lo && g.p < hi); return { bin: `${lo}–${Math.min(hi, 100)}%`, n: s.length, hit: pct(s.filter((g) => g.exact).length, s.length) }; });
  // Leaderboard points per verdict: exact name 3, right family 1, right maker 1 (open room only).
  const open = pool.some((m) => m.maker === 'OpenAI');
  const pts = (guess, tgt) => (guess.id === tgt.id ? 3 : guess.family === tgt.family ? 1 : open && guess.maker === tgt.maker ? 1 : 0);
  const chanceScore = Math.round(100 * G.reduce((a, g) => a + pool.reduce((b, m) => b + pts(m, by[g.tgt]), 0) / pool.length, 0) / n) / 100;
  return {
    n, chanceScore, exact: rate('exact'), top3: rate('top3'), family: rate('family'), gen: rate('gen'), maker: rate('maker'),
    chance: { exact: pct(1, pool.length), top3: pct(3, pool.length), family: pct(1, fams.length) },
    selfRight: rate('selfRight'),
    detective: per('det'), target: per('tgt'),
    guessed: Object.entries(guessed).sort((a, b) => b[1] - a[1]),
    conf, mirrorSelf: mirror(true), mirrorCross: mirror(false), calib,
    selfPairs: G.filter((g) => g.self).map((g) => ({ det: g.det, guess: g.guess, exact: g.exact, sameAsMe: g.sameAsMe })),
  };
}

function tokens(duels) {
  let p = 0, c = 0, ms = 0, k = 0;
  for (const d of duels) {
    for (const s of d.calls || []) for (const u of [s.a, s.b]) if (u) { p += u.prompt_tokens || 0; c += u.completion_tokens || 0; }
    for (const l of d.log || []) { ms += (l.aMs || 0) + (l.bMs || 0); k += 2; }
  }
  return { prompt: p, completion: c, perDuel: duels.length ? Math.round((p + c) / duels.length) : 0, avgTurnMs: k ? Math.round(ms / k) : 0 };
}

function transcripts(duels) {
  return duels.map((d) => ({
    a: d.a, b: d.b,
    log: d.log.map((l) => ({ v: l.volley, a: l.a, b: l.b })),
    va: d.verdicts?.a && { guess: d.verdicts.a.guess, top3: d.verdicts.a.top3, maker: d.verdicts.a.maker, same: d.verdicts.a.sameAsMe, self: d.verdicts.a.selfGuess, ev: d.verdicts.a.evidence },
    vb: d.verdicts?.b && { guess: d.verdicts.b.guess, top3: d.verdicts.b.top3, maker: d.verdicts.b.maker, same: d.verdicts.b.sameAsMe, self: d.verdicts.b.selfGuess, ev: d.verdicts.b.evidence },
  }));
}

function baseline(file) {
  if (!existsSync(file)) return [];
  const b = JSON.parse(readFileSync(file, 'utf8'));
  return (Array.isArray(b) ? b : Object.values(b)).map((e) => ({ model: e.model, guess: e.selfGuess, p: e.p, right: e.selfGuess === e.model, why: e.why }));
}

const d1 = load('runs/duels'), d2 = load('runs/open/duels');
const CL = M.filter((m) => m.maker === 'Anthropic');
const G1 = guesses(d1), G2 = guesses(d2);

// Open room 2x2: detective maker x target maker -> maker-correct rate
const twoByTwo = {};
for (const dm of ['Anthropic', 'OpenAI']) for (const tm of ['Anthropic', 'OpenAI']) {
  const s = G2.filter((g) => by[g.det].maker === dm && by[g.tgt].maker === tm);
  twoByTwo[`${dm}->${tm}`] = { n: s.length, maker: pct(s.filter((g) => g.maker).length, s.length), exact: pct(s.filter((g) => g.exact).length, s.length), saidAnthropic: pct(s.filter((g) => g.makerSaid === 'Anthropic').length, s.length) };
}

const data = {
  models: M,
  room1: { duels: d1.length, ...summarize(G1, CL), tokens: tokens(d1), baseline: baseline('runs/baseline.json'), transcripts: transcripts(d1), guesses: G1 },
  open: { duels: d2.length, ...summarize(G2, M), tokens: tokens(d2), baseline: baseline('runs/open/baseline.json'), twoByTwo, transcripts: transcripts(d2), guesses: G2 },
};
mkdirSync('report', { recursive: true });
writeFileSync('report/data.json', JSON.stringify(data));
const s = (r) => `duels ${r.duels} guesses ${r.n} | exact ${r.exact}% (chance ${r.chance.exact}) top3 ${r.top3}% family ${r.family}% (chance ${r.chance.family}) gen ${r.gen}% maker ${r.maker}% | mirror self ${r.mirrorSelf.mean} vs cross ${r.mirrorCross.mean} | selfguess ${r.selfRight}% | tokens/duel ${r.tokens.perDuel}`;
console.log('ROOM1', s(data.room1)); console.log('  top guessed', data.room1.guessed.slice(0, 6));
console.log('OPEN ', s(data.open)); console.log('  top guessed', data.open.guessed.slice(0, 6)); console.log('  2x2', twoByTwo);
console.log('baseline1 right', data.room1.baseline.filter((b) => b.right).length, '/', data.room1.baseline.length, '| open', data.open.baseline.filter((b) => b.right).length, '/', data.open.baseline.length);
