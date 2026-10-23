# Account Switch

**English** · [한국어](README.ko.md) · [日本語](README.ja.md)

A Claude Code mod that switches between several Claude subscription accounts **inside a running session**. You don't need to restart or open a new window: your next message goes out on the account you picked.

```
/account            account panel: the account in use in a green frame, the others below to pick from
/account remove     pick an account to remove
/account check      diagnostics: folders, files, what the server says, expiry dates
```

---

## Install

**Requirements**
- Claude Code 2.1.306 or later
- A Claude subscription login (Pro or Max)
- Windows, macOS or Linux. Tested on Windows (Claude Code 2.1.309), macOS (2.1.306) and Ubuntu 26.04 (2.1.309).

At the prompt of a Claude Code session:

```
/plugin install account-switch --marketplace lslogis/claude-account-switch
```

Answer `y` to add the marketplace, then pick the user scope with Enter. The mod is active right away.

From a shell instead:

```sh
claude plugin install account-switch --marketplace lslogis/claude-account-switch
```

To confirm the install, check that `claude plugin list` shows `account-switch` as `✔ enabled`.

## First use

There is nothing to set up.

1. When a session starts, the mod saves the account that is logged in.
2. The status line shows `● email · plan`.
3. To add another account, open `/account`, choose **`+ Log in to another account`**, and log in with that account in the browser. It is added to the list and becomes the account in use. Typing `/login` yourself registers the account the same way.

## Usage

### `/account`: pick and switch

```
╭─────────────────────────────────╮
│ ● IN USE  you@example.com · Pro │           ← green frame
╰─────────────────────────────────╯
Switch to — ↑↓/Tab then Enter · Esc closes

○ work@example.com · Max                      ← blue; the focused row is inverted

+ Log in to another account                   ← orange
```

- **Choosing a row:** move to it with ↑↓ or Tab and press Enter. The switch happens at once, and a toast shows the result.
- **When it takes effect:** from **your next message**. A reply already in progress finishes on the old account.
- **Expired login:** picking an account whose login has expired opens the **login screen** instead of switching.
- **Narrow terminal:** if the panel cannot open, the list is printed as text.

### Other commands

| Command | What it does |
|---|---|
| `/account <email>` | Switches without opening the panel. A prefix is enough (`/account work`). If several accounts match, it asks you to type more. |
| `/account remove` | Pick an account and confirm, and it is removed from the list. The account in use is not shown. Its login on the server is not touched. |
| `/account list` | Prints the list as text. |
| `/account check` | Shows diagnostics (see Troubleshooting). |

### Status line and warnings

- The status line always shows `● email · plan`.
- From 3 days before a login expires, `⚠ login expires in Nd` is added. Once it has expired, it reads `⚠ login expired — log in again`. The list shows the same marks.

---

## How it works

```
~/.claude/.credentials.json        ← the slot Claude reads (one account: the one in use)
                                     on macOS: the Keychain item "Claude Code-credentials"
~/.claude/account-switch.json      ← the account store: one subscription login per email
~/.claude/account-switch.json.bak  ← the store's previous state (written automatically)
```

- **Why it switches without a restart:** before calling the API, Claude Code compares the modification time of `.credentials.json` and reloads the token if the file changed. This was checked in the 2.1.309 binary. So when the subscription login inside the file is replaced, the running session moves to the new account.
- **macOS:** Claude Code keeps the login in the Keychain there, so the mod reads and writes that item with the `security` command. A running session still decides whether to reload its login by the modification time of `~/.claude/.credentials.json`, so after writing the Keychain the mod updates that file's time (`touch`, contents untouched). Claude caches Keychain reads for up to 30 seconds, so a switch on macOS can take that long to reach the next message.
- **What it replaces:** only `claudeAiOauth` in that file. The MCP server logins in the same file (`mcpOAuth`) stay as they are.
- **How accounts are told apart:** the mod asks Claude's server (`/api/oauth/profile`) whose token it is, and files it under that email.
- **Keeping tokens fresh:** the session refreshes its access token (which lasts about 8 hours) and writes it back to `.credentials.json`. On every message, and right before a switch, the mod copies the latest token into that account's entry in the store. So when you come back to an account, you come back to its newest token.
- **Config folder:** if `CLAUDE_CONFIG_DIR` is set, that folder is used instead of `~/.claude`.

## Problems handled ahead of time

| Situation | What the mod does |
|---|---|
| The account store is broken | It reads `.bak` (the previous state) and tells you. If both are broken, it **stops without writing**, so an empty list never overwrites your tokens. |
| `.credentials.json` is broken | It refuses to switch, and does not overwrite the file, so the MCP logins are not lost. |
| The server does not say whose the live token is (network) | It does not guess an account to save it under, and it refuses to switch ("try again in a moment"). The check that runs on every message does not ask again for 5 minutes after a failure. |
| The target account's token was revoked (logged out elsewhere, etc.) | It checks with the server before switching. If the token is refused, it does not switch and asks you to log in again. |
| The target account's login has expired | It does not switch. It opens the login screen instead. |
| The session writes a refreshed token at the moment of the switch | It reads the file back right after writing. If its write lost, it says "try once more". |
| Another Claude window writes the store at the same time | It reads the store again right before writing and keeps the newer entry for each account. |
| `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is set | These take priority over the subscription login, so a switch would have no effect. It refuses and tells you. |
| `/login` is cancelled halfway | Nothing changes. "Account saved" is shown only when the account actually changed. |
| The server is slow | It waits at most 8 seconds. |
| File permissions on Linux | Each time it writes the store and its backup, it runs `chmod 600` so only you can read them. |

## Good to know

- **Other windows on the same config folder switch too.** There is one login slot per folder. When you switch in one window, the other Claude windows on that folder use the new account from their next message.
- **Each account may need a fresh login about once a month.** The login expiry the server sets (currently about 4 weeks) did not move when the token was refreshed; this was checked against the server's response. Whether the login actually stops working on that date has not been observed yet. The mod warns 3 days ahead, and picking an expired account opens the login screen.
- **If you use the same account on another PC or another config folder,** a refresh over there can revoke the token saved here. If a switch is refused, log in to that account again.
- **The email in Claude's own screens (`/status` and others)** comes from a value Claude stores separately, so it can still show the old email after a switch. The account actually in use is the one in the mod's status line and on the "Server says" line of `/account check`.
- **`account-switch.json` and its `.bak` contain login tokens.** Do not share or commit them.

## Troubleshooting

Run `/account check` first.

```
Config folder  C:\Users\you/.claude
Login file     C:\Users\you/.claude/.credentials.json — subscription login present
Account store  C:\Users\you/.claude/account-switch.json — 2 account(s)
In use         you@example.com
Server says    you@example.com                      ← the account actually in use
  you@example.com · Pro — login expires 2026-11-22
  work@example.com · Max — login expires 2026-11-20
```

| Symptom or message | What to do |
|---|---|
| `/account` is an unknown command | Run `/reload-plugins`. If that doesn't help, check that `claude plugin list` shows the mod as enabled, and install it again if it is missing. |
| "Could not confirm the current account's token" | A network problem. Try again in a moment. |
| "token … was refused" or "login … has expired" | Open `/account`, then pick that account or `+ Log in to another account`, and log in with it. |
| "try once more" | Run the same command again. |
| "The account store … and its backup are both broken" | Open `~/.claude/account-switch.json` and `.bak` to check them. If they cannot be saved, delete both and log in to each account again. |
| A warning about an API key or `CLAUDE_CODE_OAUTH_TOKEN` | Remove that environment variable and start claude again. |
| You switched but still seem to be on the old account | Look at the "Server says" line of `/account check`. If it shows the new account, the switch worked, and the old email is only Claude's display. |
| The status line says "No account" | You are logged out. Pick an account in `/account`, or run `/login`. |
| "Could not read the macOS Keychain … is it locked?" | The Keychain is locked, as it is in an SSH session. Run claude in a terminal on the Mac's own desktop. |
| On macOS, a switch has not reached your next message | Wait about 30 seconds and send another one: Claude caches Keychain reads for that long. |

## Uninstall

```sh
claude plugin uninstall account-switch
```

The store `~/.claude/account-switch.json` (and its `.bak`) is left in place. Delete it yourself if you don't need it. The account currently logged in stays logged in.

## Development

Run a session with the mod loaded straight from a clone:

```sh
claude --plugin-dir /path/to/claude-account-switch
```

After editing `hooks/register.tsx`, run `/reload-plugins` in that session. Claude Code before 2.1.309 does not read the folder again on `/reload-plugins`: restart claude instead. `claude plugin validate .` checks the manifest and the module, and once Claude Code has loaded the mod, `tsc -p .` type-checks it.

```
.claude-plugin/plugin.json        mod manifest
.claude-plugin/marketplace.json   makes this repository installable with /plugin install
hooks/hooks.json                  module list
hooks/register.tsx                /account command, panels, sync, switching, diagnostics
tsconfig.json                     type-checking settings
```

## License

MIT
