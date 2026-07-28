import { ControlDefinition, ObjectRepository } from '@taf/core';
import { IAutomationAdapter, ObjectLocator, TableCellLocator } from './adapter';
import { FIELD_EVIDENCE_KEY } from './executionEngine';

function toLocator(control: ControlDefinition): ObjectLocator {
  if (control.tableId) {
    throw new Error(`"${control.name}" is a table-cell control — use its tableId/columnId/rowIndex directly instead`);
  }
  return { controlId: control.controlId, controlType: control.controlType };
}

function persistHealing(objectRepository: ObjectRepository, control: ControlDefinition, healedControlId?: string): void {
  if (!healedControlId || healedControlId === control.controlId) return;
  objectRepository.upsert({ ...control, controlId: healedControlId });
}

export interface EvidenceOptions {
  evidenceDir?: string;
  runState?: Record<string, unknown>;
}

/** "Delivered Quantity" instead of "DeliveredQuantityColumn" — falls back to the logical name when no label is set. */
function buildEvidenceCaption(control: ControlDefinition, value: string): string {
  return `${control.label ?? control.name} = ${value}`;
}

async function maybeCaptureFieldEvidence(
  adapter: IAutomationAdapter,
  locator: ObjectLocator,
  caption: string,
  evidence?: EvidenceOptions
): Promise<void> {
  if (!evidence?.evidenceDir || !evidence.runState) return;
  const fileName = `${Date.now()}-${caption.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}.png`;
  const screenshotPath = `${evidence.evidenceDir}/${fileName}`;
  await adapter.captureFieldEvidence(locator, caption, screenshotPath);
  const log = (evidence.runState[FIELD_EVIDENCE_KEY] as { label: string; screenshotPath: string }[] | undefined) ?? [];
  log.push({ label: caption, screenshotPath });
  evidence.runState[FIELD_EVIDENCE_KEY] = log;
}

/** Captures evidence for a value already read/known (e.g. a PO number after save), without re-reading or re-filling it. */
export async function captureControlEvidence(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  name: string,
  value: string,
  evidence: EvidenceOptions
): Promise<void> {
  const control = objectRepository.get(appId, name);
  await maybeCaptureFieldEvidence(adapter, toLocator(control), buildEvidenceCaption(control, value), evidence);
}

export async function waitForControl(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  name: string,
  timeoutMs?: number
): Promise<void> {
  const control = objectRepository.get(appId, name);
  const { healedControlId } = await adapter.waitFor(toLocator(control), timeoutMs);
  persistHealing(objectRepository, control, healedControlId);
}

export async function clickControl(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  name: string
): Promise<void> {
  const control = objectRepository.get(appId, name);
  const { healedControlId } = await adapter.performAction(toLocator(control), 'click');
  persistHealing(objectRepository, control, healedControlId);
}

export async function fillControl(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  name: string,
  value: string,
  options: { pressKey?: string } | undefined,
  evidence: EvidenceOptions
): Promise<void> {
  const control = objectRepository.get(appId, name);
  const locator = toLocator(control);
  const { healedControlId } = await adapter.performAction(locator, 'fill', value, options);
  persistHealing(objectRepository, control, healedControlId);
  await maybeCaptureFieldEvidence(adapter, locator, buildEvidenceCaption(control, value), evidence);
}

export async function readControlValue(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  name: string
): Promise<string> {
  const control = objectRepository.get(appId, name);
  const { value, healedControlId } = await adapter.readValue(toLocator(control));
  persistHealing(objectRepository, control, healedControlId);
  return value;
}

type TableCellStyle = Pick<TableCellLocator, 'columnAttr' | 'rowIndexAttr'>;

function toTableCellLocator(column: ControlDefinition, rowIndex: number, style?: TableCellStyle): ObjectLocator {
  if (!column.tableId) throw new Error(`"${column.name}" is missing tableId in the object repository`);
  return { tableCell: { tableId: column.tableId, columnId: column.controlId, rowIndex, ...style } };
}

export async function waitForTableCell(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  columnFieldName: string,
  rowIndex: number,
  style?: TableCellStyle,
  timeoutMs?: number
): Promise<void> {
  const column = objectRepository.get(appId, columnFieldName);
  await adapter.waitFor(toTableCellLocator(column, rowIndex, style), timeoutMs);
}

export async function clickTableCell(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  columnFieldName: string,
  rowIndex: number,
  style?: TableCellStyle
): Promise<void> {
  const column = objectRepository.get(appId, columnFieldName);
  await adapter.performAction(toTableCellLocator(column, rowIndex, style), 'click');
}

export async function fillTableCell(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  columnFieldName: string,
  rowIndex: number,
  value: string,
  style: TableCellStyle | undefined,
  evidence: EvidenceOptions
): Promise<void> {
  const column = objectRepository.get(appId, columnFieldName);
  const locator = toTableCellLocator(column, rowIndex, style);
  await adapter.performAction(locator, 'fill', value);
  await maybeCaptureFieldEvidence(adapter, locator, buildEvidenceCaption(column, value), evidence);
}

export async function readTableCellValue(
  adapter: IAutomationAdapter,
  objectRepository: ObjectRepository,
  appId: string,
  columnFieldName: string,
  rowIndex: number,
  style?: TableCellStyle
): Promise<string> {
  const column = objectRepository.get(appId, columnFieldName);
  const { value } = await adapter.readValue(toTableCellLocator(column, rowIndex, style));
  return value;
}
