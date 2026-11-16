#Requires -Version 5.1
<#
.SYNOPSIS
  The AGIG Nominations upload agent. Runs on the office VM, every minute, from Task Scheduler.

.DESCRIPTION
  AGIG accepts SFTP connections only from the office's registered IP address, and the private key it issued
  stays on this VM. So the app (on DigitalOcean) never connects to AGIG: this script asks the app for the next
  SHNOM file over HTTPS, with the app's agent token, uploads it with WinSCP, and says what happened:

    uploaded   the file is on AGIG's server, with the size found there
    not-sent   the connection failed before the upload began, so it is safe to try again
    uncertain  it failed during the upload: the file may or may not have arrived. The app never sends it again
               by itself; a person checks and settles it on the batch's page.

  It sends at most five files a run, and the app hands out one at a time (the next waits for AGIG's answer to
  the last). It refuses a file for another environment than its own (NP or PROD), so an NP agent can never send
  to production. Everything it does is written to its log. scripts/agent/README.md has the setup.

.PARAMETER SettingsPath
  The settings file (agent-settings.psd1), next to this script unless given.
#>
param(
  [string]$SettingsPath = (Join-Path $PSScriptRoot 'agent-settings.psd1')
)

$ErrorActionPreference = 'Stop'
$settings = Import-PowerShellDataFile -Path $SettingsPath
foreach ($name in 'AppUrl', 'Environment', 'HostName', 'UserName', 'RemoteDir', 'HostKeyFingerprint', 'PrivateKeyPath', 'WinScpDll', 'TokenFile', 'WorkFolder') {
  if (-not $settings[$name]) { throw "agent-settings.psd1 has no $name." }
}

$logFile = Join-Path $settings.WorkFolder 'agent.log'
function Write-Log([string]$message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $message
  Add-Content -Path $logFile -Value $line
  if ((Get-Item $logFile).Length -gt 5MB) { Move-Item $logFile "$logFile.1" -Force }
}

# The agent token, saved once with Windows DPAPI by the account the task runs as (README, step 4). Only that
# account, on this machine, can read it back. It is never written anywhere else, and never logged.
$secure = Get-Content -Path $settings.TokenFile | ConvertTo-SecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Invoke-App([string]$path, $body) {
  Invoke-RestMethod -Method Post -Uri ($settings.AppUrl.TrimEnd('/') + '/api/agig-nomination' + $path) `
    -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' `
    -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 60
}
function Send-Result($file, [string]$outcome, [string]$errorText, $remoteSize) {
  $body = @{ outcome = $outcome }
  if ($errorText) { $body.error = $errorText.Substring(0, [Math]::Min(900, $errorText.Length)) }
  if ($null -ne $remoteSize) { $body.remoteSize = [long]$remoteSize }
  $answer = Invoke-App "/agent/files/$($file.id)" $body
  Write-Log "$($file.fileName): $($answer.recorded)$(if ($errorText) { " ($errorText)" })"
}

Add-Type -Path $settings.WinScpDll
New-Item -ItemType Directory -Force -Path (Join-Path $settings.WorkFolder 'sent') | Out-Null

for ($run = 0; $run -lt 5; $run++) {
  $claim = Invoke-App '/agent/claim' @{}
  if (-not $claim.file) {
    if ($claim.waitingFor) { Write-Log "Waiting for AGIG's answer to $($claim.waitingFor)." }
    break
  }
  $file = $claim.file
  if ($claim.environment -ne $settings.Environment) {
    Send-Result $file 'not-sent' "This agent is for $($settings.Environment), not $($claim.environment)." $null
    break
  }

  $local = Join-Path $settings.WorkFolder $file.fileName
  [IO.File]::WriteAllBytes($local, [Convert]::FromBase64String($file.body))
  $hash = (Get-FileHash -Path $local -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $file.sha256) {
    Send-Result $file 'not-sent' 'The file changed on its way from the app.' $null
    continue
  }

  $options = New-Object WinSCP.SessionOptions -Property @{
    Protocol              = [WinSCP.Protocol]::Sftp
    HostName              = $settings.HostName
    PortNumber            = 22
    UserName              = $settings.UserName
    SshHostKeyFingerprint = $settings.HostKeyFingerprint   # pinned: a changed host key is refused
    SshPrivateKeyPath     = $settings.PrivateKeyPath
  }
  $session = New-Object WinSCP.Session
  try {
    try {
      $session.Open($options)
    } catch {
      Send-Result $file 'not-sent' $_.Exception.Message $null
      continue
    }
    $remote = $settings.RemoteDir.TrimEnd('/') + '/' + $file.fileName
    try {
      $transfer = New-Object WinSCP.TransferOptions
      $transfer.TransferMode = [WinSCP.TransferMode]::Binary
      $transfer.PreserveTimestamp = $false
      $session.PutFiles($local, $remote, $false, $transfer).Check()
    } catch {
      Send-Result $file 'uncertain' $_.Exception.Message $null
      continue
    }
    # The size on AGIG's server, compared by the app with what was sent. If AGIG has already picked the file up
    # (so it is not there to look at), WinSCP's completed transfer is the evidence, and the size sent stands.
    $size = (Get-Item $local).Length
    try { $size = $session.GetFileInfo($remote).Length } catch { Write-Log "$($file.fileName): uploaded; AGIG had already taken it, so its size was not checked." }
    Send-Result $file 'uploaded' $null $size
    Move-Item -Path $local -Destination (Join-Path $settings.WorkFolder 'sent') -Force
  } finally {
    $session.Dispose()
  }
}
