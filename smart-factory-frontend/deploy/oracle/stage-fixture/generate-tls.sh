#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=${1:?Supply a new private directory for the fixture certificates}
if [[ -e "$directory" || -L "$directory" ]]; then
  echo "The fixture TLS directory must be new." >&2
  exit 1
fi
mkdir -m 0700 -- "$directory"
cd -- "$directory"

# Only the leaf, its key and the CA's public certificate are mounted.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
  -subj '/CN=Smart Factory disposable stage CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout ca.key -out ca.crt
openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=stage-proxy' \
  -addext 'subjectAltName=DNS:stage-proxy' \
  -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'extendedKeyUsage=serverAuth' \
  -keyout proxy.key -out proxy.csr
openssl x509 -req -sha256 -days 1 -copy_extensions copy \
  -CA ca.crt -CAkey ca.key -CAcreateserial -in proxy.csr -out proxy.crt
openssl verify -purpose sslserver -verify_hostname stage-proxy -CAfile ca.crt proxy.crt
chmod 0644 ca.crt proxy.crt
