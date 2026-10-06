# @bedrock/ui

Onyx React primitives and four small Bedrock components. React 19 and Bun ≥ 1.2.
The package exports TypeScript source and a committed, standalone stylesheet.
Pebbles need no Tailwind, PostCSS, configuration, or CSS build command.

```sh
bun add bedrock @bedrock/ui react@^19 react-dom@^19
```

```tsx
import { createRoot } from "react-dom/client";
import { createClient } from "bedrock/client";
import { BedrockProvider } from "bedrock/react";
import { AppShell, UserMenu, SignInGate, Button } from "@bedrock/ui";
import "@bedrock/ui/styles.css";

const client = createClient();
createRoot(document.getElementById("root")!).render(
  <BedrockProvider client={client}>
    <AppShell name="My pebble" userMenu={<UserMenu client={client} />}>
      <SignInGate client={client}><Button>Hello</Button></SignInGate>
    </AppShell>
  </BedrockProvider>
);
```

Reference `app.tsx` from a `<script type="module" src="./app.tsx">` in your HTML
entry. Bun bundles React, the components, and CSS. The codicon font is embedded
in the stylesheet; `Icon` needs no extra import or asset path.

## Components

- `AppShell`: `name`, optional `userMenu` slot, and children. A responsive web header,
  bounded content column, and quiet footer.
- `UserMenu`: `client` with `logout()`, optional `onSignOut`. Reads the user from
  `useUser()`, shows their avatar/name, and signs out. Default success reloads the page.
- `SignInGate`: `client` with `loginUrl()`, optional `name`, and children. Handles
  account loading and shows a sign-in card for anonymous visitors.
- `UploadButton<P>`: typed `bucket`, required `onUpload(metadata)`, optional
  `onError`, `onUploadingChange`, `accept`, `disabled`, and `label`. Uses `useUpload`
  and shows upload progress and errors. Uploads immediately; the caller owns the
  returned file, including deleting abandoned attachments and linking it in a mutation.

All hook components need `BedrockProvider`. Pass the same provider client to auth
components; they accept only the auth methods they need, preserving typed pebble clients.

The registry subset exports button, input, textarea, checkbox, switch, select,
dialog, table, tabs, toast, text, empty-state, progress, kbd, icon, theme, panel,
toolbar, and context-menu primitives from the package root. Panels and toolbars
are useful composition pieces for ordinary web apps. Sidebar/activity-bar,
status-bar, section-select, prompt, and number-effect are omitted to keep the
web API focused; command is omitted to avoid the additional cmdk dependency.
`Toast` and `Tabs` retain Onyx's source-owned composition API; no toast manager
or extra Bedrock list abstraction is added.

## Themes and custom styles

Dark is the Onyx default. Switch the document tokens for controls and body portals:

```ts
document.documentElement.dataset.theme = "light";
document.documentElement.dataset.theme = "dark";
```

The light palette overrides the semantic `--onyx-*` variables. Customize any of
those variables on `:root`, or use `OnyxThemeRoot` with `variables` for a scoped
custom theme. OnyxThemeRoot supplies its own inline default dark tokens, so pass
explicit `variables` for scoped light themes; document `data-theme` is the simplest
app-wide option. Body portals need document-level token overrides.

Use ordinary CSS for app layouts. The prebuilt CSS includes the utilities in
**the vendored components**, not arbitrary Tailwind classes from consumer apps.
Import your app CSS after `@bedrock/ui/styles.css`. Tailwind's standard base reset
is included; UI defaults and Bedrock layouts use semantic tokens. A local alias
`--onyx-control-bg` supplies the progress track token missing from upstream defaults.

## Maintainer workflow

Onyx is the source of truth. Never hand-edit `src/onyx/`.

```sh
cd packages/ui
bun run sync:onyx /path/to/babel-ui/onyx
bun run build:css
```

The source defaults to `/Users/stellar/Playground/babel-ui/onyx`. The sync script
reads registry items and their registry dependencies, follows relative imports
for shared helpers, and preserves upstream directory structure so internal
imports remain valid. It records the source Git commit and a SHA-256 of the
selected registry and source content in `ONYX_VERSION`. The one compatibility
rewrite omits an undefined Radix CheckboxItem `checked` prop for TypeScript's
`exactOptionalPropertyTypes`. It is applied by the script, never by editing a copy.

Onyx's upstream PostCSS config references a retired `new-ui/tailwind.config.cjs`.
This package instead uses its own Tailwind 3/PostCSS development-only script with
explicit content paths. It concatenates the copied tokens/globals, Bedrock CSS,
compiled utilities, and codicons CSS/font into `dist/styles.css`. The codicons
package is a development dependency only; its font/code notices ship in `dist/`.
Commit both the
vendored source and rebuilt stylesheet. End users never run these scripts.

Run `bun install`, `bun run typecheck`, and `bun test` from the repository root.
Sync tests use a temporary source fixture derived from the committed registry
and do not require the original Babel checkout.

Release installation discovers the daemon checkout's first-party packages and
links them from one list. Their available peer dependencies are shared too,
so linked Bedrock hooks/UI and the app use the same React instance and renderer.
Runtime dependencies (Radix dialog/select/context-menu/slot, cva, clsx, and
tailwind-merge, including transitives) occupy roughly 5.4 MiB with `du -ch`,
excluding React/React DOM peers and development tools. The standalone stylesheet
is roughly 188 KiB.

## React starter

`bedrock init my-pebble --template react` scaffolds a Bun HTML entry, React app,
typed live notes, attachments, Onyx CSS, and the four Bedrock components.
Run `bun install`, `bedrock db generate`, then `bun run dev`. The local development
login requires no Google credentials. Until the packages are published, use the
monorepo/workspace versions (or local package paths) when installing the starter.
