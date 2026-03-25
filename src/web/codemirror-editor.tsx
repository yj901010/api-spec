import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#f8fbff',
    backgroundColor: 'rgba(6, 12, 28, 0.92)',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    minWidth: 'max-content',
    padding: '8px 0',
  },
  '.cm-gutters': {
    color: 'rgba(255, 255, 255, 0.45)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
  },
  '.cm-activeLineGutter': {
    color: '#f8fbff',
    backgroundColor: 'rgba(100, 181, 255, 0.12)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(100, 181, 255, 0.1)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(100, 181, 255, 0.25) !important',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#9dd8ff',
    borderLeftWidth: '2px',
  },
});

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  selection?: {
    from: number;
    to: number;
    token: string;
  } | null;
}

export function CodeMirrorEditor({ value, onChange, ariaLabel, selection }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const appliedSelectionTokenRef = useRef<string | null>(null);

  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
    view.dom.setAttribute('aria-label', ariaLabel);
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: {
        from: 0,
        to: current.length,
        insert: value,
      },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selection) return;
    if (appliedSelectionTokenRef.current === selection.token) return;
    const length = view.state.doc.length;
    const from = Math.max(0, Math.min(selection.from, length));
    const to = Math.max(from, Math.min(selection.to, length));
    appliedSelectionTokenRef.current = selection.token;
    view.dispatch({
      selection: {
        anchor: from,
        head: to,
      },
      scrollIntoView: true,
    });
    view.focus();
  }, [selection?.token, selection?.from, selection?.to]);

  useEffect(() => {
    if (!selection) {
      appliedSelectionTokenRef.current = null;
    }
  }, [selection]);

  return <div ref={containerRef} className="cm-host" />;
}
