# macOS permission prompts

Teneo explains what the access enables, why it is needed, and what still
works without it. Setup explains each optional action on its own step.
Settings explains it in a confirmation dialog before asking macOS.

- **Accessibility:** Posting a paste into the active app needs permission.
  Without access, Teneo leaves the item on the clipboard for a manual paste.
- **File previews:** Teneo only inspects its own files and the Desktop,
  Documents, or Downloads folders individually approved during this session.
  Other copied files can still be copied or opened through macOS.
- **Keychain:** Existing Keychain-encrypted secrets stay encrypted and aren't
  read at startup. Restore access in **Settings → Security** when you want
  them available for the session. Teneo doesn't save new detected secrets
  unencrypted while waiting for the key.
- **Secure Enclave:** If authentication is enabled, unlock from Security when
  you want to use saved secrets. Ordinary history reads never request Touch ID.
- **Local network and sync credentials:** A Mac with sync enabled starts
  paused. Choose **Resume sync** in Settings once per session. This prevents
  the first Keychain or local-network prompt showing at startup.
- **Login items:** Adding Teneo at login is optional. macOS can ask for approval
  after you confirm.

## Manual check in a signed Mac build

1. Skip each setup step. No prompt should open merely from visiting a step.
   Try copying and manually pasting a file from a protected folder.
2. Start setup again with test data. Approve one folder and check that the
   other two aren't requested. Verify denied access has no repeat prompt.
3. Enable encryption and sync, then quit and relaunch. Open history, copy a
   detected secret, and wait for Bonjour: none of these should ask for
   access. Confirm **Restore access** and **Resume sync** separately.
4. Repeat after an update and with authentication enabled. Cancel the Teneo
   dialog first and verify macOS never asks. Then confirm and try denial,
   retry, and approval.
