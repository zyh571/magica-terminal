// Magica Terminal's GNOME Shell helper. GNOME on Wayland doesn't let an app keep itself on top or place another app's
// window, so the app asks the shell instead, over D-Bus: org.gnome.Shell /dev/local/MagicaTerminal dev.local.MagicaTerminal.
//
//   SetAbove(path, above) → found      keep the caller's window above the others (the notepad)
//   Pick() → id                        let the user click a window ("" if they pressed Esc)
//   Find(text) → id                    the most recently used window whose title or app contains text ("" if none)
//   Attach(path, key, id, x, y, w, h, shown, frozen) → title
//                                      keep window id glued over the rectangle x, y, w, h of the caller's window
//                                      (`attach` in a pane); call it again whenever the rectangle or the flags change.
//                                      shown = false minimizes it (the pane's tab isn't showing); frozen = true lets
//                                      it be watched but not touched (clicks and focus go back to the terminal).
//                                      Returns the window's title, or "" if it's gone.
//   Detach(key)                        put the window back where it was
//   signal Gone(key)                   the attached window closed
//
// A caller's own window is the one whose GTK D-Bus name is the caller's and whose GtkApplicationWindow object path is
// `path`. Everything a caller attached is put back when it detaches, its window closes or it leaves the bus.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `<node>
  <interface name="dev.local.MagicaTerminal">
    <method name="SetAbove">
      <arg type="s" direction="in" name="window"/>
      <arg type="b" direction="in" name="above"/>
      <arg type="b" direction="out" name="found"/>
    </method>
    <method name="Pick">
      <arg type="s" direction="out" name="id"/>
    </method>
    <method name="Find">
      <arg type="s" direction="in" name="text"/>
      <arg type="s" direction="out" name="id"/>
    </method>
    <method name="Attach">
      <arg type="s" direction="in" name="window"/>
      <arg type="s" direction="in" name="key"/>
      <arg type="s" direction="in" name="id"/>
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="b" direction="in" name="shown"/>
      <arg type="b" direction="in" name="frozen"/>
      <arg type="s" direction="out" name="title"/>
    </method>
    <method name="Detach">
      <arg type="s" direction="in" name="key"/>
    </method>
    <signal name="Gone">
      <arg type="s" name="key"/>
    </signal>
  </interface>
</node>`;

const PICKABLE = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.UTILITY];

function windows() {
    return global.get_window_actors().map(a => a.meta_window).filter(w => w);
}

function callersWindow(sender, path) {
    return windows().find(w => w.get_gtk_unique_bus_name?.() === sender && w.get_gtk_window_object_path?.() === path);
}

function windowById(id) {
    return windows().find(w => String(w.get_id()) === id);
}

function rectOf(w) {
    const r = w.get_frame_rect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}

export default class MagicaTerminalHelper extends Extension {
    enable() {
        this._attached = new Map();   // key → {sender, host, target, rect, shown, frozen, saved, shield, ids}
        this._watches = new Map();    // sender → bus name watch id
        this._homes = new WeakMap();  // window → {saved, time}: where a just-detached window went back to (see _detach)
        this._picking = null;
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/dev/local/MagicaTerminal');
        this._displayIds = [
            global.display.connect('notify::focus-window', () => this._onFocus()),
            global.display.connect('restacked', () => this._attached.forEach(a => this._stackShield(a))),
            global.display.connect('grab-op-end', () => this._attached.forEach(a => this._place(a))),
        ];
    }

    disable() {
        this._picking?.finish('');
        for (const key of [...this._attached.keys()])
            this._detach(key);
        this._watches.forEach(id => Gio.bus_unwatch_name(id));
        this._watches.clear();
        this._displayIds.forEach(id => global.display.disconnect(id));
        this._dbus?.unexport();
        this._dbus = null;
    }

    SetAboveAsync([path, above], invocation) {
        const win = callersWindow(invocation.get_sender(), path);
        if (win) {
            if (above)
                win.make_above();
            else
                win.unmake_above();
        }
        invocation.return_value(new GLib.Variant('(b)', [!!win]));
    }

    // ── picking a window: a crosshair over everything; the window under it is outlined, a click takes it ──
    PickAsync(_params, invocation) {
        const sender = invocation.get_sender();
        this._picking?.finish('');
        const stage = global.stage;
        const cover = new St.Widget({reactive: true, can_focus: true, x: 0, y: 0, width: stage.width, height: stage.height});
        const outline = new St.Widget({
            visible: false,
            style: 'border: 3px solid #e85a9c; border-radius: 8px; background-color: rgba(232, 90, 156, 0.15);',
        });
        const hint = new St.Label({
            text: 'Click a window to attach it to the terminal  ·  Esc cancels',
            style: 'background-color: rgba(30, 24, 32, 0.9); color: #f5eef2; padding: 10px 18px; border-radius: 10px; font-weight: bold;',
        });
        cover.add_child(outline);
        cover.add_child(hint);
        hint.connect('notify::width', () => hint.set_position(Math.round((stage.width - hint.width) / 2), 48));
        cover.set_cursor_type?.(Clutter.CursorType.CROSSHAIR);
        Main.layoutManager.uiGroup.add_child(cover);
        const grab = Main.pushModal(cover, {actionMode: Shell.ActionMode.NORMAL});
        cover.grab_key_focus();

        const under = (x, y) => {
            const ws = global.workspace_manager.get_active_workspace();
            return windows().reverse().find(w => {
                if (!PICKABLE.includes(w.get_window_type()) || w.minimized || !w.showing_on_its_workspace() ||
                    !w.located_on_workspace(ws) || w.get_gtk_unique_bus_name?.() === sender)
                    return false;
                const r = rectOf(w);
                return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
            });
        };
        const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            picking.finish('');
            return GLib.SOURCE_REMOVE;
        });
        const picking = {
            finish: id => {
                if (this._picking !== picking)
                    return;
                this._picking = null;
                GLib.source_remove(timeout);
                Main.popModal(grab);
                cover.destroy();
                invocation.return_value(new GLib.Variant('(s)', [id]));
            },
        };
        this._picking = picking;
        cover.connect('event', (_actor, event) => {
            const type = event.type();
            if (type === Clutter.EventType.MOTION) {
                const w = under(...event.get_coords());
                outline.visible = !!w;
                if (w) {
                    const r = rectOf(w);
                    outline.set_position(r.x, r.y);
                    outline.set_size(r.width, r.height);
                }
            } else if (type === Clutter.EventType.BUTTON_PRESS) {
                const w = event.get_button() === Clutter.BUTTON_PRIMARY ? under(...event.get_coords()) : null;
                picking.finish(w ? String(w.get_id()) : '');
            } else if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                picking.finish('');
            }
            return Clutter.EVENT_STOP;
        });
    }

    FindAsync([text], invocation) {
        const sender = invocation.get_sender();
        const want = text.toLowerCase();
        const recent = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
        const all = [...recent, ...windows().filter(w => !recent.includes(w))];
        const w = all.find(w => PICKABLE.includes(w.get_window_type()) && w.get_gtk_unique_bus_name?.() !== sender &&
            [w.get_title(), w.get_wm_class(), w.get_sandboxed_app_id()].some(s => s && s.toLowerCase().includes(want)));
        invocation.return_value(new GLib.Variant('(s)', [w ? String(w.get_id()) : '']));
    }

    // ── attached windows ──
    AttachAsync([path, key, id, x, y, width, height, shown, frozen], invocation) {
        const sender = invocation.get_sender();
        let a = this._attached.get(key);
        if (a && (a.sender !== sender || String(a.target.get_id()) !== id)) {
            this._detach(key);
            a = null;
        }
        if (!a) {
            const host = callersWindow(sender, path);
            const target = windowById(id);
            if (!host || !target || target === host) {
                invocation.return_value(new GLib.Variant('(s)', ['']));
                return;
            }
            const home = this._homes.get(target);   // put back moments ago: it may not have got there yet
            let saved = home && GLib.get_monotonic_time() - home.time < 5e6 ? home.saved : null;
            for (const [k, other] of this._attached) {   // a window is glued to one place at a time
                if (other.target === target) {
                    saved = other.saved;   // (where it was before it was first glued)
                    this._detach(k, true);
                    this._dbus?.emit_signal('Gone', new GLib.Variant('(s)', [k]));
                }
            }
            a = {
                sender, host, target, ids: [],
                saved: saved ?? {rect: rectOf(target), maximized: target.is_maximized(), minimized: target.minimized},
            };
            const watch = (obj, signal, fn) => a.ids.push([obj, obj.connect(signal, fn)]);
            watch(target, 'unmanaged', () => {
                this._detach(key, false, true);
                this._dbus?.emit_signal('Gone', new GLib.Variant('(s)', [key]));
            });
            watch(host, 'unmanaged', () => this._detach(key));
            watch(host, 'position-changed', () => this._place(a));
            watch(host, 'size-changed', () => this._place(a));
            watch(host, 'notify::minimized', () => this._place(a));
            watch(host, 'workspace-changed', () => this._place(a));
            watch(host, 'raised', () => this._raise(a));
            watch(target, 'size-changed', () => this._placeSoon(a));   // it resized itself (a guest's new resolution)
            watch(target, 'position-changed', () => this._fitShield(a));
            watch(target, 'size-changed', () => this._fitShield(a));
            this._attached.set(key, a);
            this._watchSender(sender);
        }
        Object.assign(a, {rect: {x, y, width, height}, shown, frozen});
        this._place(a);
        this._raise(a);
        invocation.return_value(new GLib.Variant('(s)', [a.target.get_title() ?? '']));
    }

    DetachAsync([key], invocation) {
        if (this._attached.get(key)?.sender === invocation.get_sender())
            this._detach(key);
        invocation.return_value(null);
    }

    _watchSender(sender) {
        if (this._watches.has(sender))
            return;
        this._watches.set(sender, Gio.bus_watch_name(Gio.BusType.SESSION, sender, Gio.BusNameWatcherFlags.NONE, null,
            () => {   // the terminal quit (or crashed): give its windows back
                for (const [k, a] of this._attached) {
                    if (a.sender === sender)
                        this._detach(k);
                }
                Gio.bus_unwatch_name(this._watches.get(sender));
                this._watches.delete(sender);
            }));
    }

    _visible(a) {
        return a.shown && !a.host.minimized;
    }

    _place(a) {
        const {host, target} = a;
        if (!this._visible(a)) {
            if (!target.minimized)
                target.minimize();
            this._fitShield(a);
            return;
        }
        if (target.minimized)
            target.unminimize();
        if (target.is_fullscreen())
            target.unmake_fullscreen();
        if (target.is_maximized())
            target.unmaximize();
        const ws = host.get_workspace();
        if (ws && !target.is_on_all_workspaces() && target.get_workspace() !== ws)
            target.change_workspace(ws);
        const b = host.get_buffer_rect();   // the app gives the rectangle in its own surface's coordinates
        const r = a.rect;
        const now = rectOf(target);
        if (now.x !== b.x + r.x || now.y !== b.y + r.y || now.width !== r.width || now.height !== r.height)
            target.move_resize_frame(false, b.x + r.x, b.y + r.y, r.width, r.height);
        this._fitShield(a);
    }

    _placeSoon(a) {
        if (a.soon)
            return;
        a.soon = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            a.soon = 0;
            if ([...this._attached.values()].includes(a))
                this._place(a);
            return GLib.SOURCE_REMOVE;
        });
    }

    // the attached window sits just above the terminal: whenever the terminal comes to the front, so does it
    _raise(a) {
        if (this._visible(a) && global.display.focus_window === a.host) {
            a.target.raise();
            a.host.foreach_transient(w => {   // the terminal's own tooltips and menus stay in front of it
                w.raise();
                return true;
            });
        }
    }

    _onFocus() {
        const focus = global.display.focus_window;
        for (const a of this._attached.values()) {
            if (focus === a.host) {
                this._raise(a);
            } else if (focus === a.target && a.frozen) {   // frozen: it can be watched, not used
                a.host.activate(global.get_current_time());
            }
        }
    }

    // frozen: a see-through, click-catching layer just above the window; a click on it goes to the terminal
    _fitShield(a) {
        const want = a.frozen && this._visible(a) && !a.target.minimized;
        if (!want) {
            a.shield?.hide();
            return;
        }
        if (!a.shield) {
            a.shield = new St.Widget({reactive: true});
            a.shield.connect('event', (_actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS)
                    a.host.activate(global.get_current_time());
                return Clutter.EVENT_STOP;
            });
            global.window_group.add_child(a.shield);
        }
        const r = rectOf(a.target);
        a.shield.set_position(r.x, r.y);
        a.shield.set_size(r.width, r.height);
        a.shield.show();
        this._stackShield(a);
    }

    _stackShield(a) {
        const actor = a.target.get_compositor_private();
        if (a.shield && actor && actor.get_parent() === global.window_group)
            global.window_group.set_child_above_sibling(a.shield, actor);
    }

    // put the window back as it was (unless it's closing, or about to be glued somewhere else)
    _detach(key, moving = false, gone = false) {
        const a = this._attached.get(key);
        if (!a)
            return;
        this._attached.delete(key);
        a.ids.forEach(([obj, id]) => obj.disconnect(id));
        if (a.soon)
            GLib.source_remove(a.soon);
        a.shield?.destroy();
        if (gone || moving)
            return;
        const {target, saved} = a;
        this._homes.set(target, {saved, time: GLib.get_monotonic_time()});
        if (target.minimized && !saved.minimized)
            target.unminimize();
        const r = saved.rect;
        target.move_resize_frame(false, r.x, r.y, r.width, r.height);
        if (saved.maximized)
            target.maximize();
        if (saved.minimized && !target.minimized)
            target.minimize();
    }
}
