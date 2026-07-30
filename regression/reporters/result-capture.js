'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');

const destination = process.env.REGRESSION_RESULT_FILE;
const runStartedAt = new Date().toISOString();
const serialize = (value) => JSON.stringify(value, (_key, item) => {
  if (item instanceof Error) {
    return {
      name: item.name,
      message: item.message,
      stack: item.stack,
      cause: item.cause,
      ...item,
    };
  }
  return item;
});

if (destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    `${serialize({
      type: 'quality:run',
      data: {
        id: process.env.REGRESSION_RUN_ID || `quality-${runStartedAt.replace(/[:.]/g, '-')}`,
        label: process.env.REGRESSION_RUN_LABEL || 'Repository regression',
        mode: process.env.REGRESSION_RUN_MODE || 'Unit / Integration',
        targetClass: process.env.REGRESSION_TARGET_CLASS || 'Isolated',
        startedAt: runStartedAt,
      },
    })}\n`,
    'utf8',
  );
}

module.exports = new Transform({
  writableObjectMode: true,
  transform(event, _encoding, callback) {
    if (destination) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.appendFileSync(destination, `${serialize(event)}\n`, 'utf8');
    }

    if (event.type === 'test:pass') {
      if (event.data.skip) {
        callback();
        return;
      }
      callback(null, `✔ ${event.data.name}\n`);
      return;
    }
    if (event.type === 'test:fail') {
      callback(null, `✖ ${event.data.name}\n`);
      return;
    }
    if (event.type === 'test:complete' && event.data.skip) {
      callback(null, `﹣ ${event.data.name} # ${event.data.skip}\n`);
      return;
    }
    if (event.type === 'test:summary') {
      const summary = event.data.counts;
      if (!summary) {
        callback();
        return;
      }
      callback(
        null,
        `tests ${summary.tests} · passed ${summary.passed} · failed ${summary.failed} · skipped ${summary.skipped}\n`,
      );
      return;
    }
    callback();
  },
});
