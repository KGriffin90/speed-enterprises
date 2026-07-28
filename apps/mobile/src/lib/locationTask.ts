import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiCall } from './api';

/**
 * Background location tracking for staff routes.
 *
 * Uses expo-location's background updates (startLocationUpdatesAsync) backed by a
 * TaskManager task, so GPS breadcrumbs keep flowing — and the server-side geofence
 * keeps auto-stamping stop arrival/departure — even when the app is backgrounded
 * or the phone is locked. The task runs in a HEADLESS JS context with no React
 * state, so everything it needs (auth token, tenant, route id) comes from storage:
 *   • token + tenant slug → SecureStore (read by apiCall; written AFTER_FIRST_UNLOCK
 *     so they're readable while the device is locked — see saveSession in api.ts)
 *   • active route id      → AsyncStorage (not sensitive; readable while locked)
 */

export const LOCATION_TASK = 'speed-enterprises-location';
const ACTIVE_ROUTE_KEY = 'active_route_id';

/** Persist the route the breadcrumbs belong to so the headless task can find it. */
export async function setActiveRouteId(routeId: string | null): Promise<void> {
  if (routeId) await AsyncStorage.setItem(ACTIVE_ROUTE_KEY, routeId);
  else await AsyncStorage.removeItem(ACTIVE_ROUTE_KEY);
}

async function getActiveRouteId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTIVE_ROUTE_KEY);
  } catch {
    return null;
  }
}

// Defined at module scope so the task is registered on EVERY JS launch — including
// when the OS relaunches the app headless to deliver a batch of background fixes.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const routeId = await getActiveRouteId();
  if (!routeId) return; // not tracking (e.g. clocked out) — drop the batch

  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
  for (const loc of locations) {
    try {
      await apiCall('POST', `/api/me/routes/${routeId}/waypoints`, {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? undefined,
        speed: loc.coords.speed ?? undefined,
        heading: loc.coords.heading ?? undefined,
        altitude: loc.coords.altitude ?? undefined,
        recordedAt: new Date(loc.timestamp).toISOString(),
      });
    } catch {
      // Best-effort: a dropped fix is fine, the next one re-reports position.
    }
  }
});

/**
 * Begin foreground + background location updates for a route. Caller must have
 * already been granted at least foreground permission; background ("Always" on
 * iOS) is requested separately and, if denied, this still tracks in the foreground.
 */
export async function startBackgroundLocation(routeId: string): Promise<void> {
  await setActiveRouteId(routeId);

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (alreadyRunning) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,      // at most every 10s (Android)
    distanceInterval: 20,      // and/or every 20m moved
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true, // iOS: the blue "in use" bar
    // Android requires a persistent foreground-service notification to keep
    // location alive in the background.
    foregroundService: {
      notificationTitle: 'Tracking your route',
      notificationBody: 'Recording your work route while you are clocked in.',
      notificationColor: '#4f46e5',
    },
  });
}

/** Stop background updates and forget the active route. */
export async function stopBackgroundLocation(): Promise<void> {
  await setActiveRouteId(null);
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
}
