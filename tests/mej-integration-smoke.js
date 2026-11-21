const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "integrations", "monks-enhanced-journal.js"),
  "utf8"
);

async function boot({
  mejActive = true,
  mejVersion = "14.02",
  standaloneActive = false,
  registerThrows = false
} = {}) {
  const hooks = new Map();
  const registrations = [];
  const modules = new Map([
    ["tabbed-foundry", { active: true, api: {} }],
    ["lib-wrapper", { active: true }],
    ["monks-enhanced-journal", { active: mejActive, version: mejVersion }],
    ["mej-14-02-compat", { active: standaloneActive }]
  ]);

  class ApplicationV2 {
    async _preFirstRender() {
      return "base-pre-first-render";
    }
  }

  class SheetBase {
    render(options) {
      return Promise.resolve({ renderer: "parent", options });
    }
  }
  class EnhancedJournalSheet extends SheetBase {
    render() {
      // The broken 14.02 implementation forgot to return its inner Promise.
      this.originalRenderWasCalled = true;
    }
  }
  class PersonSheet extends EnhancedJournalSheet {
    static updateStyle(_event, html) {
      html.styleApplied = true;
    }
  }

  const originalFixTypeCalls = [];
  const mej = {
    fixType(object, settype) {
      originalFixTypeCalls.push({ object, settype });
      if (object) object.type = "monks-enhanced-journal.person";
    },
    getDocumentTypes() {
      return { person: PersonSheet };
    }
  };

  const game = {
    user: { id: "test-user" },
    modules: { get(id) { return modules.get(id) ?? null; } },
    MonksEnhancedJournal: mej
  };

  const libWrapper = {
    register(packageId, target, fn, type) {
      if (registerThrows) throw new Error("simulated libWrapper registration failure");
      registrations.push({ packageId, target, fn, type });
      return registrations.length;
    }
  };

  const context = {
    game,
    foundry: {
      applications: { api: { ApplicationV2 } },
      utils: {
        getProperty(object, pathString) {
          return pathString.split(".").reduce((value, key) => value?.[key], object);
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
    libWrapper,
    CONST: { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } },
    console: { info() {}, warn() {}, error() {} },
    Object,
    Symbol,
    Promise
  };

  vm.runInNewContext(source, context, { filename: "monks-enhanced-journal.js" });
  for (const callback of hooks.get("setup") ?? []) await callback();

  return { context, game, hooks, registrations, modules, mej, ApplicationV2, EnhancedJournalSheet, PersonSheet, originalFixTypeCalls };
}

(async () => {
  const env = await boot();
  const state = env.game[Symbol.for("tabbed-foundry.integrations")]?.mejCompatibility;

  assert.equal(state.active, true, "MEJ 14.02 integration is active");
  assert.deepEqual(
    { ...state.applied },
    { fixType: true, pageRenderPromise: true, duplicateTabsOrder: true, pageStyles: true }
  );
  assert.equal(env.registrations.length, 1, "one MEJ-specific wrapper is registered through libWrapper");
  assert.equal(env.registrations[0].packageId, "tabbed-foundry");
  assert.equal(
    env.registrations[0].target,
    "foundry.applications.api.ApplicationV2.prototype._preFirstRender"
  );
  assert.equal(env.registrations[0].type, "WRAPPER");
  assert.equal(
    env.ApplicationV2.prototype._preFirstRender.name,
    "_preFirstRender",
    "the global ApplicationV2 prototype is not replaced directly"
  );

  // MEJ's missing-document compendium call becomes a safe no-op.
  assert.doesNotThrow(() => env.mej.fixType(undefined));

  // MEJ page types no longer overwrite the core JournalEntry type.
  const journalEntry = {
    documentName: "JournalEntry",
    type: "base",
    flags: { "monks-enhanced-journal": { type: "person" } }
  };
  env.mej.fixType(journalEntry);
  assert.equal(journalEntry.type, "base");

  // MEJ's two special JournalEntry types remain supported.
  const folderEntry = {
    documentName: "JournalEntry",
    type: "base",
    flags: { "monks-enhanced-journal": { type: "folder" } }
  };
  env.mej.fixType(folderEntry);
  assert.equal(folderEntry.type, "folder");

  // JournalEntryPage handling still delegates to Monk's original logic.
  const page = { documentName: "JournalEntryPage", type: "text" };
  env.mej.fixType(page);
  assert.equal(env.originalFixTypeCalls.length, 1);
  assert.equal(page.type, "monks-enhanced-journal.person");

  // The MEJ page-sheet renderer now returns the inner render Promise.
  const personSheet = new env.PersonSheet();
  personSheet.enhancedjournal = { render: options => Promise.resolve({ renderer: "enhanced-journal", options }) };
  const renderResult = personSheet.render({ force: false });
  assert.equal(typeof renderResult?.then, "function");
  assert.deepEqual(await renderResult, { renderer: "enhanced-journal", options: { force: false } });

  // The _preFirstRender wrapper patches only MEJ's own EnhancedJournal class.
  class EnhancedJournal extends env.ApplicationV2 {
    removeDuplicateTabs() {
      const uniqueTabs = this.tabs.filter((tab, index, self) =>
        index === self.findIndex(candidate => candidate.entityId === tab.entityId)
      );
      if (!uniqueTabs.some(tab => tab.active)) {
        const activeId = this.tabs.active(true)?.entityId;
        if (activeId) uniqueTabs.find(tab => tab.entityId === activeId).active = true;
      }
      this.tabs = uniqueTabs;
    }
  }
  const enhancedJournal = new EnhancedJournal();
  enhancedJournal.tabs = [
    { entityId: "journal-1", active: false },
    { entityId: "journal-1", active: true },
    { entityId: "journal-2", active: false }
  ];

  await env.registrations[0].fn.call(
    enhancedJournal,
    () => Promise.resolve("wrapped-base-render"),
    {},
    {}
  );
  assert.doesNotThrow(() => enhancedJournal.removeDuplicateTabs());
  assert.equal(enhancedJournal.tabs.length, 2);
  assert.equal(enhancedJournal.tabs[0].active, true, "the surviving duplicate keeps active state");

  // The page style hook is installed only for MEJ subsheets.
  const pageHook = (env.hooks.get("renderJournalPageSheet") ?? [])[0];
  assert.equal(typeof pageHook, "function");
  const html = {};
  pageHook({ enhancedjournal: true, document: { type: "person" }, constructor: env.PersonSheet }, html);
  assert.equal(html.styleApplied, true);

  // Disabled / absent Monk: no compatibility changes are applied.
  const noMej = await boot({ mejActive: false });
  assert.equal(noMej.registrations.length, 0);
  assert.equal(noMej.mej.fixType, noMej.context.game.MonksEnhancedJournal.fixType);
  assert.equal(noMej.game[Symbol.for("tabbed-foundry.integrations")].mejCompatibility.active, false);

  // A different MEJ version is not patched by code specific to 14.02.
  const newerMej = await boot({ mejVersion: "14.03" });
  assert.equal(newerMej.registrations.length, 0);
  assert.equal(newerMej.game[Symbol.for("tabbed-foundry.integrations")].mejCompatibility.active, false);

  // Do not double-patch when the old standalone compatibility module remains active.
  const standalone = await boot({ standaloneActive: true });
  assert.equal(standalone.registrations.length, 0);
  assert.equal(standalone.game[Symbol.for("tabbed-foundry.integrations")].active, undefined);
  assert.match(
    standalone.game[Symbol.for("tabbed-foundry.integrations")].mejCompatibility.skippedReason,
    /módulo separado/
  );

  // Failure to register the MEJ wrapper is reported as a partial integration.
  const failedWrapper = await boot({ registerThrows: true });
  assert.equal(failedWrapper.registrations.length, 0);
  assert.equal(failedWrapper.game[Symbol.for("tabbed-foundry.integrations")].mejCompatibility.active, false);

  console.log("Tabbed Foundry MEJ integration smoke tests passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
