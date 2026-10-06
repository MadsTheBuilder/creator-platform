import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { JobError } from './job-error.ts';

const SYSTEM = readFileSync(new URL('./prompts/script.md', import.meta.url), 'utf8');
const SCHEMA = { type: 'object', properties: { title: { type: 'string' }, script: { type: 'string' } }, required: ['title', 'script'], additionalProperties: false };

export async function script(client: Anthropic, input: { idea?: unknown; platform?: unknown; length?: unknown; tone?: unknown }): Promise<{ title: string; script: string }> {
  const idea = typeof input.idea === 'string' ? input.idea.trim() : '';
  const platform = typeof input.platform === 'string' ? input.platform.slice(0, 60) : 'YouTube (long-form)';
  const tone = typeof input.tone === 'string' ? input.tone.slice(0, 80) : '';
  const length = Number(input.length);
  if (!idea) throw new JobError('Describe what the video is about first.');
  if (idea.length > 2000) throw new JobError('Keep the idea under 2,000 characters.');
  if (!Number.isInteger(length) || length < 15 || length > 1800) throw new JobError('Pick a length between 15 seconds and 30 minutes.');

  const message = await client.messages.stream({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Platform: ${platform}\nTarget length: ${length} seconds\nTone: ${tone || 'decide from the idea'}\n\nIdea:\n<idea>\n${idea}\n</idea>` }],
  }).finalMessage();
  if (message.stop_reason === 'refusal') throw new JobError('Claude declined to write this script.');
  if (message.stop_reason === 'max_tokens') throw new JobError('The script ran too long. Try a shorter length.');
  const out = JSON.parse(message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join(''));
  return { title: String(out.title).slice(0, 120), script: String(out.script).slice(0, 60000) };
}
