const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "integrations", "tabbed-popups.js"), "utf8");

(async () => {
  const hooks = new Map();
  const registrations = [];
  const timers = [];
  const documentListeners = new Map();

  class DialogV2 {
    constructor() {
      this.rendered = false;
      this.parent = null;
      this.element = {
        ownerDocument: null,
        classList: {
          values: new Set(),
          add(value) { this.values.add(value); },
          remove(value) { this.values.delete(value); },
          contains(value) { return this.values.has(value); }
        }
      };
    }
    async render(options = {}) {
      this.rendered = true;
      this.renderOptions = options;
      return this;
    }
  }

  const host = {
    rendered: true,
    window: { windowId: "tabbed-window" },
    _tabbedApps: new Map(),
    _enqueueTransition: operation => operation(),
    async ensureDetachedWindow() { this.ensureCalls = (this.ensureCalls ?? 0) + 1; },
    async renderChild(app, options) {
      this.children ??= new Map();
      this.children.set(app.id, app);
      app.parent = this;
      await app.render(options);
      return app;
    },
    bringToFront() { this.frontCalls = (this.frontCalls ?? 0) + 1; }
  };

  const doc = {
    defaultView: { setTimeout(callback) { timers.push(callback); } },
    addEventListener(type, callback, capture) { documentListeners.set(type, { callback, capture }); },
    removeEventListener(type) { documentListeners.delete(type); }
  };
  const target = {};
  const child = {
    rendered: true,
    element: { ownerDocument: doc, contains: value => value === target }
  };
  host._tabbedApps.set("journal", child);

  const module = { api: { enabled: true, host } };
  const context = {
    foundry: { applications: { api: { DialogV2 } } },
    game: { modules: { get(id) { return id === "tabbed-foundry" ? module : id === "lib-wrapper" ? { active: true } : null; } } },
    Hooks: {
      once(name, callback) { const list = hooks.get(name) ?? []; list.push(callback); hooks.set(name, list); },
      on(name, callback) { const list = hooks.get(name) ?? []; list.push(callback); hooks.set(name, list); }
    },
    libWrapper: {
      register(packageId, target, fn, type) { registrations.push({ packageId, target, fn, type }); }
    },
    console,
    WeakMap,
    WeakSet,
    Map,
    Set,
    Promise
  };

  vm.runInNewContext(source, context, { filename: "tabbed-popups.js" });
  for (const callback of hooks.get("init") ?? []) callback();

  const dialogRegistration = registrations.find(entry => entry.target === "foundry.applications.api.DialogV2.prototype.render");
  assert.ok(dialogRegistration, "DialogV2 render is intercepted");
  assert.ok(!registrations.some(entry => entry.target === "foundry.applications.api.ApplicationV2.prototype.render"), "ApplicationV2 render is not globally intercepted");
  assert.ok(registrations.some(entry => entry.target.endsWith("DocumentDirectory.prototype._onCreateEntry")), "directory create actions receive a persistent context");
  assert.ok(registrations.some(entry => entry.target.endsWith("DocumentDirectory.prototype._onCreateFolder")), "directory folder actions receive a persistent context");

  for (const callback of hooks.get("renderApplicationV2") ?? []) callback(host, { ownerDocument: doc });
  const click = documentListeners.get("click");
  assert.ok(click?.capture, "the host document listener runs in capture phase");
  click.callback({ target });

  const dialog = new DialogV2();
  dialog.id = "create-journal-dialog";
  dialog.element.ownerDocument = doc;
  let nativeCalls = 0;
  const nativeRender = async function (options) {
    nativeCalls += 1;
    return DialogV2.prototype.render.call(this, options);
  };

  const result = await dialogRegistration.fn.call(dialog, nativeRender, { force: true });
  assert.equal(result, dialog);
  assert.equal(dialog.parent, host, "the dialog is registered as a managed child of Tabbed");
  assert.equal(host.children.get(dialog.id), dialog);
  assert.equal(dialog.element.classList.contains("tabbed-foundry-popup"), true, "the dialog receives popup overlay styling");
  assert.equal(dialog.renderOptions.force, true, "render options are preserved");
  assert.equal(host.frontCalls, 1, "the host is brought to front after the popup opens");
  assert.equal(nativeCalls, 1, "the original DialogV2 render runs once through renderChild");

  const standalone = new DialogV2();
  let standaloneNativeCalls = 0;
  await dialogRegistration.fn.call(standalone, async function () {
    standaloneNativeCalls += 1;
    return this;
  }, {});
  assert.equal(standaloneNativeCalls, 1, "dialogs without a Tabbed click context retain native rendering");

  for (const timer of timers) timer();
  console.log("Tabbed Foundry popup smoke tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
