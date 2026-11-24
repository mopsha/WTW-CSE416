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
    let startedAt = ProcessInfo.processInfo.systemUptime
    var presented = false
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

  func present(_ controller: UIViewController, id: Int, promise: Promise, from presenter: UIViewController?) {
    let operation = Operation(controller, id: id, promise: promise)
    guard active == nil, let presenter, presenter.viewIfLoaded?.window != nil,
          presenter.presentedViewController == nil, !presenter.isBeingDismissed,
          !presenter.isBeingPresented, presenter.transitionCoordinator == nil else {
      operation.resolve(Result(status: "unavailable"))
      return
    }
    active = operation
    controller.presentationController?.delegate = self
    presenter.present(controller, animated: true) { [weak self, weak operation] in
      guard let operation, self?.active === operation else { return }
      operation.presented = true
      operation.controller.presentationController?.delegate = self
    }
    observe(operation)
  }

  func cancel(_ id: Int) {
    guard let operation = active, operation.id == id else { return }
    // Drop any selected number immediately, including while dismissal is animating.
    operation.result = Result(status: "cancelled")
    dismissIfPossible(operation)
  }

  func invalidate() {
    guard let operation = active else { return }
    cancel(operation.id)
    settle(operation, fallback: "cancelled")
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
    settle(operation, fallback: "cancelled")
  }

  private func complete(_ controller: UIViewController, _ result: Result) {
    guard let operation = active, operation.controller === controller,
          operation.result == nil else { return }
    operation.result = result
    // ContactsUI automatically dismisses after a selection. Let it start that transition first.
    DispatchQueue.main.async { [weak self, weak operation] in
      if let operation { self?.dismissIfPossible(operation) }
    }
  }

  private func dismissIfPossible(_ operation: Operation) {
    let controller = operation.controller
    guard active === operation, controller.presentingViewController != nil,
          !controller.isBeingDismissed, !controller.isBeingPresented else { return }
    controller.dismiss(animated: true) { [weak self, weak operation] in
      if let operation { self?.settle(operation, fallback: "cancelled") }
    }
  }

  private func settle(_ operation: Operation, fallback: String) {
    guard active === operation else { return }
    let result = operation.result ?? Result(status: fallback)
    active = nil
    operation.result = nil
    operation.resolve(result)
  }

  private func observe(_ operation: Operation) {
    // UIKit has no failure callback for a declined presentation and the adaptive
    // delegate does not cover programmatic dismissal. Keep the lock until detachment.
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(250)) { [weak self, weak operation] in
      guard let self, let operation, self.active === operation else { return }
      let controller = operation.controller
      let attached = controller.presentingViewController != nil &&
        (operation.presented || controller.viewIfLoaded?.window != nil ||
          controller.isBeingPresented || controller.isBeingDismissed)
      if attached {
        operation.presented = true
        if operation.result != nil { self.dismissIfPossible(operation) }
      } else if operation.presented || ProcessInfo.processInfo.systemUptime - operation.startedAt >= 1 {
        self.settle(operation, fallback: operation.presented ? "cancelled" : "unavailable")
        return
      }
      self.observe(operation)
    }
  }
}
