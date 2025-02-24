import "@material/mwc-button";

import { fetchConfig, LovelaceConfig, saveConfig } from "../../data/lovelace";
import "../../layouts/hass-loading-screen";
import "../../layouts/hass-error-screen";
import "./hui-root";
import { HomeAssistant, PanelInfo, Route } from "../../types";
import { Lovelace } from "./types";
import {
  LitElement,
  html,
  PropertyValues,
  TemplateResult,
  PropertyDeclarations,
} from "lit-element";
import { showSaveDialog } from "./editor/show-save-config-dialog";
import { generateLovelaceConfig } from "./common/generate-lovelace-config";

interface LovelacePanelConfig {
  mode: "yaml" | "storage";
}

let editorLoaded = false;

class LovelacePanel extends LitElement {
  public panel?: PanelInfo<LovelacePanelConfig>;
  public hass?: HomeAssistant;
  public narrow?: boolean;
  public route?: Route;
  private _columns?: number;
  private _state?: "loading" | "loaded" | "error" | "yaml-editor";
  private _errorMsg?: string;
  private lovelace?: Lovelace;
  private mqls?: MediaQueryList[];

  static get properties(): PropertyDeclarations {
    return {
      hass: {},
      lovelace: {},
      route: {},
      _columns: {},
      _state: {},
      _errorMsg: {},
      _config: {},
    };
  }

  constructor() {
    super();
    this._state = "loading";
    this._closeEditor = this._closeEditor.bind(this);
  }

  public render(): TemplateResult | void {
    const state = this._state!;

    if (state === "loaded") {
      return html`
        <hui-root
          .hass="${this.hass}"
          .lovelace="${this.lovelace}"
          .route="${this.route}"
          .columns="${this._columns}"
          @config-refresh="${this._forceFetchConfig}"
        ></hui-root>
      `;
    }

    if (state === "error") {
      return html`
        <hass-error-screen title="Lovelace" .error="${this._errorMsg}">
          <mwc-button on-click="_forceFetchConfig">Reload Lovelace</mwc-button>
        </hass-error-screen>
      `;
    }

    if (state === "yaml-editor") {
      return html`
        <hui-editor
          .hass="${this.hass}"
          .lovelace="${this.lovelace}"
          .closeEditor="${this._closeEditor}"
        ></hui-editor>
      `;
    }

    return html`
      <hass-loading-screen rootnav></hass-loading-screen>
    `;
  }

  public updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (changedProps.has("narrow")) {
      this._updateColumns();
      return;
    }

    if (!changedProps.has("hass")) {
      return;
    }

    const oldHass = changedProps.get("hass") as this["hass"];

    if (oldHass && this.hass!.dockedSidebar !== oldHass.dockedSidebar) {
      this._updateColumns();
    }
  }

  public firstUpdated() {
    this._fetchConfig(false);
    this._updateColumns = this._updateColumns.bind(this);
    this.mqls = [300, 600, 900, 1200].map((width) => {
      const mql = matchMedia(`(min-width: ${width}px)`);
      mql.addListener(this._updateColumns);
      return mql;
    });
    this._updateColumns();
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (
      this.lovelace &&
      this.hass &&
      this.lovelace.language !== this.hass.language
    ) {
      // language has been changed, rebuild UI
      this._fetchConfig(false);
    }
  }

  private _closeEditor() {
    this._state = "loaded";
  }

  private _updateColumns() {
    const matchColumns = this.mqls!.reduce(
      (cols, mql) => cols + Number(mql.matches),
      0
    );
    // Do -1 column if the menu is docked and open
    this._columns = Math.max(
      1,
      matchColumns - Number(!this.narrow && this.hass!.dockedSidebar)
    );
  }

  private _forceFetchConfig() {
    this._fetchConfig(true);
  }

  private async _fetchConfig(force) {
    let conf: LovelaceConfig;
    let confMode: Lovelace["mode"] = this.panel!.config.mode;

    try {
      conf = await fetchConfig(this.hass!, force);
    } catch (err) {
      if (err.code !== "config_not_found") {
        // tslint:disable-next-line
        console.log(err);
        this._state = "error";
        this._errorMsg = err.message;
        return;
      }
      conf = generateLovelaceConfig(this.hass!, this.hass!.localize);
      confMode = "generated";
    }

    this._state = "loaded";
    this.lovelace = {
      config: conf,
      editMode: this.lovelace ? this.lovelace.editMode : false,
      mode: confMode,
      language: this.hass!.language,
      enableFullEditMode: () => {
        if (!editorLoaded) {
          editorLoaded = true;
          import(/* webpackChunkName: "lovelace-yaml-editor" */ "./hui-editor");
        }
        this._state = "yaml-editor";
      },
      setEditMode: (editMode: boolean) => {
        if (!editMode || this.lovelace!.mode !== "generated") {
          this._updateLovelace({ editMode });
          return;
        }
        showSaveDialog(this, {
          lovelace: this.lovelace!,
        });
      },
      saveConfig: async (newConfig: LovelaceConfig): Promise<void> => {
        const { config, mode } = this.lovelace!;
        try {
          // Optimistic update
          this._updateLovelace({
            config: newConfig,
            mode: "storage",
          });
          await saveConfig(this.hass!, newConfig);
        } catch (err) {
          // tslint:disable-next-line
          console.error(err);
          // Rollback the optimistic update
          this._updateLovelace({
            config,
            mode,
          });
          throw err;
        }
      },
    };
  }

  private _updateLovelace(props: Partial<Lovelace>) {
    this.lovelace = {
      ...this.lovelace!,
      ...props,
    };
  }
}

customElements.define("ha-panel-lovelace", LovelacePanel);
