import ExpoModulesCore

public final class MetronomyControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetronomyControls")
    Constants {
      if #available(iOS 17.4, *) { return ["supportsNativeMenus": true] }
      return ["supportsNativeMenus": false]
    }
    View(MetronomyButtonView.self) {
      Events("onAction")
      Prop("configuration") { (view: MetronomyButtonView, value: [String: Any]) in view.configure(value) }
    }
    View(MetronomySliderView.self) {
      Events("onAction")
      Prop("configuration") { (view: MetronomySliderView, value: [String: Any]) in view.configure(value) }
    }
    View(MetronomySegmentsView.self) {
      Events("onAction")
      Prop("configuration") { (view: MetronomySegmentsView, value: [String: Any]) in view.configure(value) }
    }
    View(MetronomyMenuView.self) {
      Events("onAction")
      Prop("configuration") { (view: MetronomyMenuView, value: [String: Any]) in view.configure(value) }
    }
  }
}
