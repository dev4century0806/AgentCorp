import type { Attachment } from '@shared';
import { MAX_UPLOAD_BYTES } from '../net/client.js';
import { clear, closeButton, el } from './dom.js';

/** Files picked, pasted or dropped but not sent yet, shown as removable chips. */
export interface AttachTray {
  readonly files: readonly File[];
  /** Adds the files, or none of them if they would go over the upload limit. */
  add(files: Iterable<File>): void;
  remove(index: number): void;
  clear(): void;
}

export function attachTray(
  list: HTMLElement,
  opts: {
    onChange?: () => void;
    onError: (message: string) => void;
    /** Bytes already attached alongside these, such as an idea's saved files, which count toward the limit. */
    used?: () => number;
  },
): AttachTray {
  let files: File[] = [];

  const changed = () => {
    render();
    opts.onChange?.();
  };

  const render = () => {
    clear(list);
    list.hidden = !files.length;
    files.forEach((file, i) => {
      const chip = el('span', 'attach-chip');
      if (file.type.startsWith('image/')) {
        const img = el('img', 'attach-thumb');
        img.src = URL.createObjectURL(file);
        img.alt = '';
        img.onload = () => URL.revokeObjectURL(img.src);
        chip.appendChild(img);
      }
      chip.appendChild(el('span', 'attach-name', file.name || 'pasted image'));
      const remove = closeButton('attach-remove', `Remove ${file.name}`);
      remove.addEventListener('click', () => tray.remove(i));
      chip.appendChild(remove);
      list.appendChild(chip);
    });
  };

  const tray: AttachTray = {
    get files() {
      return files;
    },
    add(more) {
      const next = [...files, ...more];
      if (next.reduce((sum, f) => sum + f.size, opts.used?.() ?? 0) > MAX_UPLOAD_BYTES) {
        opts.onError(`Attachments can come to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB at most.`);
        return;
      }
      files = next;
      changed();
    },
    remove(index) {
      files = files.filter((_, i) => i !== index);
      changed();
    },
    clear() {
      if (!files.length) return;
      files = [];
      changed();
    },
  };
  render();
  return tray;
}

/**
 * Files already saved, as chips that open them in a new tab. With `onRemove`
 * each has a remove button too, which takes its chip away and says which file went.
 */
export function savedFileChips(
  files: readonly Attachment[],
  href: (file: Attachment) => string,
  onRemove?: (file: Attachment) => void,
): HTMLElement {
  const list = el('div', 'attach-list saved-files');
  list.hidden = !files.length;
  for (const file of files) {
    const chip = el('span', 'attach-chip');
    if (file.mimeType.startsWith('image/')) {
      const img = el('img', 'attach-thumb');
      img.src = href(file);
      img.alt = '';
      chip.appendChild(img);
    }
    const link = el('a', 'attach-name', file.name);
    link.href = href(file);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = `Open ${file.name}`;
    chip.appendChild(link);
    if (onRemove) {
      const remove = closeButton('attach-remove', `Remove ${file.name}`);
      remove.addEventListener('click', () => {
        chip.remove();
        list.hidden = !list.children.length;
        onRemove(file);
      });
      chip.appendChild(remove);
    }
    list.appendChild(chip);
  }
  return list;
}

/**
 * Takes files dropped anywhere on `zone`, highlighting it with `.dropping`
 * while they are over it, and files pasted into `input`.
 */
export function wireFileDrop(zone: HTMLElement, input: HTMLElement, add: (files: FileList) => void): void {
  input.addEventListener('paste', (e) => {
    const files = e.clipboardData?.files;
    if (!files?.length) return;
    e.preventDefault();
    add(files);
  });
  zone.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    zone.classList.add('dropping');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget as Node | null)) zone.classList.remove('dropping');
  });
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('dropping');
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    add(e.dataTransfer.files);
  });
}
