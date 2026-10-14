# Security policy

CrabBus runs inside your Claude Code session. It reads hook events and draws in the terminal, and it
loads costume JSON files that people share. Security reports are welcome.

## Reporting a vulnerability

Please **do not open a public issue.** Report it privately through
[GitHub's private vulnerability reporting](https://github.com/joaquinsalinas06/crabbus/security/advisories/new).

Include what you found, how to reproduce it (a minimal `.crab.json` or prompt helps), and the
Claude Code version. You should get an answer within a week.

## Scope

Of particular interest:

- design files (`.crab.json`) that hang, crash or break out of the validator, for example with
  regular expressions in `when` rules;
- regular expressions in rules and kind definitions (`if`, `kinds.words`): patterns are compiled with safe guards and input prompts are truncated to 400 characters (`MAX_TEXT`) to prevent ReDoS;
- kinds are scored locally on the first 400 characters of the description and prompt; the plugin makes no network request for them;
- prompts: the wardrobe's "Tell CrabBus" box submits one prompt to Claude (framed as this plugin's) only when the person submits it; nothing else makes the plugin start a turn. What it carries from the design files (which may be shared by others) is fenced as data with an instruction not to follow it, stripped of control characters and fences, and capped at 4000 characters;
- rule file modifications: wardrobe mutations validate the resulting pack in memory with `loadPack` before committing changes to disk;
- text from agents (descriptions, commands, messages) that can inject terminal escape sequences
  into the panel;
- anything that makes the plugin read or write outside its designs folder.

## Supported versions

Only the latest release on `main` gets fixes.
