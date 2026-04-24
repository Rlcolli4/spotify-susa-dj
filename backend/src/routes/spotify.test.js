const express = require('express');
const request = require('supertest');

jest.mock('../services/spotifyService', () => ({
  isTokenValid: jest.fn(),
  search: jest.fn(),
  getDevices: jest.fn(),
  setActiveDevice: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  next: jest.fn(),
  previous: jest.fn(),
  getCurrentPlayback: jest.fn(),
  setVolume: jest.fn(),
  getTrack: jest.fn(),
  getArtist: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const spotifyService = require('../services/spotifyService');
const spotifyRoutes = require('./spotify');

describe('spotify routes baseline behavior', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    spotifyService.isTokenValid.mockReturnValue(true);

    app = express();
    app.use(express.json());
    app.use('/api/spotify', spotifyRoutes);
  });

  test('requires auth for protected routes', async () => {
    spotifyService.isTokenValid.mockReturnValue(false);

    await request(app).get('/api/spotify/devices').expect(401, { error: 'Authentication required' });
  });

  test('validates search query and delegates valid searches', async () => {
    await request(app).get('/api/spotify/search').expect(400);

    spotifyService.search.mockResolvedValue([{ id: 'track-1' }]);
    await request(app)
      .get('/api/spotify/search?query=hello&type=track&limit=5&offset=2')
      .expect(200, [{ id: 'track-1' }]);

    expect(spotifyService.search).toHaveBeenCalledWith('hello', 'track', 5, 2);
  });

  test('device endpoints delegate to spotifyService', async () => {
    spotifyService.getDevices.mockResolvedValue([{ id: 'd1' }]);
    spotifyService.setActiveDevice.mockResolvedValue({ success: true, deviceId: 'd1' });

    await request(app).get('/api/spotify/devices').expect(200, { devices: [{ id: 'd1' }] });
    await request(app).post('/api/spotify/devices/active').send({}).expect(400, { error: 'Device ID is required' });
    await request(app).post('/api/spotify/devices/active').send({ deviceId: 'd1' }).expect(200, {
      success: true,
      message: 'Active device set successfully'
    });

    expect(spotifyService.setActiveDevice).toHaveBeenCalledWith('d1');
  });

  test('playback control endpoints delegate to spotifyService', async () => {
    spotifyService.play.mockResolvedValue({ success: true, message: 'play' });
    spotifyService.pause.mockResolvedValue({ success: true, message: 'pause' });
    spotifyService.next.mockResolvedValue({ success: true, message: 'next' });
    spotifyService.previous.mockResolvedValue({ success: true, message: 'previous' });
    spotifyService.getCurrentPlayback.mockResolvedValue({ is_playing: true });

    await request(app).post('/api/spotify/play').send({ uris: ['spotify:track:1'], deviceId: 'd1' }).expect(200, { success: true, message: 'play' });
    await request(app).post('/api/spotify/pause').send({ deviceId: 'd1' }).expect(200, { success: true, message: 'pause' });
    await request(app).post('/api/spotify/next').send({ deviceId: 'd1' }).expect(200, { success: true, message: 'next' });
    await request(app).post('/api/spotify/previous').send({ deviceId: 'd1' }).expect(200, { success: true, message: 'previous' });
    await request(app).get('/api/spotify/playback').expect(200, { is_playing: true });

    expect(spotifyService.play).toHaveBeenCalledWith(['spotify:track:1'], 'd1');
    expect(spotifyService.pause).toHaveBeenCalledWith('d1');
    expect(spotifyService.next).toHaveBeenCalledWith('d1');
    expect(spotifyService.previous).toHaveBeenCalledWith('d1');
  });

  test('volume validates range before delegating', async () => {
    spotifyService.setVolume.mockResolvedValue({ success: true, volume: 50 });

    await request(app).put('/api/spotify/volume').send({ volumePercent: 101 }).expect(400);
    await request(app).put('/api/spotify/volume').send({ volumePercent: 50, deviceId: 'd1' }).expect(200, {
      success: true,
      volume: 50
    });

    expect(spotifyService.setVolume).toHaveBeenCalledWith(50, 'd1');
  });

  test('track, artist, preview, link, and direct-track playback endpoints shape responses', async () => {
    spotifyService.getTrack.mockResolvedValue({
      id: 'track-1',
      name: 'Song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album' },
      duration_ms: 1000,
      preview_url: 'https://preview',
      external_urls: { spotify: 'https://spotify' }
    });
    spotifyService.getArtist.mockResolvedValue({ id: 'artist-1' });
    spotifyService.play.mockResolvedValue({ success: true });

    await request(app).get('/api/spotify/tracks/track-1').expect(200);
    await request(app).get('/api/spotify/artists/artist-1').expect(200, { id: 'artist-1' });
    const previewResponse = await request(app).get('/api/spotify/tracks/track-1/preview').expect(200);
    const linksResponse = await request(app).get('/api/spotify/tracks/track-1/links').expect(200);
    await request(app).post('/api/spotify/tracks/track-1/play').send({ deviceId: 'd1' }).expect(200, { success: true });

    expect(previewResponse.body).toEqual(expect.objectContaining({ preview_url: 'https://preview' }));
    expect(linksResponse.body).toEqual(expect.objectContaining({ spotify: 'https://spotify' }));
    expect(spotifyService.play).toHaveBeenCalledWith(['spotify:track:track-1'], 'd1');
  });

  test('missing preview returns 404', async () => {
    spotifyService.getTrack.mockResolvedValue({
      id: 'track-1',
      name: 'Song',
      artists: [{ name: 'Artist' }],
      duration_ms: 1000,
      preview_url: null
    });

    await request(app).get('/api/spotify/tracks/track-1/preview').expect(404);
  });
});
