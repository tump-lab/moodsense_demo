require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MoodSenseBackgroundSensing'
  s.version        = package['version']
  s.summary        = 'Reads CoreMotion activity history for MoodSense.'
  s.description    = 'Local Expo module. iOS records motion activity whether or not the app runs and keeps about seven days of it; this reads it back so gaps while the app was closed are recovered.'
  s.author         = 'MoodSense'
  s.homepage       = 'https://anonymous.4open.science/r/moodsense-demo-7K3Q'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://anonymous.4open.science/r/moodsense-demo-7K3Q' }
  s.license        = 'MIT'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMotion'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
