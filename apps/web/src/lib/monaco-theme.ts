import type { Monaco } from "@monaco-editor/react";

export const MONACO_THEME = "bytewise-dark";

export const MONACO_FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/** Matches the workspace tokens in `app/globals.css`. Safe to call repeatedly. */
export function defineBytewiseTheme(monaco: Monaco) {
  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7489", fontStyle: "italic" },
      { token: "keyword", foreground: "c792ea" },
      { token: "string", foreground: "a5d6a7" },
      { token: "number", foreground: "f2b84b" },
    ],
    colors: {
      "editor.background": "#0d1016",
      "editorGutter.background": "#0d1016",
      "editor.lineHighlightBackground": "#141923",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#3a4252",
      "editorLineNumber.activeForeground": "#8b93a7",
      "editor.selectionBackground": "#2b3a5c",
      "editorIndentGuide.background1": "#1c222d",
      "editorWidget.background": "#151921",
      "editorWidget.border": "#212733",
      "scrollbarSlider.background": "#2a314066",
      "scrollbarSlider.hoverBackground": "#2a3140aa",
      "diffEditor.insertedLineBackground": "#3fcf8e14",
      "diffEditor.removedLineBackground": "#f06a6a14",
      "diffEditor.insertedTextBackground": "#3fcf8e33",
      "diffEditor.removedTextBackground": "#f06a6a33",
      "diffEditorGutter.insertedLineBackground": "#3fcf8e22",
      "diffEditorGutter.removedLineBackground": "#f06a6a22",
    },
  });
}
