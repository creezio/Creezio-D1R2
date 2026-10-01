/** Query parameters on the root URL do not select a front view or prove a payment. */
export function isFrontHomeUrl(url: string): boolean {
  return url === '/' || url.startsWith('/?');
}
