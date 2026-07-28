import ExpoModulesCore

public class ARWindowMeasureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ARWindowMeasure")

    View(ARWindowMeasureView.self) {
      // Events flowing native → JS
      Events(
        "onDetected",
        "onSteadiness",
        "onMeasurement",
        "onCornerAdded",
        "onReady",
        "onError"
      )

      // "auto" starts Vision detection; "manual" waits for taps
      Prop("mode") { (view: ARWindowMeasureView, mode: String) in
        view.setMode(mode)
      }

      // Imperative commands from JS: { type: "reset" } | { type: "addCorner", x: N, y: N }
      Prop("command") { (view: ARWindowMeasureView, cmd: [String: Any]?) in
        guard let cmd = cmd, let type = cmd["type"] as? String else { return }
        switch type {
        case "reset":
          view.resetMeasurement()
        case "addCorner":
          let x = cmd["x"] as? CGFloat ?? 0
          let y = cmd["y"] as? CGFloat ?? 0
          view.addManualCorner(at: CGPoint(x: x, y: y))
        default:
          break
        }
      }
    }
  }
}
