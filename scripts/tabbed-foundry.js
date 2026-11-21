const MODULE_ID = "tabbed-foundry";

class TabbedFoundryHost extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "tabbed-foundry-host",
    classes: ["tabbed-foundry-host"],
    window: {
      title: "Tabbed Foundry",
      icon: "fas fa-layer-group",
      resizable: true,
      minimizable: true
    },
    position: { width: 1000, height: 720 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/host.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this._activeId = null;
    this._tabbedApps = new Map();
  }

  async _prepareContext(options) {
    return { moduleId: MODULE_ID };
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    this._renderTabStrip();
    this._syncChildElements();
  }

  async adopt(app) {
    if (!app || app === this) return false;
    if (!(app instanceof foundry.applications.api.ApplicationV2)) {
      console.warn(`[${MODULE_ID}] ApplicationV1 ainda não é suportada para agrupamento automático.`, app);
      return false;
    }

    if (!this.rendered) {
      await this.render(true);
      await this.detachWindow();
    }

    if (this._tabbedApps.has(app.id)) {
      this.activate(app.id);
      return true;
    }

    try {
      await this.renderChild(app);
      this._tabbedApps.set(app.id, app);
      this._activeId = app.id;
      this._syncChildElements();
      this._renderTabStrip();
      this.activate(app.id);
      return true;
    } catch (error) {
      console.error(`[${MODULE_ID}] Não foi possível agrupar a aplicação.`, error);
      return false;
    }
  }

  _syncChildElements() {
    const stage = this.element?.querySelector("[data-tabbed-stage]");
    if (!stage) return;

    for (const [id, app] of this._tabbedApps) {
      const element = app.element;
      if (!element) continue;
      if (element.parentElement !== stage) stage.append(element);
      element.classList.add("tabbed-foundry-child");
      element.hidden = id !== this._activeId;
    }
  }

  _renderTabStrip() {
    const strip = this.element?.querySelector("[data-tabbed-tabs]");
    if (!strip) return;
    strip.replaceChildren();

    for (const [id, app] of this._tabbedApps) {
      const tab = document.createElement("div");
      tab.className = `tabbed-foundry-tab${id === this._activeId ? " active" : ""}`;

      const activate = document.createElement("button");
      activate.type = "button";
      activate.className = "tabbed-foundry-tab-label";
      activate.textContent = app.title || app.constructor.name || "Aplicação";
      activate.title = activate.textContent;
      activate.addEventListener("click", () => this.activate(id));

      const close = document.createElement("button");
      close.type = "button";
      close.className = "tabbed-foundry-tab-close";
      close.textContent = "×";
      close.title = "Fechar aplicação";
      close.addEventListener("click", async (event) => {
        event.stopPropagation();
        await app.close();
        this._tabbedApps.delete(id);
        if (this._activeId === id) {
          this._activeId = this._tabbedApps.keys().next().value ?? null;
        }
        this._syncChildElements();
        this._renderTabStrip();
      });

      tab.append(activate, close);
      strip.append(tab);
    }

    if (this._tabbedApps.size === 0) {
      const empty = document.createElement("span");
      empty.className = "tabbed-foundry-empty";
      empty.textContent = "Destaque uma aplicação para adicioná-la aqui.";
      strip.append(empty);
    }
  }

  activate(id) {
    if (!this._tabbedApps.has(id)) return;
    this._activeId = id;
    this._syncChildElements();
    this._renderTabStrip();
  }
}

let host = null;
let originalDetachWindow = null;

function installDetachInterceptor() {
  const ApplicationV2 = foundry.applications.api.ApplicationV2;
  if (!ApplicationV2?.prototype || ApplicationV2.prototype.__tabbedFoundryPatched) return;

  originalDetachWindow = ApplicationV2.prototype.detachWindow;
  ApplicationV2.prototype.detachWindow = async function(options = {}) {
    if (this instanceof TabbedFoundryHost) {
      return originalDetachWindow.call(this, options);
    }

    if (!host) host = new TabbedFoundryHost();
    const captured = await host.adopt(this);
    if (captured) return this;

    return originalDetachWindow.call(this, options);
  };

  Object.defineProperty(ApplicationV2.prototype, "__tabbedFoundryPatched", {
    value: true,
    configurable: true
  });
}

Hooks.once("ready", () => {
  installDetachInterceptor();
  console.info(`[${MODULE_ID}] v0.1.0 carregado. Interceptação de detachWindow ativa para ApplicationV2.`);
});

Hooks.once("shutdown", () => {
  // Não deixamos referências globais penduradas ao encerrar a sessão.
  host = null;
});
