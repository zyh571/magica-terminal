// Magica Terminal: keep on top. GNOME on Wayland ignores a window asking to stay above the others, so the app asks the
// shell instead, over D-Bus: org.gnome.Shell /dev/local/MagicaTerminal dev.local.MagicaTerminal.SetAbove(path, above).
// A caller can only move its own windows: the window is the one whose GTK D-Bus name is the caller's and whose
// GtkApplicationWindow object path is `path`. Returns whether that window was found (it may not be mapped yet).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `<node>
  <interface name="dev.local.MagicaTerminal">
    <method name="SetAbove">
      <arg type="s" direction="in" name="window"/>
      <arg type="b" direction="in" name="above"/>
      <arg type="b" direction="out" name="found"/>
    </method>
  </interface>
</node>`;

export default class MagicaKeepAbove extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/dev/local/MagicaTerminal');
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
    }

    SetAboveAsync([path, above], invocation) {
        const sender = invocation.get_sender();
        const win = global.get_window_actors().map(a => a.meta_window).find(w =>
            w.get_gtk_unique_bus_name?.() === sender && w.get_gtk_window_object_path?.() === path);
        if (win) {
            if (above)
                win.make_above();
            else
                win.unmake_above();
        }
        invocation.return_value(new GLib.Variant('(b)', [!!win]));
    }
}
