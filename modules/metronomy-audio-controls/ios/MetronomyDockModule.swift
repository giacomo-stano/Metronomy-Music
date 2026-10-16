import ExpoModulesCore

public final class MetronomyDockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetronomyDock")
    View(MetronomyDockView.self) {
      Events("onCommand")
      Prop("configuration") { (view: MetronomyDockView, value: [String: Any]) in
        view.configure(value)
      }
    }
  }
}
