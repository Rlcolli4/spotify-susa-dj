import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { UserHeader } from './UserHeader';
import { useDjUserAuth } from '../contexts/DjUserAuthContext';
import { useAuth } from '../contexts/SpotifyAuthContext';

jest.mock('../contexts/DjUserAuthContext', () => ({
  useDjUserAuth: jest.fn()
}));

jest.mock('../contexts/SpotifyAuthContext', () => ({
  useAuth: jest.fn()
}));

describe('UserHeader', () => {
  let container: HTMLDivElement;
  const mockUseDjUserAuth = useDjUserAuth as jest.Mock;
  const mockUseAuth = useAuth as jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.clearAllMocks();
  });

  test('renders username, active device, and logout action', () => {
    const logout = jest.fn();
    mockUseAuth.mockReturnValue({ activeDevice: { name: 'Office Speaker', type: 'Computer' } });
    mockUseDjUserAuth.mockReturnValue({ djUser: { username: 'Alice' }, logout });

    act(() => {
      ReactDOM.render(<UserHeader />, container);
    });

    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('Office Speaker');
    expect(container.textContent).toContain('Computer');

    act(() => {
      Simulate.click(container.querySelector('button') as Element);
    });

    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('falls back to generic user label without active device', () => {
    mockUseAuth.mockReturnValue({ activeDevice: null });
    mockUseDjUserAuth.mockReturnValue({ djUser: null, logout: jest.fn() });

    act(() => {
      ReactDOM.render(<UserHeader />, container);
    });

    expect(container.textContent).toContain('User');
    expect(container.textContent).toContain('Logout');
  });
});
