const databaseService = require('./databaseService');

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('databaseService baseline behavior', () => {
  beforeEach(() => {
    databaseService.pool = {
      query: jest.fn()
    };
  });

  test('logPlaybackEvent increments times_played for an existing track', async () => {
    databaseService.pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const result = await databaseService.logPlaybackEvent({
      trackId: 'track-1',
      trackName: 'Song',
      artistName: 'Artist',
      albumName: 'Album',
      userId: 'user'
    });

    expect(result).toEqual({ id: 42 });
    expect(databaseService.pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE track_id = $1'),
      ['track-1']
    );
    expect(databaseService.pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SET times_played = times_played + 1'),
      [42]
    );
    expect(databaseService.pool.query.mock.calls[1][0]).toContain('last_played_at = now()');
    expect(databaseService.pool.query.mock.calls[1][0]).not.toContain('last_played_on_az');
  });

  test('logPlaybackEvent inserts a new track when no history row exists', async () => {
    databaseService.pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const result = await databaseService.logPlaybackEvent({
      trackId: 'track-2',
      trackName: 'New Song',
      artistName: 'New Artist',
      albumName: 'New Album',
      userId: 'new-user'
    });

    expect(result).toEqual({ id: 99 });
    expect(databaseService.pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO track_history'),
      ['track-2', 'New Song', 'New Artist', 'New Album', 'new-user']
    );
    expect(databaseService.pool.query.mock.calls[1][0]).toContain('last_played_at');
    expect(databaseService.pool.query.mock.calls[1][0]).not.toContain('last_played_on_az');
  });

  test('getRandomTracks returns unbanned random tracks with requested limit', async () => {
    const rows = [{ trackid: 'track-1' }];
    databaseService.pool.query.mockResolvedValue({ rows });

    await expect(databaseService.getRandomTracks(3)).resolves.toBe(rows);

    expect(databaseService.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE banned = false'),
      [3]
    );
    expect(databaseService.pool.query.mock.calls[0][0]).toContain('ORDER BY RANDOM()');
  });

  test('getAutoplayTracks prefers tracks not played on the current Arizona date', async () => {
    const rows = [{ trackid: 'track-1' }];
    databaseService.pool.query.mockResolvedValue({ rows });

    await expect(databaseService.getAutoplayTracks(1, '2026-04-24')).resolves.toBe(rows);

    expect(databaseService.pool.query).toHaveBeenCalledTimes(1);
    expect(databaseService.pool.query.mock.calls[0][0]).toContain('last_played_at IS NULL OR last_played_at::date < $2::date');
    expect(databaseService.pool.query.mock.calls[0][1]).toEqual([1, '2026-04-24']);
  });

  test('getAutoplayTracks falls back to all unbanned tracks when every song was played today', async () => {
    const fallbackRows = [{ trackid: 'track-2' }];
    databaseService.pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: fallbackRows });

    await expect(databaseService.getAutoplayTracks(1, '2026-04-24')).resolves.toBe(fallbackRows);

    expect(databaseService.pool.query).toHaveBeenCalledTimes(2);
    expect(databaseService.pool.query.mock.calls[1][0]).toContain('WHERE banned = false');
    expect(databaseService.pool.query.mock.calls[1][0]).toContain('ORDER BY RANDOM()');
    expect(databaseService.pool.query.mock.calls[1][1]).toEqual([1]);
  });

  test('getUserForTrack returns the first matching user', async () => {
    databaseService.pool.query.mockResolvedValue({ rows: [{ user_id: 'alice' }] });

    await expect(databaseService.getUserForTrack('track-1')).resolves.toBe('alice');
    expect(databaseService.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE track_id = $1'),
      ['track-1']
    );
  });

  test('getUserForTrack rejects when no track is found', async () => {
    databaseService.pool.query.mockResolvedValue({ rows: [] });

    await expect(databaseService.getUserForTrack('missing')).rejects.toThrow('Track not found');
  });

  test('queue helpers preserve current SQL behavior', async () => {
    databaseService.pool.query
      .mockResolvedValueOnce({ rows: [{ next_order: 7 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ trackid: 'track-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await databaseService.addToPlaybackQueue('track-1', 'Song', 'Artist', 'Album', 'art.jpg', 123, 'alice');
    await expect(databaseService.getCurrentPlaybackQueue()).resolves.toEqual([{ trackid: 'track-1' }]);
    await databaseService.removeFromPlaybackQueue('track-1');
    await databaseService.clearPlaybackQueue();

    expect(databaseService.pool.query.mock.calls[1][0]).toContain('INSERT INTO public.playback_queue');
    expect(databaseService.pool.query.mock.calls[1][1]).toEqual([
      'track-1',
      'Song',
      'Artist',
      'Album',
      'art.jpg',
      123,
      'alice',
      7
    ]);
    expect(databaseService.pool.query.mock.calls[2][0]).toContain('ORDER BY play_order ASC');
    expect(databaseService.pool.query.mock.calls[3][0]).toContain('DELETE FROM public.playback_queue');
    expect(databaseService.pool.query.mock.calls[4][0]).toContain('TRUNCATE public.playback_queue');
  });

  test('status and DJ user helpers map database rows to app values', async () => {
    databaseService.pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'autoplay' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'autoplay', user_id: 'alice', date_updated: '2026-04-24T16:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_name: 'Alice', user_id: 'u1' }] });

    await expect(databaseService.getPlaybackStatus()).resolves.toBe('autoplay');
    await expect(databaseService.getPlaybackStatusRecord()).resolves.toEqual({
      status: 'autoplay',
      user_id: 'alice',
      date_updated: '2026-04-24T16:00:00.000Z'
    });
    await databaseService.updatePlaybackStatus('play', 'alice');
    await expect(databaseService.getDjUserByCode('1234')).resolves.toEqual({ id: 'u1', username: 'Alice' });

    expect(databaseService.pool.query.mock.calls[2]).toEqual([
      expect.stringContaining('UPDATE public.playback_status'),
      ['play', 'alice']
    ]);
  });

  test('createTables adds autoplay play timestamp column and supporting index', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    };
    databaseService.pool = {
      connect: jest.fn().mockResolvedValue(client)
    };

    await databaseService.createTables();

    const allSql = client.query.mock.calls.map(call => call[0]).join('\n');
    expect(allSql).toContain('last_played_at TIMESTAMP');
    expect(allSql).toContain('ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    expect(allSql).toContain('ALTER COLUMN last_played_at SET DEFAULT CURRENT_TIMESTAMP');
    expect(allSql).toContain('idx_track_history_autoplay_daily');
    expect(allSql).toContain('track_history(banned, last_played_at)');
    expect(client.release).toHaveBeenCalled();
  });

  test('healthCheck returns unhealthy response instead of throwing', async () => {
    databaseService.pool = {
      connect: jest.fn().mockRejectedValue(new Error('db down'))
    };

    await expect(databaseService.healthCheck()).resolves.toEqual(
      expect.objectContaining({ status: 'unhealthy', error: 'db down' })
    );
  });
});
