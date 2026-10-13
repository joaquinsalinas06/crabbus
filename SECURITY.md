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
- text from agents (descriptions, commands, messages) that can inject terminal escape sequences
  into the panel;
- anything that makes the plugin read or write outside its designs folder.

## Supported versions

Only the latest release on `main` gets fixes.
