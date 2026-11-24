import PushKit
import CallKit

// Application integration example, not a standalone client or a verified device build.
// Retain this instance for app lifetime and provide authenticated networking closures.
final class IncomingCallPush: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
    private let registry = PKPushRegistry(queue: .main)
    private let provider = CXProvider(configuration: CXProviderConfiguration())
    private let publish: (String) -> Void
    private let revoke: () -> Void

    init(publish: @escaping (String) -> Void, revoke: @escaping () -> Void) {
        self.publish = publish
        self.revoke = revoke
        super.init()
        provider.setDelegate(self, queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
    }
    func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        // POST destinations with purpose=voip, platform=ios through current auth.
        publish(credentials.token.map { String(format: "%02x", $0) }.joined())
    }
    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        if type == .voIP { revoke() } // DELETE the exact stored safe destination generation.
    }
    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP,
              let data = payload.dictionaryPayload["data"] as? [String: String],
              let callId = data["callId"], let id = UUID(uuidString: callId) else {
            completion()
            return // A malformed push is a server contract defect; do not use this as a wakeup mechanism.
        }
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: "Incoming call")
        update.hasVideo = false
        // Report immediately; do not wait for a network request before reporting.
        provider.reportNewIncomingCall(with: id, update: update) { _ in completion() }
    }
    func providerDidReset(_ provider: CXProvider) {
        // App must terminate/reset active media calls and its matching application call state here.
    }
}
