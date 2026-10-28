# UX-C1 — previewing PR #138 on a physical iPad (local network only)

GitHub Pages production does **not** contain this branch. Preview it from a
checkout of the PR branch served on your own Wi-Fi. The cloud session that
produced the PR is not on your network and cannot serve your iPad.

## What is safe about this
`scripts/lan-preview.mjs` is a read-only static file server. It binds to **one
private IPv4 address only** (192.168/16, 10/8, 172.16/12, or loopback) and
refuses `0.0.0.0` and any public address, so it is not reachable from the
internet. GET/HEAD only, repository files only, no `.git`, no `node_modules`.
Nothing is uploaded and nothing is exposed publicly. Stop it with Ctrl-C.

## Steps (Windows PowerShell shown; macOS/Linux are identical apart from paths)
Use a **separate worktree** so no existing checkout (including
`lens-header-concept-lab`, UX-H31) is touched:

```powershell
cd <your main clone of madrid-tourism-intelligence-lens>
git fetch origin fix/ux-c1-light-contrast-readability
git worktree add ..\lens-ux-c1-preview origin/fix/ux-c1-light-contrast-readability
cd ..\lens-ux-c1-preview
git log -1 --oneline        # must match the PR head shown on GitHub
node scripts/lan-preview.mjs
```

The script prints `http://<your-LAN-IP>:8080/`. If it cannot pick an address,
pass your Wi-Fi address: `node scripts/lan-preview.mjs --host 192.168.1.23`.
When Windows Defender Firewall asks, allow **Private networks only**.

On the iPad (same Wi-Fi, not a guest network or VPN) open that URL in Safari.
Clean up afterwards: Ctrl-C, then `git worktree remove ..\lens-ux-c1-preview`.

## What to check
1. iPad **Settings → Display & Brightness → Light**, and in the app set
   Appearance to **System** (also try explicit Light). Landscape and portrait.
2. Switch to **COMPARE**, place Lens B, open the Comparison Bridge and choose
   **Mobility**. In *Decision Insight*, the Mobility row must be a dark navy label
   and value on a pale blue row with a thick left edge.
3. Scroll the right panel through Decision Insight and *Spatial sensitivity*
   (open Detail, capture a baseline). Text must stay dark and legible.
4. Switch Light/Dark and EN/ES; the figures and wording must be identical.

## Known differences from production
* This checkout serves the committed fallback data (`data/snapshot_poi.json`,
  labelled "SNAPSHOT SAMPLE"), not the deployed runtime data. Counts differ, and
  Mobility may read as unavailable/withheld. That still exercises the fixed
  row, but the "+37 nodes" figure will not appear.
* Map tiles need internet access on the iPad.
