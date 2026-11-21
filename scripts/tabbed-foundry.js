const MODULE_ID = "tabbed-foundry";

/**
 * Temporary safety fallback.
 *
 * The previous prototype interceptor for ApplicationV2.detachWindow caused
 * native Foundry window detaching to stop working reliably. Until tab
 * adoption is reimplemented using the supported ApplicationV2 parent/child
 * lifecycle, this module deliberately does not override detachWindow or
 * move application elements between DOM trees.
 */
Hooks.once("ready", () => {
  console.warn(
    `[${MODULE_ID}] O agrupamento em abas está temporariamente desativado para preservar o detach nativo do Foundry.`
  );
});
