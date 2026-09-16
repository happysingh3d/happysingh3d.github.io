# Happy Singh 3D — site files

## What's in here
- `index.html` — hub/landing page
- `design-video.html` — graphic design + video editing portfolio
- `3d.html` — 3D portfolio, skills, and the "Play the games" section (replaces the old portfolio-v4 page — spacing/oversized-image issue is fixed structurally: every image sits in a fixed-ratio `.media-box` with `object-fit:cover`, so no source image can ever blow up the layout again)
- `assets/css/styles.css` — shared dark theme + the media-box fix
- `assets/js/main.js` — mobile nav toggle + active-link highlighting
- `CNAME` — tells GitHub Pages this repo serves `happysingh3d.com`

The 3D-Toolkit app (normal map generator, etc.) is **not included** — keep it exactly where it already lives on GitHub (`3d-toolkit/` folder) and just drop this repo's files in alongside it. The nav already links to `3d-toolkit/`.

## What you need to do

1. **Copy your real images/video** into `assets/img/` (create the folder) and swap each `<div class="media-box placeholder">...</div>` for:
   ```html
   <div class="media-box"><img src="assets/img/your-file.jpg" alt="..."></div>
   ```
   The box's aspect ratio is fixed by CSS, so any photo — portrait, huge, tiny — gets cropped to fit cleanly. No more oversized images breaking the page.

2. **Push these files** into the `happysingh3d.github.io` repo (root), alongside the existing `3d-toolkit/` folder. Remove or archive the old `3d-portfolio/portfolio-v4.html` once you've confirmed `3d.html` looks right — don't delete it until you're sure.

3. **Point the domain (happysingh3d.com) at GitHub Pages:**
   - In your domain registrar's DNS panel, add these four A records for the root domain:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - Add a CNAME record for `www` pointing to `happysingh3d.github.io`.
   - In the repo's GitHub Pages settings, set the custom domain to `happysingh3d.com` (this writes the same `CNAME` file — it's already included here so it won't get wiped on next push) and enable "Enforce HTTPS" once it's available (can take a few hours after DNS propagates).

4. **Games stay on DeadHunk**, not here — `3d.html` just has a small "Games — on DeadHunk" pointer section linking out to deadhunk.com once that site is built. Nothing to wire in on this repo for that.

## Notes
- All four pages share one nav (`index.html`, `design-video.html`, `3d.html`, `3d-toolkit/`) — add a link there if you add more sections later.
- Color accents live in `:root` at the top of `styles.css` (`--accent`, `--accent-2`) if you want to shift the palette.
