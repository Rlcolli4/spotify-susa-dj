jest.mock('axios');
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const axios = require('axios');
const cron = require('node-cron');
const spotifyService = require('./spotifyService');
const originalMakeRequest = Object.getPrototypeOf(spotifyService).makeRequest;

describe('spotifyService baseline behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    spotifyService.makeRequest = originalMakeRequest.bind(spotifyService);
    spotifyService.clientId = 'client-id';
    spotifyService.clientSecret = 'client-secret';
    spotifyService.redirectUri = 'http://redirect';
    spotifyService.refreshToken = 'refresh-token';
    spotifyService.allowExplicit = false;
    spotifyService.accessToken = 'access-token';
    spotifyService.tokenExpiry = Date.now() + 60000;
    spotifyService.activeDeviceId = null;
  });

  test('getAuthUrl includes expected OAuth scopes and parameters', () => {
    const url = new URL(spotifyService.getAuthUrl());

    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://redirect');
    expect(url.searchParams.get('scope')).toContain('user-modify-playback-state');
    expect(url.searchParams.get('show_dialog')).toBe('true');
  });

  test('token methods store returned tokens and expirations', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { access_token: 'client-token', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: 'oauth-token', refresh_token: 'oauth-refresh', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: 'refreshed-token', expires_in: 3600 } });

    await expect(spotifyService.getClientCredentialsToken()).resolves.toBe('client-token');
    await expect(spotifyService.exchangeCodeForTokens('code')).resolves.toEqual({
      access_token: 'oauth-token',
      refresh_token: 'oauth-refresh',
      expires_in: 3600
    });
    await expect(spotifyService.refreshAccessToken()).resolves.toBe('refreshed-token');

    expect(spotifyService.refreshToken).toBe('oauth-refresh');
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  test('search filters explicit tracks when explicit playback is disabled', async () => {
    axios.get.mockResolvedValue({
      data: {
        tracks: {
          items: [
            {
              id: 'clean',
              name: 'Clean Song',
              explicit: false,
              artists: [{ name: 'Artist' }],
              album: { name: 'Album', release_date: '2020', images: [{ url: 'image' }] },
              duration_ms: 1000,
              popularity: 5
            },
            {
              id: 'explicit',
              name: 'Explicit Song',
              explicit: true,
              artists: [{ name: 'Artist' }],
              album: { name: 'Album', release_date: '2020', images: [{ url: 'image' }] },
              duration_ms: 1000,
              popularity: 5
            }
          ]
        }
      }
    });

    await expect(spotifyService.search('song', 'track', 2, 0)).resolves.toEqual([
      {
        id: 'clean',
        name: 'Clean Song',
        artist: 'Artist',
        album: 'Album',
        duration: 1000,
        release_date: '2020',
        album_image: 'image',
        popularity: 5
      }
    ]);
  });

  test('playback helpers call makeRequest with active or provided devices', async () => {
    spotifyService.makeRequest = jest.fn().mockResolvedValue({ data: { ok: true } });
    spotifyService.activeDeviceId = 'active-device';

    await expect(spotifyService.play(['spotify:track:1'])).resolves.toEqual({ success: true, message: 'Playback started' });
    await expect(spotifyService.pause('provided-device')).resolves.toEqual({ success: true, message: 'Playback paused' });
    await expect(spotifyService.next()).resolves.toEqual({ success: true, message: 'Skipped to next track' });
    await expect(spotifyService.previous()).resolves.toEqual({ success: true, message: 'Skipped to previous track' });
    await expect(spotifyService.setVolume(33)).resolves.toEqual({ success: true, volume: 33 });

    expect(spotifyService.makeRequest).toHaveBeenNthCalledWith(
      1,
      'PUT',
      '/me/player/play',
      { uris: ['spotify:track:1'] },
      { device_id: 'active-device' }
    );
    expect(spotifyService.makeRequest).toHaveBeenNthCalledWith(
      2,
      'PUT',
      '/me/player/pause',
      {},
      { device_id: 'provided-device' }
    );
    expect(spotifyService.makeRequest).toHaveBeenNthCalledWith(
      5,
      'PUT',
      '/me/player/volume',
      {},
      { volume_percent: 33, device_id: 'active-device' }
    );
  });

  test('device and lookup helpers map Spotify responses', async () => {
    spotifyService.makeRequest = jest.fn()
      .mockResolvedValueOnce({ data: { devices: [{ id: 'd1', name: 'Desk', type: 'Computer', is_active: true }] } })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { devices: [{ id: 'd2', name: 'Phone', type: 'Smartphone', is_active: false }] } })
      .mockResolvedValueOnce({ data: { is_playing: true } })
      .mockResolvedValueOnce({
        data: {
          id: 'track-1',
          name: 'Song',
          artists: [{ name: 'Artist' }],
          album: { name: 'Album', release_date: '2020', images: [{ url: 'image' }] },
          duration_ms: 1000,
          popularity: 10
        }
      })
      .mockResolvedValueOnce({ data: { id: 'artist-1' } })
      .mockResolvedValueOnce({ data: { id: 'user-1' } });

    await expect(spotifyService.getDevices()).resolves.toEqual([{ id: 'd1', name: 'Desk', type: 'Computer', is_active: true }]);
    await expect(spotifyService.setActiveDevice('d2')).resolves.toEqual({ success: true, deviceId: 'd2' });
    await expect(spotifyService.setFirstAvailableDevice()).resolves.toEqual({ success: true, id: 'd2', name: 'Phone', type: 'Smartphone' });
    await expect(spotifyService.getCurrentPlayback()).resolves.toEqual({ is_playing: true });
    await expect(spotifyService.getTrack('track-1')).resolves.toEqual({
      id: 'track-1',
      name: 'Song',
      artist: 'Artist',
      album: 'Album',
      duration: 1000,
      release_date: '2020',
      album_image: 'image',
      popularity: 10
    });
    await expect(spotifyService.getArtist('artist-1')).resolves.toEqual({ id: 'artist-1' });
    await expect(spotifyService.getUserProfile()).resolves.toEqual({ id: 'user-1' });
  });

  test('makeRequest requires a token and builds axios config', async () => {
    spotifyService.accessToken = null;
    await expect(spotifyService.makeRequest('GET', '/me')).rejects.toThrow('No access token available');

    spotifyService.accessToken = 'token';
    axios.mockResolvedValue({ data: { ok: true } });
    await spotifyService.makeRequest('POST', '/endpoint', { a: 1 }, { b: 2 });

    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://api.spotify.com/v1/endpoint',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      data: { a: 1 },
      params: { b: 2 }
    });
  });

  test('token info reports validity and schedules refresh job', () => {
    expect(spotifyService.isTokenValid()).toBe(true);
    expect(spotifyService.getTokenInfo()).toEqual(
      expect.objectContaining({
        hasToken: true,
        isValid: true,
        tokenType: 'oauth',
        activeDeviceId: null
      })
    );

    spotifyService.scheduleTokenRefresh();
    expect(cron.schedule).toHaveBeenCalledWith('*/50 * * * *', expect.any(Function));
  });
});
