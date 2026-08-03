// 토스트·확인 다이얼로그 스토어. window.alert/confirm은 쓰지 않는다 (규칙 14).

export type ToastKind = "ok" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const TOAST_TTL_MS = 4200;
let nextId = 1;

class ToastStore {
  items = $state<Toast[]>([]);

  push(kind: ToastKind, message: string): void {
    const id = nextId++;
    this.items = [...this.items, { id, kind, message }];
    setTimeout(() => this.dismiss(id), TOAST_TTL_MS);
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  ok(message: string): void {
    this.push("ok", message);
  }
  error(message: unknown): void {
    this.push("error", message instanceof Error ? message.message : String(message));
  }
  info(message: string): void {
    this.push("info", message);
  }
}

export const toasts = new ToastStore();

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

class ConfirmStore {
  request = $state<ConfirmRequest | null>(null);

  ask(
    title: string,
    body: string,
    opts: { confirmLabel?: string; danger?: boolean } = {},
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.request = {
        title,
        body,
        confirmLabel: opts.confirmLabel ?? "확인",
        danger: opts.danger ?? false,
        resolve,
      };
    });
  }

  answer(ok: boolean): void {
    this.request?.resolve(ok);
    this.request = null;
  }
}

export const confirms = new ConfirmStore();
