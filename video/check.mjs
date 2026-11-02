// Transcribes each narration clip with Gemini and prints it next to the script (I can't listen; Gemini can).
// Usage: node video/check.mjs [scene ...]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
// the Remotion project that renders the videos lives outside this repo
const REMOTION = process.env.REMOTION_DIR || join(homedir(), 'video/remotion');
const ENV_FILE = join(HERE, '..', '.env');
const env = existsSync(ENV_FILE) ? Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))) : {};
const KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
const DIR = process.env.VOICE_OUT || join(REMOTION, 'public/videos/claude-mirror-room/vo');
const meta = JSON.parse(readFileSync(join(DIR, 'lines.json'), 'utf8'));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(meta);
for (const id of ids) {
  const data = readFileSync(join(DIR, `${id}.wav`)).toString('base64');
  let j;
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.CHECK_MODEL || 'gemini-3.8-flash'}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data } },
        { text: 'Transcribe this narration verbatim. Then on a new line starting with NOTES: flag anything mispronounced, garbled, cut off, or oddly delivered (or say "clean").' }] }] }),
    });
    j = await r.json();
    if (r.ok) break;
    await new Promise((res) => setTimeout(res, 15000));
  }
  console.log(`--- ${id}\nSCRIPT: ${meta[id].text}\nHEARD:  ${j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || JSON.stringify(j).slice(0, 300)}\n`);
}
