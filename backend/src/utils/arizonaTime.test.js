const {
  getArizonaDateString,
  isArizonaQuietHours,
  isArizonaEveningCutoffWindow,
  wasUpdatedBeforeTodayEveningCutoff
} = require('./arizonaTime');

describe('arizonaTime', () => {
  test('detects quiet hours before 7 AM Arizona time', () => {
    expect(isArizonaQuietHours(new Date('2026-04-24T08:30:00.000Z'))).toBe(true);
    expect(isArizonaQuietHours(new Date('2026-04-24T14:00:00.000Z'))).toBe(false);
  });

  test('detects the 7 PM through midnight restart window', () => {
    expect(isArizonaEveningCutoffWindow(new Date('2026-04-25T01:59:00.000Z'))).toBe(false);
    expect(isArizonaEveningCutoffWindow(new Date('2026-04-25T02:00:00.000Z'))).toBe(true);
    expect(isArizonaQuietHours(new Date('2026-04-25T06:59:00.000Z'))).toBe(false);
  });

  test('uses Arizona calendar date independent of UTC date', () => {
    expect(getArizonaDateString(new Date('2026-04-24T06:30:00.000Z'))).toBe('2026-04-23');
    expect(getArizonaDateString(new Date('2026-04-24T14:00:00.000Z'))).toBe('2026-04-24');
  });

  test('detects autoplay statuses started before the current 7 PM cutoff', () => {
    const afterCutoff = new Date('2026-04-25T02:05:00.000Z');

    expect(wasUpdatedBeforeTodayEveningCutoff('2026-04-24T20:00:00.000Z', afterCutoff)).toBe(true);
    expect(wasUpdatedBeforeTodayEveningCutoff('2026-04-25T02:01:00.000Z', afterCutoff)).toBe(false);
    expect(wasUpdatedBeforeTodayEveningCutoff('2026-04-24T20:00:00.000Z', new Date('2026-04-25T01:00:00.000Z'))).toBe(false);
  });
});
