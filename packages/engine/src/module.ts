import { ObjectRepository } from '@taf/core';
import { IAutomationAdapter } from './adapter';

export interface ModuleContext {
  adapter: IAutomationAdapter;
  objectRepository: ObjectRepository;
  /** Object repository app id the current test case is exercising (e.g. "createPurchaseOrder"). */
  appId: string;
  params: Record<string, string>;
  /** Shared, mutable state for the run — e.g. a PO number captured by an earlier step. */
  runState: Record<string, unknown>;
  /** When set, fill-related modules capture an annotated "field = value" evidence screenshot into this directory. */
  evidenceDir?: string;
  /** Optional progress channel for bounded work inside one module step, such
   * as the line items owned by one sales-order transaction. */
  onChildProgress?: (progress: ChildWorkProgress) => void | Promise<void>;
}

export interface ChildWorkProgress {
  label: string;
  completed: number;
  total: number;
  currentIndex?: number;
  currentKey?: string;
  status: 'running' | 'passed' | 'failed';
  error?: string;
}

/** One expected entry in a module's params bag — lets a UI generate a real form instead of a freeform key/value editor. */
export interface ModuleParamDescriptor {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  /**
   * When this param's value is an object-repository control name, which kinds of
   * captured control make sense here — e.g. a "Click Button" step's control name
   * should only suggest clickable objects, not a table column or a read-only label.
   * Absent means "any kind" (a freeform field, not an object reference, or a module
   * like AssertControlText that legitimately reads many kinds of control).
   */
  objectKind?: ('clickable' | 'fillable' | 'toggleable' | 'readable' | 'tableColumn')[];
  /**
   * This param can only ever hold a fixed value — a timeout, a key name, a dialog title, a
   * run-state key this module writes. Binding it to a dataset column or to system context is
   * never meaningful, so the authoring form hides the value-source choice and shows one box.
   */
  literalOnly?: boolean;
  /**
   * What kind of value this param holds, so the authoring form can render the control the
   * answer actually needs instead of a text box for everything. Absent means 'text'.
   *
   * Params are strings on the wire either way — this only changes how the value is collected.
   * 'boolean' renders a checkbox writing 'true'/'false'; 'enum' renders a select over
   * `options`; 'number' renders a numeric input. All three imply literalOnly behaviour in the
   * form (a checkbox has nowhere to put a ${placeholder}), so they never show a value source.
   */
  type?: 'text' | 'number' | 'boolean' | 'enum' | 'appUrl';
  /** The allowed values for `type: 'enum'`. The first is treated as the default. */
  options?: string[];
  /**
   * This param has a sensible default that is right almost every time, so the form collapses it
   * into "Options" rather than spending prime vertical space on it.
   *
   * Deliberately NOT the same as `!required`. An optional param the author genuinely has to
   * think about — a dialog title to expect, a run-state key another step consumes — stays in
   * the main form. Hiding those is how a Test ends up silently missing a value it needed:
   * the 14 Aug 2026 observed run skipped `dialogTitles` and `maxLength` exactly that way.
   * Mark `advanced` only when leaving the param unset produces the behaviour you'd want.
   */
  advanced?: boolean;
  /**
   * The value this module falls back to when the param is absent — the SAME literal the
   * module's own `execute` uses (`params.timeoutMs ?? '8000'`). Keep the two in step.
   *
   * The authoring form shows this in the field as a soft value: visible and editable, but not
   * written into the Test unless the author actually changes it. That distinction is the point.
   * Persisting a default would pin every Test to today's value, so raising a timeout later
   * would silently not apply to any Test authored before the change.
   */
  default?: string;
}

/** Human-facing metadata for a module — optional, so modules can be described incrementally. */
export interface ModuleDescriptor {
  label: string;
  description: string;
  params: ModuleParamDescriptor[];
  /** Groups the module picker (BL-10) — e.g. "Built-In Modules" (works on any screen)
   * vs a business-process domain like "Procurement". Absent modules land in an
   * "Uncategorized" bucket rather than being hidden. */
  category?: string;
  /**
   * Produces a plain-English, run-specific description of what this step actually did —
   * e.g. "Entered SupplierField = USSU-TRL07" rather than the generic module name
   * "EnterHeaderField". Called AFTER execute() resolves (pass or fail), with the step's
   * resolved params and the run's current state — so a capture module (e.g.
   * SaveAndCaptureDocumentNumber) can report the value it just captured, not just its
   * inputs. Falls back to `label` (then the bare module name) when absent or when it
   * throws — a module not yet given a narrate function still gets a sensible label.
   */
  narrate?: (ctx: { params: Record<string, string>; runState: Record<string, unknown> }) => string;
}

export interface Module {
  name: string;
  /** Optional UI-facing metadata — absent means "no schema yet", callers should fall back to a generic param editor. */
  describe?: ModuleDescriptor;
  execute(ctx: ModuleContext): Promise<void>;
}
