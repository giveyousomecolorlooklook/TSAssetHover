# TSAssetHover

TSAssetHover is a VS Code extension for TypeScript projects. It detects string literals that point to workspace files, shows image previews on hover, and lets you open or send the referenced file to the Codex/ChatGPT extension.

## Features

- Hover preview for image paths in TypeScript and TSX files.
- Clickable `Open File` action for any supported workspace file path.
- Clickable `Send File to ChatGPT` action using `chatgpt.addFileToThread` when the OpenAI Codex/ChatGPT extension is installed.
- Workspace-safe path resolution for Windows and Unix separators.
- Missing files show `文件未找到`.
- Large previews are scaled to a configurable maximum size.

## Supported Images

Image preview support is configured in [src/config.ts](src/config.ts):

```ts
export const IMAGE_FILE_TYPES = ['png', 'jpg', 'jpeg', 'tga', 'blp'];
```

Current decoder behavior:

- `png`, `jpg`, `jpeg`: embedded as data URIs and scaled in the hover.
- `tga`: decoded locally and rendered as PNG data URI.
- `blp`: supports Warcraft III BLP1 palette/raw images and BLP1 JPEG-compressed images. BLP2 is not supported yet.

## Supported Workspace Files

Workspace file hover support is configured in [src/config.ts](src/config.ts):

```ts
export const WORKSPACE_FILE_TYPES = ['*'];
```

Supported config patterns:

- `png`
- `.png`
- `*.png`
- `*`
- `*.*`

`*` means any workspace file with an extension can show an `Open File` action. Only types listed in `IMAGE_FILE_TYPES` try to render an image preview.

## Usage

In a TypeScript or TSX file, hover a string literal such as:

```ts
const icon = "assets/images/ui_icon.blp";
const font = "assets/fonts/main.ttf";
```

For image files, the hover shows a preview plus actions. For non-image files, the hover shows file actions only.

## Commands

This extension registers internal command-link commands:

- `extension.openFile`
- `extension.sendAssetContextToChatGPT`

They are intended for hover links and are hidden from the command palette.

## Requirements

- VS Code `^1.118.0`
- Optional: OpenAI Codex/ChatGPT extension for the `Send File to ChatGPT` action.

## Known Issues

- BLP2 preview is not implemented.
- Some uncommon BLP1 variants may not decode yet.
- SVG and WebP are not included by default, but can be added to config if preview support is implemented.
