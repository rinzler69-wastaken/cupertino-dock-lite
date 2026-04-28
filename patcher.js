// patcher.js — CAMLE extension.js patcher utility
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const CAMLE_UUID = "compiz-alike-magic-lamp-effect@hermes83.github.com";
const BACKUP_DIR = "c12r-backup";
const BACKUP_FILE = "extension.js.bak";

function getCamleDir() {
    const userDir = GLib.build_filenamev([GLib.get_home_dir(), ".local", "share", "gnome-shell", "extensions", CAMLE_UUID]);
    const systemDir = "/usr/share/gnome-shell/extensions/" + CAMLE_UUID;
    if (Gio.File.new_for_path(userDir).query_exists(null)) return userDir;
    if (Gio.File.new_for_path(systemDir).query_exists(null)) return systemDir;
    return null;
}

// Returns: "not-installed" | "not-patched" | "patched"
export function getCamleStatus(extensionDir) {
    const camleDir = getCamleDir();
    if (!camleDir) return "not-installed";
    const backupFile = Gio.File.new_for_path(
        GLib.build_filenamev([camleDir, BACKUP_DIR, BACKUP_FILE]));
    return backupFile.query_exists(null) ? "patched" : "not-patched";
}

// Returns: { success: bool, error: string|null }
export function patchCamle(extensionDir) {
    const camleDir = getCamleDir();
    if (!camleDir) return { success: false, error: "not-installed" };
    try {
        const ourFile = Gio.File.new_for_path(
            GLib.build_filenamev([extensionDir, "assets", "camle-extension.js.template"]));
        if (!ourFile.query_exists(null))
            return { success: false, error: "missing-asset" };

        const backupDirFile = Gio.File.new_for_path(
            GLib.build_filenamev([camleDir, BACKUP_DIR]));
        if (!backupDirFile.query_exists(null))
            backupDirFile.make_directory(null);

        const originalFile = Gio.File.new_for_path(
            GLib.build_filenamev([camleDir, "extension.js"]));
        const backupFile = Gio.File.new_for_path(
            GLib.build_filenamev([camleDir, BACKUP_DIR, BACKUP_FILE]));

        if (!backupFile.query_exists(null))
            originalFile.copy(backupFile, Gio.FileCopyFlags.NONE, null, null);

        ourFile.copy(originalFile, Gio.FileCopyFlags.OVERWRITE, null, null);
        return { success: true, error: null };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Returns: { success: bool, error: string|null }
export function restoreCamle(extensionDir) {
    const camleDir = getCamleDir();
    if (!camleDir) return { success: false, error: "not-installed" };
    try {
        const backupFile = Gio.File.new_for_path(
            GLib.build_filenamev([camleDir, BACKUP_DIR, BACKUP_FILE]));
        if (!backupFile.query_exists(null))
            return { success: false, error: "no-backup" };

        const originalFile = Gio.File.new_for_path(
            GLib.build_filenamev([camleDir, "extension.js"]));
        backupFile.copy(originalFile, Gio.FileCopyFlags.OVERWRITE, null, null);
        backupFile.delete(null);
        try {
            Gio.File.new_for_path(
                GLib.build_filenamev([camleDir, BACKUP_DIR])).delete(null);
        } catch (e) { }
        return { success: true, error: null };
    } catch (e) {
        return { success: false, error: e.message };
    }
}