import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from '@/lib/auth-context';
import { SplashView } from '@/components/SplashView';

export default function Index() {
  const { session, loading, isStaff, isAdmin } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return <SplashView />;
  // Single-business app: signed-out users land directly on the Speed Enterprises
  // storefront (the index), mirroring the web app. No marketplace / role picker.
  if (!session) return <Redirect href={'/(platform)/storefront' as any} />;
  if (isAdmin)  return <Redirect href={'/(admin)/quotes' as any} />;
  if (isStaff)  return <Redirect href="/(staff)/jobs" />;
  return <Redirect href="/(customer)/quotes" />;
}
