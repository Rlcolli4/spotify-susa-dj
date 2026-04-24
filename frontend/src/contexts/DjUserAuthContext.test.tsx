import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { DjUserAuthProvider, useDjUserAuth } from './DjUserAuthContext';

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const Consumer: React.FC = () => {
  const auth = useDjUserAuth();

  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="username">{auth.djUser?.username || ''}</span>
      <button onClick={auth.logout}>Logout</button>
    </div>
  );
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
}

describe('DjUserAuthContext', () => {
  let container: HTMLDivElement;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    localStorage.clear();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.restoreAllMocks();
  });

  test('throws when useDjUserAuth is used outside provider', () => {
    const ThrowingConsumer = () => {
      useDjUserAuth();
      return null;
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      act(() => {
        ReactDOM.render(<ThrowingConsumer />, container);
      });
    }).toThrow('useDjUserAuth must be used within a DjUserAuthProvider');

    errorSpy.mockRestore();
  });

  test('loads an existing DJ user from localStorage', async () => {
    localStorage.setItem('DJ_USER', JSON.stringify({ username: 'Alice', id: 'u1' }));

    await act(async () => {
      ReactDOM.render(<DjUserAuthProvider><Consumer /></DjUserAuthProvider>, container);
      await flushPromises();
    });

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('false');
    expect(container.querySelector('[data-testid="authenticated"]')?.textContent).toBe('true');
    expect(container.querySelector('[data-testid="username"]')?.textContent).toBe('Alice');
    expect(container.textContent).not.toContain('Enter Verification Code');
  });

  test('verifies a code and stores the returned DJ user', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'Bob', id: 'u2' }) });

    await act(async () => {
      ReactDOM.render(<DjUserAuthProvider><Consumer /></DjUserAuthProvider>, container);
      await flushPromises();
    });

    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      setInputValue(input, ' 1234 ');
      Simulate.change(input, { target: { value: ' 1234 ' } } as any);
    });
    await act(async () => {
      Simulate.submit(container.querySelector('form') as Element);
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/auth/dj/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code: '1234' })
    }));
    expect(JSON.parse(localStorage.getItem('DJ_USER') || '{}')).toEqual({ username: 'Bob', id: 'u2' });
    expect(container.querySelector('[data-testid="authenticated"]')?.textContent).toBe('true');
    expect(container.querySelector('[data-testid="username"]')?.textContent).toBe('Bob');
  });

  test('shows verification errors and logs out to reopen dialog', async () => {
    localStorage.setItem('DJ_USER', JSON.stringify({ username: 'Alice', id: 'u1' }));

    await act(async () => {
      ReactDOM.render(<DjUserAuthProvider><Consumer /></DjUserAuthProvider>, container);
      await flushPromises();
    });

    act(() => {
      Simulate.click(container.querySelector('button') as Element);
    });

    expect(localStorage.getItem('DJ_USER')).toBeNull();
    expect(container.textContent).toContain('Enter Verification Code');

    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Invalid code' }) });
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => {
      setInputValue(input, 'bad');
      Simulate.change(input, { target: { value: 'bad' } } as any);
    });
    await act(async () => {
      Simulate.submit(container.querySelector('form') as Element);
      await flushPromises();
    });

    expect(container.textContent).toContain('Invalid code');
  });
});
