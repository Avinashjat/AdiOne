/**
 * Raises the Gradle wrapper's distribution download timeout.
 *
 * The wrapper defaults to a 10-second network timeout, which is a TCP-connect
 * timeout, not a download budget. On a slow or high-latency link the connect
 * to services.gradle.org does not complete in time and the build dies with
 * "Downloading … failed: timeout (10000ms)" before a single byte arrives —
 * which reads like the host is down when it is merely slow.
 *
 * This lives in a config plugin because `expo prebuild --clean` regenerates
 * android/ wholesale and would silently drop a hand-edit, reintroducing a
 * failure that costs a long time to re-diagnose.
 */

const { withDangerousMod } = require('expo/config-plugins');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 180000;

module.exports = function withGradleNetworkTimeout(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );

      if (!existsSync(file)) return cfg;

      const contents = readFileSync(file, 'utf8');
      const next = /^networkTimeout=.*$/m.test(contents)
        ? contents.replace(/^networkTimeout=.*$/m, `networkTimeout=${TIMEOUT_MS}`)
        : `${contents.trimEnd()}\nnetworkTimeout=${TIMEOUT_MS}\n`;

      if (next !== contents) writeFileSync(file, next);
      return cfg;
    },
  ]);
};
