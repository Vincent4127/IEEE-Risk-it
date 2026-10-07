"""Stamps a new version on every file the pages load.

Browsers keep copies of the game's files. After an update, a browser can end
up with some new files and some old ones, and then a page stops working
(that is what froze the Main Display once). This script gives every link a
new ?v= version, so each update is fetched fresh and as one set:

  - the CSS links and the page's own script in each .html file;
  - an import map in each page, which sends every import between the game's
    scripts (./ui.js, ./game.js …) to the same version.

Run it before each deploy, from the project folder:

    python tools/stamp.py
"""
import pathlib
import re
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ["index.html", "team.html", "display.html", "admin.html"]
START = "<!-- version:start (made by tools/stamp.py, don't edit by hand) -->"
END = "<!-- version:end -->"

# Shown if a page's scripts fail to load. Inline and self-styled, because the
# stylesheet may be the stale part.
GUARD = """<script>
    addEventListener("error", function (e) {
      var m = String(e.message || "");
      var scriptFailed = e.target && e.target.tagName === "SCRIPT";
      if (!scriptFailed && !/provide an export|dynamically imported module|Importing a module script failed|Cannot use import/i.test(m)) return;
      if (document.getElementById("load-fail")) return;
      var d = document.createElement("div");
      d.id = "load-fail";
      d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 18px;border-radius:14px;background:#fff;color:#0f2547;font:600 16px/1.4 system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.35)";
      d.innerHTML = "<span>This page didn't load properly, usually because the browser kept an older copy. Press Ctrl + Shift + R, or tap Reload.</span>";
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "Reload";
      b.style.cssText = "border:0;border-radius:999px;padding:10px 22px;background:#016eb6;color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer";
      b.onclick = function () { location.reload(); };
      d.appendChild(b);
      (document.body || document.documentElement).appendChild(d);
    }, true);
  </script>"""


def main():
    version = time.strftime("%Y%m%d%H%M%S")
    scripts = sorted(p.name for p in (ROOT / "js").glob("*.js"))
    imports = ",\n".join(f'        "./js/{name}": "./js/{name}?v={version}"' for name in scripts)
    block = f"""{START}
  {GUARD}
  <script type="importmap">
    {{
      "imports": {{
{imports}
      }}
    }}
  </script>
  {END}"""
    for page in PAGES:
        path = ROOT / page
        html = path.read_text(encoding="utf-8")
        if START in html:
            html = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, html, flags=re.S)
        else:
            # First run: the block goes right after the stylesheets, before
            # any script.
            last_css = list(re.finditer(r'<link rel="stylesheet"[^>]*>', html))[-1]
            html = html[: last_css.end()] + "\n  " + block + html[last_css.end():]
        html = re.sub(r'(href="css/[\w-]+\.css)(\?v=\w+)?"', rf'\1?v={version}"', html)
        html = re.sub(r'(<script type="module" src="js/[\w-]+\.js)(\?v=\w+)?"', rf'\1?v={version}"', html)
        path.write_text(html, encoding="utf-8", newline="\n")
        print(f"{page}: version {version}")


if __name__ == "__main__":
    main()
