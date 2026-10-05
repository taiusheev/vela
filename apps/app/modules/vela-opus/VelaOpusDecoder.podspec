require 'json'
root = __dir__
sources = JSON.parse(File.read(File.join(root, 'generated/sources.json')))
Pod::Spec.new do |s|
  s.name = 'VelaOpusDecoder'
  s.version = '0.1.0'
  s.summary = 'Local bounded Ogg Opus playback decoder'
  s.description = 'Pinned Xiph source, local decoding only; no HTTP library or external processor.'
  s.license = { :type => 'BSD-3-Clause', :file => 'licenses/opusfile.txt' }
  s.author = 'Vela'
  s.homepage = 'https://opus-codec.org/'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = ['ios/*.{swift,h,c}'] + sources
  s.public_header_files = 'ios/VelaOpusDecoder.h'
  s.preserve_paths = ['vendor/**', 'generated/**', 'licenses/**']
  s.resource_bundles = { 'VelaOpusLicenses' => ['licenses/*.txt'] }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.9',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAVE_CONFIG_H OPUS_BUILD',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/generated" "${PODS_TARGET_SRCROOT}/vendor/opus" "${PODS_TARGET_SRCROOT}/vendor/opus/include" "${PODS_TARGET_SRCROOT}/vendor/opus/celt" "${PODS_TARGET_SRCROOT}/vendor/opus/silk" "${PODS_TARGET_SRCROOT}/vendor/opus/silk/float" "${PODS_TARGET_SRCROOT}/vendor/opus/dnn" "${PODS_TARGET_SRCROOT}/vendor/ogg/include" "${PODS_TARGET_SRCROOT}/vendor/opusfile/include" "${PODS_TARGET_SRCROOT}/vendor/opusfile/src"'
  }
end
