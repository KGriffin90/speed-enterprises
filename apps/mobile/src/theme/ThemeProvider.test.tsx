import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { DEFAULT_BRAND } from './tokens';
import { apiCall } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

jest.mock('@/lib/api', () => ({ apiCall: jest.fn() }));
jest.mock('@/lib/auth-context', () => ({ useAuth: jest.fn() }));

const mockAuth = useAuth as unknown as jest.Mock;
const mockApi = apiCall as unknown as jest.Mock;

function Probe() {
  const t = useTheme();
  return <Text>{`brand:${t.brand.brand500}|radius:${t.radius}`}</Text>;
}
const renderWithProvider = () => render(<ThemeProvider><Probe /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

describe('ThemeProvider', () => {
  it('uses the default theme and skips the network when there is no tenant', () => {
    mockAuth.mockReturnValue({ session: null });
    renderWithProvider();
    expect(screen.getByText(`brand:${DEFAULT_BRAND.brand500}|radius:12`)).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('resolves the active tenant branding from /api/config/:slug', async () => {
    mockAuth.mockReturnValue({ session: { tenant: { slug: 'acme' } } });
    mockApi.mockResolvedValue({
      branding: { colors: { ...DEFAULT_BRAND, brand500: '#ff0000' }, cornerRadius: 'rounded' },
    });

    renderWithProvider();

    expect(mockApi).toHaveBeenCalledWith('GET', '/api/config/acme');
    await waitFor(() => expect(screen.getByText('brand:#ff0000|radius:20')).toBeTruthy());
  });

  it('keeps the default theme if the config fetch fails (no crash)', async () => {
    mockAuth.mockReturnValue({ session: { tenant: { slug: 'acme' } } });
    mockApi.mockRejectedValue(new Error('offline'));

    renderWithProvider();

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(screen.getByText(`brand:${DEFAULT_BRAND.brand500}|radius:12`)).toBeTruthy();
  });

  it('ignores a config payload with no branding block', async () => {
    mockAuth.mockReturnValue({ session: { tenant: { slug: 'acme' } } });
    mockApi.mockResolvedValue({ services: [] }); // branding absent

    renderWithProvider();

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(screen.getByText(`brand:${DEFAULT_BRAND.brand500}|radius:12`)).toBeTruthy();
  });
});
