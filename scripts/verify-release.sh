#!/bin/sh
# Verify a release of a sample agent before using it:
#
#   scripts/verify-release.sh diagram-agent-v0.1.0
#
# 1. checksums.txt is signed with the Cintelis release key (ssh-keygen -Y verify)
# 2. the tarball in the release matches the signed checksums
# 3. if npm is installed: the tarball on npm is the same file
# 4. if gh is installed: the tarball was built by this repository's release
#    workflow (build provenance attestation)
# Needs: curl, ssh-keygen (OpenSSH 8.1+), sha256sum or shasum.
set -eu

REPO="cintelis/standardagent-catalogue"
NS="standardagent-catalogue-release"
# the release signing key; also in scripts/release_key.pub
RELEASE_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOCB3IaMc3Lc4JvPv6rWCVLpTjmvvPrhFFPST0NSsypP"
tag="${1:?usage: scripts/verify-release.sh <package>-vX.Y.Z}"
base="https://github.com/$REPO/releases/download/$tag"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for f in checksums.txt checksums.txt.sig; do
  curl -fsSL "$base/$f" -o "$tmp/$f"
done

command -v ssh-keygen >/dev/null 2>&1 || { echo "ssh-keygen (OpenSSH 8.1+) is needed to check the signature" >&2; exit 1; }
printf '%s namespaces="%s" %s\n' "$NS" "$NS" "$RELEASE_KEY" > "$tmp/allowed_signers"
if ! ssh-keygen -Y verify -f "$tmp/allowed_signers" -I "$NS" -n "$NS" \
  -s "$tmp/checksums.txt.sig" < "$tmp/checksums.txt" >/dev/null 2>&1; then
  echo "$tag: checksums.txt is NOT signed with the Cintelis release key. Do not use it." >&2
  exit 1
fi
echo "signature: OK (checksums.txt signed with the Cintelis release key)"

# checksums.txt has one line: the hash and the name of the tarball
want=$(cut -d' ' -f1 "$tmp/checksums.txt")
file=$(sed 's/^[0-9a-f]* [ *]//' "$tmp/checksums.txt")
curl -fsSL "$base/$file" -o "$tmp/$file"
sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
[ "$(sha "$tmp/$file")" = "$want" ] || { echo "$file does NOT match the signed checksum. Do not use it." >&2; exit 1; }
echo "release:   OK ($file matches the signed checksum)"

if command -v npm >/dev/null 2>&1; then
  tar -xzf "$tmp/$file" -C "$tmp" package/package.json
  spec=$(sed -n 's/^  "name": "\(.*\)",$/\1/p' "$tmp/package/package.json")@${tag##*-v}
  url=$(npm view "$spec" dist.tarball 2>/dev/null || true)
  if [ -z "$url" ]; then
    echo "npm:       $spec is not on npm (yet)"
  else
    curl -fsSL "$url" -o "$tmp/npm.tgz"
    [ "$(sha "$tmp/npm.tgz")" = "$want" ] || { echo "$spec on npm is NOT the signed tarball. Do not use it." >&2; exit 1; }
    echo "npm:       OK ($spec on npm is the signed tarball)"
  fi
fi

if command -v gh >/dev/null 2>&1; then
  gh attestation verify "$tmp/$file" -R "$REPO" >/dev/null && echo "build:     OK ($file was built by the release workflow)"
fi
