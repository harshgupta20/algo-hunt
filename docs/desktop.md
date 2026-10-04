# Desktop app (Windows `.exe`)

`desktop/` is [start-algo-hunt.bat](../start-algo-hunt.bat) as a Windows program. Give the trader
**Algo-Hunt-Setup-1.0.0.exe** once. It installs like any software, asks for the settings in a setup wizard, and every
time it opens it does what the `.bat` does: gets the latest version from GitHub, installs, builds and starts. Then
it opens Algo Hunt in its own window, already signed in.

Like the `.bat`, it needs **Git** and **Node.js** on the computer. The wizard checks for them and links to the
downloads.

---

## 1. What the trader sees

| When | What happens |
| --- | --- |
| **Install** | Welcome page → risk disclaimer (**I Agree**) → install folder → **Run Algo Hunt**. Windows 10 / 11 only. Desktop and Start-menu shortcuts |
| **First start** | The setup wizard, one step at a time, each with how to get it and a live check:<br>1. Welcome: what's needed, plus a check for Windows, memory, Git and Node.js<br>2. Disclaimer<br>3. Neon database link<br>4. Kite Connect key and secret, with a *Copy* button for the redirect URL (the key is checked with Kite, the secret at the first Kite login)<br>5. Password<br>6. Telegram (optional)<br>7. Email (optional)<br>8. Review → **Start Algo Hunt**<br>Settings are saved encrypted for that Windows user. They replace the `.bat`'s `.env` file |
| **Every start** | A start-up screen: **Getting the latest version → Installing packages → Preparing the app → Starting Algo Hunt**, then the window. Install runs only when the package list changed and the build only for a new version, so a normal start takes a few seconds. A new version takes 1–3 minutes, and the first start a few minutes. No internet: it starts the version it already has |
| **Problems** | The screen says what failed: Git / Node.js missing (with a download button), download failed, build failed (with the details), port 3000 busy. Buttons: **Try again / Change settings / Open logs / Quit** |
| **Window closed** | Keeps running in the **tray**, so alerts continue. Tray menu: Open, **Get the latest version (restarts)**, Start with Windows, Change settings…, Open logs, **Quit** (saves waiting records first) |
| **Each trading morning** | **Connect Kite** in the top bar. Kite's login opens inside the window, and Kite sends the trader back to it (`http://localhost:3000/zerodhaRedirection`, the redirect URL in their Kite app), already signed in |
| **Wrong settings later** | **Algo Hunt → Change settings** in the window's menu bar (or **Ctrl+,**, or the tray icon) opens the wizard filled in with the saved values. Change what's wrong, press **Save and restart**; it restarts in seconds. If Kite rejects the key (Kite's error page) or the secret (after the login), a message offers **Fix Kite keys**, which opens the wizard on the Kite step. **View → Back** (Alt+←) and **Algo Hunt home** lead back from Kite's own pages |

On the trader's computer:

| What | Where |
| --- | --- |
| The program | `%LOCALAPPDATA%\Programs\Algo Hunt` |
| The web app's code, packages and build | `%LOCALAPPDATA%\AlgoHunt\app` (the `.bat`'s `algo-hunt` folder; always matches GitHub) |
| Settings | `%APPDATA%\Algo Hunt\settings.json`, encrypted (Windows DPAPI). Kept on uninstall |
| Logs | `%APPDATA%\Algo Hunt\logs\app.log` (steps) and `server.log` (npm, build and app output) |

The data stays in the trader's Neon database. A trader moving from the `.bat` enters the same values from their
`.env` in the wizard.

---

## 2. Making the `.exe`

The installer has to be built on Windows. GitHub does it:

1. Push `desktop/` and `.github/workflows/desktop-app.yml`.
2. On GitHub: **Actions → Desktop app → Run workflow**. It takes about 5 minutes.
3. Open the finished run. Under **Artifacts**, download **Algo-Hunt-Setup** (a zip with the `.exe`) and send the
   `.exe` to the trader.

Rebuild only when `desktop/` changes. Changes to the web app reach the trader by themselves at their next start
(or via tray → *Get the latest version*), just as with the `.bat`.

**Private repository?** `harshgupta20/algo-hunt` is public today, so no token is needed. If you make it private, add
a fine-grained token (only this repository, *Contents: Read-only*, the same kind as in the `.bat`) as the Actions
secret **`ALGO_HUNT_GITHUB_TOKEN`**, then build again. The token is built into the `.exe`, as it is written in the
`.bat`, and never appears in logs or messages.

On a Windows machine you can also build it yourself: `cd desktop && npm ci && npm run dist` →
`desktop/release/Algo-Hunt-Setup-1.0.0.exe`. For a token, set `ALGO_HUNT_GITHUB_TOKEN` or put it in
`desktop/github-token.txt` (git ignores that file).

---

## 3. How it fits together

| File | Role |
| --- | --- |
| [desktop/src/runner.ts](../desktop/src/runner.ts) | The `.bat`'s steps. Finds Git and Node.js. Gets the latest version (`git clone`, or `fetch` + `reset --hard`; offline → keeps what it has). `npm install` when `package-lock.json` changed. `npm run build` for a new version. `next start` on **127.0.0.1:3000**. Stops it cleanly with an IPC message → [background.ts](../src/server/background.ts) |
| [desktop/src/main.ts](../desktop/src/main.ts) | Windows, tray, menu, start-up order, restart after a crash, signing in (`ash_session` cookie from the password, [session.ts](../desktop/src/session.ts)) |
| [desktop/src/config.ts](../desktop/src/config.ts) | Settings ⇄ encrypted `settings.json`. `appEnv()` passes them to npm and the app as environment variables (no `.env` file) |
| [desktop/src/checks.ts](../desktop/src/checks.ts) | The wizard's live checks: database; Kite key (Kite's login page answers an unknown key with HTTP 400); Telegram; Resend |
| [desktop/setup/](../desktop/setup) | The wizard and the start-up screen. Open `index.html?mock=1` in a browser to look at them; add `&mode=edit`, `&fail=build` or `&nonode=1` for other states |
| [desktop/build/](../desktop/build) | Installer icon, pictures, disclaimer page (`license.txt`), `installer.nsh` (welcome text, Windows 10+ check). `python3 desktop/scripts/make-art.py` redraws the pictures |

---

## 4. Known limits

- **Not code-signed.** The first time, Windows SmartScreen shows *"Windows protected your PC"*: **More info → Run
  anyway**.
- **Port 3000.** The desktop app and the `.bat` can't run at the same time. If the `.bat`'s Algo Hunt is already
  running, the desktop app opens it instead.
- Not yet installed on a real Windows machine; see [status.md](status.md).
