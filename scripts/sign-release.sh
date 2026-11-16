#!/bin/sh
# Sign and publish a release of a sample agent. The release workflow builds
# each tag into a DRAFT; nothing reaches npm until this signs it, with a key
# that never leaves the maintainer's machine:
#
#   scripts/sign-release.sh diagram-agent-v0.1.0 [path/to/private/key]
#
# It checks the draft first: the tarball and checksums.txt were built by this
# repository's release workflow (build attestation), and the tarball matches
# checksums.txt. Then it signs checksums.txt, verifies the signature against
# the key committed in scripts/release_key.pub, uploads it, and publishes the
# release. Publishing the release is what starts the npm job.
# Needs: gh (logged in), ssh-keygen (OpenSSH 8.1+), sha256sum or shasum.
set -eu

REPO="cintelis/standardagent-catalogue"
NS="standardagent-catalogue-release"
tag="${1:?usage: scripts/sign-release.sh <package>-vX.Y.Z [private key]}"
key="${2:-$HOME/.ssh/cintelis-release}"
root=$(cd "$(dirname "$0")/.." && pwd)
pub="$root/scripts/release_key.pub"

[ -f "$key" ] || { echo "no private key at $key" >&2; exit 1; }
if [ "$(gh release view "$tag" -R "$REPO" --json isDraft --jq .isDraft)" != "true" ]; then
  echo "$tag is not a draft release (already published, or not built yet)" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh release download "$tag" -R "$REPO" -D "$tmp"

echo "checking build provenance ..."
for f in "$tmp"/*.tgz "$tmp/checksums.txt"; do
  gh attestation verify "$f" -R "$REPO" >/dev/null
done

echo "checking checksums ..."
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && sha256sum -c --quiet checksums.txt)
else
  (cd "$tmp" && shasum -a 256 -c --quiet checksums.txt)
fi

echo "the package to be published:"
for f in "$tmp"/*.tgz; do
  echo "  $(basename "$f")"
  tar -tzf "$f" | sed 's/^/    /'
done
printf 'Sign and publish %s? [y/N] ' "$tag"
read -r answer
[ "$answer" = "y" ] || { echo "stopped; the draft is unchanged" >&2; exit 1; }

echo "signing checksums.txt ..."
rm -f "$tmp/checksums.txt.sig"
ssh-keygen -Y sign -f "$key" -n "$NS" "$tmp/checksums.txt"

# the signature must verify with the committed public key
printf '%s namespaces="%s" %s\n' "$NS" "$NS" "$(cut -d' ' -f1,2 "$pub")" > "$tmp/allowed_signers"
ssh-keygen -Y verify -f "$tmp/allowed_signers" -I "$NS" -n "$NS" \
  -s "$tmp/checksums.txt.sig" < "$tmp/checksums.txt"

# --clobber: a rerun after a failed publish replaces the signature it uploaded
# (the release is still a draft, so it can change; once published it can't)
gh release upload "$tag" "$tmp/checksums.txt.sig" -R "$REPO" --clobber
gh release edit "$tag" -R "$REPO" --draft=false
echo "published $tag; the Release workflow now sends it to npm"
