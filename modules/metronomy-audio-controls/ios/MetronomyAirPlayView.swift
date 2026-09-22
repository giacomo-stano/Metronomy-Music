import AVKit
import ExpoModulesCore
import UIKit

public final class MetronomyAirPlayView: ExpoView {
  private var routePicker: AVRoutePickerView?
  private var installScheduled = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    clipsToBounds = false
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()

    guard window != nil, routePicker == nil, !installScheduled else {
      return
    }

    installScheduled = true

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.installScheduled = false

      guard self.window != nil, self.routePicker == nil else {
        return
      }

      let picker = AVRoutePickerView(frame: self.bounds)
      picker.backgroundColor = .clear
      picker.prioritizesVideoDevices = false
      picker.tintColor = UIColor.white.withAlphaComponent(0.72)
      picker.activeTintColor = UIColor.white
      picker.autoresizingMask = [.flexibleWidth, .flexibleHeight]

      self.addSubview(picker)
      self.routePicker = picker
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    routePicker?.frame = bounds
  }
}
