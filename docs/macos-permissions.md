# macOS permission prompts

Teneo explains what the access enables, why it is needed, and what still
works without it. Setup explains each optional action on its own step.
Settings explains it in a confirmation dialog before asking macOS.

- **Accessibility:** Posting a paste into the active app needs permission.
  Without access, Teneo leaves the item on the clipboard for a manual paste.
- **File previews:** Teneo only inspects its own files and the Desktop,
  Documents, or Downloads folders you explicitly enable. Your choice is
  saved without opening any folders at startup. macOS still controls access
  to those files. Turn previews off per folder in **Settings → Security**.
  Files without previews can still be copied or opened through macOS.
- **Keychain:** Teneo opens the saved history key at startup without allowing
  a Keychain prompt. If that fails, use **Restore access** in **Settings →
  Security**. Teneo never replaces a missing key for existing encrypted
  entries or saves new detected secrets unencrypted while waiting for the key.
- **Secure Enclave:** If authentication is enabled, unlock from Security when
  you want to use saved secrets. Ordinary history reads never request Touch ID.
- **Local network and sync credentials:** Sync resumes at launch after a
  successful Bonjour registration has been recorded and the saved credentials
  can be opened silently. For a pairing from an earlier version without that
  record, choose **Resume sync** once; the pairing is not changed. macOS has
  no general silent local-network permission check and still controls access
  if it is revoked or reset outside Teneo.
- **Login items:** Adding Teneo at login is optional. macOS can ask for approval
  after you confirm.

## Manual check in a signed Mac build

1. Skip each setup step. No prompt should open merely from visiting a step.
   Try copying and manually pasting a file from a protected folder.
2. Start setup again with test data. Approve one folder and check that the
   other two aren't requested. Verify denied access has no repeat prompt.
3. Enable encryption and sync, allow the requests and wait for Bonjour
   registration. Quit and relaunch. Open history, copy a detected secret,
   and confirm that sync reconnects and history works without asking again.
4. Test with an unreadable Keychain item and with authentication enabled.
   Confirm only the relevant recovery action is offered. Cancel the Teneo
   dialog first and verify macOS never asks. Then confirm and try denial,
   retry, and approval.
