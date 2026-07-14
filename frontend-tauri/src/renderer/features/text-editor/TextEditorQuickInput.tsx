import { useEffect, useMemo, useState } from 'react';

export interface TextEditorQuickInputItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
}

interface TextEditorQuickInputProps {
  label: string;
  placeholder: string;
  prefix?: string;
  items: TextEditorQuickInputItem[];
  onAccept: (item: TextEditorQuickInputItem) => void;
  onDismiss: () => void;
}

export function TextEditorQuickInput({
  label,
  placeholder,
  prefix,
  items,
  onAccept,
  onDismiss
}: TextEditorQuickInputProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(
    () => items.filter((item) =>
      !normalizedQuery
      || item.label.toLowerCase().includes(normalizedQuery)
      || item.detail?.toLowerCase().includes(normalizedQuery)
    ),
    [items, normalizedQuery]
  );

  useEffect(() => setSelectedIndex(0), [normalizedQuery]);

  return (
    <div
      className="text-editor-quick-input-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onDismiss();
        }
      }}
    >
      <section className="text-editor-quick-input" role="dialog" aria-label={label}>
        <label className="text-editor-quick-input-field">
          {prefix ? <span aria-hidden="true">{prefix}</span> : null}
          <input
            aria-label={label}
            autoFocus
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) =>
                  filteredItems.length === 0 ? 0 : (current + 1) % filteredItems.length
                );
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) =>
                  filteredItems.length === 0
                    ? 0
                    : (current - 1 + filteredItems.length) % filteredItems.length
                );
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const item = filteredItems[selectedIndex];
                if (item) {
                  onAccept(item);
                }
              }
            }}
          />
        </label>
        <div className="text-editor-quick-input-results" role="listbox" aria-label={`${label} results`}>
          {filteredItems.map((item, index) => (
            <button
              aria-selected={selectedIndex === index}
              className="text-editor-quick-input-item"
              data-active={selectedIndex === index ? 'true' : undefined}
              key={item.id}
              role="option"
              type="button"
              onClick={() => onAccept(item)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span>
                <strong>{item.label}</strong>
                {item.detail ? <small>{item.detail}</small> : null}
              </span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
          {filteredItems.length === 0 ? (
            <div className="text-editor-quick-input-empty">No matching results</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
