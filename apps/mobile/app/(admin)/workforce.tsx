import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Card, Badge } from '@/components/ui';

interface Member {
  id: string; role: string; fullName: string | null; active: boolean;
  user: { email: string; lastLoginAt: string | null };
  employeeProfile: { basePayCents: number; payType: string; avgMpg: number; vehicleNotes?: string | null; phone?: string | null } | null;
}

function displayRole(r: string) { return r; }

interface TimeEntry {
  id: string; clockedInAt: string; clockedOutAt: string | null;
  breakMinutes: number; status: string;
  notesByStaff: string | null; notesByAdmin: string | null;
  adminEditedAt: string | null;
  membership: { fullName: string | null; role: string; user: { email: string } };
}
interface Route {
  id: string; startedAt: string; endedAt: string | null;
  distanceMiles: number | null; gallonsUsed: number | null;
  membership: { fullName: string | null; user: { email: string } };
  _count: { waypoints: number };
}
interface PayrollRow {
  membershipId: string; name: string; basePayCents: number; payType: string;
  workedMinutes: number; grossPayCents: number; entryCount: number;
}

function fmtDur(inAt: string, outAt: string, brk: number) {
  const m = Math.max(0, Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60000) - brk);
  const h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m % 60}m`;
}
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function fmt$(c: number) { return `$${(c / 100).toFixed(2)}`; }

export default function WorkforceScreen() {
  const t = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<'team' | 'timesheets' | 'payroll' | 'routes'>('team');
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);

  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [editBrk, setEditBrk] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Team management (moved here from the Business tab — all employee info
  // lives together on Workforce).
  const [payModal, setPayModal] = useState<Member | null>(null);
  const [payInput, setPayInput] = useState('');
  const [payMpg, setPayMpg] = useState('25');
  const [payVehicle, setPayVehicle] = useState('');
  const [payPhone, setPayPhone] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  // Add-staff modal
  const [showAdd, setShowAdd] = useState(false);
  const [addFirst, setAddFirst] = useState('');
  const [addLast, setAddLast] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addRole, setAddRole] = useState<'STAFF' | 'OWNER'>('STAFF');
  const [addBusy, setAddBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  async function load() {
    setLoading(true);
    try {
      const [m, e, r, p] = await Promise.all([
        apiCall<Member[]>('GET', '/api/me/team').catch(() => []),
        apiCall<TimeEntry[]>('GET', `/api/admin/time?from=${weekAgo}&to=${today}`).catch(() => []),
        apiCall<Route[]>('GET', `/api/admin/routes?from=${weekAgo}&to=${today}`).catch(() => []),
        apiCall<PayrollRow[]>('GET', `/api/admin/payroll?from=${monthAgo}&to=${today}`).catch(() => []),
      ]);
      setMembers(m); setEntries(e); setRoutes(r); setPayroll(p);
    } finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  function removeMember(mem: Member) {
    Alert.alert('Remove member', `Remove ${mem.fullName ?? mem.user.email}? They can be restored by re-inviting, or permanently deleted from the removed list.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await apiCall('DELETE', `/api/me/team/${mem.id}`).catch(() => {});
        load();
      }},
    ]);
  }

  function permanentDelete(mem: Member) {
    Alert.alert(
      'Delete permanently',
      `Permanently delete ${mem.fullName ?? mem.user.email}? This removes them and their time entries, routes, and pay profile from the database. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          try { await apiCall('DELETE', `/api/me/team/${mem.id}/permanent`); }
          catch { Alert.alert('Error', 'Could not delete this member.'); }
          load();
        } },
      ],
    );
  }

  // Change an existing member's role — persists via PATCH /role (DB-backed).
  function changeMemberRole(mem: Member) {
    const roles = [
      { label: 'Customer', value: 'CUSTOMER' },
      { label: 'Staff', value: 'STAFF' },
      { label: 'Owner', value: 'OWNER' },
    ];
    Alert.alert('Change role', `Set the role for ${mem.fullName ?? mem.user.email}`, [
      ...roles.filter(r => r.value !== mem.role).map(r => ({
        text: r.label,
        onPress: async () => {
          try { await apiCall('PATCH', `/api/me/team/${mem.id}/role`, { role: r.value }); }
          catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not change the role.'); }
          load();
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function addStaff() {
    const fullName = `${addFirst.trim()} ${addLast.trim()}`.trim();
    if (!addFirst.trim() || !addLast.trim()) return Alert.alert('Name required', 'Enter first and last name.');
    if (!/.+@.+\..+/.test(addEmail)) return Alert.alert('Invalid email', 'Enter a valid email address.');
    if (!addPhone.trim()) return Alert.alert('Phone required', 'Enter a phone number.');

    setAddBusy(true);
    try {
      const res = await apiCall<{ immediate: boolean; setupEmailSent?: boolean }>(
        'POST', '/api/me/team/invite',
        { email: addEmail.toLowerCase().trim(), fullName, phone: addPhone.trim(), role: addRole },
      );
      setShowAdd(false);
      setAddFirst(''); setAddLast(''); setAddEmail(''); setAddPhone(''); setAddRole('STAFF');
      Alert.alert(
        'Staff added',
        res.setupEmailSent
          ? `${fullName} has been added. They'll receive an email to set their password, then can sign in with the business name and their email.`
          : `${fullName} already had an account — they've been added to your team and can sign in right away.`,
      );
      load();
    } catch (e: any) {
      Alert.alert('Could not add staff', e?.message ?? 'Please try again.');
    } finally { setAddBusy(false); }
  }

  async function savePay() {
    if (!payModal) return;
    const parsed = parseFloat(payInput);
    if (Number.isNaN(parsed) || parsed < 0) return Alert.alert('Invalid rate', 'Enter a valid hourly rate.');
    setPayBusy(true);
    try {
      await apiCall('PATCH', `/api/me/team/${payModal.id}/pay`, {
        basePayCents: Math.round(parsed * 100),
        avgMpg: parseFloat(payMpg) || 25,
        vehicleNotes: payVehicle.trim() || undefined,
        phone: payPhone.trim() || undefined,
      });
      setPayModal(null);
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPayBusy(false); }
  }

  function openEdit(entry: TimeEntry) {
    setEditing(entry);
    setEditIn(entry.clockedInAt.slice(0, 16).replace('T', ' '));
    setEditOut(entry.clockedOutAt ? entry.clockedOutAt.slice(0, 16).replace('T', ' ') : '');
    setEditBrk(String(entry.breakMinutes));
    setEditNote(entry.notesByAdmin ?? '');
  }

  async function saveEdit() {
    if (!editing) return;
    setEditBusy(true);
    try {
      await apiCall('PATCH', `/api/admin/time/${editing.id}`, {
        clockedInAt: new Date(editIn.replace(' ', 'T')).toISOString(),
        clockedOutAt: editOut ? new Date(editOut.replace(' ', 'T')).toISOString() : undefined,
        breakMinutes: parseInt(editBrk) || 0,
        notesByAdmin: editNote || undefined,
      });
      setEditing(null);
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setEditBusy(false); }
  }

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: 'team', label: 'Team' },
    { key: 'timesheets', label: 'Timesheets' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'routes', label: 'Routes' },
  ];

  const activeMembers = members.filter(m => m.active);
  const removedMembers = members.filter(m => !m.active);

  const totalMiles = routes.reduce((s, r) => s + (r.distanceMiles ?? 0), 0);
  const totalGal = routes.reduce((s, r) => s + (r.gallonsUsed ?? 0), 0);
  const totalGross = payroll.reduce((s, r) => s + r.grossPayCents, 0);
  const totalMins = payroll.reduce((s, r) => s + r.workedMinutes, 0);
  const modalInput = [m.input, { borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900], backgroundColor: t.surface[50] }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface[50] }} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <Text style={[s.heading, { color: t.ink[900] }]}>Workforce</Text>
        <View style={[s.segRow, { backgroundColor: t.surface[100] }]}>
          {tabs.map(tb => {
            const on = tab === tb.key;
            return (
              <TouchableOpacity key={tb.key} style={[s.seg, on && { backgroundColor: t.surface[0] }, on && t.shadowSoft]} onPress={() => setTab(tb.key)}>
                <Text style={[s.segText, { color: on ? t.ink[900] : t.ink[500], fontWeight: on ? '700' : '500' }]}>{tb.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={t.brand.brand500} />}
      >
        {loading && !refresh ? <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 40 }} /> : null}

        {/* TEAM */}
        {tab === 'team' && !loading && (
          <>
          <TouchableOpacity
            style={[s.addStaffBtn, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]}
            onPress={() => setShowAdd(true)}
            accessibilityLabel="Add staff member"
          >
            <Ionicons name="person-add-outline" size={16} color={t.brand.onBrand} />
            <Text style={[s.addStaffText, { color: t.brand.onBrand }]}>Add staff</Text>
          </TouchableOpacity>
          {activeMembers.length === 0
            ? <Text style={[s.empty, { color: t.ink[300] }]}>No team members yet. Tap "Add staff" to invite your crew.</Text>
            : activeMembers.map(m => (
                <Card key={m.id} padding={14} style={{ marginBottom: 10, gap: 8 }}>
                  <View style={s.teamRow}>
                    <View style={[s.avatar, { backgroundColor: t.brand.brand50 }]}>
                      <Text style={[s.avatarText, { color: t.brand.brand600 }]}>{(m.fullName ?? m.user.email).charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[s.cardName, { color: t.ink[900] }]}>{m.fullName ?? m.user.email}</Text>
                        <Badge>{displayRole(m.role)}</Badge>
                      </View>
                      <Text style={[s.cardSub, { color: t.ink[300] }]}>{m.user.email}</Text>
                    </View>
                  </View>
                  {(m.employeeProfile?.basePayCents || m.employeeProfile?.phone) ? (
                    <Text style={s.payText}>
                      {m.employeeProfile?.basePayCents ? `$${(m.employeeProfile.basePayCents / 100).toFixed(2)}/hr` : ''}
                      {m.employeeProfile?.basePayCents && m.employeeProfile?.phone ? '  ·  ' : ''}
                      {m.employeeProfile?.phone ?? ''}
                    </Text>
                  ) : null}
                  <View style={s.actionRow}>
                    <TouchableOpacity style={[s.actionBtn, { borderColor: t.brand.brand100 }]} onPress={() => changeMemberRole(m)}>
                      <Ionicons name="swap-horizontal-outline" size={14} color={t.brand.brand600} />
                      <Text style={[s.actionBtnText, { color: t.brand.brand600 }]}>Role</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.actionBtn, { borderColor: t.brand.brand100 }]}
                      onPress={() => {
                        setPayModal(m);
                        setPayInput(m.employeeProfile ? String(m.employeeProfile.basePayCents / 100) : '');
                        setPayMpg(m.employeeProfile?.avgMpg != null ? String(m.employeeProfile.avgMpg) : '25');
                        setPayVehicle(m.employeeProfile?.vehicleNotes ?? '');
                        setPayPhone(m.employeeProfile?.phone ?? '');
                      }}
                    >
                      <Ionicons name="cash-outline" size={14} color={t.brand.brand600} />
                      <Text style={[s.actionBtnText, { color: t.brand.brand600 }]}>Set pay</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actionBtn, { borderColor: '#fecaca' }]} onPress={() => removeMember(m)}>
                      <Ionicons name="person-remove-outline" size={14} color="#dc2626" />
                      <Text style={[s.actionBtnText, { color: '#dc2626' }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))}

          {/* Removed members — permanently deletable */}
          {removedMembers.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={[s.removedLabel, { color: t.ink[500] }]}>REMOVED ({removedMembers.length})</Text>
              {removedMembers.map(m => (
                <View key={m.id} style={[s.removedRow, { backgroundColor: t.surface[0], borderColor: t.surface[200] }]}>
                  <Text style={[s.removedName, { color: t.ink[500] }]} numberOfLines={1}>
                    {m.fullName ?? m.user.email} · {displayRole(m.role)}
                  </Text>
                  <TouchableOpacity onPress={() => permanentDelete(m)} hitSlop={6}>
                    <Text style={[s.removedDelete, { color: '#dc2626' }]}>Delete permanently</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          </>
        )}

        {/* TIMESHEETS */}
        {tab === 'timesheets' && !loading && (
          entries.length === 0
            ? <Text style={[s.empty, { color: t.ink[300] }]}>No shifts this week.</Text>
            : entries.map(e => (
                <Card key={e.id} padding={14} style={[{ marginBottom: 10 }, e.status === 'ACTIVE' && { borderLeftWidth: 3, borderLeftColor: '#22c55e' }]}>
                  <View style={s.cardRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.cardName, { color: t.ink[900] }]}>{e.membership.fullName ?? e.membership.user.email}</Text>
                      <Text style={[s.cardSub, { color: t.ink[300] }]}>{fmtDate(e.clockedInAt)}{e.status === 'ACTIVE' ? ' · live' : ''}</Text>
                    </View>
                    <Text style={[s.cardDur, { color: t.ink[900] }]}>{e.clockedOutAt ? fmtDur(e.clockedInAt, e.clockedOutAt, e.breakMinutes) : '—'}</Text>
                  </View>
                  <Text style={[s.cardTimes, { color: t.ink[500] }]}>{fmtTime(e.clockedInAt)} → {e.clockedOutAt ? fmtTime(e.clockedOutAt) : 'active'}</Text>
                  {e.notesByAdmin && <Text style={[s.note, { color: t.brand.brand600 }]}>Admin: {e.notesByAdmin}</Text>}
                  <TouchableOpacity style={s.editBtn} onPress={() => openEdit(e)}>
                    <Ionicons name="create-outline" size={14} color={t.brand.brand600} />
                    <Text style={[s.editBtnText, { color: t.brand.brand600 }]}>Edit</Text>
                  </TouchableOpacity>
                </Card>
              ))
        )}

        {/* PAYROLL */}
        {tab === 'payroll' && !loading && (
          <>
            <View style={s.summaryRow}>
              <SumBox t={t} label="Total payroll" value={fmt$(totalGross)} />
              <SumBox t={t} label="Hours" value={`${Math.floor(totalMins / 60)}h`} />
            </View>
            {payroll.length === 0
              ? <Text style={[s.empty, { color: t.ink[300] }]}>No payroll data this month.</Text>
              : payroll.map(r => (
                  <Card key={r.membershipId} padding={14} style={{ marginBottom: 10 }}>
                    <View style={s.cardRow}>
                      <Text style={[s.cardName, { color: t.ink[900] }]}>{r.name}</Text>
                      <Text style={[s.cardDur, { color: t.ink[900] }]}>{fmt$(r.grossPayCents)}</Text>
                    </View>
                    <Text style={[s.cardSub, { color: t.ink[300] }]}>{r.entryCount} shifts · {Math.floor(r.workedMinutes / 60)}h worked · {fmt$(r.basePayCents)}/hr</Text>
                  </Card>
                ))}
          </>
        )}

        {/* ROUTES */}
        {tab === 'routes' && !loading && (
          <>
            <TouchableOpacity
              style={[s.dashLink, { backgroundColor: t.brand.brand50 }]}
              onPress={() => router.push('/(admin)/routes' as any)}
            >
              <Ionicons name="git-branch-outline" size={16} color={t.brand.brand600} />
              <Text style={[s.dashLinkText, { color: t.brand.brand600 }]}>Open routes dashboard (planned · running · completed) →</Text>
            </TouchableOpacity>
            <View style={s.summaryRow}>
              <SumBox t={t} label="Total miles" value={totalMiles.toFixed(1)} />
              <SumBox t={t} label="Gallons" value={totalGal.toFixed(2)} />
            </View>
            {routes.length === 0
              ? <Text style={[s.empty, { color: t.ink[300] }]}>No routes this week.</Text>
              : routes.map(r => (
                  <Card key={r.id} padding={14} style={{ marginBottom: 10 }}>
                    <View style={s.cardRow}>
                      <Text style={[s.cardName, { color: t.ink[900] }]}>{r.membership.fullName ?? r.membership.user.email}</Text>
                      <Text style={[s.cardDur, { color: t.ink[900] }]}>{r.distanceMiles != null ? `${r.distanceMiles.toFixed(1)} mi` : 'live'}</Text>
                    </View>
                    <Text style={[s.cardSub, { color: t.ink[300] }]}>{fmtDate(r.startedAt)}{r.endedAt ? ' · complete' : ' · tracking…'}</Text>
                    {r.gallonsUsed != null && <Text style={[s.cardSub, { color: t.ink[300] }]}>{r.gallonsUsed.toFixed(2)} gal used · {r._count.waypoints} points</Text>}
                  </Card>
                ))}
          </>
        )}
      </ScrollView>

      {/* Add-staff modal */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[m.title, { color: t.ink[900] }]}>Add staff member</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[m.label, { color: t.ink[700] }]}>First name</Text>
                <TextInput style={modalInput} value={addFirst} onChangeText={setAddFirst} placeholder="Jane" autoCapitalize="words" placeholderTextColor={t.ink[300]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[m.label, { color: t.ink[700] }]}>Last name</Text>
                <TextInput style={modalInput} value={addLast} onChangeText={setAddLast} placeholder="Smith" autoCapitalize="words" placeholderTextColor={t.ink[300]} />
              </View>
            </View>
            <Text style={[m.label, { color: t.ink[700] }]}>Email</Text>
            <TextInput style={modalInput} value={addEmail} onChangeText={setAddEmail} placeholder="jane@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Phone</Text>
            <TextInput style={modalInput} value={addPhone} onChangeText={setAddPhone} placeholder="(801) 555-0100" keyboardType="phone-pad" placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Role</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['STAFF', 'OWNER'] as const).map(r => {
                const on = addRole === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[s.roleBtn, { backgroundColor: on ? t.brand.brand50 : t.surface[50], borderColor: on ? t.brand.brand500 : t.surface[200], borderRadius: t.radius }]}
                    onPress={() => setAddRole(r)}
                  >
                    <Text style={{ fontSize: 14, fontWeight: on ? '700' : '500', color: on ? t.brand.brand600 : t.ink[700] }}>
                      {r === 'STAFF' ? 'Staff' : 'Admin'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[s.addNote, { color: t.ink[300] }]}>
              New hires get an email to set their password; existing accounts are added immediately.
            </Text>
            <View style={m.row}>
              <TouchableOpacity style={[m.cancel, { backgroundColor: t.surface[100], borderRadius: t.radius }]} onPress={() => setShowAdd(false)}>
                <Text style={[m.cancelText, { color: t.ink[700] }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[m.confirm, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={addStaff} disabled={addBusy}>
                <Text style={[m.confirmText, { color: t.brand.onBrand }]}>{addBusy ? 'Adding…' : 'Add staff'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pay modal (team) */}
      <Modal visible={!!payModal} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[m.title, { color: t.ink[900] }]}>Pay &amp; vehicle</Text>
            <Text style={[s.cardSub, { color: t.ink[300] }]}>{payModal?.fullName ?? payModal?.user.email}</Text>
            <Text style={[m.label, { color: t.ink[700] }]}>Rate ($/hr)</Text>
            <TextInput style={modalInput} value={payInput} onChangeText={setPayInput} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Avg MPG</Text>
            <TextInput style={modalInput} value={payMpg} onChangeText={setPayMpg} keyboardType="decimal-pad" placeholder="25" placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Vehicle (optional)</Text>
            <TextInput style={modalInput} value={payVehicle} onChangeText={setPayVehicle} placeholder="e.g. 2020 Toyota Camry" placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Phone (optional)</Text>
            <TextInput style={modalInput} value={payPhone} onChangeText={setPayPhone} keyboardType="phone-pad" placeholder="(801) 555-0100" placeholderTextColor={t.ink[300]} />
            <View style={m.row}>
              <TouchableOpacity style={[m.cancel, { backgroundColor: t.surface[100], borderRadius: t.radius }]} onPress={() => setPayModal(null)}>
                <Text style={[m.cancelText, { color: t.ink[700] }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[m.confirm, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={savePay} disabled={payBusy}>
                <Text style={[m.confirmText, { color: t.brand.onBrand }]}>{payBusy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editing} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[m.title, { color: t.ink[900] }]}>Edit time entry</Text>
            <Text style={[m.label, { color: t.ink[700] }]}>Clock in (YYYY-MM-DD HH:MM)</Text>
            <TextInput style={modalInput} value={editIn} onChangeText={setEditIn} placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Clock out</Text>
            <TextInput style={modalInput} value={editOut} onChangeText={setEditOut} placeholder="leave blank if active" placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Break (minutes)</Text>
            <TextInput style={modalInput} value={editBrk} onChangeText={setEditBrk} keyboardType="number-pad" placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Admin note</Text>
            <TextInput style={[modalInput, { height: 60, textAlignVertical: 'top' }]} value={editNote} onChangeText={setEditNote} multiline placeholderTextColor={t.ink[300]} />
            <View style={m.row}>
              <TouchableOpacity style={[m.cancel, { backgroundColor: t.surface[100], borderRadius: t.radius }]} onPress={() => setEditing(null)}><Text style={[m.cancelText, { color: t.ink[700] }]}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[m.confirm, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={saveEdit} disabled={editBusy}>
                <Text style={[m.confirmText, { color: t.brand.onBrand }]}>{editBusy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SumBox({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={[sb.box, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft]}>
      <Text style={[sb.val, { color: t.ink[900] }]}>{value}</Text>
      <Text style={[sb.lbl, { color: t.ink[300] }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 16, borderBottomWidth: 1 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  segRow: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 2 },
  seg: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  segText: { fontSize: 13 },
  content: { padding: 16, paddingBottom: 40 },
  dashLink: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  dashLinkText: { fontSize: 13, fontWeight: '700', flex: 1 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardName: { fontSize: 14, fontWeight: '600' },
  cardSub: { fontSize: 12 },
  cardTimes: { fontSize: 12, marginBottom: 4 },
  cardDur: { fontSize: 16, fontWeight: '700' },
  note: { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  editBtnText: { fontSize: 13, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40 },
  // Team tab (moved from the Business tab)
  addStaffBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 12 },
  addStaffText: { fontSize: 14, fontWeight: '700' },
  roleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderWidth: 1.5 },
  addNote: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700' },
  payText: { fontSize: 13, color: '#059669', fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
  removedLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  removedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  removedName: { fontSize: 13, flex: 1 },
  removedDelete: { fontSize: 12, fontWeight: '700' },
});
const sb = StyleSheet.create({
  box: { flex: 1, padding: 14, alignItems: 'center' },
  val: { fontSize: 22, fontWeight: '700' },
  lbl: { fontSize: 12, marginTop: 2 },
});
const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, padding: 12, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirm: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '600' },
});
