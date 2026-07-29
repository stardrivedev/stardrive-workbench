/**
 * Driving the console's confirmation dialog from a test.
 *
 * Destructive actions used to go through window.confirm, and the browser
 * suites dealt with that by auto-accepting every native dialog. Now that they
 * are real in-page dialogs, a test has to press the button a person would,
 * which is a better test: it proves the dialog actually appeared, and that the
 * button it offers is the one we intended.
 */

/** Wait for the confirmation dialog, then take the named action.
 *  Returns what it said, so a test can assert the wording. */
export async function confirmDialog(page, { accept = true, timeout = 6000 } = {}) {
  await page.waitForSelector('#confirmDialog[open]', { timeout });
  const said = await page.evaluate(() => ({
    title: document.getElementById('confirmTitle').textContent,
    body: document.getElementById('confirmBody').textContent,
    confirmLabel: document.getElementById('confirmGo').textContent,
    cancelLabel: document.getElementById('confirmCancel').textContent,
  }));
  await page.click(accept ? '#confirmGo' : '#confirmCancel');
  await page.waitForSelector('#confirmDialog[open]', { state: 'detached', timeout: 3000 }).catch(async () => {
    // `open` is an attribute, not a node, so wait for it to actually clear.
    await page.waitForFunction(() => !document.getElementById('confirmDialog')?.open, null, { timeout: 3000 });
  });
  return said;
}

/**
 * Accept the dialog whenever it turns up, for tests whose subject is something
 * else entirely. Records every title it dismissed so a test can still check
 * that the expected question was asked.
 */
export async function autoConfirm(page) {
  const seen = [];
  await page.exposeFunction('__sdDialogSeen', (title) => { seen.push(title); });
  await page.addInitScript(() => {
    // The dialog is opened by script, so watch the attribute rather than
    // polling: `open` appears the moment showModal() runs.
    const arm = () => {
      const dlg = document.getElementById('confirmDialog');
      if (!dlg) return false;
      new MutationObserver(() => {
        if (!dlg.open) return;
        window.__sdDialogSeen?.(document.getElementById('confirmTitle')?.textContent || '');
        document.getElementById('confirmGo')?.click();
      }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
      return true;
    };
    if (!arm()) document.addEventListener('DOMContentLoaded', arm);
  });
  return seen;
}
