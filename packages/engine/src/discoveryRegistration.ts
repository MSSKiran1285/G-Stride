import { CapturedControl } from './discoveryNavigation';

/**
 * Every existing Object Repository row was named by a human typing a logical name — there's
 * no "type a name" step in an autonomous loop, so BL-047 Phase 2 needs a deterministic way to
 * derive one instead. Same shape human-chosen names in this product already follow (e.g.
 * "SupplierField", real captured control text like "Go"/"Save" plus a type-based suffix),
 * not a new convention invented here.
 */
function typeSuffix(controlType: string): string {
  if (/Button$/.test(controlType)) return 'Button';
  if (/Column$/.test(controlType)) return 'Column';
  if (/Table$/.test(controlType)) return 'Table';
  if (/Input|Field|ComboBox|DatePicker|Select$/.test(controlType)) return 'Field';
  return 'Control';
}

function toPascalCase(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, '') // strip parenthetical counts, e.g. "Create Deliveries (1)"
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/** The segment after a control id's last run of `-`/`:` characters is usually its own short
 *  technical name (e.g. "...--filterItemControl_BASIC-SDDocument" -> "SDDocument",
 *  "...--createDelivery" -> "createDelivery") — used only when the control has no visible
 *  text to build a name from instead. */
function lastIdSegment(controlId: string): string {
  return controlId.split(/[-:]+/).at(-1) ?? controlId;
}

/**
 * Derives a logical Object Repository name for a freshly discovered control, and guarantees
 * it doesn't collide with a name already used (by a *different* control) for this App ID —
 * appending a numeric suffix rather than silently overwriting an unrelated row.
 */
export function deriveControlName(control: CapturedControl, existingNames: string[]): string {
  const suffix = typeSuffix(control.controlType);
  const base = toPascalCase(control.text?.trim() || lastIdSegment(control.controlId));
  const candidate = base.endsWith(suffix) ? base : `${base}${suffix}`;

  if (!existingNames.includes(candidate)) return candidate;
  let n = 2;
  while (existingNames.includes(`${candidate}${n}`)) n += 1;
  return `${candidate}${n}`;
}
