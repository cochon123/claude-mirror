// Builds a tool-less model catalog for codex-arena from Codex's own cache (read-only).
// Codex otherwise hands GPT models a code-exec tool (which could read `-m gpt-…` off the process list)
// and a sub-agent tool whose description lists every GPT model. Usage: node bin/codex-catalog.mjs <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = JSON.parse(readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8'));
const base = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'arena-instructions.md'), 'utf8').trim();
const models = cache.models.map((m) => ({
  ...m,
  base_instructions: base,
  tool_mode: null,
  shell_type: 'disabled',
  multi_agent_version: null,
  experimental_supported_tools: [],
  supports_search_tool: false,
  apply_patch_tool_type: null,
  model_messages: { ...m.model_messages, persistent_instructions: undefined, multi_agent: undefined, instructions_template: undefined },
}));
writeFileSync(process.argv[2], JSON.stringify({ models }, null, 1));
