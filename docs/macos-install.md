# Install Studyus on macOS

## One-line install

Open **Terminal**, paste this command, and press **Return**:

```bash
curl -fsSL https://github.com/leonalav/studyus/releases/latest/download/install.sh | bash
```

The installer downloads the latest universal macOS build, verifies its SHA-256
checksum, installs it as `/Applications/Studyus.app`, clears residual extended
attributes, and opens Studyus. It replaces an older Studyus installation
cleanly. A normal administrator account can usually write to `/Applications`
directly; if macOS requires elevated access, the installer asks for it.

Studyus supports both Apple Silicon and Intel Macs from the same download.

## Inspect before running (optional)

To review the installer before executing it:

```bash
curl -fsSL https://github.com/leonalav/studyus/releases/latest/download/install.sh
```

The installer downloads these assets from the latest GitHub Release:

- `Studyus-macOS.zip`
- `Studyus-macOS.zip.sha256`

## Required release assets

Before the one-line command can be used, publish a non-draft GitHub Release
containing these assets with their exact stable names:

- `Studyus-macOS.zip`, created with `ditto` so it contains `Studyus.app`
- `Studyus-macOS.zip.sha256`, generated with `shasum -a 256`
- `install.sh`, copied from the repository root

Once those assets are attached, the command above resolves them through
GitHub's `releases/latest/download` URL.
