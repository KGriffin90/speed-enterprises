// Lives under (platform) — the public group — because the AR measure flow is
// reachable both from the authed customer wizard and the signed-out public
// quote flow; (customer) is session-guarded.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing,
  TextInput, Modal, Platform, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Camera } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import {
  type PaneInfo, type OverallInfo, type WindowEntry,
  getWindowEntries, setWindowEntries,
} from '@/lib/window-entries';

// Lazy-import the native view so the JS bundle doesn't crash on Android/web
let ARWindowMeasureView: any = null;
try {
  ARWindowMeasureView = require('ar-window-measure').ARWindowMeasureView;
} catch {}

// ── Local types ──────────────────────────────────────────────────────────────

interface Measurement {
  widthInches: number; heightInches: number;
  widthDisplay: string; heightDisplay: string;
  widthFeet: number;   heightFeet: number;
  paneCount?: number;
  shapeType?: 'rectangular' | 'custom';
  panes?: PaneInfo[];
  overall?: OverallInfo;
}

// ── Phase type ───────────────────────────────────────────────────────────────

type Phase =
  | 'permission'   // asking for camera
  | 'detecting'    // auto Vision scan running
  | 'shaky'        // user is moving too much
  | 'manual'       // tap 4 corners
  | 'measured'     // dimensions captured — preview before accepting
  | 'accepting'    // quantity modal (entries mode)
  | 'confirm';     // legacy confirm sheet (non-entries mode)

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ARMeasureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ questionId: string; mode?: string }>();

  // "entries" mode = multi-window accumulation flow (window cleaning).
  // Legacy mode = single measurement → save to __arMeasureResult → back.
  const entriesMode = params.mode === 'entries';

  // ── Core state ─────────────────────────────────────────────────────────────
  const [phase,           setPhase]           = useState<Phase>('permission');
  const [hasPermission,   setHasPermission]   = useState(false);
  const [unsupported,     setUnsupported]     = useState(false);
  const [mode,            setMode]            = useState<'auto' | 'manual'>('auto');
  const [command,         setCommand]         = useState<any>(null);
  const [cornerCount,     setCornerCount]     = useState(0);
  const [sampleCount,     setSampleCount]     = useState(0);
  const [detectedPanes,   setDetectedPanes]   = useState(0);

  // The most recently captured measurement (set when Vision fires).
  const [pendingMeasurement, setPendingMeasurement] = useState<Measurement | null>(null);

  // Entries mode: accumulated window list (persisted in the shared global so the
  // quote wizard can read it back when this screen pops).
  const [windowEntries, setEntries] = useState<WindowEntry[]>(() => getWindowEntries());

  // Accepting modal inputs (entries mode).
  const [editW, setEditW] = useState('');
  const [editH, setEditH] = useState('');
  const [quantity, setQuantity] = useState('1');

  // Legacy mode edit fields.
  const [legacyEditW, setLegacyEditW] = useState('');
  const [legacyEditH, setLegacyEditH] = useState('');

  // Steadiness bar animation.
  const steadyAnim = useRef(new Animated.Value(0)).current;
  // Scan ring pulse.
  const pulseAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ── Camera permission ───────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      router.back();
      return;
    }
    Camera.requestCameraPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        setHasPermission(true);
        setPhase('detecting');
      } else {
        router.back();
      }
    });
  }, []);

  // ── Native event handlers ───────────────────────────────────────────────────

  const handleDetected = useCallback((e: any) => {
    const { detected, paneCount } = e.nativeEvent;
    if (paneCount !== undefined && paneCount > 0) setDetectedPanes(paneCount as number);
    if (detected && phase !== 'measured' && phase !== 'accepting' && phase !== 'confirm') {
      setPhase('measured');
    }
  }, [phase]);

  const handleSteadiness = useCallback((e: any) => {
    const { stable, movement, sampleCount: sc } = e.nativeEvent;
    Animated.timing(steadyAnim, { toValue: 1 - movement, duration: 150, useNativeDriver: false }).start();
    if (sc !== undefined) setSampleCount(sc as number);
    if (!stable && phase === 'detecting') setPhase('shaky');
    if (stable  && phase === 'shaky')    setPhase('detecting');
  }, [phase]);

  const handleMeasurement = useCallback((e: any) => {
    const m = e.nativeEvent as Measurement;
    setPendingMeasurement(m);
    const overall = m.overall;
    const wIn = (overall?.widthInches  ?? m.widthInches).toFixed(1);
    const hIn = (overall?.heightInches ?? m.heightInches).toFixed(1);
    if (entriesMode) {
      setEditW(wIn);
      setEditH(hIn);
      setQuantity('1');
      setPhase('measured');
    } else {
      setLegacyEditW(wIn);
      setLegacyEditH(hIn);
      setPhase('measured');
    }
  }, [entriesMode]);

  const handleCornerAdded = useCallback((e: any) => {
    const { count } = e.nativeEvent;
    setCornerCount(count);
  }, []);

  const handleError = useCallback((e: any) => {
    const { message } = e.nativeEvent;
    if (message === 'auto_timeout') offerManual();
    else if (message === 'unsupported') setUnsupported(true);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  function offerManual() {
    // Silently switch to manual rather than showing an Alert — cleaner UX.
    startManual();
  }

  function startManual() {
    setMode('manual');
    setCornerCount(0);
    setSampleCount(0);
    setDetectedPanes(0);
    setPhase('manual');
    setCommand({ type: 'reset' });
    setTimeout(() => setCommand(null), 100);
  }

  function resetAll() {
    setMode('auto');
    setCornerCount(0);
    setSampleCount(0);
    setDetectedPanes(0);
    setPendingMeasurement(null);
    setPhase('detecting');
    setCommand({ type: 'reset' });
    setTimeout(() => setCommand(null), 100);
  }

  // ── Entries mode: accept + add to list ────────────────────────────────────

  function openAccepting() {
    setPhase('accepting');
  }

  function addEntry() {
    const m = pendingMeasurement;
    if (!m) return;

    const wIn = parseFloat(editW) || (m.overall?.widthInches ?? m.widthInches);
    const hIn = parseFloat(editH) || (m.overall?.heightInches ?? m.heightInches);
    const qty  = Math.max(1, parseInt(quantity) || 1);

    const entry: WindowEntry = {
      id:           Date.now().toString(),
      widthInches:  wIn,
      heightInches: hIn,
      widthDisplay: `${wIn.toFixed(1)}"`,
      heightDisplay:`${hIn.toFixed(1)}"`,
      count:        qty,
      paneCount:    m.paneCount ?? 1,
      shapeType:    m.shapeType ?? 'rectangular',
      panes:        m.panes,
      overall:      m.overall,
      method:       'ar',
    };

    const next = [...windowEntries, entry];
    setEntries(next);
    setWindowEntries(next);
    resetAll();
  }

  function removeEntry(id: string) {
    const next = windowEntries.filter(e => e.id !== id);
    setEntries(next);
    setWindowEntries(next);
  }

  function adjustQty(delta: number) {
    setQuantity(q => String(Math.max(1, (parseInt(q) || 1) + delta)));
  }

  // ── Legacy mode: save single measurement ─────────────────────────────────

  function saveLegacyMeasurement() {
    const m = pendingMeasurement;
    if (!m) return;

    const isMulti = (m.paneCount ?? 1) > 1;
    const wIn = parseFloat(legacyEditW) || (m.overall?.widthInches ?? m.widthInches);
    const hIn = parseFloat(legacyEditH) || (m.overall?.heightInches ?? m.heightInches);

    const summary = isMulti
      ? `${m.paneCount} panes — Overall: ${m.overall?.widthDisplay ?? `${wIn.toFixed(1)}"`} × ${m.overall?.heightDisplay ?? `${hIn.toFixed(1)}"`} — Perimeter: ${m.overall?.perimeterDisplay ?? 'n/a'}`
      : (m.shapeType === 'custom'
          ? `Custom shape: ~${wIn.toFixed(1)}" × ${hIn.toFixed(1)}" — Perimeter: ${m.overall?.perimeterDisplay ?? 'n/a'}`
          : `${wIn.toFixed(1)}" W × ${hIn.toFixed(1)}" H`);

    (global as any).__arMeasureResult = {
      questionId:   params.questionId,
      widthInches:  wIn,
      heightInches: hIn,
      widthFeet:    wIn / 12,
      heightFeet:   hIn / 12,
      paneCount:    m.paneCount ?? 1,
      shapeType:    m.shapeType ?? 'rectangular',
      panes:        m.panes ?? [],
      overall:      m.overall ?? null,
      summary,
    };
    router.back();
  }

  // ── Unsupported / permission fallbacks ────────────────────────────────────

  if (!ARWindowMeasureView || unsupported) {
    return (
      <View style={s.fallback}>
        <Ionicons name="cube-outline" size={48} color="#4f46e5" />
        <Text style={s.fallbackTitle}>
          {!ARWindowMeasureView ? 'Native build required' : 'AR not supported on this device'}
        </Text>
        <Text style={s.fallbackSub}>
          {!ARWindowMeasureView
            ? 'Run `npx expo prebuild --platform ios` then build with Xcode.'
            : 'Measure with a tape measure and enter dimensions manually.'}
        </Text>
        <TouchableOpacity style={s.fallbackBtn} onPress={() => router.back()}>
          <Text style={s.fallbackBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!hasPermission || phase === 'permission') {
    return (
      <View style={s.fallback}>
        <Ionicons name="camera-outline" size={48} color="#4f46e5" />
        <Text style={s.fallbackTitle}>Requesting camera…</Text>
      </View>
    );
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalEntryCount = windowEntries.reduce((sum, e) => sum + e.count, 0);
  const isMultiPane   = (pendingMeasurement?.paneCount ?? 1) > 1;
  const isCustomShape = pendingMeasurement?.shapeType === 'custom';

  const dimLabel = (() => {
    if (!pendingMeasurement) return '';
    const wIn = parseFloat(editW) || (pendingMeasurement.overall?.widthInches ?? pendingMeasurement.widthInches);
    const hIn = parseFloat(editH) || (pendingMeasurement.overall?.heightInches ?? pendingMeasurement.heightInches);
    if (isMultiPane) return `${pendingMeasurement.paneCount} panes · ${pendingMeasurement.overall?.widthDisplay} × ${pendingMeasurement.overall?.heightDisplay}`;
    if (isCustomShape) return `~${wIn.toFixed(1)}" × ${hIn.toFixed(1)}" (custom)`;
    return `${wIn.toFixed(1)}" × ${hIn.toFixed(1)}"`;
  })();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* AR camera + overlay */}
      <ARWindowMeasureView
        style={StyleSheet.absoluteFill}
        mode={mode}
        command={command}
        onDetected={handleDetected}
        onSteadiness={handleSteadiness}
        onMeasurement={handleMeasurement}
        onCornerAdded={handleCornerAdded}
        onError={handleError}
        onReady={() => {}}
      />

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <View style={s.topBar}>
        <TouchableOpacity style={s.topBtn} onPress={() => router.back()} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        {/* Entries count chip */}
        {entriesMode && windowEntries.length > 0 && (
          <View style={s.entriesChip}>
            <Ionicons name="checkmark-circle" size={14} color="#4ade80" />
            <Text style={s.entriesChipText}>
              {windowEntries.length} size{windowEntries.length !== 1 ? 's' : ''} · {totalEntryCount} window{totalEntryCount !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {/* Done button (entries mode) */}
        {entriesMode && (
          <TouchableOpacity
            style={[s.doneBtn, windowEntries.length === 0 && s.doneBtnDisabled]}
            onPress={() => router.back()}
            disabled={windowEntries.length === 0}
          >
            <Text style={[s.doneBtnText, windowEntries.length === 0 && s.doneBtnTextDisabled]}>
              {windowEntries.length > 0 ? `Done (${totalEntryCount})` : 'Done'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Steadiness bar ───────────────────────────────────────── */}
      {(phase === 'detecting' || phase === 'shaky') && (
        <View style={s.steadyBar}>
          <Ionicons name="body-outline" size={15} color="rgba(255,255,255,0.8)" />
          <View style={s.steadyTrack}>
            <Animated.View style={[s.steadyFill, {
              width: steadyAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }]} />
          </View>
          <Text style={s.steadyLabel}>{phase === 'shaky' ? 'Hold still' : 'Scanning'}</Text>
        </View>
      )}

      {/* ── Detecting HUD ────────────────────────────────────────── */}
      {/* Render for both 'detecting' and 'shaky' so the frame stays put while
          the camera moves — steadiness is reflected in the thin bar above,
          not by tearing the whole overlay down (which felt jittery). */}
      {(phase === 'detecting' || phase === 'shaky') && (
        <>
          {/* Centered reticle — a calm target the user points at the pane. */}
          <View style={s.reticleWrap} pointerEvents="none">
            <Animated.View
              style={[
                s.reticle,
                sampleCount > 0 && s.reticleLocking,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
          </View>

          {/* Single status line at the bottom-center. */}
          <View style={s.statusWrap} pointerEvents="box-none">
            <Text style={s.hudTitle}>
              {sampleCount > 0
                ? `Locking on… ${sampleCount}/3${detectedPanes > 1 ? ` · ${detectedPanes} panes` : ''}`
                : 'Point at a window'}
            </Text>
            <Text style={s.hudSub}>
              {sampleCount > 0 ? 'Hold steady — almost there' : 'Stand back, face it straight on'}
            </Text>
            {sampleCount > 0 && (
              <View style={s.sampleDots}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={[s.sampleDot, i < sampleCount ? s.sampleDotOn : s.sampleDotOff]} />
                ))}
              </View>
            )}
            <TouchableOpacity style={s.manualLink} onPress={startManual}>
              <Text style={s.manualLinkText}>Enter corners manually instead</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── Manual corner HUD ────────────────────────────────────── */}
      {phase === 'manual' && (
        <View style={s.manualHud} pointerEvents="none">
          <View style={s.manualPill}>
            <Text style={s.manualTitle}>Tap corner {cornerCount + 1} of 4</Text>
            <Text style={s.manualSub}>
              {['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][cornerCount] ?? ''}
            </Text>
          </View>
          <View style={s.dotRow}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[s.manualDot, i < cornerCount && s.manualDotDone]} />
            ))}
          </View>
        </View>
      )}

      {/* ── Measured card ────────────────────────────────────────── */}
      {phase === 'measured' && pendingMeasurement && (
        <View style={s.card}>
          {/* Shape badge */}
          {isMultiPane && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{pendingMeasurement.paneCount} panes</Text>
            </View>
          )}
          {isCustomShape && (
            <View style={[s.badge, s.badgePurple]}>
              <Text style={[s.badgeText, s.badgeTextPurple]}>Custom shape</Text>
            </View>
          )}

          {/* Dimension display */}
          <Text style={s.dimLabel}>{dimLabel}</Text>

          {isMultiPane && pendingMeasurement.panes && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.paneRow}>
              {pendingMeasurement.panes.map(p => (
                <View key={p.index} style={s.paneChip}>
                  <Text style={s.paneChipNum}>{p.index + 1}</Text>
                  <Text style={s.paneChipDim}>{p.widthDisplay} × {p.heightDisplay}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={s.cardActions}>
            <TouchableOpacity style={s.retakeBtn} onPress={resetAll}>
              <Ionicons name="refresh-outline" size={17} color="#fff" />
              <Text style={s.retakeBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.acceptBtn}
              onPress={entriesMode ? openAccepting : () => setPhase('confirm')}
            >
              <Ionicons name="checkmark" size={17} color="#fff" />
              <Text style={s.acceptBtnText}>
                {entriesMode ? 'Accept →' : 'Use dimensions'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Accumulated entries list (entries mode, while scanning) ─ */}
      {entriesMode && (phase === 'detecting' || phase === 'shaky') && windowEntries.length > 0 && (
        <View style={s.entriesList}>
          {windowEntries.map((e, idx) => (
            <View key={e.id} style={s.entryRow}>
              <View style={s.entryNum}>
                <Text style={s.entryNumText}>{idx + 1}</Text>
              </View>
              <Text style={s.entryDims}>{e.widthDisplay} × {e.heightDisplay}</Text>
              <Text style={s.entryCount}>×{e.count}</Text>
              <TouchableOpacity onPress={() => removeEntry(e.id)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ── Accepting modal (entries mode) ───────────────────────── */}
      <Modal visible={phase === 'accepting'} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <Text style={m.title}>How many of this window?</Text>

            {isMultiPane && (
              <View style={m.badgeRow}>
                <View style={m.badge}>
                  <Text style={m.badgeText}>{pendingMeasurement?.paneCount} panes · rectangular</Text>
                </View>
              </View>
            )}
            {isCustomShape && (
              <View style={m.badgeRow}>
                <View style={[m.badge, { backgroundColor: '#f3e8ff' }]}>
                  <Text style={[m.badgeText, { color: '#7c3aed' }]}>Custom shape</Text>
                </View>
              </View>
            )}

            <Text style={m.subLabel}>Adjust dimensions if needed:</Text>
            <View style={m.dimRow}>
              <View style={m.dimField}>
                <Text style={m.dimFieldLabel}>Width (inches)</Text>
                <TextInput
                  style={m.dimInput}
                  value={editW}
                  onChangeText={setEditW}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
              <Text style={m.dimX}>×</Text>
              <View style={m.dimField}>
                <Text style={m.dimFieldLabel}>Height (inches)</Text>
                <TextInput
                  style={m.dimInput}
                  value={editH}
                  onChangeText={setEditH}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
            </View>

            {editW && editH && (
              <Text style={m.equiv}>
                {(parseFloat(editW) / 12).toFixed(1)} ft × {(parseFloat(editH) / 12).toFixed(1)} ft
              </Text>
            )}

            <Text style={m.countLabel}>Number of windows this size:</Text>
            <View style={m.stepper}>
              <TouchableOpacity style={m.stepBtn} onPress={() => adjustQty(-1)}>
                <Text style={m.stepBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={m.stepInput}
                value={quantity}
                onChangeText={v => setQuantity(v.replace(/[^0-9]/g, '') || '1')}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <TouchableOpacity style={m.stepBtn} onPress={() => adjustQty(1)}>
                <Text style={m.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={m.actions}>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setPhase('measured')}>
                <Text style={m.cancelText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.addBtn} onPress={addEntry}>
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={m.addText}>Add to list</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Legacy confirm modal (non-entries mode) ──────────────── */}
      <Modal visible={phase === 'confirm'} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <Text style={m.title}>Confirm dimensions</Text>

            {isMultiPane && pendingMeasurement?.panes && (
              <>
                <View style={m.badgeRow}>
                  <View style={m.badge}>
                    <Text style={m.badgeText}>{pendingMeasurement.paneCount} panes · rectangular</Text>
                  </View>
                </View>
                {pendingMeasurement.overall && (
                  <View style={m.overallBox}>
                    <Text style={m.overallLabel}>Overall</Text>
                    <Text style={m.overallValue}>{pendingMeasurement.overall.widthDisplay} × {pendingMeasurement.overall.heightDisplay}</Text>
                    <Text style={m.overallSub}>{pendingMeasurement.overall.perimeterDisplay} perimeter</Text>
                  </View>
                )}
                <Text style={m.subLabel}>Adjust overall dimensions if needed:</Text>
              </>
            )}
            {!isMultiPane && !isCustomShape && <Text style={m.subLabel}>Review and adjust if needed:</Text>}
            {isCustomShape && !isMultiPane && (
              <>
                {pendingMeasurement?.overall && (
                  <View style={m.overallBox}>
                    <Text style={m.overallLabel}>Detected perimeter</Text>
                    <Text style={m.overallValue}>{pendingMeasurement.overall.perimeterDisplay}</Text>
                    <Text style={m.overallSub}>Bounding box: {pendingMeasurement.overall.widthDisplay} × {pendingMeasurement.overall.heightDisplay}</Text>
                  </View>
                )}
                <Text style={m.subLabel}>Adjust bounding box if needed:</Text>
              </>
            )}

            <View style={m.dimRow}>
              <View style={m.dimField}>
                <Text style={m.dimFieldLabel}>Width (inches)</Text>
                <TextInput style={m.dimInput} value={legacyEditW} onChangeText={setLegacyEditW} keyboardType="decimal-pad" selectTextOnFocus />
              </View>
              <Text style={m.dimX}>×</Text>
              <View style={m.dimField}>
                <Text style={m.dimFieldLabel}>Height (inches)</Text>
                <TextInput style={m.dimInput} value={legacyEditH} onChangeText={setLegacyEditH} keyboardType="decimal-pad" selectTextOnFocus />
              </View>
            </View>
            {legacyEditW && legacyEditH && (
              <Text style={m.equiv}>
                {(parseFloat(legacyEditW) / 12).toFixed(1)} ft × {(parseFloat(legacyEditH) / 12).toFixed(1)} ft
              </Text>
            )}

            <View style={m.actions}>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setPhase('measured')}>
                <Text style={m.cancelText}>Edit more</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.addBtn} onPress={saveLegacyMeasurement}>
                <Text style={m.addText}>Save to quote</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#000' },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#f9fafb', gap: 12 },
  fallbackTitle: { fontSize: 20, fontWeight: '700', color: '#111', textAlign: 'center' },
  fallbackSub:   { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  fallbackBtn:   { marginTop: 8, backgroundColor: '#4f46e5', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  fallbackBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Top bar
  topBar:   { position: 'absolute', top: 52, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10, zIndex: 20 },
  topBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  entriesChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(74,222,128,0.4)' },
  entriesChipText: { fontSize: 12, fontWeight: '600', color: '#4ade80' },
  doneBtn:   { backgroundColor: '#4f46e5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  doneBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.15)' },
  doneBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  doneBtnTextDisabled: { color: 'rgba(255,255,255,0.4)' },

  // Steadiness bar
  steadyBar:   { position: 'absolute', top: 98, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  steadyTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  steadyFill:  { height: '100%', backgroundColor: '#22c55e', borderRadius: 2 },
  steadyLabel: { fontSize: 11, color: '#fff', fontWeight: '600', minWidth: 48 },

  // Detecting HUD — centered reticle + a single status block lower down
  reticleWrap:  { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  reticle:      { width: 200, height: 200, borderRadius: 20, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)' },
  reticleLocking: { borderColor: '#f97316' },
  statusWrap:   { position: 'absolute', left: 0, right: 0, bottom: 140, alignItems: 'center', gap: 6 },
  hudTitle:     { fontSize: 17, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  hudSub:       { fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center', paddingHorizontal: 40, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  sampleDots:   { flexDirection: 'row', gap: 10, marginTop: 4 },
  sampleDot:    { width: 10, height: 10, borderRadius: 5 },
  sampleDotOn:  { backgroundColor: '#f97316' },
  sampleDotOff: { backgroundColor: 'rgba(255,255,255,0.25)' },
  manualLink:   { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  manualLinkText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecorationLine: 'underline' },

  // Manual HUD
  manualHud:   { position: 'absolute', top: 110, left: 0, right: 0, alignItems: 'center', gap: 12 },
  manualPill:  { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center', gap: 2 },
  manualTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  manualSub:   { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  dotRow:      { flexDirection: 'row', gap: 8 },
  manualDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.3)' },
  manualDotDone: { backgroundColor: '#4ade80' },

  // Measurement card
  card:        { position: 'absolute', bottom: 36, left: 16, right: 16, backgroundColor: 'rgba(10,10,10,0.88)', borderRadius: 20, padding: 18, gap: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  badge:       { alignSelf: 'flex-start', backgroundColor: '#dbeafe', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  badgePurple: { backgroundColor: '#f3e8ff' },
  badgeText:   { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  badgeTextPurple: { color: '#7c3aed' },
  dimLabel:    { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  paneRow:     { gap: 8 },
  paneChip:    { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', gap: 2 },
  paneChipNum: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' },
  paneChipDim: { fontSize: 14, fontWeight: '700', color: '#fff' },
  cardActions: { flexDirection: 'row', gap: 10 },
  retakeBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingVertical: 12 },
  retakeBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  acceptBtn:   { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 12 },
  acceptBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Entries list (shown while detecting after adding windows)
  entriesList: { position: 'absolute', bottom: 36, left: 16, right: 16, backgroundColor: 'rgba(10,10,10,0.88)', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, gap: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  entryRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  entryNum:    { width: 22, height: 22, borderRadius: 11, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
  entryNumText:{ fontSize: 11, fontWeight: '700', color: '#fff' },
  entryDims:   { flex: 1, fontSize: 14, fontWeight: '600', color: '#fff' },
  entryCount:  { fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: '600', minWidth: 28, textAlign: 'right' },
});

const m = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, paddingBottom: 40 },
  title:       { fontSize: 20, fontWeight: '700', color: '#111' },
  subLabel:    { fontSize: 13, color: '#9ca3af' },
  badgeRow:    { flexDirection: 'row' },
  badge:       { backgroundColor: '#dbeafe', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText:   { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  overallBox:  { backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, gap: 2 },
  overallLabel:{ fontSize: 11, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  overallValue:{ fontSize: 18, fontWeight: '800', color: '#111' },
  overallSub:  { fontSize: 12, color: '#9ca3af' },

  // Dimension inputs
  dimRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  dimField:    { flex: 1, gap: 4 },
  dimFieldLabel: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  dimInput:    { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 20, fontWeight: '700', color: '#111', textAlign: 'center', backgroundColor: '#fafafa' },
  dimX:        { fontSize: 18, fontWeight: '700', color: '#9ca3af', paddingBottom: 12 },
  equiv:       { textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: -6 },

  // Count stepper
  countLabel:  { fontSize: 14, fontWeight: '600', color: '#374151' },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn:     { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#e5e7eb' },
  stepBtnText: { fontSize: 22, fontWeight: '700', color: '#374151', lineHeight: 28 },
  stepInput:   { flex: 1, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, fontSize: 22, fontWeight: '700', color: '#111', textAlign: 'center', backgroundColor: '#fafafa' },

  // Actions
  actions:     { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:   { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText:  { fontSize: 15, fontWeight: '600', color: '#374151' },
  addBtn:      { flex: 2, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  addText:     { fontSize: 15, fontWeight: '700', color: '#fff' },
});
