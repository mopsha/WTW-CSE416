#!/usr/bin/env bash
# Run with bash tests/native/contact_invite_presentation.sh using Swift.
# Exercise the source coordinator with modeled UIKit transitions. Device QA still
# needs to verify the callbacks ContactsUI actually delivers.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

{
cat <<'SWIFT'
class NSObject {}
struct ProcessInfo {
  static let processInfo = ProcessInfo()
  let systemUptime = 0.0
}

struct DispatchTime {
  static func now() -> Self { Self() }
  static func milliseconds(_ value: Int) -> Self { Self() }
  static func + (lhs: Self, rhs: Self) -> Self { lhs }
}

final class DispatchQueue {
  static let main = DispatchQueue()
  private var queued: [() -> Void] = []
  private var delayed: [() -> Void] = []
  func async(execute: @escaping () -> Void) { queued.append(execute) }
  func asyncAfter(deadline: DispatchTime, execute: @escaping () -> Void) { delayed.append(execute) }
  func drain() {
    while !queued.isEmpty { queued.removeFirst()() }
  }
  func tick() {
    let callbacks = delayed
    delayed = []
    callbacks.forEach { $0() }
  }
}

protocol CNContactPickerDelegate {}
protocol MFMessageComposeViewControllerDelegate {}
protocol UIAdaptivePresentationControllerDelegate {}

final class Promise {
  var values: [Any] = []
  func resolve(_ value: Any) { values.append(value) }
}

final class Transition {
  struct Context {}
  var completion: ((Context) -> Void)?
  func animate(alongsideTransition: ((Context) -> Void)?, completion: @escaping (Context) -> Void) -> Bool {
    self.completion = completion
    return true
  }
}

class UIViewController: NSObject {
  final class View { var window: NSObject? = NSObject() }

  let viewIfLoaded: View? = View()
  weak var presentingViewController: UIViewController?
  var presentedViewController: UIViewController?
  var presentationController: UIPresentationController?
  var transitionCoordinator: Transition?
  var isBeingDismissed = false
  var isBeingPresented = false
  var dismissals = 0
  var dismissal: (() -> Void)?

  func present(_ child: UIViewController, animated: Bool, completion: () -> Void) {
    presentedViewController = child
    child.presentingViewController = self
    child.presentationController = UIPresentationController(child)
    completion()
  }

  func dismiss(animated: Bool, completion: @escaping () -> Void) {
    dismissals += 1
    isBeingDismissed = true
    dismissal = completion
  }

  func detach() {
    presentingViewController?.presentedViewController = nil
    presentingViewController = nil
    viewIfLoaded?.window = nil
    isBeingDismissed = false
    transitionCoordinator = nil
  }
}

final class UIPresentationController {
  weak var delegate: AnyObject?
  unowned let presentedViewController: UIViewController
  init(_ controller: UIViewController) { presentedViewController = controller }
}

final class CNContactPickerViewController: UIViewController {}
final class MFMessageComposeViewController: UIViewController {}
struct CNContactProperty { let value: Any }
struct CNPhoneNumber { let stringValue: String }
enum MessageComposeResult { case failed, cancelled, sent }
SWIFT

sed -n '/^private final class InvitePresentation:/,$p' \
  "$root/modules/contact-invites/ios/ContactInvitesModule.swift"

cat <<'SWIFT'

private let driver = InvitePresentation()
let host = UIViewController()
let picker = CNContactPickerViewController()
let picked = Promise()
driver.present(picker, id: 1, promise: picked, from: host)

let automaticDismissal = Transition()
picker.isBeingDismissed = true
picker.transitionCoordinator = automaticDismissal
driver.contactPicker(picker, didSelect: CNContactProperty(value: CNPhoneNumber(stringValue: "5551234")))
DispatchQueue.main.drain()
precondition(picked.values.isEmpty && picker.dismissals == 0)

let early = Promise()
driver.present(MFMessageComposeViewController(), id: 1, promise: early, from: host)
precondition(early.values.count == 1 && early.values[0] as? String == "unavailable")
driver.presentationControllerDidDismiss(picker.presentationController!)
precondition(picked.values.isEmpty)
picker.detach()
host.transitionCoordinator = automaticDismissal
automaticDismissal.completion?(.init())
precondition(picked.values.isEmpty)
host.transitionCoordinator = nil
DispatchQueue.main.tick()
precondition(picked.values.count == 1 && (picked.values[0] as? [String: String])?["status"] == "selected")

let composer = MFMessageComposeViewController()
let composed = Promise()
driver.present(composer, id: 1, promise: composed, from: host)
driver.contactPickerDidCancel(picker) // A stale picker delegate must leave the composer alone.
driver.messageComposeViewController(composer, didFinishWith: .sent)
driver.cancel(1) // Account change wins while the composer is dismissing.
DispatchQueue.main.drain()
precondition(composed.values.isEmpty && composer.dismissals == 1)
composer.detach()
composer.dismissal?()
driver.presentationControllerDidDismiss(composer.presentationController!)
precondition(composed.values.count == 1 && composed.values[0] as? String == "cancelled")

let stalePicker = CNContactPickerViewController()
let invalidated = Promise()
driver.present(stalePicker, id: 2, promise: invalidated, from: host)
driver.contactPicker(stalePicker, didSelect: CNContactProperty(value: CNPhoneNumber(stringValue: "5556789")))
driver.invalidate()
DispatchQueue.main.drain()
precondition(invalidated.values.isEmpty && stalePicker.dismissals == 1)
stalePicker.detach()
DispatchQueue.main.tick() // A detached operation can finish if UIKit omitted a callback.
stalePicker.dismissal?()
let response = invalidated.values.first as? [String: String]
precondition(invalidated.values.count == 1 && response?["status"] == "cancelled" && response?["number"] == nil)
print("PASS: picker detachment gates composing, and stale callbacks and cancellation settle once.")
SWIFT
} > "$work/check.swift"

swift -module-cache-path "$work/cache" "$work/check.swift"
