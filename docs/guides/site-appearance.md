# Site mascot

Administrators can choose **3D Chibi** or **2D Anime** in **Admin → Appearance**,
preview both sets, and click **Save mascot**. The change applies to everyone,
including visitors on the sign-in and access-denied screens. The default is
3D Chibi. Selecting a preview does not change the site until the save succeeds.

`GET /api/appearance` is public and returns only `{ "mascotStyle": "3D-Chibi" }`
(or `2D-Anime`). `PUT /api/admin/appearance` accepts the same shape and requires
an authenticated administrator. It is independent of per-user `/api/settings`.
Only these two identifiers are accepted; image URLs cannot be supplied.

The singleton D1 table `site_appearance` persists the selection. Apply migration
`0044_site_appearance.sql` through the normal deployment migration process before
deploying the Worker. No extra binding is needed. The migration creates no row;
an empty table uses 3D Chibi. This feature does not apply migrations itself.

Reads go directly to the D1 primary binding, with `Cache-Control: no-store` and
browser caching disabled. A successful save updates the administrator's current
page. Other sessions read again on page load or window focus; there is no push
subscription. Concurrent administrators use last successful write wins.

`MascotProvider` sits above the authentication gate and retains the last valid
style if a read fails (or the default on a fresh page). The admin form reports
read errors and disables saving until a retry succeeds. Login and learning do
not wait for this optional configuration. Failed writes keep the draft for retry.

`MascotImage` maps all eight existing scenes through the shared appearance
module. A failed 2D image falls back to the 3D image of the same scene; if that
also fails, a hidden placeholder preserves space without a broken-image icon.
Image boxes use contain sizing to preserve both sets' proportions. The 2D set
uses RGBA cutouts in `apps/web/public/mascot/2D-Anime/transparent/`; the original
white-background sources are retained in the parent directory. Preview images
have no CSS background fill. The separate asset URLs also avoid reusing cached
white-background images. Cutout provenance and prompts are recorded in
`docs/guides/mascot-cutout-prompts.md`.

Coverage includes SQLite-backed route permissions, validation and persistence,
the shared scene-to-asset mapping, and a browser regression registered in the
existing CI runner (admin saving/retry, public sign-in and denied scenes,
cross-session refresh, failure fallback and phone layout).
