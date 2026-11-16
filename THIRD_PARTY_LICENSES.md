# Third-party licences

Collage Cutter's own code is under the MIT License (see [LICENSE](LICENSE)). It also includes the following third-party software and fonts. Each one is used under its own licence. The full licence texts are in the [`licenses/`](licenses) folder.

## Bundled libraries (`lib/`)

| Component | Version | Licence | Copyright | Licence text |
|---|---|---|---|---|
| [Fabric.js](https://github.com/fabricjs/fabric.js) | 5.3.0 | MIT | © 2008–2015 Printio (Juriy Zaytsev, Maxim Chernyak) | [licenses/fabric.js-MIT.txt](licenses/fabric.js-MIT.txt) |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | MIT | © 2010–2021 James Hall; © 2015–2021 yWorks GmbH; and contributors | [licenses/jsPDF-MIT.txt](licenses/jsPDF-MIT.txt) |

`lib/fabric.min.js` has one small change: the canvas text baseline value `"alphabetical"` was corrected to `"alphabetic"` to stop a browser console warning. `lib/jspdf.umd.min.js` is unmodified, and its header keeps the full list of contributors and the notices for the components it bundles.

## Fonts (embedded in `css/fonts.css`)

The fonts come from [Google Fonts](https://fonts.google.com/) through the [Fontsource](https://fontsource.org/) 5.3.0 packages and are embedded as base64 so they work offline. Under both licences they may be bundled with software, but they may not be sold on their own.

| Font | Licence | Copyright | Licence text |
|---|---|---|---|
| Abril Fatface | SIL OFL 1.1 | © 2011 TypeTogether, Reserved Font Names "Abril" and "Abril Fatface" | [abril-fatface.txt](licenses/fonts/abril-fatface.txt) |
| Anton | SIL OFL 1.1 | © 2020 The Anton Project Authors | [anton.txt](licenses/fonts/anton.txt) |
| Archivo Black | SIL OFL 1.1 | © 2017 The Archivo Black Project Authors | [archivo-black.txt](licenses/fonts/archivo-black.txt) |
| Bebas Neue | SIL OFL 1.1 | © 2019 The Bebas Neue Project Authors | [bebas-neue.txt](licenses/fonts/bebas-neue.txt) |
| Caveat | SIL OFL 1.1 | © 2014 The Caveat Project Authors | [caveat.txt](licenses/fonts/caveat.txt) |
| Courier Prime | SIL OFL 1.1 | © 2015 The Courier Prime Project Authors | [courier-prime.txt](licenses/fonts/courier-prime.txt) |
| Inter | SIL OFL 1.1 | © 2016 The Inter Project Authors | [inter.txt](licenses/fonts/inter.txt) |
| Lobster | SIL OFL 1.1 | © 2010 The Lobster Project Authors, Reserved Font Name "Lobster" | [lobster.txt](licenses/fonts/lobster.txt) |
| Pacifico | SIL OFL 1.1 | © 2018 The Pacifico Project Authors | [pacifico.txt](licenses/fonts/pacifico.txt) |
| Playfair Display | SIL OFL 1.1 | © 2017 The Playfair Display Project Authors, Reserved Font Name "Playfair Display" | [playfair-display.txt](licenses/fonts/playfair-display.txt) |
| Permanent Marker | Apache 2.0 | © 2010 Font Diner, Inc. | [permanent-marker.txt](licenses/fonts/permanent-marker.txt) |
| Rock Salt | Apache 2.0 | © 2010 Font Diner, Inc DBA Sideshow | [rock-salt.txt](licenses/fonts/rock-salt.txt) |
| Special Elite | Apache 2.0 | © 2010 Brian J. Bonislawsky DBA Astigmatic (AOETI) | [special-elite.txt](licenses/fonts/special-elite.txt) |

## Downloaded at runtime (not included in this repository)

The AI features download these files into the browser only after the user agrees. They aren't redistributed here, and they're listed for reference:

- [transformers.js](https://github.com/huggingface/transformers.js) 3.8.1 (Apache 2.0) and [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), loaded from jsDelivr.
- [D-FINE small (COCO)](https://huggingface.co/onnx-community/dfine_s_coco-ONNX) (Apache 2.0) and [SAM 2.1 Hiera tiny](https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX) (Apache 2.0), loaded from Hugging Face.
