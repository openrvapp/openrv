require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'GatewayWifi'
  s.version        = package['version']
  s.summary        = 'Joins the OpenRV gateway update Wi-Fi and uploads firmware over it'
  s.license        = 'MIT'
  s.author         = 'OpenRV'
  s.homepage       = 'https://github.com/openrvapp/openrv'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/openrvapp/openrv.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NetworkExtension'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
