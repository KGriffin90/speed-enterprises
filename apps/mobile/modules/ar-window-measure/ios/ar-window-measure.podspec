require 'json'
# Podspec lives in ios/ (required: expo-modules-autolinking only discovers
# podspecs one directory below the module root); package.json is one level up.
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ar-window-measure'
  s.version        = package['version']
  s.summary        = package['description']
  s.author         = { 'Speed Enterprises' => 'dev@speedenterprises.app' }
  s.homepage       = 'https://github.com/speedenterprises/mobile'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '13.4' }
  s.source         = { :path => '.' }
  s.source_files   = '**/*.{swift,h,m}'
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # ARKit + Vision + SceneKit are system frameworks — no extra pods needed
  s.frameworks = 'ARKit', 'Vision', 'SceneKit', 'AVFoundation'
end
