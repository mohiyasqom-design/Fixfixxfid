const { spawn, execFile } = require('child_process');
const fs = require('fs');
const { enabledUsers } = require('./db');

const XRAY_BIN = '/usr/bin/xray';
const CONFIG_PATH = '/tmp/xray-config.json';
const XRAY_INTERNAL_PORT = 10000;
const XRAY_API_PORT = 10085;
const VLESS_PATH = process.env.VLESS_PATH || '/tun';

let xrayProcess = null;

function buildConfig() {
  // email is tagged by uuid (not display name) so stats stay correct even if
  // two users share the same display name, and survive renames untouched.
  const clients = enabledUsers().map((u) => ({ id: u.uuid, level: 0, email: u.uuid }));

  return {
    log: { loglevel: 'warning' },
    api: { tag: 'api', services: ['StatsService'] },
    stats: {},
    policy: {
      levels: { 0: { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true },
    },
    inbounds: [
      {
        listen: '127.0.0.1',
        port: XRAY_INTERNAL_PORT,
        protocol: 'vless',
        settings: { clients, decryption: 'none' },
        streamSettings: { network: 'ws', wsSettings: { path: VLESS_PATH } },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
        tag: 'vless-in',
      },
      {
        listen: '127.0.0.1',
        port: XRAY_API_PORT,
        protocol: 'dokodemo-door',
        settings: { address: '127.0.0.1' },
        tag: 'api',
      },
    ],
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'block' },
    ],
    routing: {
      rules: [
        { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
        {
          type: 'field',
          ip: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'],
          outboundTag: 'block',
        },
      ],
    },
  };
}

function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(buildConfig(), null, 2));
}

function start() {
  writeConfig();
  xrayProcess = spawn(XRAY_BIN, ['run', '-config', CONFIG_PATH], { stdio: 'inherit' });
  xrayProcess.on('exit', (code) => {
    console.log(`Xray exited with code ${code}`);
  });
}

function restart() {
  writeConfig();
  if (xrayProcess) {
    xrayProcess.once('exit', () => {
      xrayProcess = spawn(XRAY_BIN, ['run', '-config', CONFIG_PATH], { stdio: 'inherit' });
    });
    xrayProcess.kill();
  } else {
    start();
  }
}

function getStats() {
  return new Promise((resolve) => {
    execFile(
      XRAY_BIN,
      ['api', 'statsquery', `--server=127.0.0.1:${XRAY_API_PORT}`, '-pattern', 'user'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve({});
        try {
          const parsed = JSON.parse(stdout);
          const result = {};
          for (const stat of parsed.stat || []) {
            const match = stat.name.match(/^user>>>(.+)>>>traffic>>>(uplink|downlink)$/);
            if (!match) continue;
            const [, key, direction] = match;
            if (!result[key]) result[key] = { uplink: 0, downlink: 0 };
            result[key][direction] = Number(stat.value);
          }
          resolve(result);
        } catch {
          resolve({});
        }
      }
    );
  });
}

module.exports = { start, restart, getStats, XRAY_INTERNAL_PORT, VLESS_PATH };
