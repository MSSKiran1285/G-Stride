import { Module } from '../module';
import { FIELD_EVIDENCE_KEY } from '../executionEngine';
import { dismissInvoiceDialogs, closeMessagesPopoverIfOpen } from './dismissInvoiceDialogs';

/**
 * Runs SAP's own "Simulate" check (previews the accounting document that
 * would be created) before Post — a blocking problem surfaces as its own
 * "Error" dialog, distinct from the non-blocking warning/info entries that
 * routinely show up in the Messages popover. Only the former should stop
 * the run; the latter (e.g. "no delivery costs selected") are expected.
 */
export const SimulateInvoice: Module = {
  name: 'SimulateInvoice',
  describe: {
    label: 'Simulate Invoice',
    category: 'Procurement',
    description: "Runs SAP's own Simulate check and fails the run on a real blocking error, before ever posting.",
    params: [],
    narrate: () => 'Ran Simulate check on the invoice',
  },
  async execute({ adapter, runState, evidenceDir }) {
    await dismissInvoiceDialogs(adapter, 3000);
    await closeMessagesPopoverIfOpen(adapter);

    await adapter.clickByText('Simulate', 8000);
    await adapter.waitForPageSettled();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (evidenceDir) {
      const screenshotPath = `${evidenceDir}/${Date.now()}-Simulation_Result.png`;
      await adapter.screenshot(screenshotPath);
      const log = (runState[FIELD_EVIDENCE_KEY] as { label: string; screenshotPath: string }[] | undefined) ?? [];
      log.push({ label: 'Simulation Result', screenshotPath });
      runState[FIELD_EVIDENCE_KEY] = log;
    }

    const errorTitle = await adapter.findVisibleText(['Error'], 2000);
    if (errorTitle === 'Error') {
      const details = await adapter.readDialogText();
      throw new Error(`Simulation reported a blocking error: ${JSON.stringify(details)}`);
    }
  },
};
