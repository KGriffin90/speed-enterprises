'use client';

import { usePathname } from 'next/navigation';

// Routes where the tenant site header should be hidden —
// these pages have their own navigation.
const SUPPRESS = ['/auth', '/dashboard', '/admin', '/platform'];

export function ConditionalTenantHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (SUPPRESS.some(p => pathname.startsWith(p))) return null;
  return <>{children}</>;
}
