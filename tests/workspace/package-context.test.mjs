import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

test('host source and an installed SDK resolve one set of React contexts',async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const source=`
    import * as activitySource from './sdk/workspace/components.tsx';
    import * as activityPackage from '@creezio/sdk/workspace/components';
    import * as metadataSource from './sdk/workspace/metadata.tsx';
    import * as metadataPackage from '@creezio/sdk/workspace/metadata';
    import * as toolbarSource from './sdk/workspace/toolbar.tsx';
    import * as toolbarPackage from '@creezio/sdk/workspace/toolbar';
    import * as assistantSource from './sdk/ui/assistant-provider.tsx';
    import * as assistantPackage from '@creezio/sdk/ui/assistant-provider';
    export const identities={
      activity:activitySource.Workspace===activityPackage.Workspace
        &&activitySource.useWorkspaceActivity===activityPackage.useWorkspaceActivity
        &&activitySource.WorkspacePortal===activityPackage.WorkspacePortal,
      metadata:metadataSource.WorkspaceMetadataProvider===metadataPackage.WorkspaceMetadataProvider
        &&metadataSource.useRegisterWorkspaceMetadata===metadataPackage.useRegisterWorkspaceMetadata,
      toolbar:toolbarSource.PageToolbarProvider===toolbarPackage.PageToolbarProvider
        &&toolbarSource.useRegisterPageToolbar===toolbarPackage.useRegisterPageToolbar,
      assistant:assistantSource.AssistantProvider===assistantPackage.AssistantProvider
        &&assistantSource.useAssistantUiOptional===assistantPackage.useAssistantUiOptional,
    };`;
  const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'contexts.tsx',loader:'tsx'},
    bundle:true,platform:'node',format:'esm',write:false});
  const url=`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
  const {identities}=await import(url);
  assert.deepEqual(identities,{activity:true,metadata:true,toolbar:true,assistant:true});
});
