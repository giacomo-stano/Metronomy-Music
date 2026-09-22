import ExpoModulesCore
import MediaPlayer
import UIKit

public final class MetronomySystemVolumeView: ExpoView {
  private var volumeView: MPVolumeView?
  private var installScheduled = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    clipsToBounds = false
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()

    guard window != nil, volumeView == nil, !installScheduled else {
      return
    }

    installScheduled = true

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.installScheduled = false

      guard self.window != nil, self.volumeView == nil else {
        return
      }

      let volumeView = MPVolumeView(frame: self.bounds)
      volumeView.backgroundColor = .clear
      volumeView.showsVolumeSlider = true
      volumeView.showsRouteButton = false
      volumeView.clipsToBounds = false
      volumeView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

      self.addSubview(volumeView)
      self.volumeView = volumeView
      self.styleSlider()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    volumeView?.frame = bounds
    styleSlider()
  }

  private func styleSlider() {
    guard
      let volumeView,
      let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first
    else {
      return
    }

    slider.minimumTrackTintColor = UIColor.white.withAlphaComponent(0.82)
    slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.22)
    slider.thumbTintColor = UIColor.white
  }
}
