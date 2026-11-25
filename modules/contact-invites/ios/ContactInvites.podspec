Pod::Spec.new do |s|
  s.name = 'ContactInvites'
  s.version = '1.0.0'
  s.summary = 'Scoped contact invitations for WTW'
  s.description = s.summary
  s.homepage = 'https://github.com/mopsha/WTW-CSE416'
  s.author = 'WTW'
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.source = { :git => s.homepage }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ContactsUI', 'MessageUI'
  s.source_files = '**/*.swift'
end
