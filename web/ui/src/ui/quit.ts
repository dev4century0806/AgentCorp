
interface DesktopBridge {
  onQuitRequest(listener: (count: number) => void): void;
  resolveQuit(confirmed: boolean): Promise<void>;
}

const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;

export function mountQuitConfirm(): void {
  if (!desktop) return;
  const modal = document.getElementById('quitConfirm');
  const detail = document.getElementById('quitConfirmDetail');
  const keep = document.getElementById('quitKeep');
  const quit = document.getElementById('quitNow');
  if (!(modal instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(keep instanceof HTMLButtonElement) || !(quit instanceof HTMLButtonElement)) return;

  let running = 0;
  const resolve = (confirmed: boolean): void => {
    modal.hidden = true;
    void desktop.resolveQuit(confirmed);
  };

  desktop.onQuitRequest((count) => {
    running = count;
    detail.textContent = `Quitting will stop ${count} running agent${count === 1 ? '' : 's'}. They will come back idle and can be resumed when you open the office again.`;
    modal.hidden = false;
    quit.focus();
  });
  keep.addEventListener('click', () => resolve(false));
  quit.addEventListener('click', () => {
    ;
    resolve(true);
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      resolve(false);
    }
  });
}
