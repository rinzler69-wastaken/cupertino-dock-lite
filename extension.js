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

/* exported init */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Animator } from './animator.js';
import { setInterval, clearInterval } from './utils.js';

export default class DashAnimatorExtension extends Extension {
  enable() {
    this._isInitializing = true;
    this._settings = this.getSettings('org.gnome.shell.extensions.cupertino-dock-lite');
    this._applySettings();
    this._settingsChangedId = this._settings.connect('changed', () => this._applySettings());

    this._extensionManager = Main.extensionManager;
    this._d2dId = 'dash-to-dock@micxgx.gmail.com';

    this._extensionStateChangedId = this._extensionManager.connect('extension-state-changed', (em, ext) => {
      if (this._isCycling) return; // Lock: Ignore external signals during a manual toggle cycle
      if (ext.uuid === this._d2dId) {
        this._checkDashToDock();
      }
    });

    this._checkDashToDock();
    this._connectScreenSaver();

    // Settle initialization state after 800ms
    this._initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
      this._initTimeoutId = null;
      this._isInitializing = false;
      log("[cupertinisator] Extension initialization complete. Hardware Cycle enabled.");
      return GLib.SOURCE_REMOVE;
    });
  }

  _connectScreenSaver() {
    this._screenSaverProxy = new Gio.DBusProxy.makeProxyWrapper(
      '<node><interface name="org.gnome.ScreenSaver">' +
      '<signal name="ActiveChanged"><arg type="b"/></signal>' +
      '</interface></node>'
    )(Gio.DBus.session, 'org.gnome.ScreenSaver', '/org/gnome/ScreenSaver');

    this._screenSaverSignalId = this._screenSaverProxy.connectSignal(
      'ActiveChanged',
      (proxy, sender, [active]) => {
        if (active) {
          // Screen locked / suspended — disable cupertinisator, leave D2D alone
          this._doDisable();
        } else {
          // Unlocked — wait for shell to settle before re-enabling
          this._unlockTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._unlockTimeoutId = null;
            this._checkDashToDock();
            return GLib.SOURCE_REMOVE;
          });
        }
      }
    );
  }

  _disconnectScreenSaver() {
    if (this._screenSaverProxy && this._screenSaverSignalId) {
      this._screenSaverProxy.disconnectSignal(this._screenSaverSignalId);
      this._screenSaverSignalId = null;
    }
    this._screenSaverProxy = null;
  }

  _checkDashToDock() {
    let d2d = this._extensionManager.lookup(this._d2dId);
    let isD2DEnabled = d2d && d2d.state === 1; // 1 is ENABLED

    if (isD2DEnabled && !this.running) {
      this._doEnable();
    } else if (!isD2DEnabled && this.running) {
      this._doDisable();
    }
  }

  _doEnable() {
    if (this.running) return;
    this.running = true;

    this.animator = new Animator();
    this.animator.extension = this;

    this.services = {
      updateIcon: (icon) => {
        if (icon && icon.icon_name && icon.icon_name.startsWith('user-trash')) {
          if (icon._source && icon._source.first_child && icon.icon_name != icon._source.first_child.icon_name) {
            icon.icon_name = icon._source.first_child.icon_name;
          }
        }
      },
    };

    if (!this._findDashContainer()) {
      this._findDashIntervalId = setInterval(() => {
        if (this._findDashContainer()) {
          clearInterval(this._findDashIntervalId);
          this._findDashIntervalId = null;
        }
      }, 500);
    }

    this._displayEvents = [];
    this._displayEvents.push(global.display.connect('notify::focus-window', this._onFocusWindow.bind(this)));
    this._displayEvents.push(global.display.connect('in-fullscreen-changed', this._onFullScreen.bind(this)));


    this.animator.enable();
    this._connectThemeSettings();
  }

  _doDisable() {
    if (!this.running) return;
    this.running = false;

    this._disconnectThemeSettings();
    if (this.animator) this.animator.disable();

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    if (this._intervals) {
      this._intervals.forEach(id => clearInterval(id));
      this._intervals = [];
    }
    if (this._oneShotId) {
      clearInterval(this._oneShotId);
      this._oneShotId = null;
    }
    if (this._jumpHideTimer) {
      clearInterval(this._jumpHideTimer);
      this._jumpHideTimer = null;
    }

    if (this._windowEvents) {
      this._windowEvents.forEach(id => global.window_manager.disconnect(id));
      this._windowEvents = [];
    }

    if (this._displayEvents) {
      this._displayEvents.forEach(id => global.display.disconnect(id));
      this._displayEvents = [];
    }

    if (this.dashContainer) {
      this.dashContainer._animateIn = this.dashContainer.__animateIn;
      this.dashContainer._animateOut = this.dashContainer.__animateOut;
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
      this.dashContainerEvents.forEach(id => {
        if (this.dashContainer) this.dashContainer.disconnect(id);
      });
      this.dashContainerEvents = [];
      this.dashContainer = null;
    }

    if (this.dash) {
      this._unpatchTrashUnpinDrop();
      this.dashEvents.forEach(id => {
        if (this.dash) this.dash.disconnect(id);
      });
      this.dashEvents = [];
      this.dash = null;
    }

    if (this._layoutManagerEvents) {
      this._layoutManagerEvents.forEach(id => Main.layoutManager.disconnect(id));
    }
    this._layoutManagerEvents = [];

    this.animator = null;
  }

  disable() {
    if (this._initTimeoutId) {
      GLib.source_remove(this._initTimeoutId);
      this._initTimeoutId = null;
    }
    if (this._unlockTimeoutId) {
      GLib.source_remove(this._unlockTimeoutId);
      this._unlockTimeoutId = null;
    }
    if (this._extensionStateChangedId) {
      this._extensionManager.disconnect(this._extensionStateChangedId);
      this._extensionStateChangedId = null;
    }

    this._disconnectScreenSaver();
    this._doDisable();

    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    this._settings = null;
  }

  _applySettings() {
    this.jump_height = this._settings.get_double('jump-height');
    this.jump_speed = this._settings.get_double('jump-speed');
    this.urgent_bounce = this._settings.get_boolean('urgent-bounce');
  }

  _findChildByName(actor, name) {
    if (!actor) return null;
    if (actor.name === name) return actor;

    let children = actor.get_children();
    for (let i = 0; i < children.length; i++) {
      let found = this._findChildByName(children[i], name);
      if (found) return found;
    }
    return null;
  }

  _findDashContainer() {


    if (this.dashContainer) {
      return false;
    }

    this.dashContainer = this._findChildByName(Main.uiGroup, 'dashtodockContainer');
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



    this.dash = this._findChildByName(this.dashContainer, 'dash');
    this._patchTrashUnpinDrop();
    this.dashEvents = [];
    this.dashEvents.push(
      this.dash.connect('icon-size-changed', this._startAnimation.bind(this))
    );

    this.dashContainer.set_reactive(true);
    this.dashContainer.set_track_hover(true);

    this.dashContainerEvents = [];
    this.dashContainerEvents.push(
      this.dashContainer.connect('destroy', () => {
        this.animator.disable();
        this.animator.enable();
        this.dashContainer = null;
        this._findDashIntervalId = setInterval(
          this._findDashContainer.bind(this),
          500
        );
      })
    );

    // hooks
    this.dashContainer.__animateIn = this.dashContainer._animateIn;
    this.dashContainer.__animateOut = this.dashContainer._animateOut;

    this.dashContainer._animateIn = (time, delay) => {
      if (this._jumpHideTimer) {
        clearInterval(this._jumpHideTimer);
        this._jumpHideTimer = null;
      }
      this._isHidden = false;
      this._pendingHideForUrgentBounce = false;
      if (this.animator) this.animator.resumeUrgentBounce();
      this._startAnimation();
      this.dashContainer.__animateIn(time, delay);
    };
this.dashContainer._animateOut = (time, delay) => {
  if (this.animator && this.animator.isJumping()) {
    this._pendingHideForUrgentBounce = true;
    this.dashContainer.__animateIn(0.2, 0);
    if (this._jumpHideTimer) clearInterval(this._jumpHideTimer);
    this._jumpHideTimer = setInterval(() => {
      if (!this.animator.isJumping()) {
        clearInterval(this._jumpHideTimer);
        this._jumpHideTimer = null;
        if (!this._isHidden) {
          this._isHidden = true;
          this._pendingHideForUrgentBounce = false;
          if (this.animator) this.animator.pauseUrgentBounce();
          this.dashContainer.__animateOut(time, delay);
        }
      }
    }, 100);
    return;
  }
  this._isHidden = true;
  this._pendingHideForUrgentBounce = false;
  if (this.animator) this.animator.pauseUrgentBounce();
  this.dashContainer.__animateOut(time, delay);
};

    this.animator._animate();
    return true;
  }

  _findIcons() {
    if (!this.dash || !this.dashContainer) return [];

    let dashChildren = this.dash._box.get_children();

    // hook on showApps
    if (this.dash.showAppsButton && !this.dash.showAppsButton._checkEventId) {
      this.dash.showAppsButton._checkEventId = this.dash.showAppsButton.connect(
        'notify::checked',
        () => {
          if (!Main.overview.visible) {
            this._findChildByName(Main.uiGroup, 'overview')
              ._controls._toggleAppsPage();
          }
        }
      );
    }

    let icons = dashChildren.filter((actor) => {
      if (actor.child && actor.child._delegate && actor.child._delegate.icon) {
        return true;
      }
      return false;
    });

    icons.forEach((c) => {
      let appwell = c.first_child;
      if (c._appwell === appwell) return; // Already processed

      let widget = appwell.first_child;
      let icongrid = widget.first_child;
      let boxlayout = icongrid.first_child;
      let bin = boxlayout.first_child;
      if (!bin) return;
      let icon = bin.first_child;

      c._bin = bin;
      c._label = c.label;
      c._draggable = appwell._draggable;
      c._appwell = appwell;
      if (icon) {
        c._icon = icon;
      }

      // Hook notify::urgent on inner AppIcon so bounce + dock show fires immediately
      let appIcon = appwell.child && appwell.child._delegate;
      if (appIcon && !appIcon._dashAnimatorUrgentHooked) {
        appIcon._dashAnimatorUrgentHooked = true;
        appIcon.connect('notify::urgent', () => {
          if (this.urgent_bounce && appIcon.urgent) {
            if (this.animator) this.animator.requestUrgentBounce(appwell, true);
            if (this.dashContainer && this.dashContainer._animateIn)
              this.dashContainer._animateIn(0.2, 0);
          } else {
            if (this.animator) this.animator.clearUrgentBounce(appwell);
          }
        });
      }
    });

    try {
      let apps = Main.overview.dash.last_child.last_child;
      if (apps) {
        let widget = apps.child;
        // account for JustPerfection & dash-to-dock hiding the app button
        if (widget && widget.width > 0 && widget.get_parent().visible) {
          let icongrid = widget.first_child;
          let boxlayout = icongrid.first_child;
          let bin = boxlayout.first_child;
          let icon = bin.first_child;
          let c = {
            child: widget,
            _bin: bin,
            _icon: icon,
            _label: widget._delegate.label,
            _appwell: widget, // ShowApps button acts as its own appwell here
          };
          icons.push(c);
        }
      }
    } catch (err) {
      // could happen if ShowApps is hidden
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
      if (this._canUnpinDraggedFavoriteOnTrash(source) && this._isPointerOverTrash()) {
        return DND.DragMotionResult.MOVE_DROP;
      }

      return originalHandleDragOver?.(source, actor, x, y, time) ?? DND.DragMotionResult.CONTINUE;
    };

    this.dash.acceptDrop = (source, actor, x, y, time) => {
      if (this._canUnpinDraggedFavoriteOnTrash(source) && this._isPointerOverTrash()) {
        const app = this._getDraggedApp(source);
        AppFavorites.getAppFavorites().removeFavorite(app.get_id());
        return true;
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
    return global.settings.is_writable('favorite-apps') &&
      AppFavorites.getAppFavorites().isFavorite(appId);
  }

  _getDraggedApp(source) {
    return source?.app ?? source?._delegate?.app ?? source?.child?._delegate?.app ?? null;
  }

  _isPointerOverTrash() {
    const trashActor = this._getTrashActor();
    if (!trashActor) return false;

    const [pointerX, pointerY] = global.get_pointer();
    const [trashX, trashY] = trashActor.get_transformed_position();
    const [trashWidth, trashHeight] = trashActor.get_transformed_size();

    return pointerX >= trashX &&
      pointerX <= trashX + trashWidth &&
      pointerY >= trashY &&
      pointerY <= trashY + trashHeight;
  }

  _getTrashActor() {
    try {
      const children = this.dash?._box?.get_children?.() ?? [];
      return children.find(actor => actor.child?._delegate?.app?.isTrash) ?? null;
    } catch (e) {
      return null;
    }
  }

  _beginAnimation() {
    if (this.animator)
      this.animator._beginAnimation();
  }

  _endAnimation() {
    if (this.animator)
      this.animator._endAnimation();
  }

  _onFocusWindow() {
    if (this.animator)
      this.animator._onFocusWindow();
  }

  _onFullScreen() {
    if (this.animator)
      this.animator._onFullScreen();

    // Force-hide dock in fullscreen — macOS dock never shows in fullscreen
    const isFullscreen = global.display.get_monitor_in_fullscreen(
      global.display.get_current_monitor()
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
    if (this.animator)
      this.animator._startAnimation();
  }
  // ── Theme injection ──────────────────────────────────────────────────────

  _getD2DSettings() {
    try {
      const d2dExt = this._extensionManager.lookup(this._d2dId);
      if (!d2dExt || d2dExt.state !== 1) return null;
      return d2dExt.stateObj?.dockManager?.settings ?? null;
    } catch (e) { return null; }
  }

  // Expand .side.shrink selectors to also match .side (non-shrink),
  // so D2D's custom-theme-shrink toggle has no effect on our styling.
  // Calls callback(expandedFile) asynchronously — falls back to original on error.
  _expandCssAliasesAsync(cssFile, fileName, callback) {
    cssFile.load_contents_async(null, (file, result) => {
      try {
        const [ok, bytes] = file.load_contents_finish(result);
        if (!ok) { callback(cssFile); return; }

        let css = new TextDecoder().decode(bytes);
        const badgeUri = Gio.File.new_for_path(`${this.path}/assets/notification-badge.svg`).get_uri();
        css = css.replaceAll('../assets/notification-badge.svg', badgeUri);

        css = css.replace(/([^{}]+)\{/g, (match, selectors) => {
          if (selectors.trim().startsWith('@')) return match;

          let newSelectors = selectors.split(',').map(s => {
            let hasShrink = false;
            for (const side of ['bottom', 'top', 'left', 'right']) {
              if (s.includes(`.${side}.shrink`)) {
                hasShrink = true;
                break;
              }
            }
            if (hasShrink) {
              return s.replace(/\.shrink/g, '') + ',' + s;
            }
            return s;
          }).join(',');

          return newSelectors + '{';
        });

        const tmpPath = GLib.build_filenamev([GLib.get_tmp_dir(), `c12r-${fileName}`]);
        const tmpFile = Gio.File.new_for_path(tmpPath);
        tmpFile.replace_contents_async(
          new TextEncoder().encode(css),
          null, false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          null,
          (_f, res) => {
            try {
              _f.replace_contents_finish(res);
              callback(tmpFile);
            } catch (e) {
              log(`[cupertinisator] alias write failed, using original: ${e.message}`);
              callback(cssFile);
            }
          }
        );
      } catch (e) {
        log(`[cupertinisator] alias expansion failed, using original: ${e.message}`);
        callback(cssFile);
      }
    });
  }

  _applyThemeOverride() {
    if (this._themeApplyTimeoutId) {
      GLib.source_remove(this._themeApplyTimeoutId);
      this._themeApplyTimeoutId = null;
    }
    if (this._themeInTimeoutId) {
      GLib.source_remove(this._themeInTimeoutId);
      this._themeInTimeoutId = null;
    }

    if (!this._settings.get_boolean('override-theming')) {
      this._removeThemeOverride(true);
      if (this.animator) this.animator.reloadIcons();
      return;
    }

    const theme = this._settings.get_string('dock-theme');
    const aware = this._settings.get_boolean('theme-aware');
    let scheme;

    if (aware) {
      const desktopSettings = Gio.Settings.new('org.gnome.desktop.interface');
      scheme = desktopSettings.get_string('color-scheme') === 'prefer-dark' ? 'dark' : 'light';
    } else {
      scheme = this._settings.get_string('dock-color-scheme');
    }

    const fileName = `${theme}-${scheme}.css`;
    const cssFile = Gio.File.new_for_path(`${this.path}/themes/${fileName}`);

    log(`[cupertinisator] path: ${this.path}`);
    log(`[cupertinisator] looking for: ${cssFile.get_path()}`);
    log(`[cupertinisator] exists: ${cssFile.query_exists(null)}`);

    if (!cssFile.query_exists(null)) {
      log(`[cupertinisator] theme file not found: ${fileName}`);
      return;
    }

    const applyThemeNow = () => {
      this._removeThemeOverride(true);

      this._expandCssAliasesAsync(cssFile, fileName, (fileToLoad) => {
        // Guard: extension may have been disabled while async op was in flight
        if (!this.running) return;

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const stTheme = themeContext.get_theme();
        stTheme.load_stylesheet(fileToLoad);
        this._loadedThemeFile = fileToLoad;

        St.ThemeContext.get_for_stage(global.stage).emit('changed');
        if (this.animator) this.animator.reloadIcons();

        // Slide back in after theme is applied
        this._themeInTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
          this._themeInTimeoutId = null;
          if (this.dashContainer && this.dashContainer.__animateIn)
            this.dashContainer.__animateIn(0.2, 0);
          return GLib.SOURCE_REMOVE;
        });
      });
    };

    // Slide out first, apply theme after animation completes, then slide back in
    if (this.dashContainer && this.dashContainer.__animateOut) {
      this.dashContainer.__animateOut(0.2, 0);
      this._themeApplyTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        this._themeApplyTimeoutId = null;
        applyThemeNow();
        return GLib.SOURCE_REMOVE;
      });
    } else {
      applyThemeNow();
    }
  }


  _removeThemeOverride() {
    if (this._loadedThemeFile) {
      try {
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().unload_stylesheet(this._loadedThemeFile);
      } catch (e) { }
      this._loadedThemeFile = null;
    }
  }

  _connectThemeSettings() {
    const s = this._settings;

    // Re-apply whenever any relevant setting changes
    this._themeSettingIds = [
      s.connect('changed::override-theming', () => this._applyThemeOverride()),
      s.connect('changed::dock-theme', () => this._applyThemeOverride()),
      s.connect('changed::theme-aware', () => this._applyThemeOverride()),
      s.connect('changed::dock-color-scheme', () => this._applyThemeOverride()),
    ];

    // Follow system color-scheme changes
    this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    this._colorSchemeId = this._desktopSettings.connect('changed::color-scheme', () => this._applyThemeOverride());

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
    if (this._themeSettingIds) {
      this._themeSettingIds.forEach(id => this._settings.disconnect(id));
      this._themeSettingIds = null;
    }
    if (this._desktopSettings && this._colorSchemeId) {
      this._desktopSettings.disconnect(this._colorSchemeId);
      this._colorSchemeId = null;
      this._desktopSettings = null;
    }
    this._removeThemeOverride();
  }

}
