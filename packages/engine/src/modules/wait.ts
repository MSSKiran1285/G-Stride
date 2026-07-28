import { Module } from '../module';

/**
 * Pauses for a fixed duration. Not for waiting on UI state (use waitFor-backed
 * modules for that) — this exists for cases like a negative-assertion test that
 * needs to give a pending operation time to actually resolve before checking
 * that nothing changed.
 */
export const Wait: Module = {
  name: 'Wait',
  describe: {
    label: 'Wait',
    category: 'Built-In Modules',
    description: 'Pauses for a fixed duration — not for waiting on UI state, only for giving a pending operation time to settle.',
    params: [{ key: 'ms', label: 'Milliseconds', required: false, placeholder: '1000' }],
    narrate: ({ params }) => `Waited ${params.ms ?? '1000'} ms`,
  },
  async execute({ params }) {
    const ms = Number(params.ms ?? '1000');
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
};
