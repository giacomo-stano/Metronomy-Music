import ExpoModulesCore
import MediaPlayer
import UIKit

public final class MetronomySystemVolumeView: ExpoView {
  private let volumeView = MPVolumeView(frame: .zero)

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    clipsToBounds = false

    volumeView.backgroundColor = .clear
    volumeView.showsVolumeSlider = true
    volumeView.showsRouteButton = false
    volumeView.clipsToBounds = false

    addSubview(volumeView)
    styleSlider()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    volumeView.frame = bounds
    styleSlider()
  }

  private func styleSlider() {
    guard let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first else {
      return
    }

    slider.minimumTrackTintColor = UIColor.white.withAlphaComponent(0.82)
    slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.22)
    slider.thumbTintColor = UIColor.white
  }
}
