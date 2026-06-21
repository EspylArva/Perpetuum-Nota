#!/usr/bin/env bash
#
# deploy-to-zot.sh — Build the Perpetuum Nota images, push them to the Zot OCI
# registry on the NAS, and cosign-sign them.
#
# Architecture:
#   Builds MULTI-ARCH (linux/amd64 + linux/arm64) by default so the images run
#   both on the aarch64 NAS and on this amd64 machine. Override with e.g.
#   PLATFORM=linux/arm64 for a single arch. (amd64 is native here; arm64 is
#   built under QEMU emulation — install once with:
#     docker run --privileged --rm tonistiigi/binfmt --install arm64 )
#
# Why a custom curl pusher instead of `docker push`?
#   Zot sits behind Tailscale Serve, and the docker/buildx client's manifest
#   PUT is rejected there with HTTP 415 (a raw curl PUT of the same bytes
#   returns 201). Blob uploads work fine. So each image is built to a local OCI
#   layout, then every blob + manifest + index is pushed with curl over
#   HTTP/1.1. cosign uses HTTP/1.1 too, so signing works directly.
#
# Auth:
#   ZOT_USERNAME / ZOT_PASSWORD if set, else the Docker credential store entry
#   for the registry host (i.e. after `docker login <host:port>`).
#
# Signing:
#   Uses cosign with ./cosign.key (password from COSIGN_PASSWORD in .env).
#   Public key is ./cosign.pub — verify anywhere with:
#     cosign verify --key cosign.pub <host:port>/perpetuum-nota/api:latest
#
# Versioning:
#   api + web are pushed under a concrete version tag AND :latest. The version
#   is `git describe` by default (override with VERSION=1.2.0). The api image
#   bakes version/commit/branch/build-time/author in as env vars, surfaced at
#   GET /api/info (Settings -> "App info"). Pin a release on the NAS by pulling
#   with API_TAG / WEB_TAG set (see docker-compose.prod.yml).
#
# Usage:  bash scripts/deploy-to-zot.sh
#         VERSION=1.2.0 bash scripts/deploy-to-zot.sh
#
set -euo pipefail

# --- Config ------------------------------------------------------------------
PLATFORM="${PLATFORM:-linux/amd64,linux/arm64}"
NAMESPACE="perpetuum-nota"
POSTGRES_IMAGE="postgres:16-alpine"     # keep in sync with docker-compose.yml
export BUILDX_NO_DEFAULT_ATTESTATIONS=1 # plain manifests (no provenance/sbom)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
WORK="${TMPDIR:-/tmp}/zot-deploy"

win() { cygpath -m "$1" 2>/dev/null || printf '%s' "$1"; }   # POSIX -> Windows path for node/cosign
envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d'=' -f2- | tr -d '\r'; }
git_in() { git -C "$PROJECT_ROOT" "$@" 2>/dev/null; }        # git scoped to the repo

# --- Version metadata --------------------------------------------------------
# api + web get pushed under BOTH a concrete VERSION tag (immutable, for
# rollbacks / pinning) and :latest (what docker-compose.prod.yml pulls by
# default). The api image also bakes this metadata in as env vars so the running
# app can report it at GET /api/info (Settings -> "App info").
#
# Override the release name with VERSION=1.2.0; otherwise it's `git describe`
# (nearest tag + commit, or short sha when untagged) with a `-dirty` suffix when
# the tree has uncommitted changes.
VERSION="${VERSION:-$(git_in describe --tags --always --dirty || echo dev)}"
GIT_COMMIT="$(git_in rev-parse --short HEAD || echo unknown)"
GIT_COMMIT_FULL="$(git_in rev-parse HEAD || echo unknown)"
GIT_BRANCH="$(git_in rev-parse --abbrev-ref HEAD || echo unknown)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
APP_AUTHOR="${APP_AUTHOR:-$(git_in log -1 --format='%an' || echo unknown)}"
# Tag names must be valid OCI references. `git describe` output is already safe,
# but a custom VERSION containing '/' or '+' wouldn't be — sanitize defensively.
VERSION_TAG="$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9_.-' '-')"

# --- Registry host from ZOT_URL ---------------------------------------------
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found." >&2; exit 1; }
ZOT_URL="${ZOT_URL:-$(envval ZOT_URL)}"
REGISTRY="${ZOT_URL#http*://}"; REGISTRY="${REGISTRY%/}"
[ -n "$REGISTRY" ] || { echo "ERROR: ZOT_URL not set in $ENV_FILE." >&2; exit 1; }

# --- Credentials -------------------------------------------------------------
if [ -z "${ZOT_USERNAME:-}" ] || [ -z "${ZOT_PASSWORD:-}" ]; then
  store="$(grep -oE '"credsStore"[[:space:]]*:[[:space:]]*"[^"]+"' "$HOME/.docker/config.json" 2>/dev/null | sed -E 's/.*"([^"]+)"$/\1/')"
  helper="docker-credential-${store:-desktop}"
  command -v "$helper" >/dev/null 2>&1 || helper="docker-credential-desktop"
  creds="$(printf '%s' "$REGISTRY" | "$helper" get 2>/dev/null || true)"
  ZOT_USERNAME="${ZOT_USERNAME:-$(printf '%s' "$creds" | sed -E 's/.*"Username":"([^"]*)".*/\1/')}"
  ZOT_PASSWORD="${ZOT_PASSWORD:-$(printf '%s' "$creds" | sed -E 's/.*"Secret":"([^"]*)".*/\1/')}"
fi
[ -n "${ZOT_USERNAME:-}" ] && [ -n "${ZOT_PASSWORD:-}" ] || {
  echo "ERROR: no credentials for $REGISTRY. Run: docker login $REGISTRY" >&2; exit 1; }
CURL=(curl -sk --user "$ZOT_USERNAME:$ZOT_PASSWORD")

# --- cosign setup ------------------------------------------------------------
COSIGN="$(command -v cosign 2>/dev/null || true)"; [ -n "$COSIGN" ] || COSIGN="$HOME/cosign.exe"
COSIGN_KEY="$PROJECT_ROOT/cosign.key"
COSIGN_PUB="$PROJECT_ROOT/cosign.pub"
export COSIGN_PASSWORD="${COSIGN_PASSWORD:-$(envval COSIGN_PASSWORD)}"
SIGN=1; SIGN_FAILS=0
[ -x "$COSIGN" ] || command -v cosign >/dev/null 2>&1 || { echo "WARN: cosign not found — signing disabled."; SIGN=0; }
[ -f "$COSIGN_KEY" ] || { echo "WARN: $COSIGN_KEY missing — signing disabled."; SIGN=0; }
[ -n "$COSIGN_PASSWORD" ] || { echo "WARN: COSIGN_PASSWORD unset — signing disabled."; SIGN=0; }

echo "==> Registry: $REGISTRY"
echo "==> Platform: $PLATFORM"
echo "==> Version : $VERSION  (tag: $VERSION_TAG, commit: $GIT_COMMIT, branch: $GIT_BRANCH)"
echo "==> Signing : $([ "$SIGN" = 1 ] && echo "on (cosign)" || echo off)"

# --- Preflight ---------------------------------------------------------------
code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "https://$REGISTRY/v2/")"
[ "$code" = "200" ] || { echo "ERROR: GET https://$REGISTRY/v2/ returned $code (unreachable or bad creds)." >&2; exit 1; }

rm -rf "$WORK"; mkdir -p "$WORK"

# --- OCI layout walker (emits the push plan: blobs, sub-manifests, top) ------
cat > "$WORK/walk.cjs" <<'JS'
const fs=require('fs');
const dir=process.argv[2];
const rd=d=>JSON.parse(fs.readFileSync(dir+'/blobs/sha256/'+d.replace('sha256:','')));
const isIdx=mt=>/image.index|manifest.list/.test(mt||'');
const idx=JSON.parse(fs.readFileSync(dir+'/index.json'));
const blobs=[],seen=new Set(),subs=[];
const addBlob=d=>{if(!seen.has(d)){seen.add(d);blobs.push(d);}};
function mani(d,mt){const m=rd(d);addBlob(m.config.digest);(m.layers||[]).forEach(l=>addBlob(l.digest));subs.push(['MANIFEST',d,mt||m.mediaType||'application/vnd.oci.image.manifest.v1+json']);}
function index(d){const ix=rd(d);(ix.manifests||[]).forEach(c=>isIdx(c.mediaType)?index(c.digest):mani(c.digest,c.mediaType));}
const top=idx.manifests[0];let topLine;
if(isIdx(top.mediaType)){index(top.digest);topLine=['TOP',top.digest,top.mediaType];}
else{const m=rd(top.digest);addBlob(m.config.digest);(m.layers||[]).forEach(l=>addBlob(l.digest));topLine=['TOP',top.digest,top.mediaType||m.mediaType||'application/vnd.oci.image.manifest.v1+json'];}
const out=[];blobs.forEach(b=>out.push('BLOB '+b));subs.forEach(s=>out.push(s.join(' ')));out.push(topLine.join(' '));
process.stdout.write(out.join('\n')+'\n');
JS
WALK_WIN="$(win "$WORK/walk.cjs")"

# --- Registry push helpers (curl over HTTP/1.1) -----------------------------
upload_blob() {  # repo file digest
  local repo="$1" file="$2" d="$3" loc path sep
  if [ "$("${CURL[@]}" -o /dev/null -w '%{http_code}' -I "https://$REGISTRY/v2/$repo/blobs/$d")" = "200" ]; then return 0; fi
  loc="$("${CURL[@]}" -X POST -D - -o /dev/null "https://$REGISTRY/v2/$repo/blobs/uploads/" \
        | tr -d '\r' | sed -nE 's/^[Ll]ocation:[[:space:]]*//p' | head -n1)"
  path="$(printf '%s' "$loc" | sed -E 's#^https?://[^/]+##')"
  case "$path" in *\?*) sep='&';; *) sep='?';; esac
  "${CURL[@]}" -fsS -X PUT --data-binary @"$file" -H 'Content-Type: application/octet-stream' \
    -o /dev/null "https://$REGISTRY${path}${sep}digest=$d"
}
put_manifest() {  # repo file ref mediaType
  "${CURL[@]}" -fsS -X PUT -H "Content-Type: $4" --data-binary @"$2" -o /dev/null \
    "https://$REGISTRY/v2/$1/manifests/$3"
}

LAST_DIGEST=""
push_layout() {  # oci_layout_dir repo tag [tag...]  (sets LAST_DIGEST = top digest)
  local lm="$1" repo="$2"; shift 2
  local tags=("$@") lw plan
  lw="$(win "$lm")"
  plan="$(node "$WALK_WIN" "$lw")"
  printf '%s\n' "$plan" | while read -r kind dig mt; do
    case "$kind" in
      BLOB)     upload_blob "$repo" "$lm/blobs/sha256/${dig#sha256:}" "$dig" ;;
      MANIFEST) put_manifest "$repo" "$lm/blobs/sha256/${dig#sha256:}" "$dig" "$mt" ;;
      TOP)      for t in "${tags[@]}"; do
                  put_manifest "$repo" "$lm/blobs/sha256/${dig#sha256:}" "$t" "$mt"
                done ;;
    esac
  done
  LAST_DIGEST="$(printf '%s\n' "$plan" | awk '/^TOP/{print $2}')"
}

build_layout() {  # dockerfile context outdir [extra docker-buildx args...]
  local dockerfile="$1" context="$2" out="$3"; shift 3
  rm -rf "$out" "$out.tar"; mkdir -p "$out"
  docker buildx build --platform "$PLATFORM" --provenance=false --sbom=false \
    "$@" -f "$dockerfile" --output "type=oci,dest=$out.tar" "$context"
  tar -xf "$out.tar" -C "$out"; rm -f "$out.tar"
}

sign_image() {  # repo digest
  [ "$SIGN" = 1 ] || { echo "    (signing disabled)"; return 0; }
  if "$COSIGN" sign --key "$(win "$COSIGN_KEY")" --yes "$REGISTRY/$1@$2" >"$WORK/sign.log" 2>&1; then
    echo "    signed   $1@${2:7:19}"
  else
    echo "    WARN cosign sign failed for $1:"; sed 's/^/      /' "$WORK/sign.log"; SIGN_FAILS=$((SIGN_FAILS+1))
  fi
}

# --- Build + push ------------------------------------------------------------
# api/web are tagged with both the concrete VERSION_TAG and :latest. The api
# build bakes the version metadata in (surfaced at GET /api/info).
echo "==> Building api ($PLATFORM @ $VERSION)"
build_layout "$PROJECT_ROOT/backend/Dockerfile" "$PROJECT_ROOT" "$WORK/api" \
  --build-arg "APP_VERSION=$VERSION" \
  --build-arg "GIT_COMMIT=$GIT_COMMIT" \
  --build-arg "GIT_COMMIT_FULL=$GIT_COMMIT_FULL" \
  --build-arg "GIT_BRANCH=$GIT_BRANCH" \
  --build-arg "BUILD_TIME=$BUILD_TIME" \
  --build-arg "APP_AUTHOR=$APP_AUTHOR"
echo "==> Pushing  api ($VERSION_TAG + latest)"
push_layout "$WORK/api" "$NAMESPACE/api" "$VERSION_TAG" latest; API_DIG="$LAST_DIGEST"
echo "==> Building web ($PLATFORM @ $VERSION)"
build_layout "$PROJECT_ROOT/docker/nginx/Dockerfile" "$PROJECT_ROOT" "$WORK/web"
echo "==> Pushing  web ($VERSION_TAG + latest)"
push_layout "$WORK/web" "$NAMESPACE/web" "$VERSION_TAG" latest; WEB_DIG="$LAST_DIGEST"
echo "==> Mirroring $POSTGRES_IMAGE ($PLATFORM)"
printf 'FROM %s\n' "$POSTGRES_IMAGE" > "$WORK/pg.Dockerfile"
build_layout "$WORK/pg.Dockerfile" "$WORK" "$WORK/pg"
echo "==> Pushing  postgres";         push_layout  "$WORK/pg"   "$NAMESPACE/postgres" 16-alpine;   PG_DIG="$LAST_DIGEST"

# --- Sign --------------------------------------------------------------------
echo "==> Signing images"
sign_image "$NAMESPACE/api"      "$API_DIG"
sign_image "$NAMESPACE/web"      "$WEB_DIG"
sign_image "$NAMESPACE/postgres" "$PG_DIG"

# --- Verify ------------------------------------------------------------------
echo "==> Verifying"
verify_one() {  # repo tag digest
  local plats
  plats="$(docker buildx imagetools inspect "$REGISTRY/$1:$2" 2>/dev/null | grep -iE 'Platform:' | sed -E 's/.*Platform:[[:space:]]*//' | paste -sd, -)"
  printf '    %-26s %s\n' "$1:$2" "[$plats]"
  if [ "$SIGN" = 1 ]; then
    if "$COSIGN" verify --key "$(win "$COSIGN_PUB")" "$REGISTRY/$1@$3" >/dev/null 2>&1; then
      echo "        signature: OK"
    else
      echo "        signature: FAILED"
    fi
  fi
}
verify_one "$NAMESPACE/api"      "$VERSION_TAG" "$API_DIG"
verify_one "$NAMESPACE/web"      "$VERSION_TAG" "$WEB_DIG"
verify_one "$NAMESPACE/postgres" 16-alpine      "$PG_DIG"

echo "==> Done. Pushed $VERSION (tag $VERSION_TAG + latest) to https://$REGISTRY/v2/$NAMESPACE/"
echo "    Pin this release on the NAS with:  API_TAG=$VERSION_TAG WEB_TAG=$VERSION_TAG docker compose -f docker-compose.prod.yml --env-file .env pull && … up -d"
[ "$SIGN_FAILS" = 0 ] || { echo "WARN: $SIGN_FAILS image(s) failed to sign." >&2; exit 1; }
