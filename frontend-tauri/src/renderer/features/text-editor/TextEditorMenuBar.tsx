import { useEffect, useRef, useState } from 'react';

export interface TextEditorMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
}

export interface TextEditorMenuGroup {
  id: string;
  label: string;
  items: TextEditorMenuItem[];
}

interface TextEditorMenuBarProps {
  groups: TextEditorMenuGroup[];
  onCommand: (commandId: string) => void;
}

export function TextEditorMenuBar({ groups, onCommand }: TextEditorMenuBarProps) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openGroupId) {
      return;
    }

    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenGroupId(null);
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenGroupId(null);
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissWithEscape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissWithEscape);
    };
  }, [openGroupId]);

  return (
    <nav className="text-editor-menubar" aria-label="Editor menu" ref={rootRef}>
      {groups.map((group) => {
        const isOpen = group.id === openGroupId;
        return (
          <div
            className="text-editor-menubar-group"
            key={group.id}
            onMouseEnter={() => {
              if (openGroupId) {
                setOpenGroupId(group.id);
              }
            }}
          >
            <button
              aria-expanded={isOpen}
              aria-haspopup="menu"
              className="text-editor-menubar-trigger"
              type="button"
              onClick={() => setOpenGroupId((current) => current === group.id ? null : group.id)}
            >
              {group.label}
            </button>
            {isOpen ? (
              <div className="text-editor-menubar-popup" role="menu" aria-label={`${group.label} menu`}>
                {group.items.map((item) => (
                  <button
                    aria-checked={item.checked}
                    className="text-editor-menubar-item"
                    data-separator={item.separatorBefore ? 'true' : undefined}
                    disabled={item.disabled}
                    key={item.id}
                    role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    type="button"
                    onClick={() => {
                      setOpenGroupId(null);
                      onCommand(item.id);
                    }}
                  >
                    <span className="text-editor-menubar-check" aria-hidden="true">
                      {item.checked ? '✓' : ''}
                    </span>
                    <span>{item.label}</span>
                    {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
