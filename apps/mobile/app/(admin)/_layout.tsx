import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/ThemeProvider';

export default function AdminLayout() {
  const t = useTheme();
  const { session, loading, isAdmin } = useAuth();

  // Route guard: admin tabs require an ADMIN/OWNER session. Also fires when a
  // session expires mid-use (refresh failure clears it reactively).
  if (loading) return null;
  if (!session) return <Redirect href={'/(platform)/storefront' as any} />;
  if (!isAdmin) return <Redirect href={'/' as any} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: { fontSize: 11 },
        tabBarActiveTintColor: t.brand.brand600,
        tabBarInactiveTintColor: t.ink[500],
        tabBarStyle: { backgroundColor: t.surface[0], borderTopColor: t.surface[200] },
      }}
    >
      <Tabs.Screen name="quotes"     options={{ title: 'Quotes',     tabBarIcon: ({ color }) => <Ionicons name="document-text-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="schedule"   options={{ title: 'Schedule',   tabBarIcon: ({ color }) => <Ionicons name="calendar-outline"      size={22} color={color} /> }} />
      <Tabs.Screen name="services"   options={{ title: 'Services',   tabBarIcon: ({ color }) => <Ionicons name="construct-outline"     size={22} color={color} /> }} />
      <Tabs.Screen name="workforce"  options={{ title: 'Workforce',  tabBarIcon: ({ color }) => <Ionicons name="people-outline"        size={22} color={color} /> }} />
      <Tabs.Screen name="business"   options={{ title: 'Business',   tabBarIcon: ({ color }) => <Ionicons name="briefcase-outline"     size={22} color={color} /> }} />
      <Tabs.Screen name="account"    options={{ title: 'Account',    tabBarIcon: ({ color }) => <Ionicons name="person-outline"        size={22} color={color} /> }} />
      {/* Detail screens — hidden from tab bar */}
      <Tabs.Screen name="quote/[id]" options={{ href: null }} />
      <Tabs.Screen name="automations" options={{ href: null }} />
      <Tabs.Screen name="routes" options={{ href: null }} />
      <Tabs.Screen name="route-templates" options={{ href: null }} />
      <Tabs.Screen name="route-template-form" options={{ href: null }} />
    </Tabs>
  );
}
