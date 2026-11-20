require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MoodSenseIosUsage'
  s.version        = package['version']
  s.summary        = 'iOS call-length (CallKit), device unlock (data protection) and app-category usage (Screen Time) sensing for MoodSense.'
  s.description    = 'Local Expo module. CallKit gives call start/end with no number, contact or audio; the data-protection notifications give device lock/unlock, which is the only phone pick-up signal iOS exposes; DeviceActivity gives per-category usage threshold crossings for participant-selected app sets.'
  s.author         = 'MoodSense'
  s.homepage       = 'https://anonymous.4open.science/r/moodsense-demo-7K3Q'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://anonymous.4open.science/r/moodsense-demo-7K3Q' }
  s.license        = 'MIT'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
