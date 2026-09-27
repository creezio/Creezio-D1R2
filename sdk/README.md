# @creezio/sdk 1.0.0

This package is the public module authoring surface for the local T-30 qualification. The root application remains private; a module imports only the explicit subpaths in `package.json.exports`.

Build the package from the repository root with `npm run sdk:build`, then run `npm pack --workspace sdk --ignore-scripts`. The tarball contains ESM JavaScript, TypeScript declarations and the versioned contract schemas. The package does not include the application, its databases, secrets or a separate Worker.

Handlers import `OperationError` and the plan-only context from `@creezio/sdk/operations/handler`. The host imports the same runtime error from `@creezio/sdk/operations/error`; a separately bundled copy would break `instanceof`. React and React DOM are shared peer dependencies for views. `@creezio/sdk/contracts/node` is a Node-only validation entry and must not be imported by a Worker handler or browser view.

No registry publication is part of this local qualification. Use the exact verified tarball and its digest when installing a starter module into a separate application.
