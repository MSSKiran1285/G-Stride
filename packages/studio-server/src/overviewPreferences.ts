import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Automation Overview's execution-impact cost model — see AutomationOverview.tsx's
 *  ImpactAssumptions. Mirrored here (not imported) since studio-server has no dependency on
 *  studio-web, the same reasoning used elsewhere in this codebase for small shared shapes. */
export interface ImpactAssumptions {
  manualMinutesPerTest: number;
  manualDurationMultiplier: number;
  manualHourlyCost: number;
  automationHourlyCost: number;
  automationEngineerHourlyCost: number;
  buildAndSetupHours: number;
  buildAmortizationMonths: number;
  maintenanceHoursPerMonth: number;
  licenseCostPerMonth: number;
  infrastructureCostPerMonth: number;
  reviewMinutesPerExecution: number;
  triageMinutesPerFailure: number;
  otherAutomationCost: number;
}

const DEFAULT_ASSUMPTIONS: ImpactAssumptions = {
  manualMinutesPerTest: 12,
  manualDurationMultiplier: 3,
  manualHourlyCost: 50,
  automationHourlyCost: 2,
  automationEngineerHourlyCost: 75,
  buildAndSetupHours: 40,
  buildAmortizationMonths: 12,
  maintenanceHoursPerMonth: 4,
  licenseCostPerMonth: 100,
  infrastructureCostPerMonth: 50,
  reviewMinutesPerExecution: 3,
  triageMinutesPerFailure: 15,
  otherAutomationCost: 0,
};

const NUMERIC_KEYS = Object.keys(DEFAULT_ASSUMPTIONS) as (keyof ImpactAssumptions)[];

/** BL-019 AC2: "Cost assumptions are saved as owner workspace preferences" — a single owner
 *  workspace has one shared set of assumptions, so a small JSON file (mirroring
 *  WorkspaceGovernanceStore's own pattern) is enough; no per-user scoping exists in Studio today. */
export class OverviewPreferencesStore {
  constructor(private readonly filePath: string) {}

  private read(): ImpactAssumptions {
    if (!existsSync(this.filePath)) return { ...DEFAULT_ASSUMPTIONS };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<Record<keyof ImpactAssumptions, unknown>>;
      const merged = { ...DEFAULT_ASSUMPTIONS };
      for (const key of NUMERIC_KEYS) {
        const value = parsed[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) merged[key] = value;
      }
      return merged;
    } catch {
      return { ...DEFAULT_ASSUMPTIONS };
    }
  }

  getImpactAssumptions(): ImpactAssumptions {
    return this.read();
  }

  /** Merges only recognized, valid (finite, non-negative) numeric fields over the existing
   *  saved assumptions — an unrecognized or invalid field is silently ignored rather than
   *  corrupting the stored preference file. */
  saveImpactAssumptions(next: Partial<Record<string, unknown>>): ImpactAssumptions {
    const merged = this.read();
    for (const key of NUMERIC_KEYS) {
      const value = next[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) merged[key] = value;
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.filePath);
    return merged;
  }
}
