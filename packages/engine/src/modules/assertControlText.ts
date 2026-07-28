import { Module } from '../module';
import { readControlValue } from '../controlAccess';

/**
 * Asserts a control's displayed text/value contains an expected substring.
 * Unlike the other modules, this one exists purely to verify an outcome —
 * it throws (failing the step) on mismatch rather than performing an action,
 * which is what a negative/validation test case needs.
 */
export const AssertControlText: Module = {
  name: 'AssertControlText',
  describe: {
    label: 'Assert Control Text',
    category: 'Built-In Modules',
    description: "Fails the step if a control's displayed text/value doesn't contain the expected substring.",
    params: [
      { key: 'field', label: 'Field (object repository name)', required: true, objectKind: ['readable', 'fillable', 'tableColumn'] },
      { key: 'contains', label: 'Expected substring', required: true },
    ],
    narrate: ({ params }) => `Asserted ${params.field} contains "${params.contains}"`,
  },
  async execute({ adapter, objectRepository, appId, params }) {
    const actual = await readControlValue(adapter, objectRepository, appId, params.field);
    if (!actual.includes(params.contains)) {
      throw new Error(`Expected "${params.field}" to contain "${params.contains}", but got "${actual}"`);
    }
  },
};
