import { TextareaHTMLAttributes, useEffect, useRef } from "react";

/**
 * Textarea yang otomatis membesar mengikuti isi teks (Enter tetap menyisipkan
 * baris baru seperti biasa -- itu perilaku bawaan <textarea>, tidak perlu
 * Alt+Enter seperti di Excel).
 */
export default function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);

  return (
    <textarea
      ref={ref}
      rows={2}
      {...props}
      style={{ overflow: "hidden", resize: "none", ...props.style }}
    />
  );
}
