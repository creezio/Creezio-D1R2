import type { AuthorizationAudience } from '../authorization/types.ts';
import type {WidgetUiMeta, Integrity} from '../../sdk/widgets/catalog.ts';

export type McpCredential = { readonly kind: 'oauth'; readonly token: string; readonly resource: string }
  | { readonly kind: 'api-token'; readonly token: string };
export interface McpToolBinding {
  readonly name: string;
  readonly contributorModuleId: string;
  readonly moduleId: string;
  readonly operationId: string;
  readonly audience: AuthorizationAudience;
  readonly auth: readonly ('oauth' | 'api-token')[];
  readonly actors: readonly ('delegated-user' | 'machine')[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: Readonly<{readOnly: boolean; destructive: boolean; idempotent: boolean; openWorld: boolean}>;
  readonly context: 'application' | 'required';
  readonly permissions: readonly string[];
  readonly contractDigest: string;
  readonly ui?: Readonly<{
    resourceUri: string;
    visibility: readonly ('model' | 'app')[];
    widget: Readonly<{moduleId: string; widgetId: string; version: string; resourceDigest: Integrity}>;
  }>;
}
export interface McpResourceBinding {
  readonly id: string;
  readonly uri: string;
  readonly mimeType: string;
  readonly contributorModuleId: string;
  readonly audience: AuthorizationAudience;
  readonly permissions: readonly string[];
  readonly actors: readonly string[];
  readonly context: 'application' | 'required';
  readonly source: Readonly<
    {kind: 'asset'; path: string} |
    {kind: 'operation'; moduleId: string; operationId: string} |
    {kind: 'compiled-widget'; digest: Integrity; cspProfileId: Integrity; text: string; uiMeta: WidgetUiMeta}
  >;
}
export interface McpCatalog {
  readonly tools: readonly McpToolBinding[];
  readonly resources: readonly McpResourceBinding[];
}
