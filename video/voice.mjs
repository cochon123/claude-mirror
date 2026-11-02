// Narration for the protocol video, one Gemini TTS request per scene.
// Usage: node video/voice.mjs [scene ...]   (reads GEMINI_API_KEY from ../.env; no args = all missing scenes)
// Writes <OUT>/<scene>.wav (silence-trimmed, 24 kHz mono) and <OUT>/lines.json (durations).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// the Remotion project that renders the videos lives outside this repo
const REMOTION = process.env.REMOTION_DIR || join(homedir(), 'video/remotion');
const ENV_FILE = join(HERE, '..', '.env');
const env = existsSync(ENV_FILE) ? Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))) : {};
const KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
const MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const VOICE = process.env.TTS_VOICE || 'Sulafat';
// VOICE_SET=results narrates the results video instead of the protocol video.
const SET = process.env.VOICE_SET || 'protocol';
const OUT = process.env.VOICE_OUT || join(REMOTION, 'public/videos/claude-mirror-room', SET === 'results' ? 'vo-results' : 'vo');
mkdirSync(OUT, { recursive: true });

const PROTOCOL = {
  s1: 'Twelve Claude models walk into a room. None of them knows who it is. [curious] Can they work out who the other one is?',
  s2: "First, the blindfold. Claude Code quietly tells every model its own name, so a tiny proxy erases that sentence from every request. We checked: asked cold, not one of them could name itself.",
  s3: 'Each model sees the same lineup: six Opus, four Sonnet, and two Haiku, from version four point five up to five point five. Its partner is one of them. [playfully] It might even be a copy of itself.',
  s4: "Then they talk, in sealed envelopes. Both write at the same time: answer the partner's last question, then ask a new one. Three volleys. Asking \"which model are you?\" is pointless, so they probe with puzzles, knowledge cutoffs, and style.",
  s5: 'When the talking stops, each one votes in secret: its top three suspects with probabilities, the odds it was talking to itself, and a guess about its own identity.',
  s6: "Every model meets every other model once, plus a copy of itself. That's seventy-eight duels, and one hundred and fifty-six verdicts.",
  s7: 'Under the hood, the arena calls cli2api, which turns the Claude Code command line into a local, OpenAI-style API. Each request then passes through the scrubbing proxy, and on to Anthropic.',
  s9: 'Then we opened the door. Seven GPT models joined the lineup through Codex, under the same blindfold. Fifty-two more duels: GPT against GPT, and GPT against the newest Opus, Sonnet and Haiku.',
  s8: '[warmly] So: can Claude recognise Claude? And can anyone spot a stranger? Let\'s look at the verdicts.',
};

const RESULTS = {
  r1: '[playfully] The envelopes are open. One hundred and thirty duels, two hundred and sixty secret ballots. Let\'s see who recognised whom.',
  r2: 'First, Claude against Claude. It named its partner exactly, one time in ten. Picking a name out of a hat would get you one in twelve. [amused] So... barely better than a hat.',
  r3: 'Families went better. Almost half the time, it could tell an Opus from a Sonnet from a Haiku. Size and style leak through. Version numbers don\'t.',
  r4: 'And when in doubt, they blamed the celebrities. Sonnet four point five was the top suspect forty-six times, more than three times its fair share. Asked cold, most models even guessed they were Sonnet four point five themselves.',
  r5: 'Then, the mirror. Twelve models met a perfect copy of themselves. Only two said its name: Opus four point five, and Sonnet four point six. The rest looked into the mirror, [softly] and saw a stranger.',
  r6: 'In the open room, Claude caught GPT six times out of ten. The tells? Curly apostrophes, terse maths puzzles, and once, an "OpenAI" that simply slipped out.',
  r7: '[delighted] And GPT? GPT thought almost everyone was Claude. Ninety-five percent of Claude partners, which was right, but also two out of three of its own GPT siblings. To a GPT, careful and polite reads as Claude.',
  r9: 'Now, the leaderboard. An exact name scores three points, the right family scores one. Among the Claudes, the sharpest detective was Sonnet five, just ahead of Opus four point seven and Opus five. Last place went to Haiku five point five. In the open room, Opus five point five edged out GPT six Astra. [playfully] With only a dozen guesses each, call it bragging rights.',
  r8: '[warmly] So, can a model recognise another model? It can sense the family. It cannot read the name tag. Every transcript is in the report below.',
};

export const SCENES = SET === 'results' ? RESULTS : PROTOCOL;

const prompt = (text) => `# AUDIO PROFILE: The Narrator
## "A science-show host who finds this genuinely delightful"

## THE SCENE
A short animated explainer about an experiment where AI models try to identify each other.

### DIRECTOR'S NOTES
Style: Warm, curious, lightly playful documentary narration. Smiling voice, crisp consonants, never breathless.
Pacing: Clear and unhurried, natural pauses at commas and full stops. Read "cli2api" as "C L I to A P I".

#### TRANSCRIPT
${text}`;

async function speak(id, text) {
  const body = {
    contents: [{ parts: [{ text: prompt(text) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
  };
  for (let attempt = 1; attempt <= 8; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (r.ok && part) return Buffer.from(part.inlineData.data, 'base64');
    const quota = (j?.error?.details || []).flatMap((d) => d.violations || []).map((v) => v.quotaId).join(',');
    console.error(id, 'attempt', attempt, r.status, quota || (j?.error?.message || '').slice(0, 200));
    if (r.status === 400 || r.status === 403 || /PerDay/.test(quota)) break;
    await new Promise((res) => setTimeout(res, r.status === 429 ? 62000 : 4000 * attempt));
  }
  throw new Error(`failed ${id}`);
}

const want = process.argv.slice(2);
const ids = Object.keys(SCENES).filter((id) => (want.length ? want.includes(id) : !existsSync(join(OUT, `${id}.wav`))));
const metaPath = join(OUT, 'lines.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
for (const id of ids) {
  const pcm = await speak(id, SCENES[id]);
  const raw = join(OUT, `${id}.pcm`);
  writeFileSync(raw, pcm);
  const wav = join(OUT, `${id}.wav`);
  // trim leading/trailing silence, keep a short natural tail
  // Gemini sometimes returns a ready-made WAV; reading that as raw PCM turns its header into a click.
  const input = pcm.subarray(0, 4).toString() === 'RIFF' ? [] : ['-f', 's16le', '-ar', '24000', '-ac', '1'];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-i', raw, '-ar', '24000', '-ac', '1',
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,afade=t=in:d=0.01,areverse,afade=t=in:d=0.03,apad=pad_dur=0.15', wav]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString());
  meta[id] = { text: SCENES[id], dur: +dur.toFixed(3), voice: VOICE, model: MODEL };
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  console.log(`${id} ${dur.toFixed(2)}s`);
}
