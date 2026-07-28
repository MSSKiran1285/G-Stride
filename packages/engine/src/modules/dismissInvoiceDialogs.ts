import { IAutomationAdapter } from '../adapter';

/**
 * Two different dialogs can appear at unpredictable points on the Supplier
 * Invoice screen, and they need OPPOSITE-sounding but each-correct responses:
 *  - "Data Will Be Lost" (Company Code change) → "OK" to proceed.
 *  - "Invoice Draft Exists" reappearing mid-flow → "Yes" to keep using the
 *    header data already entered THIS session (NOT "No" — that discards it;
 *    confirmed by it resetting the whole form).
 * Detect which dialog is actually open by its distinctive title first, then
 * click that dialog's correct button — rather than guessing by trying button
 * texts in sequence, which risks clicking the wrong dialog's button.
 */
export async function dismissInvoiceDialogs(adapter: IAutomationAdapter, timeoutMs = 4000): Promise<void> {
  const title = await adapter.findVisibleText(['Data Will Be Lost', 'Invoice Draft Exists'], timeoutMs);
  if (title === 'Data Will Be Lost') {
    await adapter.clickByText('OK').catch(() => undefined);
  } else if (title === 'Invoice Draft Exists') {
    await adapter.clickByText('Yes').catch(() => undefined);
  }
}

/**
 * The "Messages" validation popover (opened automatically whenever a required
 * field check fires) is non-modal but stays open and physically overlaps the
 * Items table / Assign all button area at the bottom-left of the screen — any
 * click underneath it silently hangs for Playwright's full actionability
 * timeout instead of failing fast. It's a light-dismiss UI5 popover, so a
 * click on the always-present page title closes it without side effects.
 */
export async function closeMessagesPopoverIfOpen(adapter: IAutomationAdapter): Promise<void> {
  const title = await adapter.findVisibleText(['Messages'], 1000);
  if (title === 'Messages') {
    await adapter.clickByText('New Supplier Invoice', 3000).catch(() => undefined);
  }
}
