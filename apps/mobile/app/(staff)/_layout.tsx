import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/ThemeProvider';

export default function StaffLayout() {
  const t = useTheme();
  const { session, loading, isStaff } = useAuth();

  // Route guard: staff tabs require a STAFF+ session. Also fires when a
  // session expires mid-use (refresh failure clears it reactively).
  if (loading) return null;
  if (!session) return <Redirect href={'/(platform)/storefront' as any} />;
  if (!isStaff) return <Redirect href={'/' as any} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.brand.brand600,
        tabBarInactiveTintColor: t.ink[500],
        tabBarStyle: { backgroundColor: t.surface[0], borderTopColor: t.surface[200] },
      }}
    >
      <Tabs.Screen name="jobs"      options={{ title: 'Jobs',      tabBarIcon: ({ color }) => <Ionicons name="briefcase-outline"  size={22} color={color} /> }} />
      <Tabs.Screen name="timesheet" options={{ title: 'Timesheet', tabBarIcon: ({ color }) => <Ionicons name="time-outline"       size={22} color={color} /> }} />
      <Tabs.Screen name="routes"    options={{ title: 'Routes',    tabBarIcon: ({ color }) => <Ionicons name="navigate-outline"   size={22} color={color} /> }} />
      <Tabs.Screen name="account"  options={{ title: 'Account', tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="job/[id]" options={{ href: null }} />
    </Tabs>
  );
}
