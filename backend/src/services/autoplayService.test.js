jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const { enforceAutoplaySchedule, runAutoplayTick } = require('./autoplayService');

function createDeps({ queue = [], status = 'autoplay', dateUpdated = '2026-04-24T16:00:00.000Z', autoplayTracks = [] } = {}) {
  const databaseService = {
    getCurrentPlaybackQueue: jest.fn()
      .mockResolvedValueOnce(queue)
      .mockResolvedValueOnce([]),
    getPlaybackStatusRecord: jest.fn().mockResolvedValue({ status, date_updated: dateUpdated }),
    updatePlaybackStatus: jest.fn().mockResolvedValue(),
    getAutoplayTracks: jest.fn().mockResolvedValue(autoplayTracks),
    logPlaybackEvent: jest.fn().mockResolvedValue({ id: 1 }),
    removeFromPlaybackQueue: jest.fn().mockResolvedValue()
  };
  const spotifyService = {
    getCurrentPlayback: jest.fn().mockResolvedValue({ is_playing: false, item: null, progress_ms: 0 })
  };
  const playTrack = jest.fn().mockResolvedValue();

  return { databaseService, spotifyService, playTrack };
}

describe('autoplayService', () => {
  test('enforces scheduled autoplay stops without requiring Spotify playback state', async () => {
    const deps = createDeps();

    await expect(enforceAutoplaySchedule(
      deps.databaseService,
      new Date('2026-04-24T08:30:00.000Z')
    )).resolves.toBe('stop');

    expect(deps.databaseService.getPlaybackStatusRecord).toHaveBeenCalled();
    expect(deps.spotifyService.getCurrentPlayback).not.toHaveBeenCalled();
    expect(deps.databaseService.updatePlaybackStatus).toHaveBeenCalledWith('stop', 'system');
  });

  test('stops active autoplay during Arizona quiet hours', async () => {
    const deps = createDeps();

    const result = await runAutoplayTick({
      ...deps,
      now: new Date('2026-04-24T08:30:00.000Z')
    });

    expect(deps.databaseService.updatePlaybackStatus).toHaveBeenCalledWith('stop', 'system');
    expect(deps.databaseService.getAutoplayTracks).not.toHaveBeenCalled();
    expect(result.queueStatus).toBe('stop');
  });

  test('stops autoplay that was active before the 7 PM Arizona cutoff', async () => {
    const deps = createDeps({ dateUpdated: '2026-04-24T20:00:00.000Z' });

    const result = await runAutoplayTick({
      ...deps,
      now: new Date('2026-04-25T02:05:00.000Z')
    });

    expect(deps.databaseService.updatePlaybackStatus).toHaveBeenCalledWith('stop', 'system');
    expect(result.queueStatus).toBe('stop');
  });

  test('allows autoplay restarted after 7 PM Arizona time to continue until midnight', async () => {
    const deps = createDeps({ dateUpdated: '2026-04-25T02:01:00.000Z' });

    const result = await runAutoplayTick({
      ...deps,
      now: new Date('2026-04-25T02:05:00.000Z')
    });

    expect(deps.databaseService.updatePlaybackStatus).not.toHaveBeenCalled();
    expect(deps.databaseService.getAutoplayTracks).toHaveBeenCalledWith(1, '2026-04-24');
    expect(result.queueStatus).toBe('autoplay');
  });

  test('selects an eligible autoplay track when queue is empty and Spotify is idle', async () => {
    const deps = createDeps({
      autoplayTracks: [{
        trackId: 'track-1',
        trackName: 'Song',
        artistName: 'Artist',
        albumName: 'Album',
        userId: 'alice'
      }]
    });

    await runAutoplayTick({
      ...deps,
      now: new Date('2026-04-24T18:00:00.000Z')
    });

    expect(deps.databaseService.getAutoplayTracks).toHaveBeenCalledWith(1, '2026-04-24');
    expect(deps.playTrack).toHaveBeenCalledWith('track-1');
    expect(deps.databaseService.logPlaybackEvent).toHaveBeenCalledWith({
      trackId: 'track-1',
      trackName: 'Song',
      artistName: 'Artist',
      albumName: 'Album',
      userId: 'alice'
    });
  });

  test('manual queued playback still logs and removes the queue item', async () => {
    const deps = createDeps({
      status: 'play',
      queue: [{
        trackid: 'track-2',
        trackname: 'Queued Song',
        artistname: 'Queued Artist',
        albumname: 'Queued Album',
        userid: 'bob'
      }]
    });

    await runAutoplayTick({
      ...deps,
      now: new Date('2026-04-24T18:00:00.000Z')
    });

    expect(deps.playTrack).toHaveBeenCalledWith('track-2');
    expect(deps.databaseService.logPlaybackEvent).toHaveBeenCalledWith({
      trackId: 'track-2',
      trackName: 'Queued Song',
      artistName: 'Queued Artist',
      albumName: 'Queued Album',
      userId: 'bob'
    });
    expect(deps.databaseService.removeFromPlaybackQueue).toHaveBeenCalledWith('track-2');
  });

  test('manual queued add once playback skips history logging and removes the queue item', async () => {
    const deps = createDeps({
      status: 'play',
      queue: [{
        trackid: 'track-3',
        trackname: 'Queued Once',
        artistname: 'Queued Artist',
        albumname: 'Queued Album',
        userid: 'bob',
        skiphistory: true
      }]
    });

    await runAutoplayTick({
      ...deps,
      now: new Date('2026-04-24T18:00:00.000Z')
    });

    expect(deps.playTrack).toHaveBeenCalledWith('track-3');
    expect(deps.databaseService.logPlaybackEvent).not.toHaveBeenCalled();
    expect(deps.databaseService.removeFromPlaybackQueue).toHaveBeenCalledWith('track-3');
  });
});
