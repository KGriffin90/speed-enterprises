/* Global test mocks for native/Expo modules that have no JS implementation
 * under Jest. Individual tests can override any of these. */

// expo-secure-store → in-memory store so auth/session logic is testable.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
    __store: store,
  };
});

// Icon font component — render as a no-op host view.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Icon = (props: any) => React.createElement(View, props);
  return { Ionicons: Icon, MaterialIcons: Icon, FontAwesome: Icon };
});

// Safe-area: passthrough provider/views with zero insets. (The library's own
// jest mock only exposes a `default` export, which breaks our named imports.)
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  const Passthrough = ({ children, ...props }: any) => React.createElement(View, props, children);
  return {
    SafeAreaProvider: Passthrough,
    SafeAreaView: Passthrough,
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

// Silence only the Animated "useNativeDriver" noise; let every other warning
// (React key warnings, act() warnings, etc.) through so tests still surface bugs.
const realWarn = console.warn.bind(console);
jest.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useNativeDriver')) return;
  realWarn(...args);
});
