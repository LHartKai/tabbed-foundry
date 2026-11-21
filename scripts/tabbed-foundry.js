const MODULE_ID = "tabbed-foundry";
const SETTING_AUTO_GROUP = "enabled";
const PATCH_FLAG = "__tabbedFoundryDetachPatch";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const HandlebarsApplication = HandlebarsApplicationMixin(ApplicationV2);

let host = null;
let workspaceAnchor = null;
let originalDetachWindow = null;
let hostCreation = null;
let workspaceAnchorCreation = null;
const pendingCaptures = new WeakMap();

/**
 * Invisible root parent rendered in the main Foundry document.
 * Applications re-parented here remain in the main Foundry workspace.
 */
class TabbedFoundryWorkspaceAnchor extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "tabbed-foundry-workspace-anchor",
    classes: ["tabbed-foundry-workspace-anchor"],
    window: {
      frame: false,
      resizable: false,
      minimizable: false
    },
    position: { left: 0, top: 0, width: 1, height: 1 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/workspace-anchor.hbs` }
  };

  async _prepareContext(_options) {
    return {};
  }
}

class TabbedFoundryHost extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "tabbed-foundry-host",
    classes: ["tabbed-foundry-host"],
    window: {
      title: "Tabbed Foundry",
      icon: "fas fa-layer-group",
      frame: true,
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
    this._tabbedApps = new Map();
    this._childListeners = new Map();
    this._originalPositions = new Map();
    this._activeId = null;
    this._contextMenuCleanup = null;
    this._dragSession = null;
    this._dragEscapeHandler = null;
    this._boundLayout = () => this._layoutChildren();
    this._resizeObserver = null;
    this._observedView = null;
    this.addEventListener("close", () => {
      this._removeLayoutObservers();
      this._closeTabContextMenu();
      if (host === this) host = null;
    });
    this.addEventListener("position", this._boundLayout);
  }

  async _prepareContext(_options) {
    return {};
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._renderTabStrip();
    this._syncChildElements();
    this._setupLayoutObservers();
    this._layoutChildren();
  }

  async ensureDetachedWindow() {
    if (!this.rendered) await this.render({ force: true });
    if (!this.window?.windowId) {
      await originalDetachWindow.call(this, {});
    }
    this._setupLayoutObservers();
    this._layoutChildren();
  }

  async adopt(app, options = {}) {
    if (!(app instanceof ApplicationV2) || app === this) {
      throw new TypeError("Tabbed Foundry só pode agrupar instâncias ApplicationV2.");
    }

    if (this._tabbedApps.has(app.id)) {
      this.activate(app.id);
      return app;
    }

    await this.ensureDetachedWindow();
    if (!this._originalPositions.has(app.id) && app.position) {
      this._originalPositions.set(app.id, { ...app.position });
    }
    await this.renderChild(app, options);

    this._tabbedApps.set(app.id, app);
    const onRender = () => this._decorateChild(app);
    const onClose = () => this._onChildClosed(app.id);
    app.addEventListener("render", onRender);
    app.addEventListener("close", onClose);
    this._childListeners.set(app.id, { app, onRender, onClose });

    this._activeId = app.id;
    this._decorateChild(app);
    this._syncChildElements();
    this._renderTabStrip();
    this._layoutChildren();
    this.activate(app.id);
    return app;
  }

  _decorateChild(app) {
    const element = app?.element;
    if (!element) return;
    element.classList.add("tabbed-foundry-child");
    element.hidden = app.id !== this._activeId;
    element.setAttribute("aria-hidden", String(app.id !== this._activeId));
  }

  _syncChildElements() {
    for (const [id, app] of this._tabbedApps) {
      this._decorateChild(app);
      const element = app?.element;
      if (!element) continue;
      element.classList.toggle("tabbed-foundry-child-active", id === this._activeId);
    }
    this._layoutChildren();
  }

  _setupLayoutObservers() {
    const element = this.element;
    const view = element?.ownerDocument?.defaultView;
    const content = element?.querySelector(":scope > .window-content") ?? element?.querySelector(".window-content");
    if (!view || !content) return;

    // The transparent host frame must not intercept clicks intended for its
    // child application. Keep only the host header and resize handle interactive.
    this.window?.header?.style.setProperty("pointer-events", "auto", "important");
    this.window?.resize?.style.setProperty("pointer-events", "auto", "important");
    content.style.setProperty("pointer-events", "none", "important");

    if (!this._observedView || this._observedView !== view) {
      this._removeLayoutObservers();
      this._observedView = view;
      view.addEventListener("resize", this._boundLayout);
    }
    if (!this._resizeObserver && typeof view.ResizeObserver === "function") {
      this._resizeObserver = new view.ResizeObserver(this._boundLayout);
      this._resizeObserver.observe(content);
    }
  }

  _removeLayoutObservers() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._observedView?.removeEventListener("resize", this._boundLayout);
    this._observedView = null;
  }

  _layoutChildren() {
    const root = this.element;
    const content = root?.querySelector(":scope > .window-content") ?? root?.querySelector(".window-content");
    if (!root || !content) return;

    const tabs = root.querySelector("[data-tabbed-tabs]");
    const bounds = content.getBoundingClientRect();
    const tabsHeight = tabs?.getBoundingClientRect().height ?? 0;
    const left = bounds.left;
    const top = bounds.top + tabsHeight;
    const width = bounds.width;
    const height = Math.max(0, bounds.height - tabsHeight);

    root.style.setProperty("z-index", "100000", "important");
    for (const app of this._tabbedApps.values()) {
      const child = app?.element;
      if (!child) continue;
      child.style.setProperty("position", "fixed", "important");
      child.style.setProperty("left", `${left}px`, "important");
      child.style.setProperty("top", `${top}px`, "important");
      child.style.setProperty("width", `${width}px`, "important");
      child.style.setProperty("height", `${height}px`, "important");
      child.style.setProperty("z-index", "99999", "important");
    }
  }

  _onChildClosed(id) {
    this.release(id);
  }

  release(id) {
    const app = this._tabbedApps.get(id);
    const listeners = this._childListeners.get(id);
    if (listeners) {
      listeners.app.removeEventListener("render", listeners.onRender);
      listeners.app.removeEventListener("close", listeners.onClose);
      this._childListeners.delete(id);
    }
    const element = app?.element;
    if (element) {
      element.classList.remove("tabbed-foundry-child", "tabbed-foundry-child-active");
      element.hidden = false;
      element.removeAttribute("aria-hidden");
      for (const property of ["position", "left", "top", "width", "height", "z-index"]) {
        element.style.removeProperty(property);
      }
    }
    const originalPosition = this._originalPositions.get(id);
    this._originalPositions.delete(id);
    this._tabbedApps.delete(id);
    if (this._activeId === id) {
      this._activeId = this._tabbedApps.keys().next().value ?? null;
    }
    this._syncChildElements();
    this._renderTabStrip();
    this._layoutChildren();
    if (originalPosition && app?.rendered) {
      app.setPosition(originalPosition);
    }
  }

  _renderTabStrip() {
    const strip = this.element?.querySelector("[data-tabbed-tabs]");
    const empty = this.element?.querySelector("[data-tabbed-empty]");
    if (!strip) return;

    strip.replaceChildren();
    const doc = this.element.ownerDocument;

    for (const [id, app] of this._tabbedApps) {
      const tab = doc.createElement("div");
      tab.className = `tabbed-foundry-tab${id === this._activeId ? " active" : ""}`;
      tab.draggable = true;
      tab.dataset.appId = id;

      const activate = doc.createElement("button");
      activate.type = "button";
      activate.className = "tabbed-foundry-tab-label";
      activate.textContent = app.title || app.constructor.name || "Aplicação";
      activate.title = activate.textContent;
      activate.setAttribute("aria-pressed", String(id === this._activeId));
      activate.addEventListener("click", () => this.activate(id));

      const close = doc.createElement("button");
      close.type = "button";
      close.className = "tabbed-foundry-tab-close";
      close.textContent = "×";
      close.title = "Fechar aplicação";
      close.setAttribute("aria-label", `Fechar ${activate.textContent}`);
      close.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await app.close();
        } catch (error) {
          console.error(`[${MODULE_ID}] Erro ao fechar aplicação pela aba.`, error);
        }
      });

      tab.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._showTabContextMenu(event, app);
      });

      tab.addEventListener("dragstart", (event) => {
        this._dragSession = { app, cancelled: false, accepted: false };
        this._dragEscapeHandler = (keyEvent) => {
          if (keyEvent.key === "Escape" && this._dragSession) {
            this._dragSession.cancelled = true;
          }
        };
        doc.addEventListener("keydown", this._dragEscapeHandler, true);
        event.dataTransfer?.setData("text/plain", id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      tab.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      tab.addEventListener("drop", (event) => {
        event.preventDefault();
        if (this._dragSession) this._dragSession.accepted = true;
        const draggedId = event.dataTransfer?.getData("text/plain");
        if (draggedId && draggedId !== id) this._reorderTab(draggedId, id);
      });
      tab.addEventListener("dragend", (event) => {
        const session = this._dragSession;
        this._dragSession = null;
        if (this._dragEscapeHandler) {
          doc.removeEventListener("keydown", this._dragEscapeHandler, true);
          this._dragEscapeHandler = null;
        }
        if (!session || session.cancelled || session.accepted) return;
        if (event.dataTransfer?.dropEffect === "move") return;
        // A drop not accepted by a tab or a future split zone means native detach.
        this._detachApplicationToNativeWindow(session.app);
      });

      tab.append(activate, close);
      strip.append(tab);
    }

    if (empty) empty.hidden = this._tabbedApps.size > 0;
  }

  _reorderTab(draggedId, targetId) {
    const entries = [...this._tabbedApps.entries()];
    const from = entries.findIndex(([id]) => id === draggedId);
    const to = entries.findIndex(([id]) => id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    this._tabbedApps = new Map(entries);
    this._renderTabStrip();
  }

  activate(id) {
    if (!this._tabbedApps.has(id)) return;
    this._activeId = id;
    this._syncChildElements();
    this._renderTabStrip();
  }

  acceptDraggedTabDrop() {
    if (this._dragSession) this._dragSession.accepted = true;
  }

  _showTabContextMenu(event, app) {
    this._closeTabContextMenu();
    const doc = this.element?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view || !this._tabbedApps.has(app.id)) return;

    const menu = doc.createElement("div");
    menu.className = "tabbed-foundry-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Ações para ${app.title || "aplicação"}`);

    const createItem = (label, icon, action, description) => {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "tabbed-foundry-context-menu-item";
      item.setAttribute("role", "menuitem");
      const iconElement = doc.createElement("i");
      iconElement.className = icon;
      iconElement.setAttribute("aria-hidden", "true");
      const textWrap = doc.createElement("span");
      textWrap.className = "tabbed-foundry-context-menu-text";
      const title = doc.createElement("strong");
      title.textContent = label;
      const hint = doc.createElement("small");
      hint.textContent = description;
      textWrap.append(title, hint);
      item.append(iconElement, textWrap);
      item.addEventListener("click", async () => {
        this._closeTabContextMenu();
        try {
          await action();
        } catch (error) {
          console.error(`[${MODULE_ID}] Ação de aba falhou.`, error);
          ui.notifications?.error("Não foi possível mover esta aplicação.");
        }
      });
      return item;
    };

    menu.append(
      createItem(
        "Voltar para o Foundry",
        "fas fa-arrow-up-right-from-square",
        () => this._returnApplicationToWorkspace(app),
        "Reanexar à janela principal"
      ),
      createItem(
        "Destacar em janela própria",
        "fas fa-window-restore",
        () => this._detachApplicationToNativeWindow(app),
        "Abrir em uma janela externa nativa"
      )
    );

    doc.body.append(menu);
    const margin = 8;
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, view.innerWidth - menuRect.width - margin);
    const top = Math.min(event.clientY, view.innerHeight - menuRect.height - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;

    const onPointerDown = (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) this._closeTabContextMenu();
    };
    const onKeyDown = (keyEvent) => {
      if (keyEvent.key === "Escape") this._closeTabContextMenu();
    };
    const onWindowBlur = () => this._closeTabContextMenu();
    view.addEventListener("pointerdown", onPointerDown, true);
    view.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("blur", onWindowBlur);

    this._contextMenuCleanup = () => {
      view.removeEventListener("pointerdown", onPointerDown, true);
      view.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("blur", onWindowBlur);
      menu.remove();
      this._contextMenuCleanup = null;
    };
  }

  _closeTabContextMenu() {
    this._contextMenuCleanup?.();
  }

  async _returnApplicationToWorkspace(app) {
    if (!this._tabbedApps.has(app.id)) return;
    const anchor = await getOrCreateWorkspaceAnchor();
    await anchor.renderChild(app);
    this.release(app.id);
    app.bringToFront();
  }

  async _detachApplicationToNativeWindow(app) {
    if (!this._tabbedApps.has(app.id)) return;
    // The patched detachWindow handler releases the tab before the Foundry
    // native method detaches the child into its own external window.
    await app.detachWindow();
  }
}

function isAutoGroupingEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING_AUTO_GROUP) === true;
  } catch (error) {
    console.warn(`[${MODULE_ID}] Não foi possível ler a configuração; usando detach nativo.`, error);
    return false;
  }
}

async function getOrCreateWorkspaceAnchor() {
  if (workspaceAnchor?.rendered) return workspaceAnchor;
  if (workspaceAnchorCreation) return workspaceAnchorCreation;

  workspaceAnchorCreation = (async () => {
    const candidate = new TabbedFoundryWorkspaceAnchor();
    await candidate.render({ force: true });
    workspaceAnchor = candidate;
    return candidate;
  })();

  try {
    return await workspaceAnchorCreation;
  } finally {
    workspaceAnchorCreation = null;
  }
}

async function getOrCreateHost() {
  if (host?.rendered) {
    if (!host.window?.windowId) await host.ensureDetachedWindow();
    return host;
  }
  if (hostCreation) return hostCreation;

  hostCreation = (async () => {
    const candidate = new TabbedFoundryHost();
    host = candidate;
    try {
      await candidate.ensureDetachedWindow();
      return candidate;
    } catch (error) {
      if (host === candidate) host = null;
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

async function captureApplication(app, options) {
  if (pendingCaptures.has(app)) return pendingCaptures.get(app);

  const capturePromise = (async () => {
    try {
      const target = await getOrCreateHost();
      await target.adopt(app, options);
      return app;
    } catch (error) {
      console.error(`[${MODULE_ID}] Falha ao agrupar aplicação; executando detach nativo.`, error);
      if (host && app.parent === host) {
        console.warn(`[${MODULE_ID}] A aplicação já foi vinculada à janela hospedeira; mantendo-a aberta.`);
        return app;
      }
      if (host && host._tabbedApps?.size === 0) {
        try {
          await host.close();
        } catch (closeError) {
          console.warn(`[${MODULE_ID}] Não foi possível fechar a janela hospedeira vazia.`, closeError);
        }
        host = null;
      }
      return originalDetachWindow.call(app, options);
    }
  })();

  pendingCaptures.set(app, capturePromise);
  try {
    return await capturePromise;
  } finally {
    pendingCaptures.delete(app);
  }
}

function installDetachInterceptor() {
  const prototype = ApplicationV2.prototype;
  if (prototype[PATCH_FLAG]) return;

  originalDetachWindow = prototype.detachWindow;
  if (typeof originalDetachWindow !== "function") {
    console.error(`[${MODULE_ID}] ApplicationV2.detachWindow não foi encontrado. O módulo não fará interceptação.`);
    return;
  }

  prototype.detachWindow = function(options = {}) {
    if (this instanceof TabbedFoundryHost) return originalDetachWindow.call(this, options);

    // Um filho já agrupado deve sair da barra mesmo se o autoagrupamento foi desligado.
    if (host && this.parent === host) {
      const parentHost = host;
      // Restore the application's pre-tab geometry before Foundry creates
      // its native external window.
      parentHost.release(this.id);
      return originalDetachWindow.call(this, options).catch(async (error) => {
        try {
          await parentHost.adopt(this, options);
        } catch (recoveryError) {
          console.error(`[${MODULE_ID}] Não foi possível restaurar a aba após falha no detach.`, recoveryError);
        }
        throw error;
      });
    }

    // Configuração desligada: não interceptar o detach nativo.
    if (!isAutoGroupingEnabled()) return originalDetachWindow.call(this, options);

    // Applications returned to the main Foundry workspace are children of
    // the hidden workspace anchor and should be eligible for automatic capture.
    if (workspaceAnchor && this.parent === workspaceAnchor) {
      return captureApplication(this, options);
    }

    // Do not seize applications already detached or owned by another parent.
    if (this.window?.windowId || this.parent) return originalDetachWindow.call(this, options);
    return captureApplication(this, options);
  };

  Object.defineProperty(prototype, PATCH_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_AUTO_GROUP, {
    name: "Agrupar aplicações destacadas automaticamente",
    hint: "Quando ativado, aplicações destacadas são enviadas para a janela única do Tabbed Foundry. Desative para usar o detach nativo do Foundry.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", async () => {
  installDetachInterceptor();
  try {
    // Create the anchor in the primary Foundry document before any detached
    // Tabbed window can request that an application be returned to it.
    await getOrCreateWorkspaceAnchor();
  } catch (error) {
    console.error(`[${MODULE_ID}] Não foi possível preparar o ponto de retorno ao workspace principal.`, error);
  }

  game.modules.get(MODULE_ID).api = {
    get host() { return host; },
    get workspaceAnchor() { return workspaceAnchor; },
    get enabled() { return isAutoGroupingEnabled(); },
    async closeHost() {
      if (host) await host.close();
    }
  };
  console.info(`[${MODULE_ID}] Carregado. Agrupamento automático: ${isAutoGroupingEnabled() ? "ativado" : "desativado"}.`);
});
