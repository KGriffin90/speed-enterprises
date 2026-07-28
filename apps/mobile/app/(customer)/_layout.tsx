import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/ThemeProvider';

export default function CustomerLayout() {
  const t = useTheme();
  const { session, loading } = useAuth();

  // Route guard: customer tabs require a session. The public (signed-out)
  // quote flow lives under (platform) and is not affected. Also fires when a
  // session expires mid-use (refresh failure clears it reactively).
  if (loading) return null;
  if (!session) return <Redirect href={'/(platform)/storefront' as any} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.brand.brand600,
        tabBarInactiveTintColor: t.ink[500],
        tabBarStyle: { backgroundColor: t.surface[0], borderTopColor: t.surface[200] },
      }}
    >
      <Tabs.Screen name="quotes"  options={{ title: 'My Quotes', tabBarIcon: ({ color }) => <Ionicons name="document-text-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="request" options={{ title: 'New Quote',  tabBarIcon: ({ color }) => <Ionicons name="add-circle-outline"    size={22} color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="quote/[id]" options={{ href: null }} />
    </Tabs>
  );
}
