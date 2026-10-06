#!/bin/sh
set -eu
checkout=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  printf 'Install Bun from https://bun.sh/install? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes) curl -fsSL https://bun.sh/install | bash ;; *) printf 'Install Bun >= 1.2, then rerun install.sh.\n'; exit 1 ;; esac
fi
bun -e 'const [a,b]=Bun.version.split(".").map(Number); if(a<1 || (a===1 && b<2)) process.exit(1)' || { printf 'Bun >= 1.2 is required.\n'; exit 1; }
cd "$checkout"
bun install --frozen-lockfile
(cd packages/bedrock && bun link)
bedrock_bin=$(command -v bedrock || true)
if [ "$bedrock_bin" != "$BUN_INSTALL/bin/bedrock" ]; then
  mkdir -p "$BUN_INSTALL/bin"
  ln -sf "$checkout/packages/bedrock/src/cli/index.ts" "$BUN_INSTALL/bin/bedrock"
fi
bedrock --version
printf '\nNext: bedrock setup\n'
case ":${PATH}:" in *":$HOME/.bun/bin:"*) ;; *) printf 'Add %s/bin to your shell PATH.\n' "$BUN_INSTALL" ;; esac
printf 'Ensure %s/bin is on PATH in your next terminal.\n' "$BUN_INSTALL"
