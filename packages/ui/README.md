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

Every Onyx primitive is exported from the package root: form controls (Field,
Input, Select, Combobox, DatePicker, Slider, …), overlays (Dialog, Sheet,
AlertDialog, Popover, Menu, Tooltip, Command), collections (Listbox, Tree,
VirtualList, Table), layout and workbench pieces (Stack, Panel, Toolbar, Sidebar,
SplitView, StatusBar), and display components (Badge, Card, Alert, Avatar,
Skeleton, …). Names and APIs match Onyx; `Toast` and `Tabs` keep Onyx's
composition API, including the toast queue hook.

## Themes and custom styles

Dark is the Onyx default. Switch the document tokens for controls and body portals:

```ts
document.documentElement.dataset.theme = "light";
document.documentElement.dataset.theme = "dark";
```

The dark/light palettes and component defaults come directly from Onyx. Customize
semantic `--onyx-*` variables on `:root`, or use `OnyxThemeRoot` with `variables`,
`theme="light"`/`theme="dark"`, and `density="compact"`/`density="comfortable"`
for a scoped theme. An omitted theme inherits its surroundings. Floating children
inside a Dialog inherit its portal host and theme. Body portals need
document-level token overrides. See Onyx's theme documentation for browser
support and the explicit-theme fallback for automatic semantic rebinding.

Use ordinary CSS for app layouts. The prebuilt CSS covers every Onyx component,
not arbitrary Tailwind classes from consumer apps. Import your app CSS after
`@bedrock/ui/styles.css`; Onyx styles sit in cascade layers, so your rules win.
UI defaults and Bedrock layouts use semantic tokens.

## Maintainer workflow

Onyx is a regular dependency: the published
[`@mroiban/onyx`](https://github.com/MRoiban/onyx/releases) release tarball.
`src/index.ts` re-exports it, and the Bedrock components import from it. To
upgrade, change the release URL in `package.json`, then:

```sh
bun install
cd packages/ui && bun run build:css
```

`build:css` concatenates Onyx's standalone `styles.css` (which already embeds
the codicon font and its notices) with `src/bedrock/styles.css`; no Tailwind or
PostCSS step is involved. Commit the lockfile and `dist/styles.css`. End users
never run these scripts.

Run `bun install`, `bun run typecheck`, and `bun test` from the repository root.

Release installation discovers the daemon checkout's first-party packages and
links them from one list. Their available peer dependencies are shared too,
so linked Bedrock hooks/UI and the app use the same React instance and renderer.
Onyx brings its own runtime dependencies (Radix UI, Floating UI, cmdk, TanStack
Virtual, cva, clsx, tailwind-merge).

## React starter

`bedrock init my-pebble --template react` scaffolds a Bun HTML entry, React app,
typed live notes, attachments, Onyx CSS, and the four Bedrock components.
Run `bun install`, `bedrock db generate`, then `bun run dev`. The local development
login requires no Google credentials. Until the packages are published, use the
monorepo/workspace versions (or local package paths) when installing the starter.
