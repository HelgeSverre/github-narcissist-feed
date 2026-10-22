/**
 * Runs before every unit-test file. vitest.config.ts pins TZ and LC_ALL; if that did not take effect (different runner,
 * edited config) the date tests would fail with confusing diffs, so fail here with the reason instead.
 */
const offsetInOctober = new Date(2026, 9, 22, 12).getTimezoneOffset();
if (offsetInOctober !== -120) {
  throw new Error(
    `Unit tests expect TZ=Europe/Oslo (UTC+2 on 22 Oct 2026) but the offset is ${-offsetInOctober} min. See vitest.config.ts.`,
  );
}
const locale = Intl.DateTimeFormat().resolvedOptions().locale;
if (!locale.startsWith("en-US")) {
  throw new Error(`Unit tests expect the en-US default locale but got ${locale}. See vitest.config.ts.`);
}
