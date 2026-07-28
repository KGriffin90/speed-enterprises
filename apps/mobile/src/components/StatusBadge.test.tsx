import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusBadge } from './StatusBadge';

// Isolate from the tenant ThemeProvider/AuthProvider — use the default theme.
jest.mock('@/theme/ThemeProvider', () => {
  const { defaultTheme } = require('@/theme/tokens');
  return { useTheme: () => defaultTheme };
});

describe('StatusBadge', () => {
  it.each([
    ['NEW', 'New'],
    ['REVIEWING', 'Reviewing'],
    ['ESTIMATE_SENT', 'Estimate sent'],
    ['SCHEDULED', 'Scheduled'],
    ['IN_PROGRESS', 'In progress'],
    ['COMPLETED', 'Completed'],
    ['PAID', 'Paid'],
    ['CANCELED', 'Canceled'],
  ])('renders the web StatusPill label for %s', (status, label) => {
    const { getByText } = render(<StatusBadge status={status as any} />);
    expect(getByText(label)).toBeTruthy();
  });

  it('falls back to a humanized label for an unknown status (no crash)', () => {
    const { getByText } = render(<StatusBadge status={'SOME_FUTURE_STATE' as any} />);
    expect(getByText('SOME FUTURE STATE')).toBeTruthy();
  });
});
