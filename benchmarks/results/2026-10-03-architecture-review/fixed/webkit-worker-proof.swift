import Cocoa
import WebKit
final class Probe: NSObject, WKURLSchemeHandler, WKScriptMessageHandler {
  var web: WKWebView!
  let html = """
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; worker-src 'self' blob:; script-src 'self' blob: asyar-extension: 'unsafe-inline'">
  <script>
  const code = `self.__ASYAR_ROLE__='worker'; import('asyar-extension://org.probe/assets/daemon.js').catch(e=>self.postMessage({error:String(e)}));`;
  const blobUrl = URL.createObjectURL(new Blob([code], {type:'application/javascript'}));
  const w = new Worker(blobUrl, {type:'module'});
  URL.revokeObjectURL(blobUrl);
  w.onmessage = e => window.webkit.messageHandlers.proof.postMessage(JSON.stringify(e.data));
  w.onerror = e => window.webkit.messageHandlers.proof.postMessage(JSON.stringify({error:e.message}));
  </script>
  """
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    let script = url.path.hasSuffix("daemon.js") ? "import {answer} from './dependency.js'; self.postMessage({role:self.__ASYAR_ROLE__, dom:typeof document, answer});" : "export const answer=42;"
    let data = (url.scheme == "asyar-app" ? html : script).data(using: .utf8)!
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": url.scheme == "asyar-app" ? "text/html" : "application/javascript", "Access-Control-Allow-Origin":"*"])!)
    task.didReceive(data); task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    print(message.body); fflush(stdout); exit(0)
  }
  func run() {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(self, forURLScheme:"asyar-app")
    config.setURLSchemeHandler(self, forURLScheme:"asyar-extension")
    config.userContentController.add(self, name:"proof")
    web = WKWebView(frame:NSRect(x:0,y:0,width:400,height:300), configuration:config)
    web.load(URLRequest(url:URL(string:"asyar-app://localhost/")!))
    DispatchQueue.main.asyncAfter(deadline:.now()+20) { print("TIMEOUT"); exit(2) }
  }
}
let app = NSApplication.shared
let probe = Probe(); probe.run(); app.run()
