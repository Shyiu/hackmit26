import Capacitor
import UIKit
import WebKit

/// Capacitor's bridge view controller with one change: camera and mic requests from the web view
/// are granted only for the configured server origin (CAP_SERVER_URL). Stock Capacitor 8 grants
/// every origin, including any iframe or page the web view ends up on.
class BridgeViewController: CAPBridgeViewController {
    private var mediaCapturePolicy: MediaCapturePolicy?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView, let serverURL = bridge?.config.serverURL else { return }
        // WKWebView holds its uiDelegate weakly, so this controller keeps the policy alive.
        let policy = MediaCapturePolicy(allowedServerURL: serverURL, fallback: webView.uiDelegate)
        mediaCapturePolicy = policy
        webView.uiDelegate = policy
    }
}

/// Answers media capture requests itself and forwards every other WKUIDelegate call (alerts,
/// confirms, file pickers) to Capacitor's own delegate.
final class MediaCapturePolicy: NSObject, WKUIDelegate {
    private let allowedServerURL: URL
    private weak var fallback: WKUIDelegate?

    init(allowedServerURL: URL, fallback: WKUIDelegate?) {
        self.allowedServerURL = allowedServerURL
        self.fallback = fallback
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (fallback?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        fallback
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(isAllowed(origin) ? .grant : .deny)
    }

    private func isAllowed(_ origin: WKSecurityOrigin) -> Bool {
        // Only a remote https server gets the camera. The bundled placeholder page never asks.
        guard allowedServerURL.scheme == "https", let host = allowedServerURL.host else { return false }
        let port = allowedServerURL.port ?? 443
        let originPort = origin.port == 0 ? 443 : origin.port
        return origin.protocol == "https"
            && origin.host.caseInsensitiveCompare(host) == .orderedSame
            && originPort == port
    }
}
