import AVKit
import ExpoModulesCore
import UIKit

public final class MetronomyAirPlayView: ExpoView {
  private let routePicker = AVRoutePickerView(frame: .zero)

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    clipsToBounds = false

    routePicker.backgroundColor = .clear
    routePicker.prioritizesVideoDevices = false
    routePicker.tintColor = UIColor.white.withAlphaComponent(0.72)
    routePicker.activeTintColor = UIColor.white

    addSubview(routePicker)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    routePicker.frame = bounds
  }
}
