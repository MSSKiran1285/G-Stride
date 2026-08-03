/**
 * BL-047 Phase 2's model-fallback boundary: a provider-agnostic seam so swapping which model
 * answers a prompt (Anthropic, OpenAI, Google, ...) is a config/wiring change, not a rewrite of
 * whatever calls it. Deliberately minimal — one method, plain text in and out — because there
 * is no concrete caller wired up yet (shell-screen tile selection, natural-language process
 * resolution); this interface exists to prove the credential-to-response plumbing works before
 * any business logic depends on it. Callers own parsing/validating structured output (e.g.
 * asking for JSON and checking it), not this interface.
 */
export interface AiResolver {
  complete(prompt: string): Promise<string>;
}
