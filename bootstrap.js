/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let Cu = Components.utils, Ci = Components.interfaces, Cc = Components.classes;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
XPCOMUtils.defineLazyGetter(this, "AddSearch", function () {
  let url = "chrome://addtosearchbox/content/AddSearch.js";

  var obj = Object.create(null);
  Services.scriptloader.loadSubScript(url, obj);
  return obj.AddSearch;
});

function log(msg) {
  Services.console.logStringMessage(msg);
}

function searchEngineByFile(file) {
  let engines = Services.search.getEngines();
  for (let i = 0; i < engines.length; i++) {
    if (file.equals(engines[i].wrappedJSObject._file)) {
      log("found an engine by file name");
      return engines[i];
    }
  }
  log("found no engine by file name");
  return null;
}
function streamToString(inputStream) {
  if (inputStream === null)
    return null;

  let stream = Cc["@mozilla.org/scriptableinputstream;1"]
                 .createInstance(Ci.nsIScriptableInputStream);
  stream.init(inputStream);

  let data = [];
  while(true) {
    let buf = stream.read(4096);
    if (buf.length === 0)
      break;

    data.push(buf);
  }
  stream.close();
  return data.join("");
}
function findDuplicateEngine(engine) {
  let search = Math.random().toString();
  let submission = engine.getSubmission(search);
  let post = streamToString(submission.postData);

  let engines = Services.search.getEngines();
  for (let i = 0; i < engines.length; i++) {
    let cur = engines[i].getSubmission(search);
    if (cur.uri.spec === submission.uri.spec &&
      streamToString(cur.postData) === post &&
      engine.wrappedJSObject != engines[i].wrappedJSObject) {
      log("found an engine by file name");
      return engines[i];
    }
  }
  log("found no duplicate engine");
  return null;
}

function install(data, reason) {
  let dir = Services.dirsvc.get("UsrSrchPlugns", Ci.nsIFile);
  let files = dir.directoryEntries.QueryInterface(Ci.nsIDirectoryEnumerator);
  while (files.hasMoreElements()) {
    let file = files.nextFile;

    if (file.isFile() && file.fileSize !== 0 && !file.isHidden()) {
      let url = NetUtil.ioService.newFileURI(file).QueryInterface(Ci.nsIURL);
      let ext = url.fileExtension.toLowerCase();
      if (ext == "undefined") {
        log("found .undefined search engine: " + url.spec);
        let engine = searchEngineByFile(file);
        let cleanup = function() {};
        let callback = {
          'onSuccess': function(newEngine) {
            if (engine) {
              let current = Services.search.currentEngine;
              Services.search.removeEngine(current);

              if (current === engine) {
                log("setting current engine to moved engine.");
                Services.search.currentEngine = newEngine;
              }
              file.remove(false);
              log(".undefined engine re-created and removed.");
            } else {
              let duplicate = findDuplicateEngine(newEngine);
              if (duplicate) {
                log("removed newly created engine.");
                Services.search.removeEngine(newEngine);
              }

              file.remove(false);
              log(".undefined file removed.");
            }
            cleanup();
          },
          'onError': function(error) { cleanup(); }
        };
        let urlstr = url.spec;
        if (engine) {
          file.copyTo(dir, file.leafName + ".xml");
          url.spec += ".xml";

          cleanup = function () {
            let copy = dir.clone();
            copy.append(file.leafName + ".xml");
            if (copy.exists())
              copy.remove(false);
          };
        }
        Services.search.addEngine(urlstr, Ci.nsISearchEngine.TYPE_MOZSEARCH,
                null, false, callback);
      }
    }
  }
}
function uninstall(data, reason) {}
function shutdown(data, reason) { startupShutdown(false); }
function startup(data, reason) { startupShutdown(true); }

function startupShutdown(isStartup) {
  let maybe_un = isStartup ? "" : "un";

  Services.ww[maybe_un + "registerNotification"](windowObserver);

  let wins = Services.wm.getEnumerator("navigator:browser");
  while (wins.hasMoreElements()) {
    windowObserver[maybe_un + "injectWindow"](wins.getNext().document);
  }
};



const stylesheetProc = 'href="chrome://addtosearchbox/skin/browser.css" type="text/css"';
const windowObserver = {
  observe(subject, topic, data) {
    if (topic == "domwindowopened") {
      subject.QueryInterface(Ci.nsIDOMWindow).addEventListener("load", () => {
        subject.removeEventListener("load", arguments.callee);
        this.injectWindow(subject.document);
      });
    }
  },
  uninjectWindow(doc) {
    let elem = doc.getElementById("context-searchfield");
    if (elem) {
      elem.parentNode.removeEventListener("popupshowing", ContextMenu.onPopupShowing);
      elem.parentNode.removeChild(elem);
    }

    let node = doc.documentElement;
    while ((node = node.previousSibling)) {
      if (node.nodeName === "xml-stylesheet" && node.nodeValue === stylesheetProc) {
        doc.removeChild(node);
        break;
      }
    }
  },
  injectWindow(doc) {
    if (doc.documentElement.getAttribute("windowtype") != "navigator:browser") return;
    if (doc.getElementById("context-searchfield")) return;

    let url = "chrome://addtosearchbox/locale/browser.properties";
    let bundle = Services.strings.createBundle(url);

    let menu = doc.getElementById("contentAreaContextMenu");
    let item = doc.createElement("menuitem");
    item.setAttribute("id", "context-searchfield");
    item.setAttribute("label", bundle.GetStringFromName("addAsSearchEngine.label"));
    item.setAttribute("accesskey", bundle.GetStringFromName("addAsSearchEngine.accesskey"));
    item.addEventListener("command", AddSearch.promptAddEngine);
    menu.addEventListener("popupshowing", ContextMenu.onPopupShowing);

    let style = doc.createProcessingInstruction('xml-stylesheet', stylesheetProc);
    doc.insertBefore(style, doc.firstChild);

    let keywordItem = doc.getElementById("context-keywordfield");
    menu.insertBefore(item, keywordItem);
  }
};

let ContextMenu = {
  inputAddable(event, browserWin) {
    return browserWin.gContextMenu.onTextInput;
  },
  onPopupShowing(event) {
    if(event.target != event.currentTarget) return;
    let browserWin = event.currentTarget.ownerDocument.defaultView;
    let gContextMenu = browserWin.gContextMenu;
    gContextMenu.showItem("context-searchfield", ContextMenu.inputAddable(event, browserWin));
  }
};
