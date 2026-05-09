# Change Log

All notable changes to the TSAssetHover extension will be documented in this file.

## [1.0.0] - 2026-05-09

### Added

- Hover previews for image paths in TypeScript and TSX string literals.
- Workspace file resolution with Windows and Unix path separator support.
- `Open File` hover action for supported workspace files.
- `Send File to ChatGPT` hover action through `chatgpt.addFileToThread`.
- Configurable image file types and workspace file types in `src/config.ts`.
- Preview scaling via `PREVIEW_MAX_SIZE`.
- PNG, JPG, JPEG, TGA, and Warcraft III BLP image preview support.
- BLP1 palette/raw and BLP1 JPEG-compressed decoding.
- Missing file message: `文件未找到`.
