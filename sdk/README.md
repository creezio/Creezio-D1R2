# @creezio/sdk 1.1.0 — candidate T32 non publiée

This package is the module authoring surface for Creezio. The public T-30 archive `sdk-v1.0.0` is immutable; this 1.1.0 source candidate adds the delivery transport and context subpaths for T32 and has not been released. The root application remains private; a module imports only the explicit subpaths in `package.json.exports`.

Build the package from the repository root with `npm run sdk:build`, then run `npm pack --workspace sdk --ignore-scripts`. The tarball contains ESM JavaScript, TypeScript declarations and the versioned contract schemas. The package does not include the application, its databases, secrets or a separate Worker.

Handlers import `OperationError` and the plan-only context from `@creezio/sdk/operations/handler`. The host imports the same runtime error from `@creezio/sdk/operations/error`; a separately bundled copy would break `instanceof`. React and React DOM are shared peer dependencies for views. `@creezio/sdk/contracts/node` is a Node-only validation entry and must not be imported by a Worker handler or browser view.

No npm registry publication is implied by this source candidate. The starter release continues to use the exact verified 1.0.0 tarball and its digest. Build and qualify 1.1.0 on its final commit before any separate release.
