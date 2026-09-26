# Credits

PrepDeck's source code and assets are released under the [MIT Licence](LICENSE).

## Artwork

The mascot artwork is contributed work, licensed to this project under the same
MIT Licence as the rest of the repository.

| Artwork | Author |
| --- | --- |
| 2D-Anime mascot set (`apps/web/public/mascot/2D-Anime/`) and the character sheet it derives from (`imgs/mascot/mascot-master.png`) | [Tsukatskki](https://github.com/Tsukatskki) |
| 3D-Chibi mascot set (`apps/web/public/mascot/3D-Chibi/`) | [Chuyaku Gi](https://github.com/YIzhongyue) |
| Wordmark, logo lockups and the thanks image (`imgs/`, `apps/web/public/email/`) | [Chuyaku Gi](https://github.com/YIzhongyue) |

## Fonts

The web app self-hosts its typefaces (issue #44), installed from the
[Fontsource](https://fontsource.org) npm packages and bundled into the build.
Each is licensed under the SIL Open Font License 1.1; the licence texts are in
[`licenses/`](licenses/).

| Typeface | Use | Copyright | Licence |
| --- | --- | --- | --- |
| Figtree (`@fontsource/figtree`) | Body text | 2022 The Figtree Project Authors | [OFL-1.1](licenses/figtree-OFL.txt) |
| Caprasimo (`@fontsource/caprasimo`) | Headings | 2023 The Caprasimo Project Authors | [OFL-1.1](licenses/caprasimo-OFL.txt) |
| JetBrains Mono (`@fontsource/jetbrains-mono`) | Identifiers in the Admin console | 2020 The JetBrains Mono Project Authors | [OFL-1.1](licenses/jetbrains-mono-OFL.txt) |

## Third-party code

Untitled UI React components are vendored under
`apps/web/src/components/base`, with chart helpers in `components/application/charts`,
the foundation dot icon, utilities and the resize-observer hook also included.
They retain Copyright (c) 2025 Untitled UI and the
[MIT licence included with this distribution](licenses/untitled-ui-MIT.txt)
([upstream source](https://github.com/untitleduico/react/blob/main/LICENSE)).
See the [shared UI components guide](docs/guides/ui-components.md) for what is
vendored and why.

Runtime and build dependencies keep their own licences; see each package in
`package-lock.json`.
