#!/usr/bin/env python3
"""nmap_gui.py — nmap GUI front-end (customtkinter)."""

import os
import queue
import re
import subprocess
import sys
import threading
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from tkinter import filedialog

import customtkinter as ctk

# ── Save directory ─────────────────────────────────────────────────────────────
_CONFIG_DIR   = os.path.expanduser("~/.config/network_tools")
_SAVE_CFG     = os.path.join(_CONFIG_DIR, "nmap_save_dir.txt")
_SAVE_DEFAULT = os.path.expanduser("~/Nmap Scans")


def _load_save_dir() -> str:
    try:
        with open(_SAVE_CFG) as f:
            p = f.read().strip()
            return p if p else _SAVE_DEFAULT
    except OSError:
        return _SAVE_DEFAULT


def _persist_save_dir(path: str) -> None:
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    with open(_SAVE_CFG, "w") as f:
        f.write(path)


# ── nmap helpers ───────────────────────────────────────────────────────────────
NMAP_BIN = "/opt/homebrew/bin/nmap"

SCAN_PROFILES: dict[str, dict] = {
    "Quick Scan":          {"flags": ["-T4", "-F"],                                  "desc": "Fast scan of top 100 ports"},
    "Standard Scan":       {"flags": ["-T4", "-sV"],                                 "desc": "Version detection on common ports"},
    "Full Port Scan":      {"flags": ["-T4", "-p-"],                                 "desc": "All 65535 ports"},
    "Service + Version":   {"flags": ["-T4", "-sV", "--version-intensity", "5"],     "desc": "Detailed service/version detection"},
    "OS Detection":        {"flags": ["-T4", "-O", "-sV"],                           "desc": "OS fingerprinting (requires sudo)"},
    "Aggressive":          {"flags": ["-T4", "-A"],                                  "desc": "OS, version, scripts, traceroute"},
    "Vulnerability Scan":  {"flags": ["-T4", "-sV", "--script=vuln"],                "desc": "Common vulnerability scripts"},
    "UDP Scan":            {"flags": ["-T4", "-sU", "--top-ports", "100"],           "desc": "Top 100 UDP ports (requires sudo)"},
    "Ping Sweep":          {"flags": ["-sn"],                                        "desc": "Discover live hosts, no port scan"},
    "Custom":              {"flags": [],                                              "desc": "Build your own flags"},
}

# Risk colours (dark, light)
_RISK: dict[str, tuple[str, str]] = {
    "open":     ("#f85149", "#cf222e"),   # red
    "filtered": ("#e3b341", "#bc4c00"),   # amber
    "closed":   ("#8b949e", "#656d76"),   # grey
}


def _parse_nmap_xml(xml_text: str) -> list[dict]:
    """Parse nmap -oX output into list of port dicts."""
    rows: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return rows
    for host in root.findall("host"):
        addr_el = host.find("address[@addrtype='ipv4']")
        ip = addr_el.get("addr", "?") if addr_el is not None else "?"
        hostname_el = host.find(".//hostname")
        hostname = hostname_el.get("name", "") if hostname_el is not None else ""
        ports_el = host.find("ports")
        if ports_el is None:
            continue
        for port_el in ports_el.findall("port"):
            state_el  = port_el.find("state")
            service_el = port_el.find("service")
            state   = state_el.get("state", "?") if state_el is not None else "?"
            proto   = port_el.get("protocol", "tcp")
            portnum = port_el.get("portid", "?")
            svc     = service_el.get("name", "") if service_el is not None else ""
            product = service_el.get("product", "") if service_el is not None else ""
            version = service_el.get("version", "") if service_el is not None else ""
            extra   = service_el.get("extrainfo", "") if service_el is not None else ""
            ver_str = " ".join(filter(None, [product, version, extra])).strip()
            rows.append({
                "ip":       ip,
                "hostname": hostname,
                "port":     portnum,
                "proto":    proto,
                "state":    state,
                "service":  svc,
                "version":  ver_str,
            })
    return rows


# ── Colour palette ─────────────────────────────────────────────────────────────
_BG_BASE    = ("#f0f2f5", "#0d1117")
_BG_SIDEBAR = ("#e2e5ec", "#161b22")
_BG_CARD    = ("#ffffff", "#1c2128")
_ACCENT     = ("#0969da", "#58a6ff")
_ACCENT_DIM = ("#0550ae", "#1f6feb")
_DIVIDER    = ("#d0d7de", "#30363d")
_TEXT_PRI   = ("#1f2328", "#e6edf3")
_TEXT_SEC   = ("#656d76", "#8b949e")
_CLR_GREEN  = ("#1a7f37", "#3fb950")
_CLR_RED    = ("#cf222e", "#f85149")
_CLR_AMB    = ("#bc4c00", "#e3b341")

_BG_EVEN = ("gray85", "gray22")
_BG_ODD  = ("gray90", "gray18")
_MONO    = ("Menlo", 12)

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


# ── Result row widget ──────────────────────────────────────────────────────────
class ResultRow(ctk.CTkFrame):
    _COLS = [("IP / Host", 150), ("Port", 90), ("Proto", 60),
             ("State", 80), ("Service", 110), ("Version", 320)]

    def __init__(self, parent, data: dict, idx: int):
        bg = _BG_EVEN if idx % 2 == 0 else _BG_ODD
        super().__init__(parent, fg_color=bg, corner_radius=0)
        state = data.get("state", "")
        state_clr = _RISK.get(state, (_TEXT_SEC[1], _TEXT_SEC[0]))

        host_str = data["ip"]
        if data.get("hostname"):
            host_str += f"\n{data['hostname']}"

        values = [
            host_str,
            data["port"],
            data["proto"],
            state,
            data["service"],
            data["version"] or "—",
        ]
        for col_idx, ((_, w), val) in enumerate(zip(self._COLS, values)):
            clr = state_clr if col_idx == 3 else _TEXT_PRI
            lbl = ctk.CTkLabel(
                self, text=str(val), font=_MONO,
                text_color=clr, anchor="w",
                width=w, wraplength=w - 10,
            )
            lbl.grid(row=0, column=col_idx, padx=(6, 4), pady=3, sticky="w")
        for c, (_, w) in enumerate(self._COLS):
            self.grid_columnconfigure(c, minsize=w)


class ResultHeader(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color=_BG_SIDEBAR, corner_radius=0, height=30)
        for c, (name, w) in enumerate(ResultRow._COLS):
            lbl = ctk.CTkLabel(
                self, text=name,
                font=("Menlo", 12, "bold"),
                text_color=_TEXT_SEC,
                anchor="w", width=w,
            )
            lbl.grid(row=0, column=c, padx=(6, 4), pady=4, sticky="w")
            self.grid_columnconfigure(c, minsize=w)


# ── Main App ───────────────────────────────────────────────────────────────────
class NmapApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Nmap Scanner")
        self.geometry("1020x780")
        self.minsize(860, 620)

        self._save_dir = _load_save_dir()
        self._proc: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None
        self._q: queue.Queue = queue.Queue()
        self._xml_buf: list[str] = []
        self._collecting_xml = False
        self._result_rows: list[ResultRow] = []
        self._row_count = 0

        self._build_ui()
        self._apply_theme()
        self.after(100, self._drain_queue)

    # ── UI construction ────────────────────────────────────────────────────────
    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=1)

        # ── Header bar ──────────────────────────────────────────────────────
        hdr = ctk.CTkFrame(self, fg_color=_BG_SIDEBAR, corner_radius=0, height=52)
        hdr.grid(row=0, column=0, sticky="ew")
        hdr.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(hdr, text="Nmap Scanner",
                     font=("SF Pro Display", 18, "bold"),
                     text_color=_TEXT_PRI).grid(row=0, column=0, padx=18, pady=12)

        self._theme_btn = ctk.CTkButton(
            hdr, text="☀ Light", width=88, height=30,
            fg_color=_BG_CARD, text_color=_TEXT_PRI,
            hover_color=_DIVIDER, corner_radius=6,
            command=self._toggle_theme,
        )
        self._theme_btn.grid(row=0, column=2, padx=12, pady=10)

        # ── Main pane ────────────────────────────────────────────────────────
        main = ctk.CTkFrame(self, fg_color=_BG_BASE, corner_radius=0)
        main.grid(row=1, column=0, sticky="nsew")
        main.grid_columnconfigure(0, weight=1)
        main.grid_rowconfigure(2, weight=1)

        # ── Controls card ────────────────────────────────────────────────────
        ctrl = ctk.CTkFrame(main, fg_color=_BG_CARD, corner_radius=10)
        ctrl.grid(row=0, column=0, padx=14, pady=(14, 6), sticky="ew")
        ctrl.grid_columnconfigure(1, weight=1)

        # Row 0: target + profile
        ctk.CTkLabel(ctrl, text="Target", font=("SF Pro", 13),
                     text_color=_TEXT_SEC).grid(row=0, column=0, padx=(14, 8), pady=(12, 4), sticky="w")
        self._target_var = ctk.StringVar(value="192.168.1.0/24")
        ctk.CTkEntry(ctrl, textvariable=self._target_var,
                     placeholder_text="host / IP / range e.g. 192.168.1.1  10.0.0.0/24",
                     font=_MONO, height=34).grid(row=0, column=1, padx=(0, 8), pady=(12, 4), sticky="ew")

        ctk.CTkLabel(ctrl, text="Profile", font=("SF Pro", 13),
                     text_color=_TEXT_SEC).grid(row=0, column=2, padx=(4, 8), pady=(12, 4), sticky="w")
        self._profile_var = ctk.StringVar(value="Standard Scan")
        profile_menu = ctk.CTkOptionMenu(
            ctrl, variable=self._profile_var,
            values=list(SCAN_PROFILES.keys()),
            width=180, font=("SF Pro", 13),
            command=self._on_profile_change,
        )
        profile_menu.grid(row=0, column=3, padx=(0, 14), pady=(12, 4))

        # Row 1: extra flags + ports + sudo toggle
        ctk.CTkLabel(ctrl, text="Extra flags", font=("SF Pro", 13),
                     text_color=_TEXT_SEC).grid(row=1, column=0, padx=(14, 8), pady=(4, 12), sticky="w")
        self._flags_var = ctk.StringVar(value="-T4 -sV")
        self._flags_entry = ctk.CTkEntry(
            ctrl, textvariable=self._flags_var,
            placeholder_text="e.g. -p 22,80,443  --script=vuln  -O",
            font=_MONO, height=34,
        )
        self._flags_entry.grid(row=1, column=1, padx=(0, 8), pady=(4, 12), sticky="ew")

        self._sudo_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(ctrl, text="sudo", variable=self._sudo_var,
                        font=("SF Pro", 13), text_color=_TEXT_PRI,
                        width=70).grid(row=1, column=2, padx=(4, 8), pady=(4, 12))

        self._scan_btn = ctk.CTkButton(
            ctrl, text="▶  Scan", width=110, height=34,
            fg_color=_ACCENT, hover_color=_ACCENT_DIM,
            font=("SF Pro", 14, "bold"), corner_radius=8,
            command=self._start_scan,
        )
        self._scan_btn.grid(row=1, column=3, padx=(0, 14), pady=(4, 12))

        # ── Status bar ───────────────────────────────────────────────────────
        status_bar = ctk.CTkFrame(main, fg_color=_BG_CARD, corner_radius=8, height=32)
        status_bar.grid(row=1, column=0, padx=14, pady=(0, 6), sticky="ew")
        status_bar.grid_columnconfigure(0, weight=1)

        self._status_lbl = ctk.CTkLabel(
            status_bar, text="Ready — enter a target and press Scan",
            font=("SF Pro", 12), text_color=_TEXT_SEC, anchor="w",
        )
        self._status_lbl.grid(row=0, column=0, padx=12, pady=4, sticky="w")

        self._stop_btn = ctk.CTkButton(
            status_bar, text="■  Stop", width=80, height=24,
            fg_color=_CLR_RED, hover_color="#b91c1c",
            font=("SF Pro", 12, "bold"), corner_radius=6,
            state="disabled", command=self._stop_scan,
        )
        self._stop_btn.grid(row=0, column=1, padx=(4, 8), pady=4)

        self._save_btn = ctk.CTkButton(
            status_bar, text="💾  Save", width=80, height=24,
            fg_color=_BG_SIDEBAR, text_color=_TEXT_PRI,
            hover_color=_DIVIDER, corner_radius=6,
            state="disabled", command=self._save_results,
        )
        self._save_btn.grid(row=0, column=2, padx=(0, 8), pady=4)

        # ── Tab view: Results table / Raw output ─────────────────────────────
        self._tabs = ctk.CTkTabview(main, fg_color=_BG_CARD, corner_radius=10)
        self._tabs.grid(row=2, column=0, padx=14, pady=(0, 14), sticky="nsew")
        self._tabs.add("Results")
        self._tabs.add("Raw Output")

        # Results tab
        res_tab = self._tabs.tab("Results")
        res_tab.grid_columnconfigure(0, weight=1)
        res_tab.grid_rowconfigure(1, weight=1)

        self._result_hdr = ResultHeader(res_tab)
        self._result_hdr.grid(row=0, column=0, sticky="ew")

        self._result_scroll = ctk.CTkScrollableFrame(
            res_tab, fg_color=_BG_BASE, corner_radius=0,
        )
        self._result_scroll.grid(row=1, column=0, sticky="nsew")
        self._result_scroll.grid_columnconfigure(0, weight=1)

        self._empty_lbl = ctk.CTkLabel(
            self._result_scroll, text="No results yet",
            font=("SF Pro", 13), text_color=_TEXT_SEC,
        )
        self._empty_lbl.grid(row=0, column=0, pady=30)

        # Raw output tab
        raw_tab = self._tabs.tab("Raw Output")
        raw_tab.grid_columnconfigure(0, weight=1)
        raw_tab.grid_rowconfigure(0, weight=1)

        self._raw_box = ctk.CTkTextbox(
            raw_tab, font=_MONO, fg_color=_BG_BASE,
            text_color=_TEXT_PRI, wrap="none", corner_radius=0,
        )
        self._raw_box.grid(row=0, column=0, sticky="nsew")
        self._raw_box.configure(state="disabled")

    # ── Profile change ─────────────────────────────────────────────────────────
    def _on_profile_change(self, name: str):
        if name == "Custom":
            return
        flags = SCAN_PROFILES[name]["flags"]
        self._flags_var.set(" ".join(flags))

    # ── Scan control ───────────────────────────────────────────────────────────
    def _start_scan(self):
        target = self._target_var.get().strip()
        if not target:
            self._set_status("Enter a target first.", error=True)
            return

        # Build command
        flags_raw = self._flags_var.get().strip()
        try:
            extra = __import__("shlex").split(flags_raw) if flags_raw else []
        except ValueError as e:
            self._set_status(f"Bad flags: {e}", error=True)
            return

        xml_out = "/tmp/nmap_gui_result.xml"
        cmd = [NMAP_BIN] + extra + ["-oX", xml_out, target]
        if self._sudo_var.get():
            cmd = ["sudo"] + cmd

        # Clear previous
        self._clear_results()
        self._raw_box.configure(state="normal")
        self._raw_box.delete("1.0", "end")
        self._raw_box.configure(state="disabled")
        self._xml_buf.clear()
        self._collecting_xml = False

        self._scan_btn.configure(state="disabled")
        self._stop_btn.configure(state="normal")
        self._save_btn.configure(state="disabled")
        self._set_status(f"Running: {' '.join(cmd)}")

        self._thread = threading.Thread(target=self._run_scan, args=(cmd, xml_out), daemon=True)
        self._thread.start()

    def _run_scan(self, cmd: list[str], xml_path: str):
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in self._proc.stdout:  # type: ignore[union-attr]
                self._q.put(("line", line))
            self._proc.wait()
            rc = self._proc.returncode
        except FileNotFoundError:
            self._q.put(("error", f"nmap not found at {cmd[0]}"))
            return
        except Exception as e:
            self._q.put(("error", str(e)))
            return
        finally:
            self._proc = None

        # Parse XML result
        try:
            xml_text = Path(xml_path).read_text()
            rows = _parse_nmap_xml(xml_text)
            self._q.put(("done", (rc, rows)))
        except Exception as e:
            self._q.put(("done", (rc, [])))

    def _stop_scan(self):
        if self._proc:
            try:
                self._proc.terminate()
            except Exception:
                pass
        self._set_status("Scan stopped by user.", error=True)
        self._scan_btn.configure(state="normal")
        self._stop_btn.configure(state="disabled")

    # ── Queue drain (GUI thread) ───────────────────────────────────────────────
    def _drain_queue(self):
        try:
            while True:
                kind, data = self._q.get_nowait()
                if kind == "line":
                    self._append_raw(data)
                elif kind == "error":
                    self._set_status(data, error=True)
                    self._scan_btn.configure(state="normal")
                    self._stop_btn.configure(state="disabled")
                elif kind == "done":
                    rc, rows = data
                    self._populate_results(rows)
                    n = len(rows)
                    status = f"Scan complete — {n} open/filtered port{'s' if n != 1 else ''} found"
                    if rc not in (0, -15):  # -15 = SIGTERM (stopped)
                        status += f"  (exit {rc})"
                    self._set_status(status)
                    self._scan_btn.configure(state="normal")
                    self._stop_btn.configure(state="disabled")
                    if rows:
                        self._save_btn.configure(state="normal")
        except queue.Empty:
            pass
        self.after(80, self._drain_queue)

    def _append_raw(self, text: str):
        self._raw_box.configure(state="normal")
        self._raw_box.insert("end", text)
        self._raw_box.see("end")
        self._raw_box.configure(state="disabled")

    # ── Results population ─────────────────────────────────────────────────────
    def _clear_results(self):
        for w in self._result_rows:
            w.destroy()
        self._result_rows.clear()
        self._row_count = 0
        self._empty_lbl.grid(row=0, column=0, pady=30)

    def _populate_results(self, rows: list[dict]):
        if not rows:
            self._empty_lbl.configure(text="No open ports found.")
            return
        self._empty_lbl.grid_forget()
        for r in rows:
            row_w = ResultRow(self._result_scroll, r, self._row_count)
            row_w.grid(row=self._row_count, column=0, sticky="ew", pady=1)
            self._result_rows.append(row_w)
            self._row_count += 1
        self._tabs.set("Results")

    # ── Save ───────────────────────────────────────────────────────────────────
    def _save_results(self):
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        target_safe = re.sub(r"[^\w.\-]", "_", self._target_var.get().strip())
        default_name = f"nmap_{target_safe}_{ts}.txt"

        os.makedirs(self._save_dir, exist_ok=True)
        path = filedialog.asksaveasfilename(
            initialdir=self._save_dir,
            initialfile=default_name,
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if not path:
            return

        raw = self._raw_box.get("1.0", "end").strip()
        try:
            with open(path, "w") as f:
                f.write(f"Nmap Scan — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"Target : {self._target_var.get().strip()}\n")
                f.write(f"Flags  : {self._flags_var.get().strip()}\n")
                f.write("=" * 72 + "\n\n")
                f.write(raw)
            self._persist_save_dir(str(Path(path).parent))
            self._set_status(f"Saved → {path}")
        except OSError as e:
            self._set_status(f"Save failed: {e}", error=True)

    # ── Theme ──────────────────────────────────────────────────────────────────
    def _toggle_theme(self):
        mode = ctk.get_appearance_mode()
        if mode == "Dark":
            ctk.set_appearance_mode("light")
            self._theme_btn.configure(text="🌙 Dark")
        else:
            ctk.set_appearance_mode("dark")
            self._theme_btn.configure(text="☀ Light")

    def _apply_theme(self):
        ctk.set_appearance_mode("dark")

    # ── Status ─────────────────────────────────────────────────────────────────
    def _set_status(self, msg: str, error: bool = False):
        clr = _CLR_RED if error else _TEXT_SEC
        self._status_lbl.configure(text=msg, text_color=clr)


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    app = NmapApp()
    app.mainloop()


if __name__ == "__main__":
    main()
