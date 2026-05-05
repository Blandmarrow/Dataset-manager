import { useState, useRef, useCallback } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

const CATEGORY_COLORS: Record<string, string> = {
  character: "bg-blue-900/60 text-blue-300 border-blue-700",
  artist: "bg-purple-900/60 text-purple-300 border-purple-700",
  copyright: "bg-yellow-900/60 text-yellow-300 border-yellow-700",
  meta: "bg-gray-700 text-gray-300 border-gray-600",
  general: "bg-surface text-gray-300 border-gray-600",
};

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function TagEditor({ tags, onChange, disabled = false, placeholder = "Add tag..." }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = useCallback(
    (raw: string) => {
      const trimmed = raw.trim().replace(/\s+/g, "_").toLowerCase();
      if (!trimmed || tags.includes(trimmed)) return;
      onChange([...tags, trimmed]);
      setInput("");
    },
    [tags, onChange]
  );

  const removeTag = useCallback(
    (tag: string) => onChange(tags.filter((t) => t !== tag)),
    [tags, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    pasted.split(/[,\n]/).forEach((t) => addTag(t));
  };

  return (
    <div
      className="min-h-[80px] bg-surface border border-gray-600 rounded p-2 flex flex-wrap gap-1.5 cursor-text focus-within:border-accent transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className={clsx(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs",
            CATEGORY_COLORS.general
          )}
        >
          {tag}
          {!disabled && (
            <button
              className="hover:text-red-400 transition-colors ml-0.5"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}

      {!disabled && (
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => input && addTag(input)}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="bg-transparent outline-none text-xs text-gray-200 placeholder-gray-600 min-w-[120px] flex-1"
        />
      )}
    </div>
  );
}
