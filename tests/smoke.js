const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "scripts", "tabbed-foundry.js");
const source = fs.readFileSync(sourcePath, "utf8");

async function boot({ libWrapperActive = true, registerThrows = false } = {}) {
  const hooks = new Map();
  const settings = new Map();
  const registrations = [];
  const moduleObjects = new Map([
    ["lib-wrapper", { active: libWrapperActive }],
    ["tabbed-foundry", { active: true, api: null }]
  ]);

  class ApplicationV2 {
    async detachWindow(options = {}) {
      this.nativeDetachCalls = (this.nativeDetachCalls ?? 0) + 1;
      this.lastNativeDetachOptions = options;
      return "native-detach";
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
  assert.equal(env.registrations.length, 1, "one detach wrapper is registered");
  assert.equal(env.registrations[0].packageId, "tabbed-foundry");
  assert.equal(
    env.registrations[0].target,
    "foundry.applications.api.ApplicationV2.prototype.detachWindow",
    "wrapper targets the Foundry v14 ApplicationV2 API"
  );
  assert.equal(env.registrations[0].type, "MIXED");
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
  assert.match(source, /await host\._transitionQueue/, "new captures wait for an active return transition");
  assert.match(source, /_layoutFrameView/, "animation frames are cancelled against their originating Electron view");
  assert.match(source, /if \(hostAttachedToMain && this\.rendered && !this\.window\?\.windowId\)/, "failed reattachment restores the detached host");
  assert.doesNotMatch(source, /MODO DE SEGURANÇA|temporariamente suspenso/, "emergency safe mode is removed");
  assert.doesNotMatch(source, /ApplicationV2\.prototype\.detachWindow\s*=/, "direct prototype monkey-patching stays removed");

  console.log("Tabbed Foundry smoke tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
