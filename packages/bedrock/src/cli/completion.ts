import { join } from "node:path";
import { bedrockHome } from "../daemon/config";
import { BedrockError } from "../error";
import { acceptsValue, flagAt, flagsFor, resolutionFlags } from "./registry";
import type { CommandSpec, FlagSpec } from "./spec";

export const completionHelp = `Install shell completion:
  bash: bedrock completion bash >> ~/.bashrc
  zsh: source <(bedrock completion zsh) in ~/.zshrc (after compinit)
       or save as _bedrock in a directory on fpath before compinit
  fish: bedrock completion fish > ~/.config/fish/completions/bedrock.fish
  PowerShell: bedrock completion powershell >> $PROFILE`;

const scripts = {
  bash: `# Install: bedrock completion bash >> ~/.bashrc
_bedrock_complete() {
  local candidate
  COMPREPLY=()
  while IFS= read -r candidate; do
    if [[ -n "$candidate" ]]; then
      printf -v candidate '%q' "$candidate"
      COMPREPLY+=("$candidate")
    fi
  done < <(bedrock __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)
  return 0
}
complete -F _bedrock_complete bedrock
`,
  zsh: `#compdef bedrock
# Install: source <(bedrock completion zsh) in ~/.zshrc after compinit.
# Or save as _bedrock in a directory on fpath before compinit.
_bedrock() {
  local -a candidates
  candidates=("\${(@f)$(bedrock __complete "\${words[@]:1:$((CURRENT - 1))}" 2>/dev/null)}")
  (( \${#candidates} )) && compadd -- "\${candidates[@]}"
}
# An autoloaded _bedrock file must also perform the first completion.
if [[ $funcstack[1] == _bedrock ]]; then
  _bedrock "$@"
else
  compdef _bedrock bedrock
fi
`,
  fish: `# Install: bedrock completion fish > ~/.config/fish/completions/bedrock.fish
function __bedrock_complete
  set -l words (commandline -opc)
  set -l current (commandline -ct)
  bedrock __complete $words[2..-1] "$current" 2>/dev/null
end
complete -c bedrock -f -a '(__bedrock_complete)'
`,
  powershell: `# Install: bedrock completion powershell >> $PROFILE
Register-ArgumentCompleter -Native -CommandName bedrock -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @()
  foreach ($element in $commandAst.CommandElements | Select-Object -Skip 1) {
    if ($element.Extent.StartOffset -ge $cursorPosition) { break }
    if ($element.Extent.EndOffset -ge $cursorPosition) { break }
    if ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
      $words += $element.Value
    } else { $words += $element.Extent.Text }
  }
  $words += $wordToComplete
  bedrock __complete @words 2>$null | ForEach-Object {
    $text = $_
    $insert = "'" + $text.Replace("'", "''") + "'"
    [System.Management.Automation.CompletionResult]::new($insert, $text, 'ParameterValue', $text)
  }
}
`,
} as const;

export function completionScript(shell: keyof typeof scripts): string {
  if (!Object.hasOwn(scripts, shell)) throw new BedrockError("INVALID_ARGS", `Unknown completion shell '${shell}'.`, completionHelp);
  return scripts[shell];
}

function visibleNames(commands: readonly CommandSpec[]): string[] {
  return commands.filter(command => !command.hidden).map(command => command.name);
}

async function bounded<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 500); }),
    ]);
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}

export async function complete(words: string[], commands: readonly CommandSpec[], options: { pebbles?: () => Promise<string[]> } = {}): Promise<string[]> {
  try {
    return await candidates(words, commands, options);
  } catch { return []; }
}

async function candidates(words: string[], commands: readonly CommandSpec[], options: { pebbles?: () => Promise<string[]> }): Promise<string[]> {
  const partial = words.at(-1) ?? "";
  const filter = (values: readonly string[]) => [...new Set(values)].filter(value => value.startsWith(partial) && !/[\r\n\0]/.test(value));
  let spec: CommandSpec = { name: "", summary: "", subcommands: commands };
  let positional = 0;
  let literal = false;
  let pending: FlagSpec | undefined;
  const used = new Set<string>();
  const availableFlags = () => spec.name ? resolutionFlags(spec) : flagsFor(spec);
  for (const word of words.slice(0, -1)) {
    if (pending) {
      if (!acceptsValue(word, availableFlags())) return [];
      pending = undefined; continue;
    }
    if (!literal && word === "--") { literal = true; continue; }
    if (!literal && word.startsWith("-")) {
      const [name] = word.split("=", 1);
      const flag = flagAt(name!, availableFlags());
      if (!flag) return [];
      used.add(flag.name);
      if (flag.value && !word.includes("=")) pending = flag;
      continue;
    }
    const child = !literal && positional === 0 && spec.subcommands?.find(child => child.name === word || child.aliases?.includes(word));
    if (child) {
      if (child.hidden) return [];
      spec = child;
      continue;
    }
    if (spec.defaultSubcommand && positional === 0) {
      spec = spec.subcommands?.find(child => child.name === spec.defaultSubcommand) ?? spec;
    }
    const arg = spec.args?.[positional];
    if (!arg || arg.choices && !arg.choices.includes(word)) return [];
    if (!arg.variadic) positional++;
  }
  if (pending) return filter(pending.choices ?? []);
  if (!literal && partial.startsWith("-")) {
    const equals = partial.indexOf("=");
    if (equals !== -1) {
      const name = partial.slice(0, equals);
      const flag = flagAt(name, availableFlags());
      return filter(flag?.value && !used.has(flag.name) ? (flag.choices ?? []).map(choice => `${name}=${choice}`) : []);
    }
    return filter(availableFlags().filter(flag => !used.has(flag.name)).flatMap(flag => [flag.name, ...(flag.short ? [flag.short] : [])]));
  }
  const names = !literal && positional === 0 ? visibleNames(spec.subcommands ?? []) : [];
  const effective = positional === 0 && spec.defaultSubcommand ? spec.subcommands?.find(child => child.name === spec.defaultSubcommand) ?? spec : spec;
  const arg = effective.args?.[positional];
  if (arg?.choices) names.push(...arg.choices);
  if (arg?.name === "pebble" && options.pebbles) names.push(...await bounded(options.pebbles, []));
  return filter(names);
}

async function localPebbles(): Promise<string[]> {
  const controller = new AbortController();
  return bounded(async () => {
    const home = bedrockHome();
    const [state, token] = await Promise.all([
      Bun.file(join(home, "daemon.json")).json().catch(() => Bun.file(join(home, "config.json")).json()),
      Bun.file(join(home, "admin-token")).text(),
    ]);
    const port = state?.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !token.trim() || controller.signal.aborted) return [];
    const response = await fetch(`http://127.0.0.1:${port}/api/pebbles`, {
      headers: { host: `bedrock.localhost:${port}`, authorization: `Bearer ${token.trim()}` },
      redirect: "error", signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.value) ? body.value.flatMap((pebble: { name?: unknown }) => typeof pebble?.name === "string" ? [pebble.name] : []) : [];
  }, []).finally(() => controller.abort());
}

/** Handles __complete before global parsing so the partial words stay intact. */
export async function completeCommand(args: string[], _json: boolean, commands: readonly CommandSpec[]): Promise<void> {
  try {
    const values = await complete(args, commands, { pebbles: localPebbles });
    if (values.length) console.log(values.join("\n"));
  } catch {}
}

export function completionCommand(args: string[], json: boolean): void {
  const shell = args[0];
  if (args.length !== 1 || !shell || !Object.hasOwn(scripts, shell)) {
    throw new BedrockError("INVALID_ARGS", "Choose a completion shell: bash, zsh, fish, or powershell.", completionHelp);
  }
  const script = completionScript(shell as keyof typeof scripts);
  console.log(json ? JSON.stringify({ ok: true, command: "completion", shell, script }) : script);
}
