import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { parseStoryboard, type Storyboard } from '../frontend/src/storyboard/composition.ts';
import { JobError } from './job-error.ts';

// The shot-breakdown skill (worker/prompts/system.md) plus its reference files, cached as one system prompt.
const SYSTEM = ['system.md', 'vision-playbooks.md', 'director-principles.md', 'shot-codes.md', 'lighting-design.md']
  .map(f => readFileSync(new URL(`./prompts/${f}`, import.meta.url), 'utf8')).join('\n\n---\n\n');

const str = { type: 'string' };
const object = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SCHEMA = object({
  title: str, brief: str,
  scenes: { type: 'array', items: object({
    heading: str, lighting: str,
    shots: { type: 'array', items: object({
      description: str, magnification: str, movement: str, lens: str, angle: str, position: str,
      lighting: str, notes: str, audio: str, duration: { type: 'integer' },
    }) },
  }) },
});

export type Vision = { format: string; method: string; aspect: '16:9' | '9:16'; runtime: number; feel: string };

export async function breakdown(client: Anthropic, input: { script?: unknown; vision?: Partial<Vision> }): Promise<Storyboard> {
  const script = typeof input.script === 'string' ? input.script.trim() : '';
  const v = input.vision ?? {};
  if (!script) throw new JobError('Paste a script first.');
  if (script.length > 60000) throw new JobError('That script is too long for one breakdown. Split it into parts of about 60,000 characters.');
  if (v.aspect !== '16:9' && v.aspect !== '9:16') throw new JobError('Pick a platform and aspect ratio.');
  const runtime = Number.isInteger(v.runtime) && v.runtime! > 0 && v.runtime! <= 1800 ? v.runtime : undefined;

  const form = [
    `- Format and tone: ${v.format || 'decide from the script'}`,
    `- Production method: ${v.method || 'decide from the script'}`,
    `- Platform / aspect: ${v.aspect === '9:16' ? 'Reels / Shorts / TikTok, 9:16' : 'YouTube, 16:9'}`,
    `- Target runtime: ${runtime ? `${runtime} seconds` : 'natural length of the script'}`,
    `- How it should feel: ${v.feel || 'not given'}`,
  ].join('\n');
  const stream = client.beta.messages.stream({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 64000,
    // Anthropic-only fallback; proxies like OpenRouter reject it.
    ...(process.env.ANTHROPIC_BASE_URL ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Vision form:\n${form}\n\nScript:\n<script>\n${script}\n</script>` }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new JobError('Claude declined to break down this script.');
  if (message.stop_reason === 'max_tokens') throw new JobError('The breakdown ran too long. Split the script into parts.');
  const text = message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('');
  return parseStoryboard({ ...JSON.parse(text), aspect: v.aspect });
}
