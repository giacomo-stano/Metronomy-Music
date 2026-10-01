import ExpoModulesCore
import MediaPlayer
import UIKit

public final class MetronomySystemVolumeView: ExpoView {
  private var volumeView: MPVolumeView?
  private var installScheduled = false
  private weak var styledSlider: UISlider?

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

    guard styledSlider !== slider else { return }
    styledSlider = slider
    slider.minimumTrackTintColor = UIColor.white.withAlphaComponent(0.82)
    slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.22)
    // Keep MPVolumeView in charge of system volume and AirPlay routing.
    // A capsule track grows without changing layout or replacing its slider.
    slider.setMinimumTrackImage(trackImage(color: UIColor.white.withAlphaComponent(0.82)), for: .normal)
    slider.setMaximumTrackImage(trackImage(color: UIColor.white.withAlphaComponent(0.22)), for: .normal)
    slider.setThumbImage(UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).image { _ in }, for: .normal)
    slider.addTarget(self, action: #selector(beginInteraction), for: [.touchDown, .touchDragEnter])
    slider.addTarget(self, action: #selector(endInteraction), for: [.touchUpInside, .touchUpOutside, .touchCancel])
  }

  private func trackImage(color: UIColor) -> UIImage {
    let image = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 5)).image { _ in
      color.setFill()
      UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 10, height: 5), cornerRadius: 2.5).fill()
    }
    return image.resizableImage(withCapInsets: UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4))
  }

  @objc private func beginInteraction(_ slider: UISlider) {
    guard !UIAccessibility.isReduceMotionEnabled else { return }
    UIView.animate(withDuration: 0.12, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      slider.transform = CGAffineTransform(scaleX: 1, y: 2)
    }
  }

  @objc private func endInteraction(_ slider: UISlider) {
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.22, delay: 0,
      usingSpringWithDamping: 0.88, initialSpringVelocity: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      slider.transform = .identity
    }
  }
}
