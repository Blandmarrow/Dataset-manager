interface Props {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = "Confirm", danger = false }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="card p-6 w-full max-w-sm space-y-4">
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-gray-400 text-sm">{message}</p>
        <div className="flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
