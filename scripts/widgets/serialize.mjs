/** Emit MCP resources with references to the one compiled HTML copy in widgetCatalog. */
export function serializeMcpCatalogWithWidgetResources(mcpCatalog, widgetCatalog) {
  if (!Array.isArray(mcpCatalog?.tools) || !Array.isArray(mcpCatalog?.resources)
    || !Array.isArray(widgetCatalog?.resources)) throw new TypeError('Invalid widget catalogs.');
  const widgets = new Map(widgetCatalog.resources.map((resource, index) => [resource.uri, {resource, index}]));
  const resources = mcpCatalog.resources.map(resource => {
    if (resource.source?.kind !== 'compiled-widget') return JSON.stringify(resource);
    const linked = widgets.get(resource.uri);
    if (!linked || linked.resource.digest !== resource.source.digest
      || linked.resource.text !== resource.source.text
      || linked.resource.cspProfileId !== resource.source.cspProfileId)
      throw new TypeError('MCP widget resource differs from its compiled HTML.');
    const {text, ...source} = resource.source;
    const fields = Object.entries(resource).map(([name, value]) => name === 'source'
      ? `${JSON.stringify(name)}:{...${JSON.stringify(source)},text:widgetCatalog.resources[${linked.index}].text}`
      : `${JSON.stringify(name)}:${JSON.stringify(value)}`);
    return `{${fields.join(',')}}`;
  });
  return `{tools:${JSON.stringify(mcpCatalog.tools)},resources:[${resources.join(',')}]}`;
}
