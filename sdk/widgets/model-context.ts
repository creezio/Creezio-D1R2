/** Keep Creezio's action routing inside its host adapter; external MCP Apps receive portable context. */
export function widgetModelContextPayload(hostName: string | undefined, actionId: string,
  input: Readonly<Record<string, unknown>>, remove = false):
  Readonly<{structuredContent: Readonly<Record<string, unknown>>}> {
  if (hostName === 'Creezio') return {structuredContent: {creezioWidgetAction: {
    actionId, input, ...(remove ? {remove: true} : {})}}};
  return {structuredContent: remove ? {} : {...input}};
}
