# Third-Party Notices

TaxCLI includes software and assets maintained by third parties. Their licenses apply to those components independently of the project's Taxperia Non-Commercial Attribution License.

## Font Awesome Free

Copyright © 2026 Fonticons, Inc.  
Website: <https://fontawesome.com>

Font Awesome Free is distributed under multiple licenses:

- Icons packaged as SVG and JavaScript: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Web and desktop font files: [SIL Open Font License 1.1](https://openfontlicense.org/)
- Non-font and non-icon code: [MIT License](https://opensource.org/license/mit/)

“Font Awesome” is a reserved font name. Brand icons are trademarks of their respective owners and their inclusion does not imply endorsement.

The complete license text is distributed with the dependency at:

```text
node_modules/@fortawesome/fontawesome-free/LICENSE.txt
```

Packaged releases must preserve the dependency's license and attribution files.

## QRCode

The mobile pairing QR image is generated with the [`qrcode`](https://www.npmjs.com/package/qrcode) npm package, distributed under the MIT License. Its license text is included with the installed dependency at `node_modules/qrcode/license`.

## Provider brand marks

TaxCLI displays provider logos only to identify the corresponding third-party CLI or service:

- OpenAI/Codex symbol sourced from the official OpenAI brand artwork
- Cursor, OpenCode, GitHub Copilot, Google Gemini, and NVIDIA marks distributed through the [Simple Icons](https://simpleicons.org/) project

Simple Icons data is released under CC0 1.0, but the individual logos remain trademarks of their respective owners. Their inclusion does not imply sponsorship, endorsement, or affiliation. Brand marks must be used according to each owner's guidelines.

## Other dependencies

PDF text extraction uses Mozilla PDF.js (`pdfjs-dist`), distributed under Apache License 2.0. The package includes its license at `node_modules/pdfjs-dist/LICENSE` and retains its own notices. Optional canvas dependencies retain the licenses in their package directories.

Additional npm dependency licenses are recorded in `package-lock.json` and their respective package directories. Release builds should generate and ship a complete software bill of materials and third-party license bundle.
