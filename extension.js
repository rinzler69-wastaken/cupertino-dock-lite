/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as AppFavorites from "resource:///org/gnome/shell/ui/appFavorites.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { Animator } from "./animator.js";

export default class DashAnimatorExtension extends Extension {
  enable() {
    this._disabled = false;
    this._settings = this.getSettings();
    this._applySettings();
    this._settings.connectObject("changed", () => this._applySettings(), this);

    this.animator = new Animator();
    this.animator.extension = this;

    if (!this._findDashContainer()) {
      this._findDashIntervalId = setInterval(() => {
        if (this._findDashContainer()) {
          clearInterval(this._findDashIntervalId);
          this._findDashIntervalId = null;
        }
      }, 500);
    }

    global.display.connectObject(
      "in-fullscreen-changed",
      () => this._onFullScreen(),
      this,
    );

    this.animator.enable();
    this._connectThemeSettings();
  }

  disable() {
    this._disabled = true;
    this._disconnectThemeSettings();
    if (this.animator) this.animator.disable();

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    if (this._oneShotId) {
      clearTimeout(this._oneShotId);
      this._oneShotId = null;
    }

    this._pendingHide = null;

    this._disconnectIconEvents();

    global.display.disconnectObject(this);

    if (this.dashContainer) {
      if (this.dashContainer.__animateIn)
        this.dashContainer._animateIn = this.dashContainer.__animateIn;
      if (this.dashContainer.__animateOut)
        this.dashContainer._animateOut = this.dashContainer.__animateOut;
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
      this._disconnectDashContainerEvents();
    }

    if (this.dash) {
      this._unpatchTrashUnpinDrop();
      this._disconnectDashEvents();
      this.dash = null;
    }

    this.dashContainer = null;
    this.animator = null;

    if (this._settings) {
      this._settings.disconnectObject(this);
      this._settings = null;
    }
  }

  _disconnectIconEvents() {
    this._findIcons().forEach((c) => {
      const appIcon = c._appwell?.child?._delegate;
      if (appIcon) {
        appIcon.disconnectObject(this);
        appIcon._dashAnimatorUrgentHooked = false;
      }
    });
    if (this.dash?.showAppsButton) {
      this.dash.showAppsButton.disconnectObject(this);
      this.dash.showAppsButton._dashAnimatorHooked = false;
    }
  }

  _disconnectDashEvents() {
    if (this.dash) {
      this.dash.disconnectObject(this);
      if (this.dash._box) {
        this.dash._box.disconnectObject(this);
      }
    }
  }

  _disconnectDashContainerEvents() {
    if (this.dashContainer) {
      this.dashContainer.disconnectObject(this);
    }
  }

  _applySettings() {
    this.urgent_bounce = this._settings.get_boolean("urgent-bounce");
  }

  _findChildByName(actor, name, maxDepth = 4, currentDepth = 0) {
    if (!actor) return null;
    if (actor.name === name) return actor;
    if (currentDepth >= maxDepth) return null;

    const children = actor.get_children();
    for (let i = 0; i < children.length; i++) {
      const found = this._findChildByName(
        children[i],
        name,
        maxDepth,
        currentDepth + 1,
      );
      if (found) return found;
    }
    return null;
  }

  _findDashContainer() {
    if (this.dashContainer) {
      return false;
    }

    this.dashContainer = this._findChildByName(
      Main.uiGroup,
      "dashtodockContainer",
    );
    if (!this.dashContainer) {
      return false;
    }

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    this.scale = 1;
    this.dashContainer.delegate = this;
    this.animator.dashContainer = this.dashContainer;

    this._disconnectDashEvents();
    this._disconnectIconEvents();
    this.dash = this._findChildByName(this.dashContainer, "dash");
    this._patchTrashUnpinDrop();
    this._iconsDirty = true;

    this.dash._box.connectObject(
      "child-added",
      () => {
        this._iconsDirty = true;
        this._startAnimation();
      },
      "child-removed",
      () => {
        this._iconsDirty = true;
        this._startAnimation();
      },
      this,
    );
    this.dash.connectObject(
      "icon-size-changed",
      () => {
        this._iconsDirty = true;
        this._startAnimation();
      },
      this,
    );

    this.dashContainer.set_reactive(true);
    this.dashContainer.set_track_hover(true);

    this.dashContainer.connectObject(
      "destroy",
      () => {
        this._iconsDirty = true;
        // The dash/app icons are already destroyed here by Dash to Dock, so
        // their connections are gone; skip disconnect to avoid signal errors.
        this.dash = null;
        if (!this.animator) return;
        this.animator.disable();
        this.animator.dashContainer = null;
        this.dashContainer = null;

        // Do not recreate animation actors while the extension is disabling.
        if (this._disabled) return;

        this.animator.enable();
        if (!this._findDashIntervalId) {
          this._findDashIntervalId = setInterval(
            this._findDashContainer.bind(this),
            500,
          );
        }
      },
      this,
    );

    // hooks
    this.dashContainer.__animateIn = this.dashContainer._animateIn;
    this.dashContainer.__animateOut = this.dashContainer._animateOut;

    this.dashContainer._animateIn = (time, delay) => {
      // Cancel any pending deferred hide — user showed the dock again
      this._pendingHide = null;
      this._isHidden = false;
      // Resume urgent bounce if the matter is still unattended
      if (this.animator) this.animator.resumeUrgentBounce();
      this._startAnimation();
      this.dashContainer.__animateIn(time, delay);
    };
    this.dashContainer._animateOut = (time, delay) => {
      // If any bounce is in progress (click or urgent), defer the hide:
      // store args, keep dock visible, let the current arc finish landing.
      // The animator will call _firePendingHide() once all jumps settle.
      // The 3-cycle first-run gate for urgent is enforced inside the animator loop.
      const anyJumping = this.animator?.isJumping();
      const anyFirstRunPending = this._iconsContainer_firstRunPending();
      if (anyJumping || anyFirstRunPending) {
        this._pendingHide = { time, delay };
        this.dashContainer.__animateIn(0.2, 0);
        return;
      }
      this._isHidden = true;
      this._pendingHide = null;
      this.dashContainer.__animateOut(time, delay);
    };

    this._startAnimation();
    return true;
  }

  _findIcons() {
    if (!this.dash || !this.dashContainer) return [];

    if (!this._iconsDirty && this.dashContainer._icons) {
      return this.dashContainer._icons;
    }
    this._iconsDirty = false;

    const dashChildren = this.dash._box.get_children();

    // hook on showApps
    if (
      this.dash.showAppsButton &&
      !this.dash.showAppsButton._dashAnimatorHooked
    ) {
      this.dash.showAppsButton._dashAnimatorHooked = true;
      this.dash.showAppsButton.connectObject(
        "notify::checked",
        () => {
          if (!Main.overview.visible) {
            this._findChildByName(
              Main.uiGroup,
              "overview",
            )?._controls?._toggleAppsPage();
          }
        },
        this,
      );
    }

    const icons = dashChildren.filter((actor) => {
      if (actor.child && actor.child._delegate && actor.child._delegate.icon) {
        return true;
      }
      return false;
    });

    icons.forEach((c) => {
      const appwell = c.first_child;
      if (c._appwell === appwell) return; // Already processed

      const widget = appwell.first_child;
      const icongrid = widget.first_child;
      const boxlayout = icongrid.first_child;
      const bin = boxlayout.first_child;
      if (!bin) return;
      const icon = bin.first_child;

      c._bin = bin;
      c._label = c.label;
      c._draggable = appwell._draggable;
      c._appwell = appwell;
      if (icon) {
        c._icon = icon;
      }

      // Hook notify::urgent on inner AppIcon so bounce + dock show fires immediately
      const appIcon = appwell.child && appwell.child._delegate;
      if (appIcon && !appIcon._dashAnimatorUrgentHooked) {
        appIcon._dashAnimatorUrgentHooked = true;
        appIcon.connectObject(
          "notify::urgent",
          () => {
            if (this.urgent_bounce && appIcon.urgent) {
              if (this.animator)
                this.animator.requestUrgentBounce(appwell, true);
              if (this.dashContainer && this.dashContainer._animateIn)
                this.dashContainer._animateIn(0.2, 0);
            } else {
              if (this.animator) this.animator.clearUrgentBounce(appwell);
            }
          },
          this,
        );
      }
    });

    const apps = Main.overview.dash?.last_child?.last_child;
    if (apps) {
      const widget = apps.child;
      // account for JustPerfection & dash-to-dock hiding the app button
      if (widget && widget.width > 0 && widget.get_parent()?.visible) {
        const icongrid = widget.first_child;
        const boxlayout = icongrid.first_child;
        const bin = boxlayout.first_child;
        const icon = bin.first_child;
        const c = {
          child: widget,
          _bin: bin,
          _icon: icon,
          _label: widget._delegate?.label,
          _appwell: widget, // ShowApps button acts as its own appwell here
        };
        icons.push(c);
      }
    }

    this.dashContainer._icons = icons;
    return icons;
  }

  _patchTrashUnpinDrop() {
    if (!this.dash || this.dash._cupertinoTrashUnpinPatched) return;

    const originalHandleDragOver = this.dash.handleDragOver?.bind(this.dash);
    const originalAcceptDrop = this.dash.acceptDrop?.bind(this.dash);

    this.dash._cupertinoTrashUnpinPatched = {
      handleDragOver: this.dash.handleDragOver,
      acceptDrop: this.dash.acceptDrop,
    };

    this.dash.handleDragOver = (source, actor, x, y, time) => {
      // 1. Check if we are over the trash first
      if (this._isPointerOverTrash()) {
        // 2. If it's a favorite, allow the drop (to trigger unpinning)
        if (this._canUnpinDraggedFavoriteOnTrash(source)) {
          return DND.DragMotionResult.MOVE_DROP;
        }
        // 3. If it's NOT a favorite, explicitly return NO_DROP
        //    to prevent the dock from trying to pin it.
        return DND.DragMotionResult.NO_DROP;
      }

      return (
        originalHandleDragOver?.(source, actor, x, y, time) ??
        DND.DragMotionResult.CONTINUE
      );
    };

    this.dash.acceptDrop = (source, actor, x, y, time) => {
      // 1. If over trash and it's a favorite, remove it
      if (
        this._isPointerOverTrash() &&
        this._canUnpinDraggedFavoriteOnTrash(source)
      ) {
        const app = this._getDraggedApp(source);
        AppFavorites.getAppFavorites().removeFavorite(app.get_id());
        return true;
      }

      // 2. If over trash but NOT a favorite, return false to block the drop
      if (this._isPointerOverTrash()) {
        return false;
      }

      return originalAcceptDrop?.(source, actor, x, y, time) ?? false;
    };
  }

  _unpatchTrashUnpinDrop() {
    if (!this.dash?._cupertinoTrashUnpinPatched) return;

    const patch = this.dash._cupertinoTrashUnpinPatched;
    this.dash.handleDragOver = patch.handleDragOver;
    this.dash.acceptDrop = patch.acceptDrop;
    this.dash._cupertinoTrashUnpinPatched = null;
  }

  _canUnpinDraggedFavoriteOnTrash(source) {
    const app = this._getDraggedApp(source);
    if (!app?.get_id || app.isTrash) return false;

    const appId = app.get_id();
    return (
      global.settings.is_writable("favorite-apps") &&
      AppFavorites.getAppFavorites().isFavorite(appId)
    );
  }

  _getDraggedApp(source) {
    return (
      source?.app ??
      source?._delegate?.app ??
      source?.child?._delegate?.app ??
      null
    );
  }

  _isPointerOverTrash() {
    const trashActor = this._getTrashActor();
    if (!trashActor) return false;

    const [pointerX, pointerY] = global.get_pointer();
    const [trashX, trashY] = trashActor.get_transformed_position();
    const [trashWidth, trashHeight] = trashActor.get_transformed_size();

    return (
      pointerX >= trashX &&
      pointerX <= trashX + trashWidth &&
      pointerY >= trashY &&
      pointerY <= trashY + trashHeight
    );
  }

  _getTrashActor() {
    const children = this.dash?._box ? this.dash._box.get_children() : [];
    return (
      children.find((actor) => actor.child?._delegate?.app?.isTrash) ?? null
    );
  }

  _beginAnimation() {
    if (this.animator) this.animator._beginAnimation();
  }

  _endAnimation() {
    if (this.animator) this.animator._endAnimation();
  }

  _onFullScreen() {
    // Force-hide dock in fullscreen — macOS dock never shows in fullscreen
    const isFullscreen = global.display.get_monitor_in_fullscreen(
      global.display.get_current_monitor(),
    );
    if (isFullscreen) {
      if (this.dashContainer && this.dashContainer._animateOut)
        this.dashContainer._animateOut(0.1, 0);
    } else {
      // Exiting fullscreen (e.g. workspace switch) — slide in smoothly
      if (this.dashContainer && this.dashContainer._animateIn)
        this.dashContainer._animateIn(0.3, 0.1);
    }
  }

  _startAnimation() {
    if (this.animator) this.animator._startAnimation();
  }

  // Returns true if any urgent icon still has first-run bounce cycles remaining.
  // Used by _animateOut to decide whether to defer the hide.
  _iconsContainer_firstRunPending() {
    if (!this.animator?._iconsContainer) return false;
    return this.animator._iconsContainer
      .get_children()
      .filter((c) => c.name !== "cupertinisator-badge")
      .some((c) => (c._appwell?._dashAnimatorUrgentFirstRunRemaining ?? 0) > 0);
  }

  // Called by the animator when the last first-run cycle completes,
  // fires the deferred hide that was waiting for it.
  _firePendingHide() {
    if (!this._pendingHide) return;
    const { time, delay } = this._pendingHide;
    this._pendingHide = null;
    this._isHidden = true;
    if (this.dashContainer?.__animateOut)
      this.dashContainer.__animateOut(time, delay);
  }
  // ── Theme injection ──────────────────────────────────────────────────────

  _applyThemeOverride() {
    if (this._themeApplyTimeoutId) {
      GLib.source_remove(this._themeApplyTimeoutId);
      this._themeApplyTimeoutId = null;
    }
    if (this._themeInTimeoutId) {
      GLib.source_remove(this._themeInTimeoutId);
      this._themeInTimeoutId = null;
    }

    if (!this._settings.get_boolean("override-theming")) {
      this._removeThemeOverride();
      if (this.animator) this.animator.reloadIcons();
      return;
    }

    const theme = this._settings.get_string("dock-theme");
    const aware = this._settings.get_boolean("theme-aware");
    let scheme;

    if (aware) {
      scheme =
        this._desktopSettings.get_string("color-scheme") === "prefer-dark"
          ? "dark"
          : "light";
    } else {
      scheme = this._settings.get_string("dock-color-scheme");
    }

    const fileName = `${theme}-${scheme}.css`;
    const cssFile = Gio.File.new_for_path(`${this.path}/themes/${fileName}`);

    cssFile.query_info_async(
      Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
      (file, res) => {
        try {
          file.query_info_finish(res);
        } catch (e) {
          return;
        }

        const applyThemeNow = () => {
          this._removeThemeOverride();

          if (!this.animator) return;

          const themeContext = St.ThemeContext.get_for_stage(global.stage);
          const stTheme = themeContext.get_theme();
          stTheme.load_stylesheet(cssFile);
          this._loadedThemeFile = cssFile;

          themeContext.emit("changed");
          if (this.animator) this.animator.reloadIcons();

          // Slide back in after theme is applied — use wrapper so _pendingHide
          // is cleared and urgent bounce resumes if still active.
          this._themeInTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            50,
            () => {
              this._themeInTimeoutId = null;
              if (this.dashContainer && this.dashContainer._animateIn)
                this.dashContainer._animateIn(0.2, 0);
              return GLib.SOURCE_REMOVE;
            },
          );
        };

        // Slide out first, apply theme after animation completes, then slide back in
        if (this.dashContainer && this.dashContainer.__animateOut) {
          this.dashContainer.__animateOut(0.2, 0);
          this._themeApplyTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            250,
            () => {
              this._themeApplyTimeoutId = null;
              applyThemeNow();
              return GLib.SOURCE_REMOVE;
            },
          );
        } else {
          applyThemeNow();
        }
      },
    );
  }

  _removeThemeOverride() {
    if (this._loadedThemeFile) {
      try {
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().unload_stylesheet(this._loadedThemeFile);
      } catch (e) {}
      this._loadedThemeFile = null;
    }
  }

  _connectThemeSettings() {
    const s = this._settings;

    // Re-apply whenever any relevant setting changes
    s.connectObject(
      "changed::override-theming",
      () => this._applyThemeOverride(),
      "changed::dock-theme",
      () => this._applyThemeOverride(),
      "changed::theme-aware",
      () => this._applyThemeOverride(),
      "changed::dock-color-scheme",
      () => this._applyThemeOverride(),
      this,
    );

    // Follow system color-scheme changes
    this._desktopSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });
    this._desktopSettings.connectObject(
      "changed::color-scheme",
      () => this._applyThemeOverride(),
      this,
    );

    this._applyThemeOverride();
  }

  _disconnectThemeSettings() {
    if (this._themeApplyTimeoutId) {
      GLib.source_remove(this._themeApplyTimeoutId);
      this._themeApplyTimeoutId = null;
    }
    if (this._themeInTimeoutId) {
      GLib.source_remove(this._themeInTimeoutId);
      this._themeInTimeoutId = null;
    }
    this._settings.disconnectObject(this);
    if (this._desktopSettings) {
      this._desktopSettings.disconnectObject(this);
      this._desktopSettings = null;
    }
    this._removeThemeOverride();
  }
}
