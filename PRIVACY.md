# Privacy policy — codeswarm

Last updated: 2026-07-07

codeswarm is a Claude Code plugin that runs entirely on your machine, inside
your own Claude Code session.

## What the plugin collects

Nothing. The plugin has no telemetry, no analytics, no version-check calls,
and no error reporting. It never sends data to the plugin author or to any
third party.

## Where your data goes

- **Model traffic.** All agent and workflow activity runs through your own
  Claude Code installation and your own Anthropic account or API key, under
  [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy). The
  plugin adds no model traffic of its own.
- **Local files.** Configuration (`~/.claude/codeswarm.json`), the optional
  evaluation log (`codeswarm-eval-log.jsonl`), and standalone-runner journals
  stay on your machine. Nothing is uploaded.
- **Issue tracker (opt-in).** If you configure the GitLab/GitHub integration,
  the plugin files issues to the tracker **you** specify, using a token you
  provide via a local file path. That is the only network traffic the plugin
  can generate, it only happens when you request issue filing, and it goes
  only to your own tracker. See [docs/security.md](docs/security.md) for how
  tokens are handled.

## Hooks

The plugin's session hooks run locally, open no network connections, and
write no files. Their behavior is documented in
[docs/security.md](docs/security.md) and covered by tests in the repository.

## Contact

Questions: open an issue in this repository, or use the author contact in
`.claude-plugin/plugin.json` and the plugin directory listing.
