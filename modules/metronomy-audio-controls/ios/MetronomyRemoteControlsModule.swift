import ExpoModulesCore
import MediaPlayer

public final class MetronomyRemoteControlsModule: Module {
  private var commandsRegistered = false

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

    guard !commandsRegistered else {
      return
    }

    center.nextTrackCommand.addTarget(
      self,
      action: #selector(handleNextTrack(_:))
    )

    center.previousTrackCommand.addTarget(
      self,
      action: #selector(handlePreviousTrack(_:))
    )

    commandsRegistered = true
  }

  private func disableRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()

    if commandsRegistered {
      center.nextTrackCommand.removeTarget(
        self,
        action: #selector(handleNextTrack(_:))
      )

      center.previousTrackCommand.removeTarget(
        self,
        action: #selector(handlePreviousTrack(_:))
      )

      commandsRegistered = false
    }

    center.nextTrackCommand.isEnabled = false
    center.previousTrackCommand.isEnabled = false
  }

  @objc
  private func handleNextTrack(
    _ event: MPRemoteCommandEvent
  ) -> MPRemoteCommandHandlerStatus {
    sendEvent("onNextTrack", [:])
    return .success
  }

  @objc
  private func handlePreviousTrack(
    _ event: MPRemoteCommandEvent
  ) -> MPRemoteCommandHandlerStatus {
    sendEvent("onPreviousTrack", [:])
    return .success
  }
}
