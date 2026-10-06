#!/usr/bin/env python3
"""Launch with a clean profile/minimal PATH; optionally require renderer/IPC ACK."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-report", action="store_true")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a launch command is required")
    args.output.mkdir(parents=True, exist_ok=True)
    report = (args.output / "renderer-ipc.json").resolve()
    report.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="arxell-profile-") as home:
        allowed = ["DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "TMPDIR", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"]
        env = {key: os.environ[key] for key in allowed if key in os.environ}
        env.update(HOME=home, USERPROFILE=home, PATH="/usr/bin:/bin:/usr/sbin:/sbin" if os.name != "nt" else os.environ.get("PATH", ""),
                   XDG_DATA_HOME=f"{home}/data", XDG_CONFIG_HOME=f"{home}/config", XDG_CACHE_HOME=f"{home}/cache", APPIMAGE_EXTRACT_AND_RUN="1")
        if args.require_report:
            env["ARXELL_DESKTOP_SMOKE_REPORT"] = str(report)
        with (args.output / "launch.log").open("wb") as log:
            app = subprocess.Popen(command, env=env, stdout=log, stderr=log, start_new_session=(os.name != "nt"))
            try:
                deadline = time.monotonic() + args.timeout
                rendered = False
                while time.monotonic() < deadline:
                    if app.poll() is not None:
                        raise RuntimeError(f"Arxell exited during startup: {app.returncode}; see {args.output}/launch.log")
                    if args.require_report and report.exists():
                        try:
                            payload = json.loads(report.read_text())
                            rendered = payload.get("frontendRendered") is True and bool(payload.get("ipcVersion"))
                        except (ValueError, OSError):
                            pass
                        if rendered:
                            break
                    time.sleep(0.2)
                if args.require_report and not rendered:
                    raise RuntimeError("Renderer/IPC handshake missing; a live process is not sufficient")
                if sys.platform == "darwin":
                    subprocess.run(["/usr/sbin/screencapture", "-x", str(args.output / "desktop.png")], timeout=10, check=False)
                print("PASS: renderer + Rust IPC" if args.require_report else "PASS: installed application startup (not a UI acceptance test)")
            finally:
                if os.name == "nt":
                    app.terminate()
                else:
                    try:
                        os.killpg(app.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                try:
                    app.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        app.kill()
                    else:
                        os.killpg(app.pid, signal.SIGKILL)
                    app.wait(timeout=5)


if __name__ == "__main__":
    main()
