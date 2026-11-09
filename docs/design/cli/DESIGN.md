# Bedrock CLI: help, suggestions and usable output (design)

Owner request (2026-11-09): the CLI lacks what a well-crafted CLI has — a help
command, explanations of each command, and "did you mean" pushes towards the
right command when the user or agent gets it wrong. Git is the main reference
(most users and agents know it); gh, cargo/clap and uv were compared too.

## Findings (Bedrock at f2a2932)

- `bedrock`, `bedrock help`, `--help`, `-h` all fail with `UNKNOWN_COMMAND` and
  a ~600-character one-line list. So do typos (`bedrock error`, `deploi`).
  The message never names the bad word and never suggests the right one.
- `--help` works only for commands in `commandHelp`; `ls`, `status`, `whoami`,
  `daemon`, `doctor`, `tunnel`, `service`, `login`, `logout`, `setup`, `dev` and
  `self-update` reject it as an invalid flag.
- Subcommand and flag typos (`tunnel setpu`, `db genrate`, `deploy --no-opn`)
  dump a usage line without saying which word was wrong.
- Usage text lives in at least three places (`commandHelp`, every module's
  `invalid()` hint, the `UNKNOWN_COMMAND` hint) and has drifted: the unknown
  command hint omits `errors`, `metrics` and `alerts`; `logs` help omits `-f`.
- Eleven hand-written argument parsers, each slightly different (some accept
  `-x`, some reject repeats, none accept `--flag=value` or `--`).
- Without `--json`, most commands print pretty-printed JSON, not text.
- Every failure exits 1; a usage mistake is indistinguishable from an outage.

## What best-in-class CLIs do

| Behaviour | git | gh (cobra) | cargo / uv (clap) |
|---|---|---|---|
| Bare command | Grouped "common commands" by workflow | Grouped help | Help |
| Unknown command | `git: 'sttaus' is not a git command. See 'git --help'.` + "The most similar command is status" | `unknown command "prr"` + "Did you mean this?" | `no such command: buidl` + `help: a command with a similar name exists: build` |
| Unknown flag | `error: unknown option 'frobnicate'` + usage, exit 129 | `unknown flag: --stat` + usage | `unexpected argument '--frozne'` + `tip: a similar argument exists: '--frozen'` + corrected usage line, exit 2 |
| Help depth | `-h` short usage, `help <cmd>` full page, `help -a` all, `help -g` guides | `help <topic>` (exit-codes, environment) | `--help`, `--list`, `--explain <code>` |
| Next steps | `git status` prints `(use "git add <file>..." …)` | Hints after actions | — |

Git's suggester (`help.c`) is the best of these: a Damerau-Levenshtein distance
weighted for typing errors — swapping two letters costs 0, substitution 2, a
letter the user left out 1, an extra letter the user typed 3, plus 1 — where a
candidate that starts with what was typed scores best, only the tied-best
candidates are shown, and only when the score is under 7. Cobra's plain edit
distance shows the difference: `gh pr lsit` suggests `edit` before `list`.
Git never runs a guess unless `help.autocorrect` opts in.

## Decisions

1. **One registry.** `src/cli/spec.ts` (types) and `src/cli/commands.ts` (data)
   describe every command, subcommand, positional and flag with a summary,
   choices, examples and author-guide anchors. Help, usage hints, parsing,
   suggestions and completion all derive from it. A test keeps the docs in sync.
2. **One parser** (`src/cli/args.ts`): `parse(spec path, argv) → Parsed`.
   Accepts `--flag value`, `--flag=value`, short aliases, and `--` to end options.
   Rejects unknown flags, repeated flags, missing values, values outside
   `choices`, missing/extra positionals and unknown subcommands, each with an
   error that names the offending word and suggests the closest valid one.
   A value flag takes the next word even if it starts with one `-`
   (`--name -agent`), unless that word is a flag of the command.
   Unique-prefix flag abbreviation (git's `--amen`) is **not** supported: it
   makes adding a flag a breaking change for scripts.
3. **Help everywhere, never side effects.**
   - `bedrock`, `bedrock help`, `-h`, `--help`: grouped overview (git style) on
     stdout, exit 0. Groups: Build a pebble · Ship and run · Observe · Access and
     secrets · Run the server.
   - `bedrock help <command> [<sub>]` ≡ `bedrock <command> [<sub>] --help`, for
     every command and subcommand, at any argument position before `--`.
   - `bedrock help <topic>`: `env` (BEDROCK_HOME, BEDROCK_URL, BEDROCK_TOKEN,
     NO_COLOR, CLOUDFLARE_API_TOKEN …) and `exit-codes`.
   - `--json` help returns the structured spec: the whole tree for the
     overview, one command (with subcommands) otherwise, so an agent can learn
     the CLI in one call.
4. **Did you mean.** Git's weighting (`src/cli/suggest.ts`, no dependency)
   for commands, subcommands, flags, choices, and — from the daemon — pebble
   and job names. `suggestFor` covers words no edit distance will reach
   (`list` → `ls`, `remove` → `rm`). With exactly one best match the
   suggestion replays the rest of the command line (`bedrock errors notes`).
   Guesses are never executed (destructive commands and agents exist), and a
   tie between a harmless and a destructive command (`lm` → `ls`/`rm`) drops
   the destructive one. Daemon suggestions only name what the caller's token
   could list. Secret values never appear in messages or suggestions.
5. **Error shape** (text mode, stderr):
   ```
   UNKNOWN_COMMAND: 'error' is not a bedrock command.

   Did you mean this?
       bedrock errors notes

   Hint: Run 'bedrock help' to see all commands.
   ```
   The first line keeps `CODE: message`; the hint is the failing command's own
   usage, never the whole CLI. With `--json` the envelope is unchanged and the
   suggestions are in `error.data.suggestions` (full command lines).
6. **Exit codes.** 0 success · 1 the command ran and failed · 2 usage error,
   nothing was attempted (`UNKNOWN_COMMAND`, `INVALID_ARGS`, `CONFIRM_REQUIRED`;
   `bedrock test` also uses 2 when its test setup fails) · 130 cancelled at a
   prompt (`CANCELLED`). Documented in `bedrock help exit-codes`.
7. **Text output for humans.** Every command gets a text formatter (tables for
   lists, one-line confirmations with ✓ for actions, a "Next:" line where there
   is an obvious next command, like git status). `--json` is unchanged. Colour
   only on a TTY and only without `NO_COLOR`.
8. **`bedrock version`** prints the same as `--version` (gh/docker/kubectl
   habit).
9. **Shell completion.** `bedrock completion bash|zsh|fish|powershell` prints a
   small script that calls the hidden `bedrock __complete <words…>`; candidates
   come from the registry, plus pebble names from the local daemon (500 ms
   budget) for `pebble` positionals.

Not doing: pagers, man pages, user-defined aliases, auto-executing guesses,
config-driven behaviour, a CLI framework dependency.

## Output formats

Overview (`bedrock help`):
```
usage: bedrock <command> [<args>] [--json]

Bedrock runs small apps ("pebbles") on your own server.

Build a pebble
   new         Create a pebble directory with dependencies, Git and migrations
   …
Ship and run
   …

'bedrock help <command>' explains a command, with options and examples.
'bedrock help env' and 'bedrock help exit-codes' explain the environment.
All commands accept --json. The author guide is <path>/AGENTS.md.
```

Command help (`bedrock help logs`): `usage:` synopsis lines generated from the
spec, description, `Arguments`, `Subcommands`, `Options` (command flags, then
`--url/--token` for remote commands, then `--json`, `-h`), `Examples`, `See also`
(absolute paths into the shipped `AGENTS.md`).

## Work split

Phase 1 (parallel): suggest + parser + help + top-level dispatch · registry
data · text formatters · completion · daemon name suggestions. Phase 2: every
command module moved onto the shared parser; docs. Phase 3: code review,
a 510-invocation UX transcript and an old-vs-new behaviour matrix (57 pairs);
their confirmed findings (secret redaction, suggestion permissions, single-dash
values, narrow tables, status text, …) were fixed with regression tests.
