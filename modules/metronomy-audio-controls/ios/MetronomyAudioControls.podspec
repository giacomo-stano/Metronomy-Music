Pod::Spec.new do |s|
  s.name           = 'MetronomyAudioControls'
  s.version        = '1.0.0'
  s.summary        = 'Native iOS AirPlay and system volume controls for Metronomy'
  s.description    = 'Expo local module exposing AVRoutePickerView and MPVolumeView.'
  s.license        = 'MIT'
  s.author         = 'Metronomy'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
