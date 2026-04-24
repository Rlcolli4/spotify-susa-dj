import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { AuthGuard } from './AuthGuard';
import { useAuth } from '../contexts/SpotifyAuthContext';

jest.mock('../contexts/SpotifyAuthContext', () => ({
  useAuth: jest.fn()
}));

const mockUseAuth = useAuth as jest.Mock;

describe('AuthGuard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.clearAllMocks();
  });

  test('renders loading state while auth status is loading', () => {
    mockUseAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, login: jest.fn() });

    act(() => {
      ReactDOM.render(<AuthGuard><div>Protected</div></AuthGuard>, container);
    });

    expect(container.textContent).toContain('Loading...');
    expect(container.textContent).not.toContain('Protected');
  });

  test('renders login prompt and calls login when unauthenticated', () => {
    const login = jest.fn();
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, login });

    act(() => {
      ReactDOM.render(<AuthGuard><div>Protected</div></AuthGuard>, container);
    });

    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('Connect with Spotify'));
    expect(container.textContent).toContain('DJ Bot');
    expect(container.textContent).not.toContain('Protected');

    act(() => {
      Simulate.click(button as Element);
    });

    expect(login).toHaveBeenCalledTimes(1);
  });

  test('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, login: jest.fn() });

    act(() => {
      ReactDOM.render(<AuthGuard><div>Protected</div></AuthGuard>, container);
    });

    expect(container.textContent).toContain('Protected');
  });
});
