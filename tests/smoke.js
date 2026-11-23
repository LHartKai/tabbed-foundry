const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "scripts", "tabbed-foundry.js");
const source = fs.readFileSync(sourcePath, "utf8");
const stylesheetPath = path.join(__dirname, "..", "styles", "tabbed-foundry.css");
const stylesheet = fs.readFileSync(stylesheetPath, "utf8");

async function boot({ libWrapperActive = true, registerThrows = false } = {}) {
  const hooks = new Map();
  const settings = new Map();
  const registrations = [];
  const moduleObjects = new Map([
    ["lib-wrapper", { active: libWrapperActive }],
    ["tabbed-foundry", { active: true, api: null }]
  ]);

  class ApplicationV2 {
    static _instances = new Set();
    static instances() {
      return this._instances.values();
    }
    constructor() {
      this.children = new Map();
      this.rendered = false;
      ApplicationV2._instances.add(this);
    }
    async render(options = {}) {
      this.rendered = true;
      this.lastRenderOptions = options;
      return this;
    }
    async detachWindow(options = {}) {
      this.nativeDetachCalls = (this.nativeDetachCalls ?? 0) + 1;
      this.lastNativeDetachOptions = options;
      return "native-detach";
    }
    async attachWindow(options = {}) {
      this.nativeAttachCalls = (this.nativeAttachCalls ?? 0) + 1;
      this.lastNativeAttachOptions = options;
      return "native-attach";
    }
    async renderChild(app, options = {}) {
      if (app.parent?.children?.get(app.id) === app) app.parent.children.delete(app.id);
      this.children.set(app.id, app);
      app.parent = this;
      app.rendered = true;
      app.lastParentRenderOptions = options;
      return app;
    }
    bringToFront() {
      this.broughtToFront = true;
    }
  }

  const nativeDetachMethod = ApplicationV2.prototype.detachWindow;
  const libWrapper = {
    register(packageId, target, fn, type) {
      if (registerThrows) throw new Error("simulated libWrapper registration conflict");
      registrations.push({ packageId, target, fn, type });
      return registrations.length;
    }
  };

  const context = {
    foundry: {
      applications: {
        api: {
          ApplicationV2,
          HandlebarsApplicationMixin: Base => Base
        }
      }
    },
    Hooks: {
      once(name, callback) {
        if (!hooks.has(name)) hooks.set(name, []);
        hooks.get(name).push(callback);
      },
      on(name, callback) {
        if (!hooks.has(name)) hooks.set(name, []);
        hooks.get(name).push(callback);
      }
    },
    game: {
      settings: {
        register(namespace, key, definition) {
          settings.set(namespace + "." + key, definition);
          if (!settings.has(namespace + "." + key + ".value")) {
            settings.set(namespace + "." + key + ".value", definition.default);
          }
        },
        get(namespace, key) {
          return settings.get(namespace + "." + key + ".value");
        },
        async set(namespace, key, value) {
          settings.set(namespace + "." + key + ".value", value);
          return value;
        }
      },
      modules: {
        get(id) {
          return moduleObjects.get(id) ?? null;
        }
      },
      user: { isGM: true }
    },
    libWrapper,
    ui: { sidebar: null, notifications: { warn() {}, error() {} } },
    console,
    setTimeout,
    clearTimeout,
    WeakMap,
    Map,
    Set,
    Promise,
    TypeError
  };

  vm.runInNewContext(source, context, { filename: "tabbed-foundry.js" });
  for (const callback of hooks.get("init") ?? []) await callback();

  return {
    context,
    ApplicationV2,
    nativeDetachMethod,
    settings,
    registrations,
    hooks,
    moduleObjects,
    setAutoGrouping(value) {
      settings.set("tabbed-foundry.autoGrouping.value", value);
    }
  };
}

(async () => {
  // The wrapper must be registered through libWrapper without replacing the
  // ApplicationV2 prototype method directly.
  const env = await boot();

  const enumeratedApp = new env.ApplicationV2();
  assert.ok(
    env.context.getOpenApplications().includes(enumeratedApp),
    "open applications are discovered through ApplicationV2.instances()"
  );
  assert.equal(
    env.context.getApplicationDocumentUuid({ document: { uuid: "Actor.restore-test" } }),
    "Actor.restore-test",
    "document-backed applications expose a stable document UUID"
  );

  const documentSheet = new env.ApplicationV2();
  documentSheet.document = { uuid: "Actor.restore-test" };
  env.context.fromUuid = async uuid => (
    uuid === "Actor.restore-test" ? { sheet: documentSheet } : null
  );
  assert.equal(
    await env.context.reopenDocumentSheet({
      documentUuid: "Actor.restore-test",
      className: "ApplicationV2"
    }),
    documentSheet,
    "a saved document sheet can be resolved again after a reload"
  );
  assert.equal(
    await env.context.reopenDocumentSheet({
      documentUuid: "Actor.restore-test",
      className: "DifferentApplication"
    }),
    null,
    "restoration does not substitute a different sheet class"
  );

  const legacySheet = new env.ApplicationV2();
  legacySheet.document = { uuid: "Actor.legacy-test" };
  const legacyDocument = { name: "Legacy actor", sheet: legacySheet };
  env.context.game.collections = new Map([["actors", [legacyDocument]]]);
  assert.equal(
    await env.context.reopenDocumentSheet({
      documentUuid: null,
      className: "ApplicationV2",
      title: "Legacy actor"
    }),
    legacySheet,
    "a legacy saved tab can migrate from a unique world-document name and sheet class"
  );

  const duplicateLegacyDocument = { name: "Legacy actor", sheet: new env.ApplicationV2() };
  env.context.game.collections = new Map([["actors", [legacyDocument, duplicateLegacyDocument]]]);
  assert.equal(
    await env.context.reopenDocumentSheet({
      documentUuid: null,
      className: "ApplicationV2",
      title: "Legacy actor"
    }),
    null,
    "legacy migration does not guess when multiple documents share the same title and sheet class"
  );

  assert.equal(env.registrations.length, 2, "detach and attach lifecycle wrappers are registered");
  assert.equal(env.registrations[0].packageId, "tabbed-foundry");
  assert.equal(
    env.registrations[0].target,
    "foundry.applications.api.ApplicationV2.prototype.detachWindow",
    "wrapper targets the Foundry v14 ApplicationV2 API"
  );
  assert.equal(env.registrations[0].type, "MIXED");
  assert.ok(
    env.registrations.some(entry => entry.target === "foundry.applications.api.ApplicationV2.prototype.attachWindow"),
    "native reattachment of a child previously detached from Tabbed returns to the main workspace"
  );
  assert.equal(
    env.ApplicationV2.prototype.detachWindow,
    env.nativeDetachMethod,
    "module source does not monkey-patch ApplicationV2.prototype"
  );

  const settingDefinition = env.settings.get("tabbed-foundry.autoGrouping");
  assert.equal(settingDefinition.scope, "client");
  assert.equal(settingDefinition.config, true);
  assert.equal(settingDefinition.default, true);

  const wrapper = env.registrations[0].fn;
  const makeApp = (overrides = {}) => ({
    id: "test-app",
    parent: null,
    window: {},
    ...overrides
  });
  const nativeCall = async function (app, options) {
    return wrapper.call(app, function (receivedOptions) {
      app.nativeCalls = (app.nativeCalls ?? 0) + 1;
      app.receivedNativeOptions = receivedOptions;
      return Promise.resolve("native-detach");
    }, options);
  };

  // Disabled mode must always preserve the Foundry native detach.
  env.setAutoGrouping(false);
  const disabledApp = makeApp();
  assert.equal(await nativeCall(disabledApp, { source: "disabled" }), "native-detach");
  assert.equal(disabledApp.nativeCalls, 1);
  assert.deepEqual(disabledApp.receivedNativeOptions, { source: "disabled" });

  // When enabled, applications already detached into their own window stay native.
  env.setAutoGrouping(true);
  const alreadyDetachedApp = makeApp({ window: { windowId: "existing-window" } });
  assert.equal(await nativeCall(alreadyDetachedApp, { source: "already-detached" }), "native-detach");
  assert.equal(alreadyDetachedApp.nativeCalls, 1);

  // Apps owned by another ApplicationV2 parent are not stolen by Tabbed Foundry.
  const otherParentApp = makeApp({ parent: {} });
  assert.equal(await nativeCall(otherParentApp, { source: "other-parent" }), "native-detach");
  assert.equal(otherParentApp.nativeCalls, 1);

  // A missing/inactive libWrapper must fail closed: no wrapper and no prototype edit.
  const noLibrary = await boot({ libWrapperActive: false });
  assert.equal(noLibrary.registrations.length, 0);
  assert.equal(noLibrary.ApplicationV2.prototype.detachWindow, noLibrary.nativeDetachMethod);

  // A wrapper conflict must also fail safely without changing Foundry's method.
  const conflict = await boot({ registerThrows: true });
  assert.equal(conflict.registrations.length, 0);
  assert.equal(conflict.ApplicationV2.prototype.detachWindow, conflict.nativeDetachMethod);

  // Structural regression guards for previously observed failure modes.
  assert.match(source, /_enqueueTransition\(operation\)/, "state transitions are serialized");
  assert.match(source, /await existingHost\._transitionQueue/, "new captures wait for an active return transition");
  assert.match(source, /_layoutFrameView/, "animation frames are cancelled against their originating Electron view");
  assert.match(source, /SETTING_LAYOUT_STATE/, "the workspace layout has a persistent client setting");
  assert.match(source, /game\.settings\.set\(MODULE_ID, SETTING_LAYOUT_STATE, snapshot\)/, "layout changes are saved as they happen");
  assert.match(source, /async restorePersistedLayout\(\)/, "the saved workspace layout is restored on startup");
  assert.match(source, /documentUuid: getApplicationDocumentUuid\(app\)/, "document UUIDs are persisted for document-backed applications");
  assert.match(source, /await reopenDocumentSheet\(record\)/, "document-backed applications are recreated from saved UUIDs");
  assert.match(source, /restorePendingApplication\(app\)/, "applications created after startup can rejoin their saved tabs");
  assert.match(
    source,
    /if \(this\._detachingApps\.has\(app\.id\)\) return;/,
    "a close event emitted during native detach must not release and close the Tabbed host"
  );
  assert.match(
    source,
    /this\.parent === parent \|\| parent\.children\?\.get\(this\.id\) === this/,
    "the native detach must sever the parent-child link before the host releases the app"
  );
  assert.ok(source.includes("await attachApplicationToMainWorkspace(app)"), "reattachment moves the selected app directly to the main workspace");
  assert.doesNotMatch(source, /makeItem\("Voltar para o Foundry"/, "the tab context menu no longer offers the return-to-Foundry action");
  assert.match(source, /dragHandle\.draggable = true/, "the title of a standalone detached app is the drag source");
  assert.match(source, /_hasTabbedFoundryDrag\(event\)/, "external cross-window drags are accepted before DataTransfer payloads can be read");
  assert.match(source, /setData\("application\/x-tabbed-foundry-app", app\.id\)/, "detached app drags carry the ApplicationV2 id");
  assert.match(source, /this\._adoptDraggedApplication\(draggedId, node\.id, appId\)/, "dropping on an existing tab adopts the external app into this host");
  assert.match(source, /this\._adoptDraggedApplication\(draggedId, node\.id\)/, "dropping on the empty tab strip adopts the external app into this host");
  assert.doesNotMatch(source, /_workspaceReturnDropTarget|_setupWorkspaceReturnDropTarget/, "dragging into Tabbed does not target the Foundry-native sidebar");
  assert.doesNotMatch(source, /MODO DE SEGURANÇA|temporariamente suspenso/, "emergency safe mode is removed");
  assert.doesNotMatch(source, /ApplicationV2\.prototype\.detachWindow\s*=/, "direct prototype monkey-patching stays removed");

  assert.doesNotMatch(source, /activePopupCapture|installPopupCapture|_adoptPopupApplication/, "pop-up capture stays out of the module");
  assert.doesNotMatch(stylesheet, /tabbed-foundry-popup/, "pop-up capture styling stays removed");
  assert.ok(
    source.includes("parent.release(this.id, { restorePosition: false, closeWhenEmpty: false })"),
    "a native detach must not auto-close its host while Foundry is transferring the child window"
  );
  assert.ok(
    stylesheet.includes(".tabbed-foundry-child {\n  /* The child inherits pointer-events:none from the transparent host surface. */\n  pointer-events: auto !important;"),
    "interactive child applications must restore pointer events inside the transparent host"
  );

  // Reattaching an app replaces the old parent link rather than restoring it.
  const mainWorkspace = new env.ApplicationV2();
  mainWorkspace.rendered = true;
  mainWorkspace.children = new Map();
  mainWorkspace.renderChild = async (app, options = {}) => {
    mainWorkspace.children.set(app.id, app);
    app.parent = mainWorkspace;
    app.rendered = true;
    app.lastParentRenderOptions = options;
    return app;
  };
  env.context.ui.sidebar = mainWorkspace;

  const formerHost = new env.ApplicationV2();
  const returnedApp = new env.ApplicationV2();
  returnedApp.id = "returned-journal";
  returnedApp.parent = formerHost;
  formerHost.children.set(returnedApp.id, returnedApp);
  const returned = await env.context.attachApplicationToMainWorkspace(returnedApp, { focus: true });
  assert.equal(returned, returnedApp);
  assert.equal(returnedApp.parent, mainWorkspace, "returned Journal is parented to the main workspace");
  assert.equal(mainWorkspace.children.get(returnedApp.id), returnedApp);
  assert.equal(formerHost.children.has(returnedApp.id), false, "old Tabbed parent no longer retains the app");
  assert.equal(returnedApp.lastParentRenderOptions.focus, true);

  // Native attachWindow for an app last detached from Tabbed is routed to the
  // primary workspace instead of Foundry restoring its remembered Tabbed parent.
  const nativeReturnedApp = new env.ApplicationV2();
  nativeReturnedApp.id = "native-returned-journal";
  env.context.rememberTabbedDetach(nativeReturnedApp);
  const attachWrapper = env.registrations.find(
    entry => entry.target === "foundry.applications.api.ApplicationV2.prototype.attachWindow"
  ).fn;
  let nativeAttachCalled = false;
  const nativeAttachResult = await attachWrapper.call(
    nativeReturnedApp,
    async () => { nativeAttachCalled = true; return "native-attach"; },
    { focus: true }
  );
  assert.equal(nativeAttachResult, nativeReturnedApp);
  assert.equal(nativeAttachCalled, false, "Foundry's remembered-parent attach is bypassed for Tabbed children");
  assert.equal(nativeReturnedApp.parent, mainWorkspace);
  assert.equal(mainWorkspace.children.get(nativeReturnedApp.id), nativeReturnedApp);

  // The MEJ close X is handled once at the root capture phase. Its own method
  // runs, while the click never reaches the parent .journal-tab activation.
  const closeControl = {
    closest(selector) {
      if (selector === ".journal-tab .close") return this;
      if (selector === ".journal-tab") return tabElement;
      return null;
    }
  };
  const tabElement = { dataset: { tabid: "mej-tab-to-close" } };
  const closeListeners = new Map();
  const closeRoot = {
    addEventListener(type, callback, capture) { closeListeners.set(type, { callback, capture }); },
    contains(element) { return element === closeControl; }
  };
  const closedTabs = [];
  const mejApp = {
    element: closeRoot,
    tabs: [{ id: "mej-tab-to-close" }],
    async removeTab(tab, event) { closedTabs.push({ id: tab.id, event }); }
  };
  assert.equal(env.context.installMejTabCloseCapture(mejApp), true);
  assert.equal(closeListeners.get("click").capture, true, "MEJ close interception runs in capture phase");
  let defaultPrevented = false;
  let propagationStopped = false;
  let immediatePropagationStopped = false;
  const closeEvent = {
    target: { closest: selector => selector === ".journal-tab .close" ? closeControl : null },
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
    stopImmediatePropagation() { immediatePropagationStopped = true; }
  };
  await closeListeners.get("click").callback(closeEvent);
  assert.equal(closedTabs.length, 1, "MEJ's removeTab method runs exactly once");
  assert.equal(closedTabs[0].id, "mej-tab-to-close");
  assert.equal(defaultPrevented, true);
  assert.equal(propagationStopped, true);
  assert.equal(immediatePropagationStopped, true);
  assert.ok(source.includes("await app.removeTab(tab, event)"), "MEJ close capture calls Monk's original removal routine");

  const returnMethod = source.slice(
    source.indexOf("async _returnApplicationToWorkspaceNow"),
    source.indexOf("async _detachApplicationToNativeWindow")
  );
  assert.ok(returnMethod.includes("await attachApplicationToMainWorkspace(app)"));
  assert.doesNotMatch(returnMethod, /this\.attachWindow\(|this\.detachWindow\(/, "returning one tab no longer reattaches and re-detaches the entire Tabbed host");

  console.log("Tabbed Foundry smoke tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
