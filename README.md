# TSAssetHover

TSAssetHover helps TypeScript projects preview local asset paths directly from the editor. Hover a string literal that points to a workspace file, and the extension shows a preview or quick actions for that file.

## What You Can Do

- Preview image assets from TypeScript and TSX string literals.
- Open the referenced workspace file from the hover popup.
- Send the referenced file to the Codex/ChatGPT extension when it is installed.
- Use Windows or Unix-style path separators.
- See a clear missing-file message when the path cannot be resolved.

## How To Use

Open a TypeScript or TSX file and hover a string path that points to a file in your workspace:

```ts
const icon = "assets/images/ui_icon.blp";
const font = "assets/fonts/main.ttf";
```

If the path points to an image, the hover shows a preview and file actions. If the path points to another supported workspace file, the hover shows file actions without an image preview.

## Supported Image Previews

- PNG
- JPG / JPEG
- TGA
- BLP

BLP preview is intended for Warcraft III BLP1 textures. BLP2 preview is not currently supported.

## Requirements

- VS Code 1.118.0 or newer
- Optional: OpenAI Codex/ChatGPT extension for the `Send File to ChatGPT` action

## Notes

- Paths must point to files inside the current workspace.
- Very large image previews are scaled down in the hover.
- Some uncommon BLP1 variants may not preview correctly yet.
