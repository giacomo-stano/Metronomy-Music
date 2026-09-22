import ExpoModulesCore
import MediaPlayer

public final class MetronomyRemoteControlsModule: Module {
  private var nextTarget: Any?
  private var previousTarget: Any?

  public func definition() -> ModuleDefinition {
    Name("MetronomyRemoteControls")

    Events("onNextTrack", "onPreviousTrack")

    Function("setEnabled") { (enabled: Bool) in
      if enabled {
        self.enableRemoteCommands()
      } else {
        self.disableRemoteCommands()
      }
    }
  }

  private func enableRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()

    center.nextTrackCommand.isEnabled = true
    center.previousTrackCommand.isEnabled = true

    if nextTarget == nil {
      nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
        guard let self else {
          return .commandFailed
        }

        self.sendEvent("onNextTrack", [:])
        return .success
      }
    }

    if previousTarget == nil {
      previousTarget = center.previousTrackCommand.addTarget { [weak self] _ in
        guard let self else {
          return .commandFailed
        }

        self.sendEvent("onPreviousTrack", [:])
        return .success
      }
    }
  }

  private func disableRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()

    if let nextTarget {
      center.nextTrackCommand.removeTarget(nextTarget)
      self.nextTarget = nil
    }

    if let previousTarget {
      center.previousTrackCommand.removeTarget(previousTarget)
      self.previousTarget = nil
    }

    center.nextTrackCommand.isEnabled = false
    center.previousTrackCommand.isEnabled = false
  }
}
