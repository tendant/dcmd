# Releasing

Releases are cut from a tag. Pushing `v*` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds
four bundles on real runners and collects them into a **draft** GitHub release.
Nothing becomes public until someone presses publish.

Four targets, because only those runners can produce them:

| Target | Runner | Output |
| --- | --- | --- |
| `aarch64-apple-darwin` | `macos-latest` | `.dmg` |
| `x86_64-apple-darwin` | `macos-13` | `.dmg` |
| `x86_64-unknown-linux-gnu` | `ubuntu-22.04` | `.AppImage`, `.deb` |
| `x86_64-pc-windows-msvc` | `windows-latest` | `.msi`, `.exe` |

Both Mac architectures are built separately rather than as one universal
binary: a universal build doubles the download for everyone to spare one group
a choice, and an x86_64 build will not run natively on Apple silicon.

## Cutting a release

1. Bump the version in **three** places, which must agree: `package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Run `cargo check` so
   `Cargo.lock` follows.
2. Update `README.md` if behaviour changed. It has been wrong before — it
   claimed preview was unimplemented for several releases' worth of work.
3. Commit, push, then tag:

   ```sh
   git tag -a v0.2.0 -m "dcmd 0.2.0"
   git push origin v0.2.0
   ```

4. Watch the run. `fail-fast: false`, so one broken target does not hide the
   others.
5. Review the draft, add the notes below, publish.

To try the workflow without tagging, run it from **Actions → Release → Run
workflow**. It builds and uploads artifacts; the publish job is gated on a tag,
so nothing is created.

If the workflow itself needs fixing, delete the tag and re-cut it — nothing is
published until the draft is:

```sh
git tag -d v0.2.0 && git push origin :v0.2.0
```

## Signing and notarising macOS

**Without this, the app is unusable for anyone who did not build it.** Gatekeeper
refuses an unsigned bundle downloaded from the internet, and the message it
shows suggests the app is damaged rather than unsigned. Users read that as a
broken download.

### The certificate is not the one you already have

An **Apple Development** certificate — what you get by default, and what
Xcode installs — signs apps for your own registered devices. It cannot be used
for distribution and Apple will not notarise it.

What is needed is a **Developer ID Application** certificate. It comes with a
paid Apple Developer Program membership and has to be created explicitly, by
the Account Holder.

Check what is actually installed:

```sh
security find-identity -v -p codesigning
```

Only a line beginning `Developer ID Application:` will do.

### Creating it

1. developer.apple.com → Certificates, IDs & Profiles → Certificates → **+** →
   **Developer ID Application**.
2. It asks for a CSR: Keychain Access → Certificate Assistant → *Request a
   Certificate From a Certificate Authority* → save to disk.
3. Upload the CSR, download the `.cer`, double-click to install.
4. Keychain Access → *My Certificates* → the new "Developer ID Application"
   entry → right-click → **Export** → `.p12`, with a password.

### The credentials CI needs

```sh
./scripts/signing-cert.sh --export              # export it, then check
./scripts/signing-cert.sh ~/Desktop/some.p12    # check one exported by hand
```

`--export` takes the identity out of the login keychain and writes a `.p12`
holding only it. Use it when Keychain Access greys out the `.p12` option, which
it does unless the selected row is the one with the private key beneath it.

The export is not scripted on purpose. `security export -t identities` takes
the entire keychain — every Apple Development certificate, and any revoked ones
— with no way to select one identity. A keychain usually holds several, and
none of the others should reach a runner.

The script refuses to hand anything over unless the file is a readable PKCS#12
**containing a private key**, unless macOS itself can `security import` it into
a throwaway keychain — the same operation CI performs, so the answer is direct
rather than by proxy — and unless the base64 decodes back to those exact bytes. It also reports how many certificates the file holds and whether the
first is a Developer ID one, which is what catches exporting the wrong entry
out of several. It writes the base64 to a file for `pbcopy` — deliberately to a
file, so a private key does not end up in a terminal transcript or a chat
window.

Notarisation needs an **app-specific password**, not the Apple ID password:
appleid.apple.com → Sign-In and Security → App-Specific Passwords.

Add six repository secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the password set when exporting it |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | the Apple ID email |
| `APPLE_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | the 10-character team ID |

Tauri reads these itself: it imports the certificate into a temporary keychain,
signs with the hardened runtime, and submits for notarisation.

A build with the secrets absent still succeeds, unsigned. Forks have no secrets,
and a missing one should not become a red build whose cause is invisible.

### When the certificate will not import

```
security: SecKeychainItemImport: Unknown format in import.
failed codesign application: failed to run command security import
```

The bytes in `APPLE_CERTIFICATE` are not a PKCS#12. In order of likelihood:

- **A `.cer` was exported instead of a `.p12`.** Keychain Access shows the same
  certificate under *Certificates* and under *My Certificates*; only the latter
  export includes the private key, and only that can sign. A `.cer` base64s
  perfectly well and fails exactly like this.
- **The `.p12` was written by OpenSSL 3 with its default algorithms.** macOS
  cannot read those at all. Demonstrated:

  ```
  openssl pkcs12 -export ...            -> security import FAILED
  openssl pkcs12 -export -legacy ...    -> security import OK
  ```

  `-legacy` is required, or `-certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES
  -macalg SHA1`. The script does this; anything hand-rolled with OpenSSL 3 will
  not.
- **The base64 was truncated or altered** on its way into the secret field.
- **The wrong file was encoded** — easy where a keychain holds several
  identities, which most do.

A wrong *password* does not produce this — that fails later, complaining about
MAC verification. This message is about the format alone.

`./scripts/signing-cert.sh` checks all of these locally, which is cheaper than
finding out after a five-minute build on a runner.

### Confirming it worked

The workflow reports this after each macOS build, so an unsigned bundle is
visible in the log rather than discovered by whoever downloads it:

```sh
codesign --verify --deep --strict --verbose=2 path/to/dcmd.app
spctl --assess --type execute --verbose path/to/dcmd.app
```

`spctl` is the check Gatekeeper performs on another machine. A release that is
ready reports `accepted` and `source=Notarized Developer ID`. Anything else
means the download will be refused.

Signing locally works the same way — set the same variables and run
`pnpm tauri build`.

## Release notes

Two things belong in every release until they change:

- **If the macOS bundles are unsigned**, say so and give the way through:
  right-click → Open, or `xattr -d com.apple.quarantine /Applications/dcmd.app`.
  Silence here reads as a broken build.
- **Linux and Windows bundles are unsigned too.** Windows SmartScreen warns on
  an unsigned installer; that needs a separate code-signing certificate and is
  not set up.

## Known gaps

- **Nothing verifies the bundles run.** CI builds and signs them; that they
  launch on a clean machine is checked by hand or not at all.
- **No update mechanism.** Tauri's updater is not configured, so a new version
  means downloading it again.
- **`spctl` in the workflow is informational.** It reports and does not fail the
  build, because a fork with no secrets would otherwise always be red. Read the
  log before publishing.
