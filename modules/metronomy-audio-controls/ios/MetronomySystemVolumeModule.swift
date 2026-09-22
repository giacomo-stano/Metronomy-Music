import ExpoModulesCore

public final class MetronomySystemVolumeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetronomySystemVolume")

    View(MetronomySystemVolumeView.self) {}
  }
}
