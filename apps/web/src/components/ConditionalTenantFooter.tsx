'use client';

import { usePathname } from 'next/navigation';

// Routes where the large marketing footer should be hidden — these logged-in
// app surfaces have their own chrome. Mirrors the header's suppress list in
// ConditionalTenantHeader.tsx.
const SUPPRESS = ['/auth', '/dashboard', '/admin', '/platform'];

export function ConditionalTenantFooter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (SUPPRESS.some(p => pathname.startsWith(p))) return null;
  return <>{children}</>;
}
