# Collage Cutter ✂

A digital version of cutting photos out and sticking them on paper. Everything runs locally in your browser, and your photos never leave your machine.

## Start

- run `./start.sh` (recommended: serves it at http://localhost:8765 and opens your browser; the AI features run about 3× faster this way), or
- double-click `index.html` (everything works, the AI is just slower).

## How it works

1. **Add photos.** Drag them anywhere onto the window, paste with Ctrl+V, or click **Add photos**. They go into the tray on the left.
   To use a photo uncut, click **Place** on its tray card. Or press **Place whole photo** in the cutting window without drawing anything.
2. **Cut.** Click **Cut out** (or the photo itself) to open the cutting window:
   | Tool | Key | How |
   |---|---|---|
   | Adjust | V | Click a shape to select it, drag to move, drag handles to resize. Delete removes it. |
   | Lasso | L | Hold and draw around what you want, then let go. |
   | Polygon | P | Click points. Close by clicking the first point, double-clicking or pressing Enter. |
   | Rectangle / Ellipse | R / E | Drag. |
   | **Magic select** ✨ | W | Click an object and it's outlined automatically. Click the same spot again to cycle between a smaller and a bigger selection (e.g. a shirt vs. the whole person). |

   **Find objects** (F) detects the things in the photo (people, animals, cars, cups, plants… 80 everyday kinds) and lists them. Tick the ones you want, then either place them as one piece or click **Place separately** to get each as its own piece. Detected outlines are ordinary shapes, so you can adjust them with the other tools, Smooth and Feather them, and re-edit them later.

   - **New / Add / Subtract** decide how a new shape combines with the existing ones. You can also hold **Shift** to add or **Alt** to subtract.
   - **Smooth** evens out shaky freehand lines and rounds rectangle corners. **Feather** softens the edge.
   - **Place on paper** (Enter) places the piece and closes the window. **Place + cut more** (Shift+Enter) keeps cutting the same photo.
   - Pieces land where they sat in the original photo, so several pieces from one photo keep their arrangement.

   **Sticker border:** select a piece on the paper and tick **Sticker border** in the panel on the right to give it a die-cut edge. You can set the thickness and colour (white by default) and add an optional soft shadow, which helps a white border show up on white paper.
3. **Arrange.** Drag pieces around. Use the corner handles to resize and the top handle to rotate. Rotation clicks straight when you get within 5° of upright or a right angle, and Shift snaps to 15° steps. Double-click a piece to **re-edit its cut**.
4. **Layering.** Drag rows in the **Layers** panel. The top of the list is the top of the pile. You can also use the Back / Down / Up / Front buttons, or `[` `]` and `Ctrl+[` `Ctrl+]`. The eye icon hides a layer and the padlock locks it in place.
5. **Text.** Click **Text** or press T. Choose the font, size, colour, bold/italic, alignment, line and letter spacing, an outline, and a label box behind it.
6. **Export.** Save as PNG (optionally with a transparent background), JPEG or PDF, at screen, 150 or 300 DPI. Anything hanging off the paper gets trimmed, like real scissors.

## AI features: first use and offline

- The first time you use Find objects or Magic select, the app asks before downloading about **96 MB** of AI files: the AI runtime, a D-FINE object detector and Meta's SAM 2.1 "Segment Anything" model.
- The files are stored in your browser, so after that it **works offline** and doesn't download them again. You can delete them from the paper panel (click empty paper → **AI models → Remove**).
- Everything runs on your computer. Photos are never uploaded.
- Analysing a photo takes a few seconds the first time (about 3 s with `start.sh`, about 8 s when opening `index.html` directly). After that, clicks respond in about 0.2 s. If the models are already downloaded, the analysis starts quietly as soon as you open the cutting window.

## Saving

- Work **autosaves in the browser**, so closing the tab or refreshing is safe.
- **Save** downloads a `.collage` project file with everything embedded, including photos. **Open** it later, or drop it onto the window, to carry on editing.
- **New** clears the paper and keeps your photos in the tray. To empty the tray, use the bin icon in the Photos header. Pieces already on the paper stay, and you can still re-edit them.

## Shortcuts

| | |
|---|---|
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo (also works inside the cutter) |
| Ctrl+D | Duplicate |
| Delete | Delete selection |
| Arrows | Nudge (Shift = 10×) |
| Shift+H / Shift+V | Flip horizontal / vertical |
| Ctrl+A | Select all |
| Space+drag, middle-drag, or scroll | Pan |
| Ctrl+scroll / pinch | Zoom |
| Ctrl+0 | Fit paper to window |
| Ctrl+S / Ctrl+O / Ctrl+E | Save / open / export |

## Notes

- Very large photos are scaled to at most 4000 px on the long edge when imported, which keeps the app quick and still prints sharply.
- HEIC photos (from iPhones) can't be decoded by browsers. Export them as JPEG first.
- AI: [transformers.js](https://github.com/huggingface/transformers.js) 3.8 running [D-FINE](https://huggingface.co/onnx-community/dfine_s_coco-ONNX) and [SAM 2.1 tiny](https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX) (both Apache-2.0), pinned to exact versions.
- Built with [Fabric.js](http://fabricjs.com/) 5.3 and [jsPDF](https://github.com/parallax/jsPDF) 2.5, both in `lib/`. The fonts come from Google Fonts via Fontsource (SIL Open Font License or Apache 2.0) and are embedded in `css/fonts.css` so they work offline.
- Third-party licences and copyright notices are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), with the full texts in `licenses/`.
