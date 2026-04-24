import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { AuthProvider, useAuth } from './SpotifyAuthContext';

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const Consumer: React.FC = () => {
  const auth = useAuth();

  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.spotifyUser?.displayName || ''}</span>
      <span data-testid="device">{auth.activeDevice?.name || ''}</span>
      <button onClick={auth.login}>Login</button>
      <button onClick={auth.logout}>Logout</button>
      <button onClick={auth.checkAuthStatus}>Check</button>
    </div>
  );
};

describe('SpotifyAuthContext', () => {
  let container: HTMLDivElement;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('throws when useAuth is used outside provider', () => {
    const ThrowingConsumer = () => {
      useAuth();
      return null;
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      act(() => {
        ReactDOM.render(<ThrowingConsumer />, container);
      });
    }).toThrow('useAuth must be used within an AuthProvider');

    errorSpy.mockRestore();
  });

  test('checkAuthStatus loads authenticated profile and active device', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Alice' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Office Speaker' }) });

    await act(async () => {
      ReactDOM.render(<AuthProvider><Consumer /></AuthProvider>, container);
      await flushPromises();
    });

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('false');
    expect(container.querySelector('[data-testid="authenticated"]')?.textContent).toBe('true');
    expect(container.querySelector('[data-testid="user"]')?.textContent).toBe('Alice');
    expect(container.querySelector('[data-testid="device"]')?.textContent).toBe('Office Speaker');
  });

  test('login opens Spotify auth window and rechecks auth on timeout', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authUrl: 'https://spotify-auth' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) });
    const openSpy = jest.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    await act(async () => {
      ReactDOM.render(<AuthProvider><Consumer /></AuthProvider>, container);
      await flushPromises();
    });

    await act(async () => {
      Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Login') as Element);
      await flushPromises();
    });

    expect(openSpy).toHaveBeenCalledWith('https://spotify-auth', 'spotify-auth', 'width=500,height=600,scrollbars=yes,resizable=yes');

    await act(async () => {
      jest.advanceTimersByTime(30000);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/auth/spotify/status');
  });

  test('logout clears auth state and uses current logout endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Alice' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Office Speaker' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await act(async () => {
      ReactDOM.render(<AuthProvider><Consumer /></AuthProvider>, container);
      await flushPromises();
    });

    await act(async () => {
      Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Logout') as Element);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:3001/auth/spotify/logout', expect.objectContaining({ method: 'POST' }));
    expect(container.querySelector('[data-testid="authenticated"]')?.textContent).toBe('false');
    expect(container.querySelector('[data-testid="user"]')?.textContent).toBe('');
    expect(container.querySelector('[data-testid="device"]')?.textContent).toBe('');
  });
});
