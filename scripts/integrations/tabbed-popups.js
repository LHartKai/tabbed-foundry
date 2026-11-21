/**
 * Keep DialogV2 pop-ups opened from a Tabbed child inside the detached Tabbed
 * window. This intentionally does not intercept ApplicationV2#render globally.
 */
const MODULE_ID = "tabbed-foundry";
const POPUP_CLASS = "tabbed-foundry-popup";

const DialogV2 = foundry.applications.api.DialogV2;
const popupRenderBypass = new WeakSet();
const boundDocuments = new WeakMap();
const documentBindings = new Set();
let activePopupCapture = null;
let popupCaptureInstalled = false;

function getTabbedHost() {
  const api = game.modules.get(MODULE_ID)?.api;
  if (!api?.enabled) return null;
  const candidate = api.host;
  return candidate?.rendered ? candidate : null;
}

function findHostForDocument(doc) {
  const candidate = getTabbedHost();
  if (!candidate || !doc || candidate.element?.ownerDocument !== doc) return null;
  return candidate;
}

function withPopupCaptureContext(targetHost, callback, { persistUntilSettled = false } = {}) {
  if (!targetHost) return callback();
  const previous = activePopupCapture;
  const capture = { host: targetHost, previous, persistUntilSettled };
  activePopupCapture = capture;
  let result;
  try {
    result = callback();
  } catch (error) {
    if (activePopupCapture === capture) activePopupCapture = previous;
    throw error;
  }
  if (result && typeof result.then === "function") {
    return Promise.resolve(result).finally(() => {
      if (activePopupCapture === capture) activePopupCapture = previous;
    });
  }
  if (activePopupCapture === capture) activePopupCapture = previous;
  return result;
}

function unbindDocument(doc) {
  const binding = boundDocuments.get(doc);
  if (!binding) return;
  doc.removeEventListener("click", binding.listener, true);
  boundDocuments.delete(doc);
  for (const entry of documentBindings) {
    if (entry.doc === doc) {
      documentBindings.delete(entry);
      break;
    }
  }
}

function bindHostDocument(targetHost, doc) {
  if (!targetHost || !doc) return;

  // The host moves between documents when Foundry detaches or re-attaches it.
  for (const entry of [...documentBindings]) {
    if (entry.binding.host === targetHost && entry.doc !== doc) unbindDocument(entry.doc);
  }
  if (boundDocuments.has(doc)) return;

  const listener = (event) => {
    const sourceApp = [...targetHost._tabbedApps.values()].find(
      app => app?.rendered && app.element?.ownerDocument === doc && app.element?.contains?.(event.target)
    );
    if (!sourceApp) return;

    const previous = activePopupCapture;
    const capture = { host: targetHost, previous, persistUntilSettled: false };
    activePopupCapture = capture;
    // Keep the context through synchronous handlers and their microtasks.
    // Directory actions below keep it alive for the full returned Promise.
    doc.defaultView?.setTimeout(() => {
      if (activePopupCapture === capture) activePopupCapture = previous;
    }, 0);
  };

  doc.addEventListener("click", listener, true);
  const binding = { host: targetHost, listener };
  boundDocuments.set(doc, binding);
  documentBindings.add({ doc, binding });
}

function unbindDetachedDocument(win) {
  let doc;
  try {
    doc = win?.document;
  } catch (_error) {
    return;
  }
  if (doc) unbindDocument(doc);
}

function normalizeRenderOptions(options, legacyOptions) {
  if (typeof options === "boolean") return { ...(legacyOptions ?? {}), force: options };
  return { ...(options ?? {}), ...(legacyOptions ?? {}) };
}

function renderPopupInHost(app, targetHost, options, nativeRender) {
  if (!(app instanceof DialogV2) || app.parent || app.rendered || popupRenderBypass.has(app) || !targetHost?.rendered) {
    return nativeRender();
  }
  return targetHost._enqueueTransition(async () => {
    if (app.parent || app.rendered) return nativeRender();
    await targetHost.ensureDetachedWindow();
    popupRenderBypass.add(app);
    try {
      await targetHost.renderChild(app, options);
      app.element?.classList.add(POPUP_CLASS);
      targetHost.bringToFront();
      return app;
    } catch (error) {
      app.element?.classList.remove(POPUP_CLASS);
      throw error;
    } finally {
      popupRenderBypass.delete(app);
    }
  });
}

function installPopupCapture() {
  if (!DialogV2 || !game.modules.get("lib-wrapper")?.active || typeof libWrapper === "undefined") {
    console.warn("[" + MODULE_ID + "] DialogV2 ou libWrapper indisponível; pop-ups manterão o comportamento nativo.");
    return false;
  }

  try {
    libWrapper.register(
      MODULE_ID,
      "foundry.applications.api.DialogV2.prototype.render",
      function (wrapped, options = {}, legacyOptions = {}) {
        const capture = activePopupCapture;
        if (!capture || !capture.host?.rendered || !getTabbedHost() || this === capture.host) {
          return wrapped(options, legacyOptions);
        }
        if (!capture.persistUntilSettled && activePopupCapture === capture) {
          activePopupCapture = capture.previous;
        }
        const renderOptions = normalizeRenderOptions(options, legacyOptions);
        return renderPopupInHost(this, capture.host, renderOptions, () => wrapped(options, legacyOptions));
      },
      "WRAPPER"
    );
    popupCaptureInstalled = true;
  } catch (error) {
    console.error("[" + MODULE_ID + "] Não foi possível instalar a captura de DialogV2; o comportamento nativo foi preservado.", error);
    return false;
  }

  // Directory wrappers are deliberately separate: a missing optional target
  // must never disable the DialogV2 wrapper or affect native Journal creation.
  const directoryTargets = [
    "foundry.applications.sidebar.DocumentDirectory.prototype._onCreateEntry",
    "foundry.applications.sidebar.DocumentDirectory.prototype._onCreateFolder"
  ];
  for (const target of directoryTargets) {
    try {
      libWrapper.register(
        MODULE_ID,
        target,
        function (wrapped, event, button, ...args) {
          const doc = this?.element?.ownerDocument ?? button?.ownerDocument ?? event?.currentTarget?.ownerDocument;
          const targetHost = findHostForDocument(doc);
          return withPopupCaptureContext(
            targetHost,
            () => wrapped(event, button, ...args),
            { persistUntilSettled: true }
          );
        },
        "WRAPPER"
      );
    } catch (error) {
      console.warn("[" + MODULE_ID + "] Não foi possível adicionar contexto ao método " + target + "; a captura por clique continua ativa.", error);
    }
  }

  console.info("[" + MODULE_ID + "] Captura contextual de DialogV2 instalada.");
  return true;
}

Hooks.once("init", () => {
  installPopupCapture();

  Hooks.on("renderApplicationV2", (app, element) => {
    const targetHost = getTabbedHost();
    if (targetHost && app === targetHost) bindHostDocument(targetHost, element?.ownerDocument);
  });

  Hooks.on("openDetachedWindow", (windowId, win) => {
    const targetHost = getTabbedHost();
    if (!targetHost) return;
    if (targetHost.window?.windowId && targetHost.window.windowId !== windowId) return;
    bindHostDocument(targetHost, win?.document);
  });

  Hooks.on("closeDetachedWindow", (_windowId, win) => unbindDetachedDocument(win));
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;
  module.api = module.api ?? {};
  Object.defineProperty(module.api, "popupCaptureInstalled", {
    configurable: true,
    enumerable: true,
    get: () => popupCaptureInstalled
  });
});
