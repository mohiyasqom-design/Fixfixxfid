#!/bin/sh
set -e
sed -i "s/PORT_PLACEHOLDER/${PORT}/" /etc/xray/config.json
exec xray run -config /etc/xray/config.json
