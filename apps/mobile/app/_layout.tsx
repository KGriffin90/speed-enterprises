import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
// Side-effect import: registers the background location TaskManager task at
// startup, including when the OS relaunches the app headless to deliver fixes.
import '@/lib/locationTask';

SplashScreen.preventAutoHideAsync();

/**
 * Status bar follows the active color scheme app-wide: light text on the dark
 * surfaces of dark mode, dark text on light mode. Centralising it here means
 * individual screens no longer fight over the bar style as the user navigates.
 */
function ThemedChrome() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* ThemeProvider reads the active tenant (from AuthProvider) and the OS
            color scheme, resolving both into the design-system theme. */}
        <ThemeProvider>
          <ThemedChrome />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
