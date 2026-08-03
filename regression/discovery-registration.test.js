'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveControlName } = require('../packages/engine/dist');

function control(overrides) {
  return { controlId: 'x--y', controlType: 'sap.m.Input', category: 'actionable', ...overrides };
}

test('derives a Field name from a button-less input control id when no text is present', () => {
  const name = deriveControlName(
    control({ controlId: 'i2d.le.st.delivery.create::sap.suite.ui.generic.template.ListReport.view.ListReport::C_OutboundDeliveryCreate--listReportFilter-filterItemControl_BASIC-SDDocument', controlType: 'sap.ui.comp.smartfilterbar.SFBMultiInput' }),
    []
  );
  assert.equal(name, 'SDDocumentField');
});

test('derives a Button name from visible text, stripping a parenthetical count', () => {
  const name = deriveControlName(control({ controlType: 'sap.m.Button', text: 'Create Deliveries (1)' }), []);
  assert.equal(name, 'CreateDeliveriesButton');
});

test('derives a short Button name from a single word', () => {
  const name = deriveControlName(control({ controlType: 'sap.m.Button', text: 'Go' }), []);
  assert.equal(name, 'GoButton');
});

test('derives a Table name from the control id when the control type ends in Table', () => {
  const name = deriveControlName(control({ controlId: 'x--responsiveTable', controlType: 'sap.m.Table' }), []);
  assert.equal(name, 'ResponsiveTable');
});

test('does not double-append the type suffix when the derived base already ends with it', () => {
  const name = deriveControlName(control({ controlType: 'sap.m.Button', text: 'Save Button' }), []);
  assert.equal(name, 'SaveButton');
});

test('appends a numeric suffix when the derived name collides with an existing different control', () => {
  const name = deriveControlName(control({ controlType: 'sap.m.Button', text: 'Save' }), ['SaveButton']);
  assert.equal(name, 'SaveButton2');
});

test('keeps incrementing the numeric suffix past one collision', () => {
  const name = deriveControlName(control({ controlType: 'sap.m.Button', text: 'Save' }), ['SaveButton', 'SaveButton2']);
  assert.equal(name, 'SaveButton3');
});
