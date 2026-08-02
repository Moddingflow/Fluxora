# Game template backgrounds

Local, presentation-only artwork for the Create Build game selector.

Contract:

- canvas: exactly `960 x 320` pixels;
- format: WebP;
- encoded size: at most `96 KiB`;
- runtime source: local import only; remote image URLs are not allowed;
- mapping: every bundled `backend/resources/GameDefinitions/*.json` ID must be present in `index.ts`.

## Provenance

| File | Source | Transformation |
| --- | --- | --- |
| `skyrimse.webp` | Existing repository asset `../images/SkyrimSpecialEditionIcon.png` | Center-cropped to 3:1, resized to 960 x 320, converted to compressed WebP. No new remote asset was introduced. |
