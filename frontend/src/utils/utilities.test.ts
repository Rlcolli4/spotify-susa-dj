import { formatDuration } from './utilities';

describe('formatDuration', () => {
  test('formats milliseconds as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(61000)).toBe('1:01');
    expect(formatDuration(3599000)).toBe('59:59');
  });
});
