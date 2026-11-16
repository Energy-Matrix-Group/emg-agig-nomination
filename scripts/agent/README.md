# The upload agent (office VM)

AGIG accepts SFTP connections only from the office's registered IP address, and keeps the private key it issued with us. The app runs on DigitalOcean, so it never connects to AGIG. Instead, this small script on the office VM collects each SHNOM file from the app over HTTPS and uploads it with WinSCP. Without it, files are sent by hand: download the file on the batch's page, upload it with WinSCP, press **Mark as uploaded**.

```
App (DigitalOcean)  <── HTTPS, agent token ──  Send-Nominations.ps1 (office VM)  ── SFTP, AGIG key ──>  AGIG MFT
```

It needs no new software beyond WinSCP, which the VM already has, and nothing on the VM needs to accept a connection: it only calls out.

## Set it up (once per environment)

1. **WinSCP.** Install it on the VM if it is not there (it brings `WinSCPnet.dll`). Connect to AGIG once by hand with the key AGIG issued, check the host key fingerprint WinSCP shows with AGIG, and note it.
2. **The key.** Convert AGIG's private key to PuTTY format (`.ppk`) with WinSCP's PuTTYgen (Tools, Run PuTTYgen, Load, Save private key). Keep it in a folder only the task's account can read. It expires every 12 months: put its expiry date in the app's `NOM_SFTP_KEY_EXPIRES` so the app warns at 45, 14 and 3 days.
3. **The token.** Make a long random token (for example `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }) -as [byte[]])`), and set it on the app's component as `NOM_AGENT_TOKEN`, marked Encrypt.
4. **Save the token on the VM**, signed in as the account the task will run as (a service account, not a person):

   ```powershell
   Read-Host -AsSecureString 'Agent token' | ConvertFrom-SecureString | Set-Content D:\NomHub\agent-token.txt
   ```

   Windows DPAPI encrypts it for that account on this machine only.
5. **Settings.** Copy `agent-settings.example.psd1` to `agent-settings.psd1` next to the script and fill it in. `Environment` must equal the app's `NOM_ENVIRONMENT`.
6. **Try it** once by hand: `powershell -ExecutionPolicy Bypass -File Send-Nominations.ps1`. With nothing to send it does nothing; publish a test nomination on NP and run it again. The log is `agent.log` in the work folder.
7. **Schedule it** in Task Scheduler: every minute, indefinitely, "Run whether user is logged on or not", as the service account, action `powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\NomHub\agent\Send-Nominations.ps1`, and "Do not start a new instance" if one is still running.

The app's System page shows when the agent last asked for work, and raises an alert if files wait while it is quiet for 10 minutes.

## What it does with each file

- Asks `POST /api/agig-nomination/agent/claim` for the next file (the app hands out one at a time, and holds the next until AGIG has answered the last, unless its cutoff is close).
- Checks the bytes against the SHA-256 the app sent, writes them to the work folder, opens the SFTP session with the pinned host key, and uploads.
- Reports `uploaded` (with the size on AGIG's server), `not-sent` (the connection failed first: the app offers it again next minute, and alerts after three tries) or `uncertain` (it failed part way: never sent again by itself; someone checks and settles it on the batch's page).

## Questions still open with AGIG

The remote folder (`RemoteDir`), whether processed files are removed, whether files may be uploaded as `.tmp` and renamed, and the key type. See the design's "Questions to put to AGIG".
