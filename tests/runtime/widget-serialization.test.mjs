import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {serializeMcpCatalogWithWidgetResources} from '../../scripts/widgets/serialize.mjs';

test('MCP audience resources reference one compiled static widget HTML value', () => {
  const html = '<!doctype html><html>unique-widget-html-marker</html>';
  const widgetCatalog = {resources: [{uri: 'ui://widget', digest: 'digest-1',
    cspProfileId: 'profile-1', text: html}]};
  const shared = {kind: 'compiled-widget', digest: 'digest-1',
    cspProfileId: 'profile-1', text: html, uiMeta: {csp: {connectDomains: []}}};
  const mcpCatalog = {tools: [], resources: [
    {id: 'admin', uri: 'ui://widget', audience: 'admin', source: shared},
    {id: 'app', uri: 'ui://widget', audience: 'app', source: shared},
  ]};
  const emitted = serializeMcpCatalogWithWidgetResources(mcpCatalog, widgetCatalog);
  assert.equal(emitted.includes('unique-widget-html-marker'), false);
  assert.equal((JSON.stringify(widgetCatalog) + emitted).split('unique-widget-html-marker').length - 1, 1);
  const reconstructed = runInNewContext(`(${emitted})`, {widgetCatalog});
  assert.equal(reconstructed.resources[0].source.text, html);
  assert.equal(reconstructed.resources[1].source.text, html);
  assert.equal(reconstructed.resources[0].source.text,
    widgetCatalog.resources[0].text);
  assert.throws(() => serializeMcpCatalogWithWidgetResources({tools: [], resources: [
    {...mcpCatalog.resources[0], source: {...shared, text: 'other'}}]}, widgetCatalog),
  /differs from its compiled HTML/);
});
