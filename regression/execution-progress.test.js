'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectRepository } = require('../packages/core/dist');
const { executeGroup, ModuleRegistry } = require('../packages/engine/dist');

test('single batch group reports determinate step and stage progress', async () => {
  const repository = new ObjectRepository(':memory:');
  const progress = [];
  const adapter = {
    screenshot: async () => undefined,
  };

  try {
    const result = await executeGroup(
      [
        {
          name: 'Create document',
          steps: [
            { module: 'Wait', params: { ms: '1' } },
            { module: 'Wait', params: { ms: '1' } },
          ],
        },
        {
          name: 'Verify document',
          steps: [
            { module: 'Wait', params: { ms: '1' } },
            { module: 'Wait', params: { ms: '1' } },
          ],
        },
      ],
      adapter,
      repository,
      new ModuleRegistry(),
      {
        appId: 'synthetic',
        dataRow: {},
        screenshotDir: '.',
        onProgress: (event) => progress.push(event),
      },
    );

    assert.equal(result.status, 'passed');
    assert.ok(progress.length >= 6, 'expected step events and stage-completion events');
    assert.deepEqual(
      progress.filter((event) => event.latestStepStatus === 'passed').map((event) => event.completedSteps),
      [1, 2, 2, 3, 4, 4],
    );
    assert.deepEqual(progress.at(-1), {
      completedSteps: 4,
      totalSteps: 4,
      completedStages: 2,
      totalStages: 2,
      currentStage: 'Verify document',
      currentStep: 'Scenario completed',
      latestStepStatus: 'passed',
    });
  } finally {
    repository.close();
  }
});
