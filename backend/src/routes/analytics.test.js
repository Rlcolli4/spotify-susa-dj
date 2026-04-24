const express = require('express');
const request = require('supertest');

jest.mock('../services/databaseService', () => ({
  logPlaybackEvent: jest.fn(),
  getRandomTracks: jest.fn(),
  getUserForTrack: jest.fn(),
  removeTrackFromHistory: jest.fn(),
  getAnalytics: jest.fn(),
  getPopularTracks: jest.fn(),
  getPopularArtists: jest.fn(),
  getSearchAnalytics: jest.fn(),
  getUserSessionStats: jest.fn(),
  healthCheck: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const databaseService = require('../services/databaseService');
const analyticsRoutes = require('./analytics');

describe('analytics routes baseline behavior', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/analytics', analyticsRoutes);
  });

  test('logplayback validates and logs playback events', async () => {
    databaseService.logPlaybackEvent.mockResolvedValue({ id: 1 });

    await request(app).post('/api/analytics/logplayback').send({}).expect(400, { error: 'Invalid track data' });
    await request(app)
      .post('/api/analytics/logplayback')
      .send({
        track: {
          id: 'track-1',
          trackName: 'Song',
          artistName: 'Artist',
          albumName: 'Album'
        },
        userId: 'alice'
      })
      .expect(200, { message: 'Playback event logged' });

    expect(databaseService.logPlaybackEvent).toHaveBeenCalledWith({
      trackId: 'track-1',
      trackName: 'Song',
      artistName: 'Artist',
      albumName: 'Album',
      userId: 'alice'
    });
  });

  test('random, blame, and ban routes delegate to databaseService', async () => {
    databaseService.getRandomTracks.mockResolvedValue([{ trackid: 'track-1' }]);
    databaseService.getUserForTrack.mockResolvedValue('Alice');
    databaseService.removeTrackFromHistory.mockResolvedValue();

    await request(app).get('/api/analytics/random/tracks?limit=2').expect(200, [{ trackid: 'track-1' }]);
    await request(app).get('/api/analytics/blame/track-1').expect(200, { trackId: 'track-1', addedBy: 'Alice' });
    await request(app).get('/api/analytics/ban/track-1').expect(200, { trackId: 'track-1' });

    expect(databaseService.getRandomTracks).toHaveBeenCalledWith('2');
    expect(databaseService.getUserForTrack).toHaveBeenCalledWith('track-1');
    expect(databaseService.removeTrackFromHistory).toHaveBeenCalledWith('track-1');
  });

  test('usage and popularity routes validate query params and shape responses', async () => {
    databaseService.getAnalytics.mockResolvedValue([{ id: 1 }]);
    databaseService.getPopularTracks.mockResolvedValue([{ track_id: 'track-1' }]);
    databaseService.getPopularArtists.mockResolvedValue([{ artist_name: 'Artist' }]);

    await request(app).get('/api/analytics/usage?limit=2&offset=1&userId=alice').expect(200, {
      data: [{ id: 1 }],
      count: 1,
      filters: { limit: 2, offset: 1, userId: 'alice' }
    });
    await request(app).get('/api/analytics/popular/tracks?days=7&limit=3').expect(200, {
      data: [{ track_id: 'track-1' }],
      count: 1,
      timeRange: '7 days',
      limit: 3
    });
    await request(app).get('/api/analytics/popular/artists?days=7&limit=3').expect(200, {
      data: [{ artist_name: 'Artist' }],
      count: 1,
      timeRange: '7 days',
      limit: 3
    });

    await request(app).get('/api/analytics/popular/tracks?days=500').expect(400);
  });

  test('search, sessions, rollups, health, and export routes return current computed shapes', async () => {
    databaseService.getSearchAnalytics.mockResolvedValue([{ search_query: 'song' }]);
    databaseService.getUserSessionStats.mockResolvedValue({ sessions: 1 });
    databaseService.getAnalytics.mockResolvedValue([
      { id: 1, user_id: 'alice', action_type: 'search', timestamp: '2026-04-24T10:00:00.000Z', search_query: 'one', device_id: 'd1' },
      { id: 2, user_id: 'alice', action_type: 'play', timestamp: '2026-04-24T11:00:00.000Z', search_query: '', device_id: '' },
      { id: 3, user_id: 'bob', action_type: 'play', timestamp: '2026-04-24T11:30:00.000Z', search_query: '', device_id: '' }
    ]);
    databaseService.healthCheck.mockResolvedValue({ status: 'healthy' });

    await request(app).get('/api/analytics/search?days=7').expect(200, {
      data: [{ search_query: 'song' }],
      count: 1,
      timeRange: '7 days'
    });
    await request(app).get('/api/analytics/sessions?days=7').expect(200, {
      data: { sessions: 1 },
      timeRange: '7 days'
    });
    const breakdownResponse = await request(app).get('/api/analytics/actions/breakdown?days=7').expect(200);
    const hourlyResponse = await request(app).get('/api/analytics/activity/hourly?days=7').expect(200);
    const usersResponse = await request(app).get('/api/analytics/users/summary?days=7').expect(200);

    expect(breakdownResponse.body).toEqual(expect.objectContaining({ total: 3 }));
    expect(hourlyResponse.body).toEqual(expect.objectContaining({ total: 3 }));
    expect(usersResponse.body).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        total_actions: 3,
        unique_users: 2,
        average_actions_per_user: '1.50'
      })
    }));
    await request(app).get('/api/analytics/health').expect(200, { status: 'healthy' });
    const exportResponse = await request(app).get('/api/analytics/export?format=json&days=7').expect(200);
    expect(exportResponse.body).toEqual(expect.objectContaining({ count: 3 }));
    await request(app).get('/api/analytics/export?format=csv&days=7').expect(200);
    await request(app).get('/api/analytics/export?format=xml').expect(400);
  });
});
