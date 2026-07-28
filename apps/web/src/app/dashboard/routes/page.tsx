import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { AssignedRoutes } from './AssignedRoutes';

interface Route {
  id: string;
  startedAt: string;
  endedAt: string | null;
  distanceMiles: number | null;
  gallonsUsed: number | null;
  _count: { waypoints: number };
}

export const metadata = { title: 'My routes' };

export default async function MyRoutes() {
  requireTenantRole('STAFF');
  const routes = await apiServer<Route[]>('GET', '/api/me/routes').catch(() => []);

  const totalMiles = routes.filter(r => r.endedAt).reduce((s, r) => s + (r.distanceMiles ?? 0), 0);

  return (
    <div className="max-w-3xl">
      {/* Owner-assigned routes with per-stop check-in (Arrive / Complete). */}
      <AssignedRoutes />

      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>My routes</h1>
        {totalMiles > 0 && (
          <span className="text-sm" style={{ color: 'var(--ink-500)' }}>{totalMiles.toFixed(1)} mi total</span>
        )}
      </div>

      {routes.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-500)' }}>
          No routes yet. Routes are started automatically when you clock in if location permission is granted.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Start</th>
                <th className="text-left px-4 py-3 font-medium">End</th>
                <th className="text-left px-4 py-3 font-medium">Miles</th>
                <th className="text-left px-4 py-3 font-medium">Gallons</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(r => (
                <tr key={r.id} className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                    {new Date(r.startedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                    {new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                    {r.endedAt
                      ? new Date(r.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : <span style={{ color: '#059669' }}>tracking…</span>}
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink-900)' }}>
                    {r.distanceMiles != null ? r.distanceMiles.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                    {r.gallonsUsed != null ? r.gallonsUsed.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs mt-4" style={{ color: 'var(--ink-400)' }}>
        GPS tracking runs while the timesheet page is open. For continuous background tracking, keep the page open or use the mobile app.
        Gas usage is estimated based on your vehicle's MPG — update it on the Team page.
      </p>
    </div>
  );
}
