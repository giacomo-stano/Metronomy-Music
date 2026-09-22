import ExpoModulesCore

public final class MetronomyAirPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetronomyAirPlay")

    View(MetronomyAirPlayView.self) {}
  }
}
