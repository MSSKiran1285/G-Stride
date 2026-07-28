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
