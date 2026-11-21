const MODULE_ID = "tabbed-foundry";
const MEJ_ID = "monks-enhanced-journal";
const STANDALONE_COMPAT_ID = "mej-14-02-compat";
const TARGET_MEJ_VERSION = "14.02";
const PATCH_MARKER = Symbol.for("tabbed-foundry.mej-14-02-compat.v1");
const INTEGRATION_STATE = Symbol.for("tabbed-foundry.integrations");

const integrationStatus = {
  module: MEJ_ID,
  targetVersion: TARGET_MEJ_VERSION,
  detectedVersion: null,
  active: false,
  skippedReason: null,
  applied: {
    fixType: false,
    pageRenderPromise: false,
    duplicateTabsOrder: false,
    pageStyles: false
  }
};

function getMEJVersion(module) {
  return String(module?.version ?? module?.data?.version ?? "");
}

function patchFixType(mej) {
  if (mej.fixType?.[PATCH_MARKER]) return true;
  if (typeof mej.fixType !== "function") return false;

  const originalFixType = mej.fixType;
  const patchedFixType = function (object, settype) {
    // MEJ 14.02 can call fixType(undefined) during a compendium import.
    if (!object) return;

    // MEJ page types (text/person/quest...) must not replace JournalEntry.type.
    // Core JournalEntry sheets only register the "base" document type.
    if (object.documentName !== "JournalEntryPage") {
      const type = settype ??
        foundry.utils.getProperty(object, "flags.monks-enhanced-journal.type") ??
        foundry.utils.getProperty(object, "flags.monks-enhanced-journal.pagetype");

      if (type === "blank" || type === "folder") object.type = type;
      return;
    }

    // Preserve the original subtype normalization for JournalEntryPage.
    return originalFixType.call(this, object, settype);
  };

  Object.defineProperty(patchedFixType, PATCH_MARKER, { value: true });
  Object.defineProperty(patchedFixType, "original", { value: originalFixType });
  mej.fixType = patchedFixType;
  return true;
}

function findEnhancedJournalSheetPrototype(mej) {
  let types;
  try {
    types = mej.getDocumentTypes?.();
  } catch (error) {
    console.warn(`[${MODULE_ID}] Não foi possível consultar os tipos de páginas do Monk's Journal.`, error);
    return null;
  }

  for (const SheetClass of Object.values(types ?? {})) {
    if (typeof SheetClass !== "function" || !SheetClass.prototype) continue;

    let prototype = SheetClass.prototype;
    while (prototype && prototype !== Object.prototype) {
      if (prototype.constructor?.name === "EnhancedJournalSheet") return prototype;
      prototype = Object.getPrototypeOf(prototype);
    }
  }

  return null;
}

function patchEnhancedJournalSheetRender(mej) {
  const prototype = findEnhancedJournalSheetPrototype(mej);
  if (!prototype || typeof prototype.render !== "function") return false;
  if (prototype.render[PATCH_MARKER]) return true;

  const parentRender = Object.getPrototypeOf(prototype)?.render;
  if (typeof parentRender !== "function") return false;

  // MEJ 14.02 must return the inner EnhancedJournal render Promise.
  // The ownership behavior below mirrors the original MEJ method.
  const patchedRender = function (options) {
    const { force = this.tempOwnership } = options || {};
    if (force && (
      !this.document.testUserPermission(game.user, "OBSERVER") ||
      (this.document.parent && !this.document.parent.testUserPermission(game.user, "OBSERVER"))
    )) {
      this.document.ownership[game.user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
      if (this.document.parent) {
        this.document.parent.ownership[game.user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
      }
      this.tempOwnership = true;
    }

    if (this.enhancedjournal) return this.enhancedjournal.render(options);
    return parentRender.call(this, options);
  };

  Object.defineProperty(patchedRender, PATCH_MARKER, { value: true });
  Object.defineProperty(patchedRender, "original", { value: prototype.render });
  prototype.render = patchedRender;
  return true;
}

function patchRemoveDuplicateTabsForInstance(instance) {
  const original = instance?.removeDuplicateTabs;
  if (typeof original !== "function") return false;
  if (original[PATCH_MARKER]) return true;

  const patched = function () {
    const originalTabs = Array.isArray(this.tabs) ? this.tabs : [];
    if (originalTabs.length < 2) return;

    const uniqueTabs = originalTabs.filter((tab, index, self) =>
      index === self.findIndex(candidate => candidate.entityId === tab.entityId)
    );
    if (uniqueTabs.length === originalTabs.length) return;

    // MEJ 14.02 invokes removeDuplicateTabs before it creates this.tabs.active.
    // Keep the active duplicate on the surviving tab without calling that helper.
    const previouslyActive = originalTabs.find(tab => tab.active);
    if (previouslyActive?.entityId) {
      const replacement = uniqueTabs.find(tab => tab.entityId === previouslyActive.entityId);
      if (replacement) replacement.active = true;
    }

    this.tabs = uniqueTabs;
  };

  Object.defineProperty(patched, PATCH_MARKER, { value: true });
  Object.defineProperty(patched, "original", { value: original });
  instance.removeDuplicateTabs = patched;
  return instance.removeDuplicateTabs === patched;
}

function installDuplicateTabsOrderPatch() {
  if (installDuplicateTabsOrderPatch[PATCH_MARKER]) return true;

  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (typeof ApplicationV2?.prototype?.render !== "function") return false;
  if (typeof libWrapper === "undefined" || !game.modules.get("lib-wrapper")?.active) return false;

  try {
    // Wrap render rather than ApplicationV2._preFirstRender. EnhancedJournal
    // overrides _preFirstRender, and its mixin/super chain is not a reliable
    // interception point. render runs before the first _preFirstRender call,
    // so the instance-local fix is guaranteed to exist before Monk uses it.
    libWrapper.register(
      MODULE_ID,
      "foundry.applications.api.ApplicationV2.prototype.render",
      function (wrapped, ...args) {
        if (this?.id === "MonksEnhancedJournal" || this?.constructor?.name === "EnhancedJournal") {
          patchRemoveDuplicateTabsForInstance(this);
        }
        return wrapped(...args);
      },
      "WRAPPER"
    );

    Object.defineProperty(installDuplicateTabsOrderPatch, PATCH_MARKER, { value: true });
    return true;
  } catch (error) {
    console.error(`[${MODULE_ID}] Não foi possível registrar a correção de abas duplicadas do Monk's Journal via libWrapper.`, error);
    return false;
  }
}

function installPageStyleHook() {
  const gameMarker = Symbol.for("tabbed-foundry.mej-14-02.page-style-hook");
  if (game[gameMarker]) return true;

  Hooks.on("renderJournalPageSheet", (sheet, html) => {
    if (!sheet?.enhancedjournal) return;
    if (["blank", "folder"].includes(sheet.document?.type)) return;

    const updateStyle = sheet.constructor?.updateStyle;
    if (typeof updateStyle !== "function") return;

    try {
      updateStyle.call(sheet, null, html);
    } catch (error) {
      console.error(`[${MODULE_ID}] Não foi possível reaplicar o estilo da página do Journal.`, error);
    }
  });

  Object.defineProperty(game, gameMarker, { value: true });
  return true;
}

function publishIntegrationStatus() {
  game[INTEGRATION_STATE] ??= {};
  game[INTEGRATION_STATE].mejCompatibility = integrationStatus;
}

Hooks.once("setup", () => {
  const module = game.modules.get(MEJ_ID);
  if (!module?.active) {
    integrationStatus.skippedReason = "Monk's Enhanced Journal não está ativo.";
    console.info(`[${MODULE_ID}] ${integrationStatus.skippedReason} Integração não aplicada.`);
    publishIntegrationStatus();
    return;
  }

  const version = getMEJVersion(module);
  integrationStatus.detectedVersion = version || null;
  if (version !== TARGET_MEJ_VERSION) {
    integrationStatus.skippedReason =
      `Patch destinado exclusivamente ao MEJ ${TARGET_MEJ_VERSION}; versão detectada: ${version || "desconhecida"}.`;
    console.warn(`[${MODULE_ID}] ${integrationStatus.skippedReason} Nenhuma alteração foi aplicada.`);
    publishIntegrationStatus();
    return;
  }

  // Prevent two modules from wrapping the same MEJ methods. Keep the old
  // standalone patch active during migration, then disable it after Tabbed's
  // bundled integration is installed and verified.
  if (game.modules.get(STANDALONE_COMPAT_ID)?.active) {
    integrationStatus.skippedReason =
      "O módulo separado MEJ 14.02 Compatibility Patch ainda está ativo; integração embutida ignorada para evitar patches duplicados.";
    console.warn(`[${MODULE_ID}] ${integrationStatus.skippedReason}`);
    publishIntegrationStatus();
    return;
  }

  const mej = game.MonksEnhancedJournal;
  if (!mej || typeof mej.fixType !== "function" || typeof mej.getDocumentTypes !== "function") {
    integrationStatus.skippedReason = "A API do Monk's Enhanced Journal não ficou disponível durante setup.";
    console.error(`[${MODULE_ID}] ${integrationStatus.skippedReason}`);
    publishIntegrationStatus();
    return;
  }

  integrationStatus.applied.fixType = patchFixType(mej);
  integrationStatus.applied.pageRenderPromise = patchEnhancedJournalSheetRender(mej);
  integrationStatus.applied.duplicateTabsOrder = installDuplicateTabsOrderPatch();
  integrationStatus.applied.pageStyles = installPageStyleHook();
  integrationStatus.active = Object.values(integrationStatus.applied).every(Boolean);

  if (!integrationStatus.active) {
    integrationStatus.skippedReason = "Uma ou mais correções não puderam ser aplicadas; consulte os detalhes no console.";
    console.warn(`[${MODULE_ID}] Integração aplicada parcialmente.`, integrationStatus.applied);
  } else {
    console.info(
      `[${MODULE_ID}] Compatibilidade do Monk's Enhanced Journal ${version} aplicada.`,
      integrationStatus.applied
    );
  }
  publishIntegrationStatus();
});

Hooks.once("ready", publishIntegrationStatus);
