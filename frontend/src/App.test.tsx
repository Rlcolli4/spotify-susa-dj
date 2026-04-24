import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import App from './App';

jest.mock('./components/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

jest.mock('./components/UserHeader', () => ({
  UserHeader: () => <div>User Header</div>
}));

jest.mock('./contexts/SpotifyAuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

jest.mock('./contexts/DjUserAuthContext', () => ({
  DjUserAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDjUserAuth: () => ({
    djUser: { username: 'Alice' }
  })
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
}

function mockJson(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => data
  });
}

describe('App baseline behavior', () => {
  let container: HTMLDivElement;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    fetchMock = jest.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/api/queue') && !options) {
        return mockJson({ queue: [], status: 'stop', spotify: { isPlaying: false, progressMs: 0, item: null } });
      }
      return mockJson({});
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('polls queue state on mount and renders stopped state', async () => {
    await act(async () => {
      ReactDOM.render(<App />, container);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/queue');
    expect(container.textContent).toContain('No Song Playing');
    expect(container.textContent).toContain('Search for a song or click Autoplay to start your music');
  });

  test('search submits query and renders transformed track results', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/spotify/search')) {
        return mockJson([
          {
            id: 'track-1',
            album: 'Album',
            name: 'Song',
            artist: 'Artist',
            duration: 61000,
            album_image: 'https://image',
            release_date: '2020-01-01',
            popularity: 55
          }
        ]);
      }
      if (url.endsWith('/api/queue') && !options) {
        return mockJson({ queue: [], status: 'stop', spotify: { isPlaying: false, progressMs: 0, item: null } });
      }
      return mockJson({});
    });

    await act(async () => {
      ReactDOM.render(<App />, container);
      await flushPromises();
    });

    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      setInputValue(input, 'song');
      Simulate.change(input, { target: { value: 'song' } } as any);
    });
    await act(async () => {
      Simulate.submit(container.querySelector('form') as Element);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/spotify/search?query=song&type=track&limit=10',
      expect.objectContaining({ method: 'GET' })
    );
    expect(container.textContent).toContain('Song');
    expect(container.textContent).toContain('Artist');
    expect(container.textContent).toContain('Popularity: 55');
  });

  test('autoplay button updates server status with current DJ user', async () => {
    await act(async () => {
      ReactDOM.render(<App />, container);
      await flushPromises();
    });

    const autoplayButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Autoplay') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(autoplayButton);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'autoplay', userId: 'Alice' })
      })
    );
  });

  test('adding a song while stopped starts playback and logs through analytics endpoint', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/spotify/search')) {
        return mockJson([
          {
            id: 'track-1',
            album: 'Album',
            name: 'Song',
            artist: 'Artist',
            duration: 61000,
            album_image: 'https://image',
            release_date: '2020-01-01',
            popularity: 55
          }
        ]);
      }
      if (url.endsWith('/api/spotify/play')) {
        return mockJson({ success: true });
      }
      if (url.endsWith('/api/analytics/logplayback')) {
        return mockJson({ message: 'Playback event logged' });
      }
      if (url.endsWith('/api/status')) {
        return mockJson({ status: 'play' });
      }
      if (url.endsWith('/api/queue') && !options) {
        return mockJson({ queue: [], status: 'stop', spotify: { isPlaying: false, progressMs: 0, item: null } });
      }
      return mockJson({});
    });

    await act(async () => {
      ReactDOM.render(<App />, container);
      await flushPromises();
    });

    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      setInputValue(input, 'song');
      Simulate.change(input, { target: { value: 'song' } } as any);
    });
    await act(async () => {
      Simulate.submit(container.querySelector('form') as Element);
      await flushPromises();
    });

    const addSongButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add Song') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(addSongButton);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/spotify/play',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ uris: ['spotify:track:track-1'] })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/analytics/logplayback',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          track: {
            id: 'track-1',
            trackName: 'Song',
            artistName: 'Artist',
            albumName: 'Album'
          },
          userId: 'Alice'
        })
      })
    );
    expect(container.textContent).toContain('Song');
  });
});
