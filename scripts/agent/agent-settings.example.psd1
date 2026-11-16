# Copy to agent-settings.psd1 next to Send-Nominations.ps1 and fill in. Nothing secret goes here: the agent token
# is in the DPAPI file named by TokenFile, and the private key stays in the .ppk file named by PrivateKeyPath.
@{
  # The app's address (its component on DigitalOcean), no path.
  AppUrl             = 'https://agig-nomination-test.apps.energymatrix.com.au'
  # NP or PROD: must equal NOM_ENVIRONMENT on the app. A file for the other environment is refused.
  Environment        = 'NP'

  # AGIG's SFTP, from AGIG's onboarding (spec section 3). NP: mft-np.agig.com.au. PROD: mft.agig.com.au.
  HostName           = 'mft-np.agig.com.au'
  UserName           = '<from AGIG>'
  RemoteDir          = '<confirm with AGIG>'
  # AGIG's host key, pinned. WinSCP shows it the first time you connect by hand: check it with AGIG, then copy it.
  HostKeyFingerprint = 'ssh-ed25519 255 <fingerprint>'
  # AGIG's private key, converted to PuTTY format (.ppk) with WinSCP's PuTTYgen. Readable by the task's account only.
  PrivateKeyPath     = 'D:\NomHub\keys\agig-np.ppk'

  # WinSCP's .NET library, installed with WinSCP.
  WinScpDll          = 'C:\Program Files (x86)\WinSCP\WinSCPnet.dll'
  # The agent token, saved with DPAPI by the task's account (README, step 4).
  TokenFile          = 'D:\NomHub\agent-token.txt'
  # Where files are written before upload, kept after it (sent\), and the log.
  WorkFolder         = 'D:\NomHub\agent'
}
