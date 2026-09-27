/** Only a user action from the currently displayed protected pane may drive the URL.
 * Projection refresh and a pending direct link must not replay an older pane URL. */
export function shouldNavigateFromPanel(currentUrl: string, previousPanelUrl: string | null,
  nextPanelUrl: string, currentProtectedAllowed: boolean): boolean {
  return currentProtectedAllowed && previousPanelUrl === currentUrl && nextPanelUrl !== currentUrl;
}
