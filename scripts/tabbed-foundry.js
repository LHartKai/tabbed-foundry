const MODULE_ID = "tabbed-foundry";
const SETTING_AUTO_GROUP = "enabled";
const PATCH_FLAG = "__tabbedFoundryDetachPatch";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const HandlebarsApplication = HandlebarsApplicationMixin(ApplicationV2);

let host = null;
let workspaceAnchor = null;
let originalDetachWindow = null;
let hostCreation = null;
const pendingCaptures = new WeakMap();

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
    main: { template: "modules/tabbed-foundry/templates/host.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this._tabbedApps = new Map();
    this._childListeners = new Map();
    this._originalPositions = new Map();
    this._detachingApps = new Set();
    this._paneContentElements = new Map();
    this._paneSequence = 0;
    this._splitSequence = 0;
    this._layoutTree = this._createPane();
    this._activePaneId = this._layoutTree.id;
    this._contextMenuCleanup = null;
    this._dragSession = null;
    this._dragEscapeHandler = null;
    this._boundLayout = () => this._scheduleLayout();
    this._resizeObserver = null;
    this._childResizeObserver = null;
    this._observedView = null;
    this._observedChildren = new Map();
    this._patchedMejCloseButtons = new WeakSet();
    this._layoutFrame = null;
    this._dividerCleanup = null;

    this.addEventListener("close", () => {
      this._removeLayoutObservers();
      this._closeTabContextMenu();
      this._finishDragSession(false);
      this._stopDividerResize();
      if (host === this) host = null;
    });
    this.addEventListener("position", this._boundLayout);
  }

  _createPane() {
    return {
      type: "pane",
      id: "tabbed-pane-" + (++this._paneSequence),
      tabs: [],
      activeId: null
    };
  }

  async _prepareContext(_options) {
    return {};
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._renderWorkspace();
    this._setupLayoutObservers();
    this._scheduleLayout();
  }

  async ensureDetachedWindow() {
    if (!this.rendered) await this.render({ force: true });
    if (!this.window?.windowId) {
      await originalDetachWindow.call(this, {});
    }
    this._setupLayoutObservers();
    this._scheduleLayout();
  }

  async adopt(app, options = {}) {
    if (!(app instanceof ApplicationV2) || app === this) {
      throw new TypeError("Tabbed Foundry só pode agrupar instâncias ApplicationV2.");
    }

    if (this._tabbedApps.has(app.id)) {
      const pane = this._findPaneForApp(app.id);
      if (pane) this.activate(app.id, pane.id);
      return app;
    }

    await this.ensureDetachedWindow();
    if (!this._originalPositions.has(app.id) && app.position) {
      this._originalPositions.set(app.id, { ...app.position });
    }

    this._tabbedApps.set(app.id, app);
    this._insertIntoActivePane(app.id);

    const onRender = () => {
      this._decorateChild(app);
      this._applyOptionalIntegrations(app);
      this._observeChild(app);
      this._scheduleLayout();
    };
    const onPosition = () => this._scheduleLayout();
    const onClose = () => this.release(app.id);

    app.addEventListener("render", onRender);
    app.addEventListener("position", onPosition);
    app.addEventListener("close", onClose);
    this._childListeners.set(app.id, { app, onRender, onPosition, onClose });

    try {
      await this.renderChild(app, options);
      this._decorateChild(app);
      this._applyOptionalIntegrations(app);
      this._observeChild(app);
      this._renderWorkspace();
      this._scheduleLayout();
      this.bringToFront();
      return app;
    } catch (error) {
      this.release(app.id);
      throw error;
    }
  }

  _findPane(node, paneId) {
    if (!node) return null;
    if (node.type === "pane") return node.id === paneId ? node : null;
    return this._findPane(node.first, paneId) || this._findPane(node.second, paneId);
  }

  _findPaneForApp(appId, node = this._layoutTree) {
    if (!node) return null;
    if (node.type === "pane") return node.tabs.includes(appId) ? node : null;
    return this._findPaneForApp(appId, node.first) || this._findPaneForApp(appId, node.second);
  }

  _firstPane(node = this._layoutTree) {
    if (!node) return null;
    if (node.type === "pane") return node;
    return this._firstPane(node.first) || this._firstPane(node.second);
  }

  _forEachPane(node, callback) {
    if (!node) return;
    if (node.type === "pane") {
      callback(node);
      return;
    }
    this._forEachPane(node.first, callback);
    this._forEachPane(node.second, callback);
  }

  _replacePane(node, paneId, replacement) {
    if (!node) return null;
    if (node.type === "pane") return node.id === paneId ? replacement : node;
    node.first = this._replacePane(node.first, paneId, replacement);
    node.second = this._replacePane(node.second, paneId, replacement);
    return node;
  }

  _removeFromLayout(appId, keepEmptyPaneId = null) {
    const clean = (node) => {
      if (!node) return null;
      if (node.type === "pane") {
        node.tabs = node.tabs.filter((id) => id !== appId);
        if (node.activeId === appId) node.activeId = node.tabs[0] ?? null;
        if (node.tabs.length === 0 && node.id !== keepEmptyPaneId) return null;
        return node;
      }
      node.first = clean(node.first);
      node.second = clean(node.second);
      if (!node.first) return node.second;
      if (!node.second) return node.first;
      return node;
    };

    this._layoutTree = clean(this._layoutTree) || this._createPane();
    if (!this._findPane(this._layoutTree, this._activePaneId)) {
      this._activePaneId = this._firstPane()?.id ?? this._layoutTree.id;
    }
  }

  _insertIntoActivePane(appId) {
    let pane = this._findPane(this._layoutTree, this._activePaneId);
    if (!pane) {
      pane = this._firstPane();
      this._activePaneId = pane?.id ?? null;
    }
    if (!pane) {
      this._layoutTree = this._createPane();
      pane = this._layoutTree;
      this._activePaneId = pane.id;
    }
    if (!pane.tabs.includes(appId)) pane.tabs.push(appId);
    pane.activeId = appId;
  }

  _decorateChild(app) {
    const element = app?.element;
    if (!element) return;
    if (this._detachingApps.has(app.id)) {
      this._clearChildPresentation(app);
      return;
    }
    const pane = this._findPaneForApp(app.id);
    const active = !!pane && pane.activeId === app.id;
    element.classList.add("tabbed-foundry-child");
    element.hidden = !active;
    element.setAttribute("aria-hidden", String(!active));
  }

  _syncChildElements() {
    for (const app of this._tabbedApps.values()) this._decorateChild(app);
    this._scheduleLayout();
  }

  _setupLayoutObservers() {
    const element = this.element;
    const view = element?.ownerDocument?.defaultView;
    const content = element?.querySelector(":scope > .window-content") ?? element?.querySelector(".window-content");
    if (!view || !content) return;

    this.window?.header?.style.setProperty("pointer-events", "auto", "important");
    this.window?.resize?.style.setProperty("pointer-events", "auto", "important");
    content.style.setProperty("pointer-events", "none", "important");

    if (this._observedView !== view) {
      this._removeLayoutObservers();
      this._observedView = view;
      view.addEventListener("resize", this._boundLayout);
    }

    if (!this._resizeObserver && typeof view.ResizeObserver === "function") {
      this._resizeObserver = new view.ResizeObserver(this._boundLayout);
      this._resizeObserver.observe(content);
    }
    if (!this._childResizeObserver && typeof view.ResizeObserver === "function") {
      this._childResizeObserver = new view.ResizeObserver(() => this._scheduleLayout());
    }
    // The host can move to a different Electron document when it is detached.
    // Re-observe existing children with the ResizeObserver from that document.
    for (const app of this._tabbedApps.values()) this._observeChild(app);
  }

  _observeChild(app) {
    const element = app?.element;
    if (!element || !this._childResizeObserver) return;
    const previous = this._observedChildren.get(app.id);
    if (previous === element) return;
    if (previous) this._childResizeObserver.unobserve(previous);
    this._childResizeObserver.observe(element);
    this._observedChildren.set(app.id, element);
  }

  _removeLayoutObservers() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._childResizeObserver?.disconnect();
    this._childResizeObserver = null;
    this._observedChildren.clear();
    this._observedView?.removeEventListener("resize", this._boundLayout);
    this._observedView = null;
    if (this._layoutFrame && this.element?.ownerDocument?.defaultView) {
      this.element.ownerDocument.defaultView.cancelAnimationFrame(this._layoutFrame);
    }
    this._layoutFrame = null;
  }

  _scheduleLayout() {
    const view = this.element?.ownerDocument?.defaultView;
    if (!view) {
      this._layoutChildren();
      return;
    }
    if (this._layoutFrame !== null) return;
    this._layoutFrame = view.requestAnimationFrame(() => {
      this._layoutFrame = null;
      this._layoutChildren();
    });
  }

  _layoutChildren() {
    const root = this.element;
    if (!root) return;

    this._forEachPane(this._layoutTree, (pane) => {
      const content = this._paneContentElements.get(pane.id);
      if (!content) return;
      const bounds = content.getBoundingClientRect();

      for (const appId of pane.tabs) {
        if (this._detachingApps.has(appId)) continue;
        const app = this._tabbedApps.get(appId);
        const child = app?.element;
        if (!child) continue;

        child.classList.add("tabbed-foundry-child");
        child.hidden = pane.activeId !== appId;
        child.setAttribute("aria-hidden", String(pane.activeId !== appId));
        child.style.setProperty("position", "fixed", "important");
        child.style.setProperty("left", bounds.left + "px", "important");
        child.style.setProperty("top", bounds.top + "px", "important");
        child.style.setProperty("width", bounds.width + "px", "important");
        child.style.setProperty("height", bounds.height + "px", "important");
        child.style.setProperty("z-index", "99999", "important");
      }
    });
  }

  _renderWorkspace() {
    const workspace = this.element?.querySelector("[data-tabbed-workspace]");
    if (!workspace) return;
    workspace.replaceChildren();
    this._paneContentElements.clear();
    this._renderLayoutNode(this._layoutTree, workspace);
    this._scheduleLayout();
  }

  _renderLayoutNode(node, parentElement) {
    const doc = parentElement.ownerDocument;
    if (node.type === "pane") {
      const pane = doc.createElement("section");
      pane.className = "tabbed-foundry-pane";
      pane.dataset.paneId = node.id;
      if (node.id === this._activePaneId) pane.classList.add("active");

      const tabs = doc.createElement("nav");
      tabs.className = "tabbed-foundry-pane-tabs";
      tabs.setAttribute("aria-label", "Abas do painel");

      for (const appId of node.tabs) {
        const app = this._tabbedApps.get(appId);
        if (!app) continue;

        const tab = doc.createElement("div");
        tab.className = "tabbed-foundry-tab" + (node.activeId === appId ? " active" : "");
        tab.draggable = true;
        tab.dataset.appId = appId;

        const activate = doc.createElement("button");
        activate.type = "button";
        activate.className = "tabbed-foundry-tab-label";
        activate.textContent = app.title || app.constructor.name || "Aplicação";
        activate.title = activate.textContent;
        activate.setAttribute("aria-pressed", String(node.activeId === appId));
        activate.addEventListener("click", () => this.activate(appId, node.id));
        activate.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this._showTabContextMenu(event, app);
        });
        tab.addEventListener("dragover", (event) => {
          const draggedId = this._draggedAppId(event);
          if (!draggedId || draggedId === appId) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          const dropZone = this._tabDropZone(event, tab);
          tab.dataset.dropPreview = dropZone;
        });
        tab.addEventListener("dragleave", (event) => {
          if (!tab.contains(event.relatedTarget)) delete tab.dataset.dropPreview;
        });
        tab.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          delete tab.dataset.dropPreview;
          const draggedId = this._draggedAppId(event);
          if (!draggedId || draggedId === appId) return;
          const dropZone = this._tabDropZone(event, tab);
          this._finishDragSession(true);
          if (dropZone === "left" || dropZone === "right") {
            this._splitPaneWithApplication(draggedId, node.id, dropZone);
          } else {
            this._dropOnTab(draggedId, node.id, appId);
          }
        });

        const close = doc.createElement("button");
        close.type = "button";
        close.className = "tabbed-foundry-tab-close";
        close.textContent = "×";
        close.title = "Fechar aplicação";
        close.setAttribute("aria-label", "Fechar " + activate.textContent);
        close.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await app.close();
          } catch (error) {
            console.error("[" + MODULE_ID + "] Erro ao fechar aplicação pela aba.", error);
          }
        });

        tab.addEventListener("dragstart", (event) => this._startTabDrag(event, app, doc));
        tab.addEventListener("dragend", (event) => this._endTabDrag(event, doc));
        tab.append(activate, close);
        tabs.append(tab);
      }

      const content = doc.createElement("div");
      content.className = "tabbed-foundry-pane-content";
      content.dataset.paneContent = node.id;
      if (node.tabs.length === 0) {
        const empty = doc.createElement("div");
        empty.className = "tabbed-foundry-pane-empty";
        empty.textContent = "Arraste uma aba para este painel";
        content.append(empty);
      }
      this._paneContentElements.set(node.id, content);

      const dropZones = doc.createElement("div");
      dropZones.className = "tabbed-foundry-dropzones";
      for (const zone of ["left", "right", "top", "bottom", "center"]) {
        const target = doc.createElement("button");
        target.type = "button";
        target.className = "tabbed-foundry-dropzone zone-" + zone;
        target.dataset.dropZone = zone;
        target.textContent = zone === "center" ? "Adicionar como aba" : "";
        target.setAttribute("aria-label", zone === "center" ? "Adicionar como aba neste painel" : "Dividir painel: " + zone);
        target.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          target.classList.add("drag-over");
        });
        target.addEventListener("dragleave", () => target.classList.remove("drag-over"));
        target.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          target.classList.remove("drag-over");
          const draggedId = this._draggedAppId(event);
          if (!draggedId) return;
          this._finishDragSession(true);
          this._dropOnPane(draggedId, node.id, zone);
        });
        dropZones.append(target);
      }

      pane.append(tabs, content, dropZones);
      parentElement.append(pane);
      return;
    }

    const split = doc.createElement("div");
    split.className = "tabbed-foundry-split split-" + node.direction;
    split.dataset.splitId = node.id;

    const first = doc.createElement("div");
    first.className = "tabbed-foundry-split-child split-first";
    first.style.flex = node.ratio + " 1 0px";
    this._renderLayoutNode(node.first, first);

    const divider = doc.createElement("div");
    divider.className = "tabbed-foundry-divider";
    divider.tabIndex = 0;
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", node.direction === "horizontal" ? "vertical" : "horizontal");
    divider.setAttribute("aria-label", "Redimensionar painéis");
    divider.addEventListener("pointerdown", (event) => this._startDividerResize(event, node, split, first, second));
    divider.addEventListener("dblclick", () => {
      node.ratio = 0.5;
      this._applySplitRatio(node, split, first, second);
      this._scheduleLayout();
    });
    divider.addEventListener("keydown", (event) => {
      const horizontal = node.direction === "horizontal";
      const negative = horizontal ? "ArrowLeft" : "ArrowUp";
      const positive = horizontal ? "ArrowRight" : "ArrowDown";
      if (event.key !== negative && event.key !== positive) return;
      event.preventDefault();
      node.ratio = Math.max(0.18, Math.min(0.82, node.ratio + (event.key === positive ? 0.03 : -0.03)));
      this._applySplitRatio(node, split, first, second);
      this._scheduleLayout();
    });

    const second = doc.createElement("div");
    second.className = "tabbed-foundry-split-child split-second";
    second.style.flex = (1 - node.ratio) + " 1 0px";
    this._renderLayoutNode(node.second, second);

    split.append(first, divider, second);
    parentElement.append(split);
  }

  _applySplitRatio(node, split, first, second) {
    const bounds = split.getBoundingClientRect();
    const size = node.direction === "horizontal" ? bounds.width : bounds.height;
    const minRatio = size > 0 ? Math.min(0.5, 180 / size) : 0.18;
    const ratio = Math.max(minRatio, Math.min(1 - minRatio, node.ratio));
    node.ratio = ratio;
    first.style.flex = ratio + " 1 0px";
    second.style.flex = (1 - ratio) + " 1 0px";
  }

  _startDividerResize(event, node, split, first, second) {
    if (event.button !== 0) return;
    event.preventDefault();
    this._stopDividerResize();

    const view = this.element?.ownerDocument?.defaultView;
    if (!view) return;
    const bounds = split.getBoundingClientRect();
    const horizontal = node.direction === "horizontal";
    const size = horizontal ? bounds.width : bounds.height;
    if (!size) return;

    dividerPointerCapture(event.currentTarget, event.pointerId);

    const onMove = (moveEvent) => {
      const coordinate = horizontal ? moveEvent.clientX - bounds.left : moveEvent.clientY - bounds.top;
      const rawRatio = coordinate / size;
      const minRatio = Math.min(0.5, 180 / size);
      node.ratio = Math.max(minRatio, Math.min(1 - minRatio, rawRatio));
      this._applySplitRatio(node, split, first, second);
      this._scheduleLayout();
    };
    const onEnd = () => this._stopDividerResize();

    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onEnd, { once: true });
    view.addEventListener("pointercancel", onEnd, { once: true });
    this._dividerCleanup = () => {
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onEnd);
      view.removeEventListener("pointercancel", onEnd);
    };
  }

  _stopDividerResize() {
    this._dividerCleanup?.();
    this._dividerCleanup = null;
  }

  _startTabDrag(event, app, doc) {
    this._dragSession = { app, accepted: false, cancelled: false };
    this.element?.classList.add("tabbed-foundry-dragging");
    this._dragEscapeHandler = (keyEvent) => {
      if (keyEvent.key === "Escape" && this._dragSession) {
        this._dragSession.cancelled = true;
        this._finishDragSession(false);
      }
    };
    doc.addEventListener("keydown", this._dragEscapeHandler, true);
    event.dataTransfer?.setData("text/plain", app.id);
    event.dataTransfer?.setData("application/x-tabbed-foundry-app", app.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  _draggedAppId(event) {
    return event.dataTransfer?.getData("application/x-tabbed-foundry-app") ||
      event.dataTransfer?.getData("text/plain") ||
      this._dragSession?.app?.id ||
      null;
  }

  _finishDragSession(accepted) {
    if (this._dragSession && accepted) this._dragSession.accepted = true;
    const doc = this.element?.ownerDocument;
    if (this._dragEscapeHandler && doc) {
      doc.removeEventListener("keydown", this._dragEscapeHandler, true);
    }
    this._dragEscapeHandler = null;
    this.element?.classList.remove("tabbed-foundry-dragging");
    if (accepted) this._dragSession = null;
  }

  _endTabDrag(_event, doc) {
    const session = this._dragSession;
    if (this._dragEscapeHandler) doc.removeEventListener("keydown", this._dragEscapeHandler, true);
    this._dragEscapeHandler = null;
    this.element?.classList.remove("tabbed-foundry-dragging");
    this._dragSession = null;
    if (!session || session.cancelled || session.accepted) return;
    this._detachApplicationToNativeWindow(session.app);
  }

  _tabDropZone(event, tab) {
    const bounds = tab.getBoundingClientRect();
    if (!bounds.width) return "center";
    const x = (event.clientX - bounds.left) / bounds.width;
    if (x <= 0.22) return "left";
    if (x >= 0.78) return "right";
    return "center";
  }

  _dropOnTab(appId, targetPaneId, targetAppId) {
    const source = this._findPaneForApp(appId);
    const target = this._findPane(this._layoutTree, targetPaneId);
    if (!source || !target) return;

    if (source.id === target.id) {
      const from = source.tabs.indexOf(appId);
      const to = source.tabs.indexOf(targetAppId);
      if (from >= 0 && to >= 0 && from !== to) {
        source.tabs.splice(to, 0, source.tabs.splice(from, 1)[0]);
      }
      source.activeId = appId;
      this._activePaneId = source.id;
    } else {
      this._removeFromLayout(appId);
      const refreshedTarget = this._findPane(this._layoutTree, targetPaneId);
      if (!refreshedTarget) return;
      const insertAt = Math.max(0, refreshedTarget.tabs.indexOf(targetAppId));
      refreshedTarget.tabs.splice(insertAt, 0, appId);
      refreshedTarget.activeId = appId;
      this._activePaneId = refreshedTarget.id;
    }
    this._renderWorkspace();
  }

  _dropOnPane(appId, targetPaneId, zone) {
    if (!this._tabbedApps.has(appId)) return;
    if (zone === "center") {
      this._moveApplicationToPane(appId, targetPaneId);
      return;
    }
    this._splitPaneWithApplication(appId, targetPaneId, zone);
  }

  _moveApplicationToPane(appId, targetPaneId) {
    const source = this._findPaneForApp(appId);
    const target = this._findPane(this._layoutTree, targetPaneId);
    if (!source || !target) return;
    if (source.id === target.id) {
      source.activeId = appId;
      this._activePaneId = source.id;
      this._renderWorkspace();
      return;
    }

    this._removeFromLayout(appId);
    const destination = this._findPane(this._layoutTree, targetPaneId);
    if (!destination) return;
    destination.tabs.push(appId);
    destination.activeId = appId;
    this._activePaneId = destination.id;
    this._renderWorkspace();
  }

  _splitPaneWithApplication(appId, targetPaneId, edge) {
    const source = this._findPaneForApp(appId);
    const target = this._findPane(this._layoutTree, targetPaneId);
    if (!source || !target) return;

    this._removeFromLayout(appId, source.id === target.id ? target.id : null);
    const targetPane = this._findPane(this._layoutTree, targetPaneId);
    if (!targetPane) return;

    const newPane = this._createPane();
    newPane.tabs.push(appId);
    newPane.activeId = appId;

    const horizontal = edge === "left" || edge === "right";
    const newFirst = edge === "left" || edge === "top";
    const splitNode = {
      type: "split",
      id: "tabbed-split-" + (++this._splitSequence),
      direction: horizontal ? "horizontal" : "vertical",
      ratio: 0.5,
      first: newFirst ? newPane : targetPane,
      second: newFirst ? targetPane : newPane
    };

    this._layoutTree = this._replacePane(this._layoutTree, targetPaneId, splitNode);
    this._activePaneId = newPane.id;
    this._renderWorkspace();
  }

  activate(appId, paneId) {
    const pane = this._findPane(this._layoutTree, paneId) || this._findPaneForApp(appId);
    if (!pane || !pane.tabs.includes(appId)) return;
    pane.activeId = appId;
    this._activePaneId = pane.id;
    for (const app of this._tabbedApps.values()) this._decorateChild(app);
    this._renderWorkspace();
  }

  _onChildClosed(id) {
    this.release(id);
  }

  _clearChildPresentation(app) {
    const element = app?.element;
    if (!element) return;
    element.classList.remove("tabbed-foundry-child", "tabbed-foundry-child-active");
    element.hidden = false;
    element.removeAttribute("aria-hidden");
    for (const property of ["position", "left", "top", "width", "height", "z-index"]) {
      element.style.removeProperty(property);
    }
  }

  prepareForNativeDetach(app) {
    if (!this._tabbedApps.has(app.id)) return;
    this._detachingApps.add(app.id);
    this._clearChildPresentation(app);
    const originalPosition = this._originalPositions.get(app.id);
    if (originalPosition && app.rendered) app.setPosition(originalPosition);
  }

  _closeWhenEmpty() {
    const view = this.element?.ownerDocument?.defaultView;
    const schedule = view?.setTimeout?.bind(view) ?? setTimeout;
    const check = async (attempt = 0) => {
      if (!this.rendered || this._tabbedApps.size > 0) return;
      const remainingChildren = [...(this.children?.values?.() ?? [])]
        .some(child => child?.rendered && child.parent === this);
      if (remainingChildren) {
        if (attempt < 4) schedule(() => check(attempt + 1), 50);
        return;
      }
      try {
        await this.close();
      } catch (error) {
        console.error("[" + MODULE_ID + "] Não foi possível fechar a janela Tabbed vazia.", error);
      }
    };
    schedule(() => check(0), 0);
  }

  release(id, { restorePosition = true, closeWhenEmpty = true } = {}) {
    const app = this._tabbedApps.get(id);
    if (!app) return;

    const listeners = this._childListeners.get(id);
    if (listeners) {
      listeners.app.removeEventListener("render", listeners.onRender);
      listeners.app.removeEventListener("position", listeners.onPosition);
      listeners.app.removeEventListener("close", listeners.onClose);
      this._childListeners.delete(id);
    }

    const observed = this._observedChildren.get(id);
    if (observed && this._childResizeObserver) this._childResizeObserver.unobserve(observed);
    this._observedChildren.delete(id);

    this._detachingApps.delete(id);
    this._clearChildPresentation(app);

    const originalPosition = this._originalPositions.get(id);
    this._originalPositions.delete(id);
    this._tabbedApps.delete(id);
    this._removeFromLayout(id);

    if (restorePosition && originalPosition && app.rendered) app.setPosition(originalPosition);
    this._renderWorkspace();
    this._scheduleLayout();
    if (closeWhenEmpty) this._closeWhenEmpty();
  }

  _applyOptionalIntegrations(app) {
    if (!game.modules.get("monks-enhanced-journal")?.active) return;
    if (app.id !== "MonksEnhancedJournal" && app.constructor?.name !== "EnhancedJournal") return;

    const root = app.element;
    if (!root) return;

    // Monk's Enhanced Journal registers its own close-page handler on
    // .journal-tab .close. The event then bubbles to .journal-tab, whose
    // click handler activates the page being removed. Stop only that bubbling
    // after Monk's own button handler has run; do not cancel the click itself.
    for (const button of root.querySelectorAll(".journal-tab .close")) {
      if (this._patchedMejCloseButtons.has(button)) continue;
      button.addEventListener("click", (event) => event.stopPropagation());
      this._patchedMejCloseButtons.add(button);
    }
  }

  _renderTabContextMenu(event, app) {
    this._showTabContextMenu(event, app);
  }

  _showTabContextMenu(event, app) {
    this._closeTabContextMenu();
    const doc = this.element?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view || !this._tabbedApps.has(app.id)) return;

    const menu = doc.createElement("div");
    menu.className = "tabbed-foundry-context-menu";
    menu.setAttribute("role", "menu");

    const makeItem = (label, icon, detail, action) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "tabbed-foundry-context-menu-item";
      button.setAttribute("role", "menuitem");
      const iconNode = doc.createElement("i");
      iconNode.className = icon;
      iconNode.setAttribute("aria-hidden", "true");
      const textNode = doc.createElement("span");
      textNode.className = "tabbed-foundry-context-menu-text";
      const title = doc.createElement("strong");
      title.textContent = label;
      const hint = doc.createElement("small");
      hint.textContent = detail;
      textNode.append(title, hint);
      button.append(iconNode, textNode);
      button.addEventListener("click", async () => {
        this._closeTabContextMenu();
        try {
          await action();
        } catch (error) {
          console.error("[" + MODULE_ID + "] Ação de aba falhou.", error);
          ui.notifications?.error("Não foi possível mover esta aplicação.");
        }
      });
      return button;
    };

    menu.append(
      makeItem("Voltar para o Foundry", "fas fa-arrow-up-right-from-square",
        "Reanexar à janela principal", () => this._returnApplicationToWorkspace(app)),
      makeItem("Destacar em janela própria", "fas fa-window-restore",
        "Abrir em uma janela externa nativa", () => this._detachApplicationToNativeWindow(app))
    );

    doc.body.append(menu);
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(margin, Math.min(event.clientX, view.innerWidth - rect.width - margin)) + "px";
    menu.style.top = Math.max(margin, Math.min(event.clientY, view.innerHeight - rect.height - margin)) + "px";

    const onPointerDown = (pointerEvent) => {
      if (!menu.contains(pointerEvent.target)) this._closeTabContextMenu();
    };
    const onKeyDown = (keyEvent) => {
      if (keyEvent.key === "Escape") this._closeTabContextMenu();
    };
    const onBlur = () => this._closeTabContextMenu();
    view.addEventListener("pointerdown", onPointerDown, true);
    view.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("blur", onBlur);

    this._contextMenuCleanup = () => {
      view.removeEventListener("pointerdown", onPointerDown, true);
      view.removeEventListener("keydown", onKeyDown, true);
      view.removeEventListener("blur", onBlur);
      menu.remove();
      this._contextMenuCleanup = null;
    };
  }

  _closeTabContextMenu() {
    this._contextMenuCleanup?.();
  }

  async _returnApplicationToWorkspace(app) {
    if (!this._tabbedApps.has(app.id)) return app;
    if (app.parent !== this) {
      throw new Error("A aplicação não está mais vinculada à janela Tabbed Foundry.");
    }

    const tabbedHost = this;
    const originalPosition = this._originalPositions.get(app.id);
    let mainSidebar = null;
    let hostAttachedToMain = false;
    let appMovedToMain = false;

    try {
      // Clear the tab-specific geometry before moving the host. The host
      // itself must first reattach so ui.sidebar resolves in the primary
      // Foundry window, not in the detached Tabbed window.
      this._clearChildPresentation(app);
      if (originalPosition && app.rendered) app.setPosition(originalPosition);

      await this.attachWindow();
      hostAttachedToMain = !this.window?.windowId;

      mainSidebar = ui.sidebar;
      if (!(mainSidebar instanceof ApplicationV2)) {
        throw new Error("A Sidebar do workspace principal não está disponível como ApplicationV2.");
      }
      if (!this.element?.ownerDocument || mainSidebar.element?.ownerDocument !== this.element.ownerDocument) {
        throw new Error("A Sidebar encontrada não pertence ao documento principal do Foundry.");
      }

      workspaceAnchor = mainSidebar;
      await mainSidebar.renderChild(app);
      if (app.parent !== mainSidebar) {
        throw new Error("O Foundry não confirmou a transferência para a Sidebar principal.");
      }
      appMovedToMain = true;

      // Remove only the selected application. Do not close the host yet:
      // remaining children need the host to be detached back into its own window.
      this.release(app.id, { restorePosition: true, closeWhenEmpty: false });

      if (this._tabbedApps.size > 0) {
        await originalDetachWindow.call(this, {});
        this._setupLayoutObservers();
        this._scheduleLayout();
      } else {
        await this.close();
      }

      mainSidebar.bringToFront();
      app.bringToFront();
      return app;
    } catch (error) {
      console.error("[" + MODULE_ID + "] Falha ao devolver aplicação ao workspace principal.", error);

      if (appMovedToMain || (mainSidebar && app.parent === mainSidebar)) {
        // The application is already in the main Foundry window. Keep that
        // success even if the remaining Tabbed window could not be detached.
        if (this._tabbedApps.has(app.id)) {
          this.release(app.id, { restorePosition: true, closeWhenEmpty: false });
        }
        if (this.rendered && !this.window?.windowId) {
          if (this._tabbedApps.size > 0) {
            try {
              await originalDetachWindow.call(this, {});
              this._setupLayoutObservers();
              this._scheduleLayout();
            } catch (detachError) {
              console.error("[" + MODULE_ID + "] A aplicação voltou ao Foundry, mas a janela Tabbed não conseguiu voltar a destacar.", detachError);
            }
          } else {
            await this.close();
          }
        }
        ui.notifications?.warn("A aplicação voltou ao Foundry, mas a janela Tabbed precisou permanecer aberta.");
        return app;
      }

      // Roll back to the Tabbed host if the transfer did not reach the main
      // Sidebar. The current pane tree and tab identity are preserved.
      try {
        if (app.parent !== this) await this.renderChild(app);
        if (!this._tabbedApps.has(app.id)) {
          this._tabbedApps.set(app.id, app);
          this._insertIntoActivePane(app.id);
        }
        this._decorateChild(app);
        this._renderWorkspace();
      } catch (rollbackError) {
        console.error("[" + MODULE_ID + "] Falha ao restaurar a aplicação no Tabbed Foundry.", rollbackError);
      }

      if (hostAttachedToMain && this.rendered && !this.window?.windowId) {
        try {
          await originalDetachWindow.call(this, {});
          this._setupLayoutObservers();
          this._scheduleLayout();
        } catch (detachError) {
          console.error("[" + MODULE_ID + "] Não foi possível restaurar a janela externa do Tabbed Foundry.", detachError);
        }
      }
      throw error;
    }
  }

  async _detachApplicationToNativeWindow(app) {
    if (!this._tabbedApps.has(app.id)) return;
    await app.detachWindow();
  }
}

function dividerPointerCapture(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch (_error) {
    // Pointer capture is optional; window-level pointer listeners remain active.
  }
}

function isAutoGroupingEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING_AUTO_GROUP) === true;
  } catch (error) {
    console.warn("[" + MODULE_ID + "] Não foi possível ler a configuração; usando detach nativo.", error);
    return false;
  }
}

async function getOrCreateWorkspaceAnchor() {
  // The Foundry Sidebar is a native ApplicationV2 already attached to the
  // primary workspace. Re-parenting to it avoids creating a second hidden
  // Application host which could conflict with Tabbed Foundry interception.
  const sidebar = ui.sidebar;
  if (!(sidebar instanceof ApplicationV2)) {
    throw new Error("ui.sidebar não está disponível como ApplicationV2.");
  }
  if (!sidebar.rendered) await sidebar.render({ force: true });
  workspaceAnchor = sidebar;
  return sidebar;
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
        console.warn("[" + MODULE_ID + "] Não foi possível fechar a janela hospedeira incompleta.", closeError);
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

  const promise = (async () => {
    try {
      const target = await getOrCreateHost();
      await target.adopt(app, options);
      return app;
    } catch (error) {
      console.error("[" + MODULE_ID + "] Falha ao agrupar aplicação; executando detach nativo.", error);
      if (host && app.parent === host) return app;
      if (host && host._tabbedApps?.size === 0) {
        try {
          await host.close();
        } catch (closeError) {
          console.warn("[" + MODULE_ID + "] Não foi possível fechar a janela hospedeira vazia.", closeError);
        }
        host = null;
      }
      return originalDetachWindow.call(app, options);
    }
  })();

  pendingCaptures.set(app, promise);
  try {
    return await promise;
  } finally {
    pendingCaptures.delete(app);
  }
}

function installDetachInterceptor() {
  const prototype = ApplicationV2.prototype;
  if (prototype[PATCH_FLAG]) return;

  originalDetachWindow = prototype.detachWindow;
  if (typeof originalDetachWindow !== "function") {
    console.error("[" + MODULE_ID + "] ApplicationV2.detachWindow não foi encontrado. O módulo não fará interceptação.");
    return;
  }

  prototype.detachWindow = function(options = {}) {
    if (this instanceof TabbedFoundryHost) return originalDetachWindow.call(this, options);

    if (host && this.parent === host) {
      const parentHost = host;
      // The native detach must succeed before removing the app from the pane
      // tree. This keeps the tab intact when Electron cannot create its window.
      parentHost.prepareForNativeDetach(this);
      return Promise.resolve()
        .then(() => originalDetachWindow.call(this, options))
        .then((result) => {
          parentHost.release(this.id, { restorePosition: false });
          return result;
        })
        .catch((error) => {
          parentHost._detachingApps.delete(this.id);
          parentHost._decorateChild(this);
          parentHost._scheduleLayout();
          throw error;
        });
    }

    if (!isAutoGroupingEnabled()) return originalDetachWindow.call(this, options);

    if (workspaceAnchor && this.parent === workspaceAnchor) {
      return captureApplication(this, options);
    }

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
    await getOrCreateWorkspaceAnchor();
  } catch (error) {
    console.error("[" + MODULE_ID + "] Não foi possível preparar o ponto de retorno ao workspace principal.", error);
  }

  game.modules.get(MODULE_ID).api = {
    get host() { return host; },
    get workspaceAnchor() { return workspaceAnchor; },
    get enabled() { return isAutoGroupingEnabled(); },
    async closeHost() {
      if (host) await host.close();
    }
  };
  console.info("[" + MODULE_ID + "] Carregado. Agrupamento automático: " + (isAutoGroupingEnabled() ? "ativado" : "desativado") + ".");
});
