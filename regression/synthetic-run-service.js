'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createSyntheticRunService(root) {
  const entries = new Map();

  function groupName(file) {
    try {
      const group = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      return group.name || path.basename(file, '.json');
    } catch {
      return path.basename(file, '.json');
    }
  }

  function statusFor(entry) {
    const completed = Date.now() - Date.parse(entry.record.startedAt) >= 150;
    const state = completed ? 'passed' : 'running';
    const files = entry.options.mode === 'batch'
      ? entry.options.groupFiles || []
      : entry.options.testCaseFiles;
    const snapshotPackMembers = entry.options.executionSnapshot?.plan?.kind === 'regressionPack'
      ? entry.options.executionSnapshot.plan.members
      : [];
    const names = entry.options.mode === 'batch'
      ? (files.length > 0 ? files.map(groupName) : snapshotPackMembers.map((member) => member.name))
      : files.map((file) => path.basename(file, '.json'));
    const members = names.map((name, index) => ({
      memberId: `synthetic-member-${index + 1}`,
      name,
      status: completed ? 'passed' : index === 0 ? 'running' : 'pending',
      iterations: [{
        iterationId: `synthetic-iteration-${index + 1}`,
        index: 0,
        status: completed ? 'passed' : index === 0 ? 'running' : 'pending',
        stages: [],
        evidencePdfUrl: null,
      }],
    }));
    const resultNames = entry.options.mode === 'chain'
      ? [names.join(' → ')]
      : names;
    const results = entry.options.mode === 'batch'
      ? []
      : resultNames.map((name) => ({
          testCaseName: name,
          status: state,
          startedAt: entry.record.startedAt,
          durationMs: completed ? 150 : 0,
          steps: completed
            ? [{
                module: 'Wait',
                description: 'Synthetic execution completed',
                status: 'passed',
                startedAt: entry.record.startedAt,
                durationMs: 1,
              }]
            : [],
          stages: [],
          capturedValues: {},
          fieldEvidence: [],
        }));
    const groupResults = entry.options.mode === 'batch'
      ? names.map((name) => ({
          name,
          status: completed ? 'passed' : 'running',
          totalTestCases: 1,
          passedCount: completed ? 1 : 0,
          failedTestCase: null,
          passPercent: completed ? 100 : 0,
          durationMs: completed ? 150 : 0,
          evidencePdfUrl: null,
          stages: [],
        }))
      : undefined;
    const record = {
      ...entry.record,
      status: state,
      finishedAt: completed ? entry.finishedAt : undefined,
    };
    return {
      ...record,
      results,
      groupResults,
      progress: {
        completedGroups: completed ? names.length : 0,
        totalGroups: names.length,
        completedSteps: completed ? names.length : 0,
        totalSteps: names.length,
        completedStages: completed ? names.length : 0,
        totalStages: names.length,
        currentGroup: completed ? 'Complete' : names[0] || 'Synthetic execution',
        currentStage: completed ? 'Complete' : 'Synthetic stage',
        currentStep: completed ? 'Complete' : 'Synthetic step',
        percent: completed ? 100 : 25,
      },
      evidenceDocuments: [],
      evidencePdfUrl: null,
      hierarchy: { executionId: record.id, members },
      diagnosis: null,
      rerunEligibility: {
        full: { eligible: completed },
        failed: {
          eligible: false,
          reason: completed
            ? 'This execution has no failed or unattempted transactions to rerun.'
            : 'Wait for the execution to reach a terminal state.',
        },
      },
    };
  }

  const service = {
    start(options) {
      const id = randomUUID();
      const startedAt = new Date().toISOString();
      const record = {
        id,
        status: 'running',
        mode: options.mode || 'chain',
        reportDir: path.join(root, 'reports', id),
        reportDirRel: path.join('reports', id),
        testCaseFiles: options.testCaseFiles,
        totalUnits: options.mode === 'batch'
          ? Math.max(1, options.groupFiles?.length || options.executionSnapshot?.plan?.members?.length || 0)
          : options.mode === 'suite'
            ? Math.max(1, options.testCaseFiles.length)
            : 1,
        startedAt,
        exitCode: null,
        logTail: 'Synthetic isolated execution.',
        snapshotHash: options.executionSnapshot?.snapshotHash,
        initiatedBy: options.initiatedBy,
        targetContext: options.targetContext,
        parentRunId: options.parentRunId,
        rerunReason: options.rerunReason,
        rerunScope: options.rerunScope,
        rerunReviewHash: options.rerunReviewHash,
        rerunChanges: options.rerunChanges,
        request: {
          testCaseFiles: [...options.testCaseFiles],
          appId: options.appId,
          dataFile: options.dataFile,
          headless: options.headless,
          mode: options.mode || 'chain',
          groupFiles: options.groupFiles ? [...options.groupFiles] : undefined,
          sessionPolicy: options.sessionPolicy,
          iterationFailurePolicy: options.iterationFailurePolicy,
          maxRecords: options.maxRecords,
        },
        startLatencyMs: 1,
      };
      entries.set(id, {
        record,
        options,
        finishedAt: new Date(Date.now() + 150).toISOString(),
      });
      return record;
    },
    get(id) {
      const entry = entries.get(id);
      return entry ? statusFor(entry) : null;
    },
    metrics() {
      const statuses = [...entries.values()].map(statusFor);
      return {
        totalExecutions: statuses.length,
        running: statuses.filter((status) => status.status === 'running').length,
        passed: statuses.filter((status) => status.status === 'passed').length,
        failed: 0,
        cancelled: 0,
        averageDurationMs: statuses.length ? 150 : 0,
        averageStartLatencyMs: statuses.length ? 1 : 0,
        completedIterations: statuses.filter((status) => status.status === 'passed').length,
        iterationThroughputPerHour: 0,
        evidenceExpected: 0,
        evidenceAvailable: 0,
        failureCategories: {
          setup: 0,
          data: 0,
          object: 0,
          authentication: 0,
          navigation: 0,
          assertion: 0,
          execution: 0,
        },
      };
    },
    cancel(id) {
      return this.get(id);
    },
    review(id, options) {
      const original = this.get(id);
      if (!original) throw Object.assign(new Error('Unknown parent run id.'), { status: 404 });
      const eligible = original.status === 'passed' && options.scope === 'full' && Boolean(options.reason.trim());
      const blockingReasons = eligible
        ? []
        : [
            original.status !== 'passed'
              ? 'Wait for the parent execution to reach a terminal state.'
              : options.scope === 'failed'
                ? 'This execution has no failed or unattempted transactions to rerun.'
                : 'A rerun reason is required for audit lineage.',
          ];
      const reviewHash = `${id}:${options.scope}:${options.reason.trim()}`;
      return {
        parentRunId: id,
        scope: options.scope,
        reason: options.reason.trim(),
        eligible,
        blockingReasons,
        sourceSnapshotHash: original.snapshotHash || 'synthetic-source',
        proposedSnapshotHash: original.snapshotHash || 'synthetic-source',
        reviewHash,
        eligibleMembers: eligible ? original.hierarchy.members.length : 0,
        eligibleIterations: eligible ? original.totalUnits : 0,
        excludedPassedIterations: 0,
        differences: [
          {
            area: 'plan',
            field: 'Execution Plan',
            sourceValue: original.snapshotHash || 'synthetic-source',
            rerunValue: original.snapshotHash || 'synthetic-source',
            changed: false,
            explanation: 'The immutable synthetic plan is inherited.',
          },
          {
            area: 'data',
            field: 'Immutable data snapshot',
            sourceValue: `${original.totalUnits} iteration(s)`,
            rerunValue: `${original.totalUnits} iteration(s)`,
            changed: false,
            explanation: 'The immutable synthetic data is inherited.',
          },
          {
            area: 'policies',
            field: 'Session and failure policies',
            sourceValue: 'Inherited',
            rerunValue: 'Inherited',
            changed: false,
            explanation: 'Policies are inherited.',
          },
          {
            area: 'target',
            field: 'SAP target context',
            sourceValue: original.targetContext?.hostname || 'synthetic.invalid',
            rerunValue: options.targetContext?.hostname || 'synthetic.invalid',
            changed: false,
            explanation: 'The verified synthetic target is inherited.',
          },
          {
            area: 'scope',
            field: 'Transaction scope',
            sourceValue: `${original.totalUnits} original iteration(s)`,
            rerunValue: `${original.totalUnits} full-scope iteration(s)`,
            changed: false,
            explanation: 'Full scope is unchanged.',
          },
        ],
        changedInputs: [],
      };
    },
    rerun(id, options) {
      const review = this.review(id, options);
      if (!review.eligible) throw Object.assign(new Error(review.blockingReasons.join(' ')), { status: 409 });
      if (review.reviewHash !== options.reviewHash) {
        throw Object.assign(new Error('Rerun inputs changed after review.'), { status: 409 });
      }
      const original = entries.get(id);
      if (!original) throw Object.assign(new Error('Unknown parent run id.'), { status: 404 });
      const record = this.start({
        ...original.options,
        parentRunId: id,
        rerunReason: options.reason.trim(),
        rerunScope: options.scope,
        rerunReviewHash: options.reviewHash,
        rerunChanges: review.changedInputs,
        initiatedBy: options.initiatedBy,
        targetContext: options.targetContext,
      });
      return this.get(record.id);
    },
  };
  return service;
}

module.exports = { createSyntheticRunService };
