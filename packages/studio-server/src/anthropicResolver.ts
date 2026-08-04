import { getAiApiKey } from '@taf/core';
import { AiResolver } from '@taf/engine';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
export const AI_PROVIDER = 'anthropic';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * The one concrete AiResolver implementation wired up so far — Anthropic's Messages API.
 * Started on Haiku 4.5 for BL-047's initial POC on cost, moved to Sonnet 5 once the discovery
 * task grew into multi-step instruction following with its own memory of prior steps, then to
 * Opus 5 once the owner decided reliability mattered more than the last fraction of a cent for
 * this exact kind of agentic, multi-step decision-making — Opus's own stated strength. Still
 * trivial in absolute terms (~$0.02/call; a full 20-step process run costs well under $1).
 * Takes its own fetch function so regression tests can substitute a fake HTTP call instead of
 * needing a real API key or hitting the network — matches how FioriPlaywrightAdapter takes an
 * injectable page rather than always launching a new browser.
 */
export class AnthropicResolver implements AiResolver {
  constructor(
    private model: string = DEFAULT_ANTHROPIC_MODEL,
    private fetchImpl: typeof fetch = fetch
  ) {}

  async complete(prompt: string): Promise<string> {
    const apiKey = await getAiApiKey(AI_PROVIDER);
    const res = await this.fetchImpl(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API request failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as AnthropicMessageResponse;
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('Anthropic API response did not include a text content block.');
    }
    return text;
  }
}
