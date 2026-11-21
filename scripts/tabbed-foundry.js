const MODULE_ID = "tabbed-foundry";
const SETTING_ENABLED = "enabled";

let originalDetachWindow;
let host = null;
let hostCreation = null;
let detachInterceptorInstalled = false;

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;
const TabbedFoundryApplication = HandlebarsApplicationMixin(ApplicationV2);

class TabbedFoundryHost extends TabbedFoundryApplication {
  static DEFAULT_OPTIONS = {
    id: "tabbed-foundry-host",
    classes: ["tabbed-foundry-host"],
    window: {
      title: "Tabbed Foundry",
      icon: "fas fa-layer-group",
      resizable: true,
      minimizable: true
    },
    position: { width: 1100, height: 760 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/host.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.tabbedApplications = new Map();
    this.activeApplicationId = null;
  }

  async _prepareContext(options) {
    return { moduleId: MODULE_ID };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._renderTabs();
    this._syncApplications();
  }

  async addApplication(app) {
    if (!app || app === this) return false;

    if (this.tabbedApplications.has(app.id)) {
      this.activateApplication(app.id);
      return true;
    }

    // renderChild is the Foundry-supported parent/child lifecycle.
    // It does not manually move the application's DOM element.
    await this.renderChild(app);

    this.tabbedApplications.set(app.id, app);
    this.activeApplicationId = app.id;

    this._syncApplications();
    this._renderTabs();
    this.bringToFront();
    return true;
  }

  _syncApplications() {
    for (const [id, app] of this.tabbedApplications) {
      const element = app.element;
      if (!element) continue;

      element.classList.add("tabbed-foundry-child");
      element.hidden = id !== this.activeApplicationId;
      element.toggleAttribute("aria-hidden", id !== this.activeApplicationId);
    }
  }

  _renderTabs() {
    const strip = this.element?.querySelector("[data-tabbed-tabs]");
    if (!strip) return;

    strip.replaceChildren();

    for (const [id, app] of this.tabbedApplications) {
      const tab = document.createElement("div");
      tab.className = `tabbed-foundry-tab${id === this.activeApplicationId ? " active" : ""}`;

      const activate = document.createElement("button");
      activate.type = "button";
      activate.className = "tabbed-foundry-tab-label";
      activate.textContent = app.title || app.id;
      activate.title = activate.textContent;
      activate.setAttribute("aria-pressed", String(id === this.activeApplicationId));
      activate.addEventListener("click", () => this.activateApplication(id));

      const close = document.createElement("button");
      close.type = "button";
      close.className = "tabbed-foundry-tab-close";
      close.textContent = "×";
      close.title = "Fechar aplicação";
      close.setAttribute("aria-label", `Fechar ${app.title || "aplicação"}`);
      close.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this._closeApplication(id);
      });

      tab.append(activate, close);
      strip.append(tab);
    }

    if (this.tabbedApplications.size === 0) {
      const empty = document.createElement("span");
      empty.className = "tabbed-foundry-empty";
      empty.textContent = "Destaque uma aplicação para adicioná-la aqui.";
      strip.append(empty);
    }
  }

  activateApplication(id) {
    if (!this.tabbedApplications.has(id)) return;
    this.activeApplicationId = id;
    this._syncApplications();
    this._renderTabs();
  }

  async _closeApplication(id) {
    const app = this.tabbedApplications.get(id);
    if (!app) return;

    this.tabbedApplications.delete(id);
    if (this.activeApplicationId === id) {
      this.activeApplicationId = this.tabbedApplications.keys().next().value ?? null;
    }

    await app.close();
    this._syncApplications();
    this._renderTabs();
  }

  async _onClose(options) {
    await super._onClose(options);
    if (host === this) host = null;
    this.tabbedApplications.clear();
    this.activeApplicationId = null;
  }
}

async function getOrCreateHost() {
  if (host?.rendered) return host;
  if (hostCreation) return hostCreation;

  hostCreation = (async () => {
    const candidate = new TabbedFoundryHost();

    try {
      await candidate.render(true);

      // Use the original Foundry method for the host itself.
      await originalDetachWindow.call(candidate);

      host = candidate;
      return candidate;
    } catch (error) {
      console.error(`[${MODULE_ID}] Falha ao criar a janela hospedeira.`, error);
      try {
        await candidate.close();
      } catch (closeError) {
        console.warn(`[${MODULE_ID}] Não foi possível fechar a janela hospedeira incompleta.`, closeError);
      }
      throw error;
    }
  })();

  try {
    return await hostCreation;
  } finally {
    hostCreation = null;
  }
}

function installDetachInterceptor() {
  if (detachInterceptorInstalled) return;

  const prototype = ApplicationV2.prototype;
  originalDetachWindow = prototype.detachWindow;

  if (typeof originalDetachWindow !== "function") {
    console.error(`[${MODULE_ID}] ApplicationV2.detachWindow não está disponível. O módulo não interceptará o detach.`);
    return;
  }

  prototype.detachWindow = async function(options = {}) {
    // The host must use Foundry's original detach implementation.
    if (this instanceof TabbedFoundryHost) {
      return originalDetachWindow.call(this, options);
    }

    // The setting is client-scoped. When disabled, preserve native behavior.
    if (!game.settings.get(MODULE_ID, SETTING_ENABLED)) {
      return originalDetachWindow.call(this, options);
    }

    // Only ApplicationV2 instances can be adopted through renderChild.
    if (!(this instanceof ApplicationV2)) {
      return originalDetachWindow.call(this, options);
    }

    try {
      const tabHost = await getOrCreateHost();
      await tabHost.addApplication(this);
      return this;
    } catch (error) {
      console.error(`[${MODULE_ID}] Não foi possível adicionar a aplicação às abas. Usando o detach nativo.`, error);
      return originalDetachWindow.call(this, options);
    }
  };

  detachInterceptorInstalled = true;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_ENABLED, {
    name: "Agrupar aplicações destacadas",
    hint: "Quando ativado, aplicações destacadas são enviadas para a janela Tabbed Foundry. Desative para usar o detach nativo do Foundry.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  installDetachInterceptor();
});

Hooks.once("ready", () => {
  console.info(`[${MODULE_ID}] Carregado. Agrupamento automático: ${game.settings.get(MODULE_ID, SETTING_ENABLED) ? "ativado" : "desativado"}.`);
});
