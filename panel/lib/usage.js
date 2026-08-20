const db = require('./db');
const xray = require('./xray');

const POLL_MS = 5000;
const SNAPSHOT_EVERY_N_TICKS = 12; // 12 * 5s = every ~60s

let tickCount = 0;

async function tick() {
  tickCount++;
  const stats = await xray.getStats(); // keyed by uuid, cumulative since xray process start
  const users = db.listUsers();
  const now = new Date();
  let needsRestart = false;

  for (const u of users) {
    const raw = stats[u.uuid] || { uplink: 0, downlink: 0 };

    // If raw counters are lower than what we last saw, xray restarted in between
    // (counters reset to 0) — treat the current raw value as the delta since restart.
    const deltaUp = raw.uplink >= u.last_raw_uplink ? raw.uplink - u.last_raw_uplink : raw.uplink;
    const deltaDown =
      raw.downlink >= u.last_raw_downlink ? raw.downlink - u.last_raw_downlink : raw.downlink;

    if (deltaUp || deltaDown || raw.uplink !== u.last_raw_uplink || raw.downlink !== u.last_raw_downlink) {
      db.applyUsageDelta(u.id, deltaUp, deltaDown, raw.uplink, raw.downlink);
    }

    const fresh = db.getUser(u.id);
    const totalBytes = fresh.uploaded_total + fresh.downloaded_total;
    const overQuota = fresh.data_limit_bytes != null && totalBytes >= fresh.data_limit_bytes;
    const expired = fresh.expires_at != null && now >= new Date(fresh.expires_at);

    if (fresh.enabled && (overQuota || expired)) {
      db.setEnabled(fresh.id, false, 1);
      needsRestart = true;
    }

    if (tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
      db.recordSnapshot(fresh.id, fresh.uploaded_total, fresh.downloaded_total);
    }
  }

  if (needsRestart) xray.restart();
}

function start() {
  setTimeout(() => {
    tick();
    setInterval(tick, POLL_MS);
  }, 6000);
}

module.exports = { start };
