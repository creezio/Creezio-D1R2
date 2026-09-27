import path from 'node:path';

const UPDATE_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,55}$/;

/** The initial delivery and each code update keep separate, durable artifacts. */
export function cloudflareBuildPaths(root,updateId=null){
  if(typeof root!=='string'||!path.isAbsolute(root)
    ||updateId!==null&&!UPDATE_ID.test(updateId))throw Object.assign(
      new Error('Invalid Cloudflare artifact identity.'),{code:'invalid_artifact_identity'});
  root=path.resolve(root);
  const delivery=path.join(root,'.wrangler','delivery');
  const build=path.join(delivery,'build');
  const local=path.join(root,'.quality','delivery-build');
  const buildSpace=updateId===null?build:path.join(delivery,'updates',updateId);
  const localSpace=updateId===null?local:path.join(local,'updates',updateId);
  return Object.freeze({buildSpace,localSpace,artifactRoot:path.join(buildSpace,'artifact'),
    staging:path.join(buildSpace,'artifact-staging')});
}

export const cloudflareArtifactRoot=(root,updateId=null)=>
  cloudflareBuildPaths(root,updateId).artifactRoot;
