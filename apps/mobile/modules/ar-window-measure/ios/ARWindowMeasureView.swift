import ExpoModulesCore
import ARKit
import Vision
import SceneKit
import UIKit

// ── Constants ──────────────────────────────────────────────────────────────
//
// Tuned constants (speed vs accuracy comments preserved from previous pass):
//   kStableFramesNeeded   8   — ~133 ms of steady hold before first attempt
//   kFramesBetweenAttempts 3  — 50 ms gap; detectionInFlight prevents pile-up
//   kAutoDetectTimeout    7   — faster failure + offer-manual path
//
// Multi-pane additions:
//   kMaxPanesPerWindow    8   — up to 8 individual panes returned by Vision
//   kNMSIoUThreshold     0.50 — suppress a rect only when >50% overlap with
//                               a higher-scoring rect, so 3 side-by-side panes
//                               (each ~33% of overall window) all survive
//   kMinContourBboxFrac  0.08 — contour must cover ≥8% of image area
//   kMaxRectangularity   0.92 — skip contours that are essentially rectangular
//                               (rect detection would have caught those already)

private let kStableFramesNeeded    = 8
private let kFramesBetweenAttempts = 3
private let kAutoDetectTimeout     = 7.0
private let kMovementThreshold     = Float(0.002)
private let kRotationThreshold     = Float(0.006)
private let kSamplesNeeded         = 3
private let kMaxSampleBuffer       = 5
private let kCoplanarTolerance     = Float(0.02)
private let kMaxNormalY            = Float(0.35)
private let kMaxOppositeSideRatio  = Float(1.12)
private let kMaxPanesPerWindow     = 8
private let kNMSIoUThreshold       = Float(0.50)
private let kMinContourBboxFrac    = CGFloat(0.08)
private let kMaxRectangularity     = CGFloat(0.92)

// ── Value types ────────────────────────────────────────────────────────────

/// One validated pane: includes both screen and world-space corners so the
/// caller can compute overall bounding boxes across multiple panes.
private struct PaneSample {
  let width:         Float
  let height:        Float
  let screenCorners: [CGPoint]     // [TL, TR, BR, BL] in UIView space
  let worldCorners:  [simd_float3] // [TL, TR, BR, BL] in ARKit world space
}

/// A simultaneous snapshot of all detected panes in one frame.
/// `isCustomShape` true  → came from VNDetectContoursRequest (non-rectangular).
/// `shapePerimeter`      → 3D perimeter in metres (contour mode only).
private struct MultiPaneSample {
  let panes:          [PaneSample]  // sorted left-to-right by screen centre X
  let isCustomShape:  Bool
  let shapePerimeter: Float?

  init(panes: [PaneSample], isCustomShape: Bool = false, shapePerimeter: Float? = nil) {
    self.panes          = panes
    self.isCustomShape  = isCustomShape
    self.shapePerimeter = shapePerimeter
  }
}

// ── View ──────────────────────────────────────────────────────────────────

public class ARWindowMeasureView: ExpoView, ARSCNViewDelegate, ARSessionDelegate {

  // -- Expo event dispatchers
  let onDetected    = EventDispatcher()
  let onSteadiness  = EventDispatcher()
  let onMeasurement = EventDispatcher()
  let onCornerAdded = EventDispatcher()
  let onReady       = EventDispatcher()
  let onError       = EventDispatcher()

  // -- Subviews
  private let arView      = ARSCNView()
  private let overlayView = UIView()

  // -- State
  private var currentMode:        String = "auto"
  private var stableFrameCount:   Int = 0
  private var framesSinceAttempt: Int = 0
  private var detectionInFlight   = false
  private var autoDetectTimer:    Timer?
  private var lastCameraTransform: simd_float4x4?
  private var hasAutoDetected     = false
  private var sessionStarted      = false

  /// Rolling buffer of multi-pane snapshots (one snapshot = N panes from one frame).
  private var paneSets: [MultiPaneSample] = []

  private var manualCorners:      [simd_float3] = []
  private var manualScreenPoints: [CGPoint]     = []

  // Overlay layers — a single combined CAShapeLayer per state so they
  // replace cleanly without clearing corner dot labels.
  private var pendingOverlayLayer:   CAShapeLayer?
  private var detectionOverlayLayer: CAShapeLayer?
  private var cornerDotLayers:       [CALayer] = []

  // MARK: - Init

  required public init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    buildSubviews()
  }

  private func buildSubviews() {
    arView.frame              = bounds
    arView.autoresizingMask   = [.flexibleWidth, .flexibleHeight]
    arView.delegate           = self
    arView.session.delegate   = self
    arView.automaticallyUpdatesLighting = true
    arView.debugOptions = []
    addSubview(arView)

    overlayView.frame                   = bounds
    overlayView.autoresizingMask        = [.flexibleWidth, .flexibleHeight]
    overlayView.isUserInteractionEnabled = false
    overlayView.backgroundColor         = .clear
    addSubview(overlayView)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    arView.addGestureRecognizer(tap)

    startARSession()
  }

  // MARK: - AR Session

  private func startARSession() {
    guard !sessionStarted else { return }
    guard ARWorldTrackingConfiguration.isSupported else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.onError(["message": "unsupported"])
      }
      return
    }
    sessionStarted = true

    let config = ARWorldTrackingConfiguration()
    config.planeDetection           = [.vertical]
    config.isLightEstimationEnabled = true
    if #available(iOS 14.0, *),
       ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      config.frameSemantics = .sceneDepth
    }
    arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame      = bounds
    overlayView.frame = bounds
  }

  // MARK: - Mode

  public func setMode(_ mode: String) {
    currentMode = mode
    if mode == "manual" {
      autoDetectTimer?.invalidate()
      autoDetectTimer = nil
      hasAutoDetected    = false
      manualCorners      = []
      manualScreenPoints = []
      paneSets           = []
      stableFrameCount   = 0
      clearOverlay()
    }
  }

  // MARK: - ARSessionDelegate — per-frame logic

  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard !hasAutoDetected || currentMode == "manual" else { return }

    // ── Steadiness ──────────────────────────────────────────────────────
    let ct = frame.camera.transform
    if let last = lastCameraTransform {
      let deltaT = simd_length(
        simd_float3(ct.columns.3.x, ct.columns.3.y, ct.columns.3.z) -
        simd_float3(last.columns.3.x, last.columns.3.y, last.columns.3.z)
      )
      let deltaR       = simd_length(ct.columns.0 - last.columns.0)
      let stable       = deltaT < kMovementThreshold && deltaR < kRotationThreshold
      let movementNorm = min(1.0, Double(deltaT) / Double(kMovementThreshold))

      // paneSets is mutated on main; snapshot count here for thread safety.
      let currentSampleCount = paneSets.count

      DispatchQueue.main.async {
        self.onSteadiness([
          "stable":        stable,
          "movement":      movementNorm,
          "sampleCount":   currentSampleCount,
          "samplesNeeded": kSamplesNeeded,
        ])
      }

      if stable {
        stableFrameCount   += 1
        framesSinceAttempt += 1
      } else {
        stableFrameCount = 0
        // Large movement invalidates accumulated samples — they came from a
        // different vantage point.
        if !paneSets.isEmpty && Double(deltaT) > Double(kMovementThreshold) * 8 {
          paneSets = []
          DispatchQueue.main.async { self.clearPendingOverlay() }
        }
      }

      if stable,
         currentMode == "auto",
         !detectionInFlight,
         stableFrameCount   >= kStableFramesNeeded,
         framesSinceAttempt >= kFramesBetweenAttempts {
        framesSinceAttempt = 0
        detectWindowInFrame(frame)
      }
    }
    lastCameraTransform = ct

    if autoDetectTimer == nil && currentMode == "auto" {
      DispatchQueue.main.async {
        self.autoDetectTimer = Timer.scheduledTimer(
          withTimeInterval: kAutoDetectTimeout,
          repeats: false
        ) { [weak self] _ in
          guard let self = self, !self.hasAutoDetected else { return }
          self.onError(["message": "auto_timeout"])
        }
      }
    }
  }

  // MARK: - Vision Detection (multi-pane rectangles + contour fallback)

  private func detectWindowInFrame(_ frame: ARFrame) {
    detectionInFlight = true
    let pixelBuffer      = frame.capturedImage
    let displayTransform = frame.displayTransform(for: .portrait, viewportSize: arView.bounds.size)
    let viewportSize     = arView.bounds.size

    // Capture results from both requests before dispatching to main.
    var rectObservations: [VNRectangleObservation] = []

    // ── IMPORTANT: VNContour.normalizedPoints returns UnsafePointer<simd_float2>
    // whose backing buffer is owned by the Vision pipeline and may be freed once
    // handler.perform() returns.  Accessing it on the main thread after that is
    // a use-after-free.  We extract all contour points HERE — inside the request
    // completion handler, still on the Vision background thread — so we only pass
    // plain [CGPoint] arrays to the main thread.
    var extractedContours: [[CGPoint]] = []

    // ── Rectangle request — up to kMaxPanesPerWindow observations ────────
    let rectRequest = VNDetectRectanglesRequest { req, _ in
      rectObservations = (req.results as? [VNRectangleObservation]) ?? []
    }
    rectRequest.minimumAspectRatio  = VNAspectRatio(0.20)  // allow tall/narrow panes (1:5)
    rectRequest.maximumAspectRatio  = VNAspectRatio(5.00)
    rectRequest.minimumSize         = Float(0.10)           // pane ≥ 10% of frame dimension
    rectRequest.maximumObservations = kMaxPanesPerWindow
    rectRequest.minimumConfidence   = Float(0.75)           // slightly lower: individual panes
    rectRequest.quadratureTolerance = Float(15)             // more tolerance for angled views

    // ── Contour request — non-rectangular shapes ─────────────────────────
    let contourRequest = VNDetectContoursRequest { req, _ in
      guard let obs = (req.results as? [VNContoursObservation])?.first else { return }
      // Use normalizedPath (a stable CGPath value type) rather than normalizedPoints
      // (an UnsafePointer<simd_float2>) — no unsafe pointer, no lifetime concerns.
      for contour in obs.topLevelContours {
        guard contour.pointCount >= 8 else { continue }
        var pts: [CGPoint] = []
        pts.reserveCapacity(contour.pointCount)
        contour.normalizedPath.applyWithBlock { elementPtr in
          let el = elementPtr.pointee
          switch el.type {
          case .moveToPoint, .addLineToPoint:
            pts.append(el.points[0])
          default:
            break
          }
        }
        if pts.count >= 8 { extractedContours.append(pts) }
      }
    }
    contourRequest.contrastAdjustment = 2.0
    contourRequest.detectsDarkOnLight = true   // dark window frame on bright exterior/sky

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer)
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }

      // ── Step 1: rectangle detection (primary path) ─────────────────────
      // Run this first, every frame.  Most windows are rectangular so this
      // succeeds in the common case without needing the contour pass at all.
      do {
        try handler.perform([rectRequest])
      } catch {
        DispatchQueue.main.async { self.detectionInFlight = false }
        return
      }

      let nmsRects = self.applyNMS(rectObservations)

      // ── Step 2: contour detection (fallback — only when no rects found) ─
      // VNDetectContoursRequest builds a full edge-map of the camera image.
      // Running it unconditionally on every frame (10×/sec at 60 fps) causes
      // serious thermal pressure and can trigger an uncatchable NSException on
      // complex scenes.  We only pay the cost when rect detection finds nothing.
      var safeContours: [[CGPoint]] = []
      if nmsRects.isEmpty {
        do {
          try handler.perform([contourRequest])
          safeContours = extractedContours
        } catch {
          // Contour failure is non-fatal — fall through with empty array.
        }
      }

      DispatchQueue.main.async {
        defer { self.detectionInFlight = false }
        if !nmsRects.isEmpty {
          self.processDetectedPanes(nmsRects,
                                    displayTransform: displayTransform,
                                    viewportSize: viewportSize)
        } else if !safeContours.isEmpty {
          self.processContourShape(safeContours,
                                   displayTransform: displayTransform,
                                   viewportSize: viewportSize)
        } else {
          if !self.hasAutoDetected {
            self.onDetected(["detected": false, "confidence": 0])
          }
        }
      }
    }
  }

  // MARK: - NMS (Non-Maximum Suppression)

  /// Remove duplicate/overlapping rectangle observations.
  /// Sorted by area × confidence (descending), then suppress any candidate
  /// whose IoU with an already-kept rect exceeds kNMSIoUThreshold.
  ///
  /// Using 0.50 as the threshold means 3 side-by-side panes (each ~33% of
  /// total window area, IoU ≈ 0.33 with the whole window) all survive.
  private func applyNMS(_ obs: [VNRectangleObservation]) -> [VNRectangleObservation] {
    let sorted = obs.sorted { a, b in
      let sa = a.boundingBox.width * a.boundingBox.height * CGFloat(a.confidence)
      let sb = b.boundingBox.width * b.boundingBox.height * CGFloat(b.confidence)
      return sa > sb
    }
    var kept: [VNRectangleObservation] = []
    for candidate in sorted {
      let dominated = kept.contains { iou(candidate.boundingBox, $0.boundingBox) > CGFloat(kNMSIoUThreshold) }
      if !dominated { kept.append(candidate) }
    }
    return kept
  }

  private func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let inter = a.intersection(b)
    guard !inter.isNull else { return 0 }
    let interArea = inter.width * inter.height
    let unionArea = a.width * a.height + b.width * b.height - interArea
    return unionArea > 0 ? interArea / unionArea : 0
  }

  // MARK: - Multi-pane Rectangle Processing

  private func processDetectedPanes(
    _ observations: [VNRectangleObservation],
    displayTransform: CGAffineTransform,
    viewportSize: CGSize
  ) {
    guard !hasAutoDetected, currentMode == "auto" else { return }

    let margin: CGFloat = 8
    var validPanes: [PaneSample] = []

    for obs in observations {
      let rawScreen = [obs.topLeft, obs.topRight, obs.bottomRight, obs.bottomLeft]
        .map { visionToScreen($0, displayTransform, viewportSize) }
      let ordered = orderedCorners(rawScreen)

      // All corners must be safely on-screen.
      guard ordered.allSatisfy({ c in
        c.x >= margin && c.y >= margin &&
        c.x <= viewportSize.width  - margin &&
        c.y <= viewportSize.height - margin
      }) else { continue }

      // Raycast all four corners to 3D.
      var world3D: [simd_float3] = []
      var allHit = true
      for corner in ordered {
        guard let pt = raycast(screenPoint: corner) else { allHit = false; break }
        world3D.append(pt)
      }
      guard allHit else { continue }

      // Validate geometry — same accuracy constraints as the single-pane version.
      guard let sample = validatePaneSample(world3D: world3D, screenCorners: ordered) else { continue }
      validPanes.append(sample)
    }

    guard !validPanes.isEmpty else {
      onDetected(["detected": false, "confidence": 0])
      return
    }

    // Sort panes left-to-right by screen-space centroid X.
    let sortedPanes = validPanes.sorted { a, b in
      (a.screenCorners.reduce(CGFloat(0)) { $0 + $1.x } / 4) <
      (b.screenCorners.reduce(CGFloat(0)) { $0 + $1.x } / 4)
    }

    paneSets.append(MultiPaneSample(panes: sortedPanes))
    if paneSets.count > kMaxSampleBuffer { paneSets.removeFirst() }

    let bestConf = observations.map { Float($0.confidence) }.max() ?? 0

    // Visual feedback before consensus — amber dashed boxes around all panes.
    if paneSets.count < kSamplesNeeded {
      drawPendingBoxes(panes: sortedPanes)
      onDetected([
        "detected":      false,
        "confidence":    bestConf,
        "sampleCount":   paneSets.count,
        "samplesNeeded": kSamplesNeeded,
        "paneCount":     sortedPanes.count,
      ])
      return
    }

    // ── Consensus ──────────────────────────────────────────────────────
    let recent = Array(paneSets.suffix(kSamplesNeeded))

    // All samples must agree on pane count.
    let paneCounts = recent.map { $0.panes.count }
    guard paneCounts.allSatisfy({ $0 == paneCounts[0] }) else {
      // Inconsistent count — discard buffer and start fresh.
      paneSets.removeAll()
      return
    }
    let paneCount = paneCounts[0]

    // Each corresponding pane's width and height must agree within tolerance.
    var consensusPanes: [PaneSample] = []
    for idx in 0..<paneCount {
      let ws = recent.map { $0.panes[idx].width }.sorted()
      let hs = recent.map { $0.panes[idx].height }.sorted()
      let median = kSamplesNeeded / 2
      let wTol = max(Float(0.012), ws[median] * Float(0.02))  // 1.2 cm or 2%
      let hTol = max(Float(0.012), hs[median] * Float(0.02))
      guard ws.last! - ws.first! <= wTol,
            hs.last! - hs.first! <= hTol else {
        paneSets.removeAll()
        return
      }
      consensusPanes.append(recent.last!.panes[idx])
    }

    hasAutoDetected = true
    autoDetectTimer?.invalidate()
    autoDetectTimer = nil
    paneSets = []

    drawConfirmedBoxes(panes: consensusPanes)
    onDetected(["detected": true, "confidence": Double(bestConf), "paneCount": paneCount])
    emitWindowMeasurement(panes: consensusPanes)
  }

  /// Same accuracy logic as the original `validateSample`, extended to also
  /// return the world-space corners needed for multi-pane bounding-box math.
  private func validatePaneSample(world3D: [simd_float3], screenCorners: [CGPoint]) -> PaneSample? {
    guard world3D.count == 4 else { return nil }
    let tl = world3D[0], tr = world3D[1], br = world3D[2], bl = world3D[3]

    // Coplanarity — all four corners must lie on the same plane.
    let n    = simd_cross(tr - tl, bl - tl)
    let nLen = simd_length(n)
    guard nLen > 1e-6 else { return nil }
    let normal = n / nLen
    let dist4  = abs(simd_dot(br - tl, normal))
    guard dist4 <= kCoplanarTolerance else { return nil }

    // Wall normal — reject floors/ceilings.
    guard abs(normal.y) <= kMaxNormalY else { return nil }

    // Minimum real-world side length: 5 cm per edge.
    let wTop    = simd_distance(tl, tr)
    let wBottom = simd_distance(bl, br)
    let hLeft   = simd_distance(tl, bl)
    let hRight  = simd_distance(tr, br)
    guard wTop > 0.05, wBottom > 0.05, hLeft > 0.05, hRight > 0.05 else { return nil }

    // Parallelism — opposite sides must not differ too much (no wild trapezoids).
    guard max(wTop, wBottom) / min(wTop, wBottom) <= kMaxOppositeSideRatio,
          max(hLeft, hRight) / min(hLeft, hRight) <= kMaxOppositeSideRatio else { return nil }

    return PaneSample(
      width:         (wTop + wBottom) / 2,
      height:        (hLeft + hRight) / 2,
      screenCorners: screenCorners,
      worldCorners:  world3D
    )
  }

  // MARK: - Contour (non-rectangular shape) Processing

  /// `contours` is a pre-extracted [[CGPoint]] built inside the Vision callback
  /// on the background thread (safe).  We never touch VNContour.normalizedPoints
  /// here — that UnsafePointer may be freed by the time we run on main.
  private func processContourShape(
    _ contours: [[CGPoint]],
    displayTransform: CGAffineTransform,
    viewportSize: CGSize
  ) {
    guard !hasAutoDetected, currentMode == "auto" else { return }

    // Take the largest top-level contour (the outer window boundary).
    guard let pts = contours.max(by: {
      contourBboxAreaFromPoints($0) < contourBboxAreaFromPoints($1)
    }) else { return }
    guard pts.count >= 8 else { return }

    // Contour must be large enough to be a window.
    guard contourBboxAreaFromPoints(pts) > kMinContourBboxFrac else { return }

    // Skip near-rectangular contours — VNDetectRectanglesRequest should have
    // caught those already.  rectangularity = contourArea / bboxArea; a
    // semicircular arch scores ≈ 0.79, a rectangle scores ≈ 1.0.
    let rectScore = contourRectangularity(pts)
    guard rectScore < kMaxRectangularity else { return }

    // Decimate to ≤40 points for raycasting performance.
    let step      = max(1, pts.count / 40)
    let sampled   = stride(from: 0, to: pts.count, by: step).map { pts[$0] }
    let screenPts = sampled.map { visionToScreen($0, displayTransform, viewportSize) }

    // Raycast each sampled point to the wall plane.
    var world3D: [simd_float3] = []
    for pt in screenPts {
      guard let w = raycast(screenPoint: pt) else { continue }
      world3D.append(w)
    }
    guard world3D.count >= 6 else { return }

    // 3D perimeter (close the loop).
    var perimeter: Float = 0
    for i in 0..<world3D.count {
      perimeter += simd_distance(world3D[i], world3D[(i + 1) % world3D.count])
    }

    // 3D bounding box.
    let xs  = world3D.map { $0.x }
    let ys  = world3D.map { $0.y }
    let bbW = (xs.max()! - xs.min()!)
    let bbH = abs(ys.max()! - ys.min()!)

    // Build a synthetic single-pane sample for consensus accumulation.
    let n = world3D.count
    let synthPane = PaneSample(
      width:  bbW,
      height: bbH,
      screenCorners: [
        screenPts[0],
        screenPts[min(n / 4, screenPts.count - 1)],
        screenPts[min(n / 2, screenPts.count - 1)],
        screenPts[min(3 * n / 4, screenPts.count - 1)],
      ],
      worldCorners: [
        world3D[0],
        world3D[n / 4],
        world3D[n / 2],
        world3D[3 * n / 4],
      ]
    )
    paneSets.append(MultiPaneSample(panes: [synthPane],
                                    isCustomShape: true,
                                    shapePerimeter: perimeter))
    if paneSets.count > kMaxSampleBuffer { paneSets.removeFirst() }

    let customSamples = paneSets.filter { $0.isCustomShape }

    if customSamples.count < kSamplesNeeded {
      drawContourPending(screenPts: screenPts)
      onDetected([
        "detected":      false,
        "confidence":    0.7,
        "sampleCount":   customSamples.count,
        "samplesNeeded": kSamplesNeeded,
        "paneCount":     1,
        "shapeType":     "custom",
      ])
      return
    }

    // Consensus on perimeter: must agree within 2 cm or 3%.
    let perimeters = customSamples.suffix(kSamplesNeeded)
                                  .compactMap { $0.shapePerimeter }
                                  .sorted()
    guard perimeters.count == kSamplesNeeded else { return }
    let median = kSamplesNeeded / 2
    let pTol   = max(Float(0.02), perimeters[median] * Float(0.03))
    guard perimeters.last! - perimeters.first! <= pTol else {
      paneSets.removeAll()
      return
    }

    hasAutoDetected = true
    autoDetectTimer?.invalidate()
    autoDetectTimer = nil
    paneSets = []

    drawContourConfirmed(screenPts: screenPts)
    onDetected(["detected": true, "confidence": 0.85, "paneCount": 1, "shapeType": "custom"])
    emitContourMeasurement(bboxW: bbW, bboxH: bbH, perimeter: perimeters[median])
  }

  // MARK: - Contour geometry helpers

  private func contourBboxAreaFromPoints(_ pts: [CGPoint]) -> CGFloat {
    guard !pts.isEmpty else { return 0 }
    let xs = pts.map(\.x); let ys = pts.map(\.y)
    return (xs.max()! - xs.min()!) * (ys.max()! - ys.min()!)
  }

  /// Shoelace area / bounding-box area.  Score = 1.0 for a perfect rectangle,
  /// ≈ 0.79 for a semicircular-arch window, lower for triangles/hexagons.
  private func contourRectangularity(_ pts: [CGPoint]) -> CGFloat {
    guard pts.count >= 4 else { return 1.0 }
    var area: CGFloat = 0
    let n = pts.count
    for i in 0..<n {
      let j = (i + 1) % n
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    let contourArea = abs(area) / 2
    let bboxArea    = contourBboxAreaFromPoints(pts)
    return bboxArea > 0 ? min(contourArea / bboxArea, 1.0) : 1.0
  }

  // MARK: - Vision → Screen coordinate transform

  private func visionToScreen(_ p: CGPoint, _ t: CGAffineTransform, _ size: CGSize) -> CGPoint {
    let imageNorm = CGPoint(x: p.x, y: 1 - p.y)   // flip Y (bottom-left → top-left origin)
    let viewNorm  = imageNorm.applying(t)
    return CGPoint(x: viewNorm.x * size.width, y: viewNorm.y * size.height)
  }

  /// Sort four arbitrary screen points into [TL, TR, BR, BL] order.
  private func orderedCorners(_ pts: [CGPoint]) -> [CGPoint] {
    let byY    = pts.sorted { $0.y < $1.y }
    let top    = byY.prefix(2).sorted { $0.x < $1.x }
    let bottom = byY.suffix(2).sorted { $0.x < $1.x }
    return [top[0], top[1], bottom[1], bottom[0]]
  }

  // MARK: - ARKit Raycasting

  private func raycast(screenPoint: CGPoint) -> simd_float3? {
    // 1) Tracked vertical plane geometry (highest accuracy)
    if let q = arView.raycastQuery(from: screenPoint, allowing: .existingPlaneGeometry, alignment: .vertical),
       let r = arView.session.raycast(q).first {
      let t = r.worldTransform
      return simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
    }
    // 2) Infinite extension of tracked vertical plane (handles glass / window pane area)
    if let q = arView.raycastQuery(from: screenPoint, allowing: .existingPlaneInfinite, alignment: .vertical),
       let r = arView.session.raycast(q).first {
      let t = r.worldTransform
      return simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
    }
    // 3) Estimated vertical plane (LiDAR devices resolve this well without prior plane detection)
    if let q = arView.raycastQuery(from: screenPoint, allowing: .estimatedPlane, alignment: .vertical),
       let r = arView.session.raycast(q).first {
      let t = r.worldTransform
      return simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
    }
    return nil
  }

  // MARK: - Manual Corner Tapping

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    guard currentMode == "manual", manualCorners.count < 4 else { return }
    addManualCorner(at: gesture.location(in: arView))
  }

  public func addManualCorner(at screenPoint: CGPoint) {
    guard manualCorners.count < 4 else { return }
    guard let world = raycast(screenPoint: screenPoint) else {
      onError(["message": "Could not project corner to 3D. Move camera to face the window directly."])
      return
    }
    manualCorners.append(world)
    manualScreenPoints.append(screenPoint)
    drawCornerDot(at: screenPoint, number: manualCorners.count)
    onCornerAdded(["count":   manualCorners.count,
                   "screenX": screenPoint.x,
                   "screenY": screenPoint.y])
    if manualCorners.count == 4 { emitManualMeasurement() }
  }

  private func emitManualMeasurement() {
    let idx        = [0, 1, 2, 3].sorted { manualScreenPoints[$0].y < manualScreenPoints[$1].y }
    let topPair    = idx.prefix(2).sorted { manualScreenPoints[$0].x < manualScreenPoints[$1].x }
    let bottomPair = idx.suffix(2).sorted { manualScreenPoints[$0].x < manualScreenPoints[$1].x }
    let tl = manualCorners[topPair[0]],    tr = manualCorners[topPair[1]]
    let bl = manualCorners[bottomPair[0]], br = manualCorners[bottomPair[1]]

    let width  = Double((simd_distance(tl, tr) + simd_distance(bl, br)) / 2)
    let height = Double((simd_distance(tl, bl) + simd_distance(tr, br)) / 2)
    emitSingleMeasurement(width: width, height: height)
  }

  // MARK: - Measurement Emission

  /// Full multi-pane payload — one entry per detected pane + overall summary.
  private func emitWindowMeasurement(panes: [PaneSample]) {
    let k = 39.3701  // metres → inches

    let panePayloads: [[String: Any]] = panes.enumerated().map { idx, p in
      let wIn = Double(p.width) * k
      let hIn = Double(p.height) * k
      return [
        "index":        idx,
        "widthMeters":  Double(p.width),
        "heightMeters": Double(p.height),
        "widthInches":  wIn,
        "heightInches": hIn,
        "widthFeet":    wIn / 12.0,
        "heightFeet":   hIn / 12.0,
        "widthDisplay": String(format: "%.1f\"", wIn),
        "heightDisplay": String(format: "%.1f\"", hIn),
        "areaSqFt":     (wIn * hIn) / 144.0,
        "areaDisplay":  String(format: "%.1f sq ft", (wIn * hIn) / 144.0),
      ] as [String: Any]
    }

    let overallW  = computeOverallWidth(panes: panes)
    let overallH  = computeOverallHeight(panes: panes)
    let perimeter = 2.0 * (overallW + overallH)
    let totalArea = panes.reduce(Float(0)) { $0 + $1.width * $1.height }

    let owIn      = Double(overallW) * k
    let ohIn      = Double(overallH) * k
    let periIn    = Double(perimeter) * k
    let totalSqFt = Double(totalArea) * k * k / 144.0

    // First/only pane fills backwards-compat top-level fields.
    let p0   = panes[0]
    let w0In = Double(p0.width) * k
    let h0In = Double(p0.height) * k

    onMeasurement([
      // Backwards-compat single-pane fields (always = first pane)
      "widthMeters":   Double(p0.width),
      "heightMeters":  Double(p0.height),
      "widthInches":   w0In,
      "heightInches":  h0In,
      "widthFeet":     w0In / 12.0,
      "heightFeet":    h0In / 12.0,
      "widthDisplay":  String(format: "%.1f\"", w0In),
      "heightDisplay": String(format: "%.1f\"", h0In),
      // Multi-pane fields
      "paneCount":  panes.count,
      "shapeType":  "rectangular",
      "panes":      panePayloads,
      "overall": [
        "widthMeters":      Double(overallW),
        "heightMeters":     Double(overallH),
        "widthInches":      owIn,
        "heightInches":     ohIn,
        "widthFeet":        owIn / 12.0,
        "heightFeet":       ohIn / 12.0,
        "widthDisplay":     String(format: "%.1f\"", owIn),
        "heightDisplay":    String(format: "%.1f\"", ohIn),
        "perimeterInches":  periIn,
        "perimeterFeet":    periIn / 12.0,
        "perimeterDisplay": String(format: "%.1f ft", periIn / 12.0),
        "totalAreaSqFt":    totalSqFt,
        "totalAreaDisplay": String(format: "%.1f sq ft", totalSqFt),
      ] as [String: Any],
    ])
  }

  /// Emission for non-rectangular (contour-detected) windows.
  private func emitContourMeasurement(bboxW: Float, bboxH: Float, perimeter: Float) {
    let k = 39.3701
    let wIn     = Double(bboxW) * k
    let hIn     = Double(bboxH) * k
    let periIn  = Double(perimeter) * k
    let areaSqFt = Double(bboxW * bboxH) * k * k / 144.0  // bbox approximation

    onMeasurement([
      "widthMeters":   Double(bboxW),
      "heightMeters":  Double(bboxH),
      "widthInches":   wIn,
      "heightInches":  hIn,
      "widthFeet":     wIn / 12.0,
      "heightFeet":    hIn / 12.0,
      "widthDisplay":  String(format: "%.1f\"", wIn),
      "heightDisplay": String(format: "%.1f\"", hIn),
      "paneCount":  1,
      "shapeType":  "custom",
      "panes": [[
        "index":        0,
        "widthInches":  wIn,
        "heightInches": hIn,
        "widthFeet":    wIn / 12.0,
        "heightFeet":   hIn / 12.0,
        "widthDisplay": String(format: "%.1f\"", wIn),
        "heightDisplay": String(format: "%.1f\"", hIn),
        "areaSqFt":     areaSqFt,
        "areaDisplay":  String(format: "%.1f sq ft", areaSqFt),
      ] as [String: Any]],
      "overall": [
        "widthInches":      wIn,
        "heightInches":     hIn,
        "widthFeet":        wIn / 12.0,
        "heightFeet":       hIn / 12.0,
        "widthDisplay":     String(format: "%.1f\"", wIn),
        "heightDisplay":    String(format: "%.1f\"", hIn),
        "perimeterInches":  periIn,
        "perimeterFeet":    periIn / 12.0,
        "perimeterDisplay": String(format: "%.1f ft", periIn / 12.0),
        "totalAreaSqFt":    areaSqFt,
        "totalAreaDisplay": String(format: "%.1f sq ft", areaSqFt),
      ] as [String: Any],
    ])
  }

  /// Backwards-compatible emitter used by manual 4-corner mode.
  private func emitSingleMeasurement(width wMeters: Double, height hMeters: Double) {
    let k = 39.3701
    let wIn = wMeters * k
    let hIn = hMeters * k
    let perInches = 2 * (wIn + hIn)
    let areaSqFt  = (wIn * hIn) / 144.0
    onMeasurement([
      "widthMeters":   wMeters,
      "heightMeters":  hMeters,
      "widthInches":   wIn,
      "heightInches":  hIn,
      "widthFeet":     wIn / 12.0,
      "heightFeet":    hIn / 12.0,
      "widthDisplay":  String(format: "%.1f\"", wIn),
      "heightDisplay": String(format: "%.1f\"", hIn),
      "paneCount":  1,
      "shapeType":  "rectangular",
      "panes": [[
        "index":        0,
        "widthInches":  wIn,
        "heightInches": hIn,
        "widthFeet":    wIn / 12.0,
        "heightFeet":   hIn / 12.0,
        "widthDisplay": String(format: "%.1f\"", wIn),
        "heightDisplay": String(format: "%.1f\"", hIn),
        "areaSqFt":     areaSqFt,
        "areaDisplay":  String(format: "%.1f sq ft", areaSqFt),
      ] as [String: Any]],
      "overall": [
        "widthInches":      wIn,
        "heightInches":     hIn,
        "widthFeet":        wIn / 12.0,
        "heightFeet":       hIn / 12.0,
        "widthDisplay":     String(format: "%.1f\"", wIn),
        "heightDisplay":    String(format: "%.1f\"", hIn),
        "perimeterInches":  perInches,
        "perimeterFeet":    perInches / 12.0,
        "perimeterDisplay": String(format: "%.1f ft", perInches / 12.0),
        "totalAreaSqFt":    areaSqFt,
        "totalAreaDisplay": String(format: "%.1f sq ft", areaSqFt),
      ] as [String: Any],
    ])
  }

  // MARK: - Overall dimension helpers

  /// Width = distance from the left edge of the leftmost pane to the right
  /// edge of the rightmost pane, measured in 3D world space.
  private func computeOverallWidth(panes: [PaneSample]) -> Float {
    guard panes.count > 1 else {
      let p = panes[0]
      return (simd_distance(p.worldCorners[0], p.worldCorners[1]) +
              simd_distance(p.worldCorners[3], p.worldCorners[2])) / 2
    }
    let first = panes.first!, last = panes.last!
    // TL of leftmost pane → TR of rightmost pane (top edge)
    // BL of leftmost pane → BR of rightmost pane (bottom edge)
    let topW    = simd_distance(first.worldCorners[0], last.worldCorners[1])
    let bottomW = simd_distance(first.worldCorners[3], last.worldCorners[2])
    return (topW + bottomW) / 2
  }

  /// Height = average pane height across all detected panes.
  private func computeOverallHeight(panes: [PaneSample]) -> Float {
    let heights = panes.map { p in
      (simd_distance(p.worldCorners[0], p.worldCorners[3]) +
       simd_distance(p.worldCorners[1], p.worldCorners[2])) / 2
    }
    return heights.reduce(0, +) / Float(heights.count)
  }

  // MARK: - Reset

  public func resetMeasurement() {
    manualCorners      = []
    manualScreenPoints = []
    paneSets           = []
    hasAutoDetected    = false
    detectionInFlight  = false
    stableFrameCount   = 0
    framesSinceAttempt = 0
    autoDetectTimer?.invalidate()
    autoDetectTimer = nil
    clearOverlay()
  }

  // MARK: - Overlay Drawing

  /// Amber dashed boxes around all detected panes — pre-consensus feedback.
  private func drawPendingBoxes(panes: [PaneSample]) {
    pendingOverlayLayer?.removeFromSuperlayer()
    let path  = combinedPanePath(panes)
    let shape = makeShapeLayer(
      path:      path,
      stroke:    UIColor.systemOrange,
      fill:      UIColor.systemOrange.withAlphaComponent(0.06),
      lineWidth: 2.5,
      dashed:    true
    )
    overlayView.layer.insertSublayer(shape, at: 0)
    pendingOverlayLayer = shape
  }

  /// Green solid boxes + pane-number labels + cyan overall bounding box.
  private func drawConfirmedBoxes(panes: [PaneSample]) {
    clearOverlay()

    // Individual pane outlines (green, solid)
    let panePath  = combinedPanePath(panes)
    let paneShape = makeShapeLayer(
      path:      panePath,
      stroke:    UIColor.systemGreen,
      fill:      UIColor.systemGreen.withAlphaComponent(0.12),
      lineWidth: 3,
      dashed:    false
    )
    overlayView.layer.addSublayer(paneShape)
    detectionOverlayLayer = paneShape

    // Centre label for each pane (index 1-based)
    for (idx, pane) in panes.enumerated() {
      let cx = pane.screenCorners.reduce(CGFloat(0)) { $0 + $1.x } / 4
      let cy = pane.screenCorners.reduce(CGFloat(0)) { $0 + $1.y } / 4
      addPaneLabel(at: CGPoint(x: cx, y: cy), text: "\(idx + 1)", color: .systemGreen)
    }

    // Cyan dashed overall bounding box for multi-pane windows
    if panes.count > 1 {
      let tl = panes.first!.screenCorners[0]
      let tr = panes.last!.screenCorners[1]
      let br = panes.last!.screenCorners[2]
      let bl = panes.first!.screenCorners[3]
      let overallPath = UIBezierPath()
      overallPath.move(to: tl)
      [tr, br, bl].forEach { overallPath.addLine(to: $0) }
      overallPath.close()
      let overallShape = makeShapeLayer(
        path:      overallPath,
        stroke:    UIColor.systemCyan,
        fill:      UIColor.clear,
        lineWidth: 1.5,
        dashed:    true
      )
      overlayView.layer.addSublayer(overallShape)
    }
  }

  /// Purple dashed outline — non-rectangular shape detected, pre-consensus.
  private func drawContourPending(screenPts: [CGPoint]) {
    pendingOverlayLayer?.removeFromSuperlayer()
    guard screenPts.count >= 3 else { return }
    let path = polyPath(screenPts)
    let shape = makeShapeLayer(
      path:      path,
      stroke:    UIColor.systemPurple,
      fill:      UIColor.systemPurple.withAlphaComponent(0.06),
      lineWidth: 2.5,
      dashed:    true
    )
    overlayView.layer.insertSublayer(shape, at: 0)
    pendingOverlayLayer = shape
  }

  /// Green solid outline — non-rectangular shape confirmed.
  private func drawContourConfirmed(screenPts: [CGPoint]) {
    clearOverlay()
    guard screenPts.count >= 3 else { return }
    let path  = polyPath(screenPts)
    let shape = makeShapeLayer(
      path:      path,
      stroke:    UIColor.systemGreen,
      fill:      UIColor.systemGreen.withAlphaComponent(0.10),
      lineWidth: 3,
      dashed:    false
    )
    overlayView.layer.addSublayer(shape)
    detectionOverlayLayer = shape
  }

  // MARK: - Manual-mode corner dots

  private func drawCornerDot(at point: CGPoint, number: Int) {
    let colors: [UIColor] = [.systemBlue, .systemOrange, .systemPurple, .systemRed]
    addCornerMarker(at: point, label: "\(number)", color: colors[(number - 1) % colors.count])
  }

  private func addCornerMarker(at point: CGPoint, label: String, color: UIColor) {
    let r: CGFloat = 10
    let dot = CAShapeLayer()
    dot.path        = UIBezierPath(ovalIn: CGRect(x: point.x-r, y: point.y-r, width: r*2, height: r*2)).cgPath
    dot.fillColor   = color.cgColor
    dot.strokeColor = UIColor.white.cgColor
    dot.lineWidth   = 2.5
    overlayView.layer.addSublayer(dot)

    let txt = CATextLayer()
    txt.string          = label
    txt.fontSize        = 13
    txt.foregroundColor = UIColor.white.cgColor
    txt.alignmentMode   = .center
    txt.contentsScale   = UIScreen.main.scale
    txt.frame           = CGRect(x: point.x - 10, y: point.y - 9, width: 20, height: 18)
    overlayView.layer.addSublayer(txt)

    cornerDotLayers.append(dot)
    cornerDotLayers.append(txt)
  }

  // MARK: - Overlay helpers

  private func combinedPanePath(_ panes: [PaneSample]) -> UIBezierPath {
    let combined = UIBezierPath()
    for pane in panes {
      let p = UIBezierPath()
      p.move(to: pane.screenCorners[0])
      pane.screenCorners.dropFirst().forEach { p.addLine(to: $0) }
      p.close()
      combined.append(p)
    }
    return combined
  }

  private func polyPath(_ pts: [CGPoint]) -> UIBezierPath {
    let p = UIBezierPath()
    p.move(to: pts[0])
    pts.dropFirst().forEach { p.addLine(to: $0) }
    p.close()
    return p
  }

  private func makeShapeLayer(
    path:      UIBezierPath,
    stroke:    UIColor,
    fill:      UIColor,
    lineWidth: CGFloat,
    dashed:    Bool
  ) -> CAShapeLayer {
    let shape = CAShapeLayer()
    shape.path        = path.cgPath
    shape.strokeColor = stroke.cgColor
    shape.fillColor   = fill.cgColor
    shape.lineWidth   = lineWidth
    shape.lineCap     = .round
    shape.lineJoin    = .round
    if dashed { shape.lineDashPattern = [8, 5] }
    return shape
  }

  /// Circular label badge in the centre of a detected pane.
  private func addPaneLabel(at center: CGPoint, text: String, color: UIColor) {
    let r: CGFloat = 13
    let dot = CAShapeLayer()
    dot.path        = UIBezierPath(ovalIn: CGRect(x: center.x-r, y: center.y-r, width: r*2, height: r*2)).cgPath
    dot.fillColor   = color.withAlphaComponent(0.88).cgColor
    dot.strokeColor = UIColor.white.cgColor
    dot.lineWidth   = 2
    overlayView.layer.addSublayer(dot)

    let txt = CATextLayer()
    txt.string          = text
    txt.fontSize        = 14
    txt.foregroundColor = UIColor.white.cgColor
    txt.alignmentMode   = .center
    txt.contentsScale   = UIScreen.main.scale
    txt.frame           = CGRect(x: center.x - r, y: center.y - 10, width: r * 2, height: 20)
    overlayView.layer.addSublayer(txt)
  }

  private func clearPendingOverlay() {
    pendingOverlayLayer?.removeFromSuperlayer()
    pendingOverlayLayer = nil
  }

  private func clearOverlay() {
    overlayView.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
    cornerDotLayers.removeAll()
    detectionOverlayLayer = nil
    pendingOverlayLayer   = nil
  }

  // MARK: - ARSCNView Delegate
  public func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {}
}
