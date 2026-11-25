import ContactsUI
import ExpoModulesCore
import MessageUI
import UIKit

public final class ContactInvitesModule: Module {
  private let presentation = InvitePresentation()

  public func definition() -> ModuleDefinition {
    Name("ContactInvites")

    AsyncFunction("pickPhone") { (id: Int, promise: Promise) in
      let picker = CNContactPickerViewController()
      picker.delegate = self.presentation
      picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
      picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
      picker.predicateForSelectionOfContact = NSPredicate(value: false)
      picker.predicateForSelectionOfProperty = NSPredicate(format: "key == %@", CNContactPhoneNumbersKey)
      self.presentation.present(
        picker, id: id, promise: promise,
        from: self.appContext?.utilities?.currentViewController()
      )
    }.runOnQueue(.main)

    AsyncFunction("composeText") { (id: Int, number: String, body: String, promise: Promise) in
      guard MFMessageComposeViewController.canSendText() else {
        promise.resolve("unavailable")
        return
      }
      let composer = MFMessageComposeViewController()
      composer.messageComposeDelegate = self.presentation
      composer.recipients = [number]
      composer.body = body
      self.presentation.present(
        composer, id: id, promise: promise,
        from: self.appContext?.utilities?.currentViewController()
      )
    }.runOnQueue(.main)

    AsyncFunction("cancel") { (id: Int) in
      self.presentation.cancel(id)
    }.runOnQueue(.main)

    OnDestroy {
      let presentation = self.presentation
      DispatchQueue.main.async { presentation.invalidate() }
    }
  }
}

private final class InvitePresentation: NSObject, CNContactPickerDelegate,
  MFMessageComposeViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
  private struct Result {
    let status: String
    var number: String? = nil
  }

  private final class Operation {
    let controller: UIViewController
    let id: Int
    let promise: Promise
    weak var presenter: UIViewController?
    let startedAt = ProcessInfo.processInfo.systemUptime
    var presented = false
    var waitingForDismissal = false
    var result: Result?

    init(_ controller: UIViewController, id: Int, promise: Promise) {
      self.controller = controller
      self.id = id
      self.promise = promise
    }

    func resolve(_ result: Result) {
      if controller is CNContactPickerViewController {
        var response = ["status": result.status]
        response["number"] = result.number
        promise.resolve(response)
      } else {
        promise.resolve(result.status)
      }
    }
  }

  private var active: Operation?
  private var invalidated = false

  func present(_ controller: UIViewController, id: Int, promise: Promise, from presenter: UIViewController?) {
    let operation = Operation(controller, id: id, promise: promise)
    guard !invalidated, active == nil, let presenter, presenter.viewIfLoaded?.window != nil,
          presenter.presentedViewController == nil, !presenter.isBeingDismissed,
          !presenter.isBeingPresented, presenter.transitionCoordinator == nil else {
      operation.resolve(Result(status: "unavailable"))
      return
    }
    active = operation
    operation.presenter = presenter
    controller.presentationController?.delegate = self
    presenter.present(controller, animated: true) { [weak self, weak operation] in
      guard let operation, self?.active === operation else { return }
      operation.presented = true
      operation.controller.presentationController?.delegate = self
      self?.advanceDismissal(operation)
    }
    observe(operation)
  }

  func cancel(_ id: Int) {
    guard let operation = active, operation.id == id else { return }
    // Drop any selected number immediately, including while dismissal is animating.
    operation.result = Result(status: "cancelled")
    advanceDismissal(operation)
  }

  func invalidate() {
    invalidated = true
    guard let operation = active else { return }
    cancel(operation.id)
  }

  func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
    complete(picker, Result(status: "cancelled"))
  }

  func contactPicker(_ picker: CNContactPickerViewController, didSelect property: CNContactProperty) {
    let number = (property.value as? CNPhoneNumber)?.stringValue
    complete(picker, Result(status: number == nil ? "noPhone" : "selected", number: number))
  }

  func messageComposeViewController(
    _ controller: MFMessageComposeViewController,
    didFinishWith result: MessageComposeResult
  ) {
    let status = result == .failed ? "unavailable" : result == .cancelled ? "cancelled" : "closed"
    complete(controller, Result(status: status))
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard let operation = active,
          operation.controller === presentationController.presentedViewController else { return }
    finishIfDetached(operation, fallback: "cancelled")
  }

  private func complete(_ controller: UIViewController, _ result: Result) {
    guard let operation = active, operation.controller === controller,
          operation.result == nil else { return }
    operation.result = result
    // ContactsUI automatically dismisses after a selection. Let it start that transition first.
    DispatchQueue.main.async { [weak self, weak operation] in
      if let operation { self?.advanceDismissal(operation) }
    }
  }

  private func advanceDismissal(_ operation: Operation) {
    guard active === operation, operation.result != nil, operation.presented,
          !operation.waitingForDismissal else { return }
    let controller = operation.controller
    guard !controller.isBeingPresented else { return }
    if let transition = controller.transitionCoordinator ?? operation.presenter?.transitionCoordinator {
      operation.waitingForDismissal = transition.animate(alongsideTransition: nil) { [weak self, weak operation] _ in
        guard let operation else { return }
        operation.waitingForDismissal = false
        self?.finishIfDetached(operation, fallback: "cancelled")
      }
      return
    }
    guard !controller.isBeingDismissed, controller.presentingViewController != nil else { return }
    operation.waitingForDismissal = true
    controller.dismiss(animated: true) { [weak self, weak operation] in
      guard let operation else { return }
      operation.waitingForDismissal = false
      self?.finishIfDetached(operation, fallback: "cancelled")
    }
  }

  private func finishIfDetached(_ operation: Operation, fallback: String) {
    let controller = operation.controller
    // The JS caller may begin composing immediately after resolution.
    guard active === operation,
          controller.presentingViewController == nil,
          operation.presenter?.presentedViewController !== controller,
          controller.viewIfLoaded?.window == nil,
          !controller.isBeingPresented, !controller.isBeingDismissed,
          controller.transitionCoordinator == nil,
          operation.presenter?.transitionCoordinator == nil else { return }
    let result = operation.result ?? Result(status: fallback)
    active = nil
    operation.result = nil
    operation.resolve(result)
  }

  private func observe(_ operation: Operation) {
    // UIKit has no failure callback for a declined presentation and the adaptive
    // delegate does not cover programmatic dismissal. Keep the lock until detachment.
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(250)) { [self, weak operation] in
      guard let operation, self.active === operation else { return }
      let controller = operation.controller
      let attached = controller.presentingViewController != nil &&
        (operation.presented || controller.viewIfLoaded?.window != nil ||
          controller.isBeingPresented || controller.isBeingDismissed)
      if attached {
        operation.presented = true
        self.advanceDismissal(operation)
      } else if operation.presented || ProcessInfo.processInfo.systemUptime - operation.startedAt >= 1 {
        self.finishIfDetached(operation, fallback: operation.presented ? "cancelled" : "unavailable")
      }
      if self.active === operation { self.observe(operation) }
    }
  }
}
