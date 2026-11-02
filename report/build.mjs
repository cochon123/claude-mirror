// Inlines data.json and the video into one self-contained HTML file.
import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('report/data.json', 'utf8'));
for (const r of ['room1', 'open']) data[r].guesses = data[r].guesses.map(({ evidence, ...g }) => g);
const lite = process.argv.includes('--lite');
// --web: videos and posters as separate files in deploy/ (for hosting), instead of inlined base64.
const web = process.argv.includes('--web');
if (lite) for (const r of ['room1', 'open']) { data[r].transcripts = data[r].transcripts.filter((t) => t.a === t.b).slice(0, 3); data[r].guesses = data[r].guesses.map(({ det, tgt, guess, self, exact, sameAsMe, p }) => ({ det, tgt, guess, self, exact, sameAsMe, p })); }
const video = process.argv[2] && !lite && !web ? 'data:video/mp4;base64,' + readFileSync(process.argv[2]).toString('base64') : '';
const html = readFileSync('report/template.html', 'utf8')
  .replace('/*DATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'))
  .replace('__VIDEO__', () => (web ? 'protocol.mp4' : video))
  .replace('__POSTER__', () => web ? 'protocol.jpg' : 'data:image/jpeg;base64,' + readFileSync('report/poster.jpg').toString('base64'))
  .replace('__VIDEO2__', () => (web ? 'results.mp4' : process.argv[3] && !lite ? 'data:video/mp4;base64,' + readFileSync(process.argv[3]).toString('base64') : ''))
  .replace('__POSTER2__', () => web ? 'results.jpg' : 'data:image/jpeg;base64,' + readFileSync('report/poster-results.jpg').toString('base64'));
const out = lite ? html.replace(/<video[^>]*><\/video>/, '<img src="' + process.cwd() + '/report/poster.jpg" style="display:block;width:100%" alt="video still">') : html;
writeFileSync(web ? 'deploy/index.html' : lite ? 'report/lite.html' : 'mirror-room.html', out);
console.log(web ? 'deploy/index.html' : lite ? 'lite' : 'mirror-room.html', (out.length / 1e6).toFixed(1) + ' MB');
