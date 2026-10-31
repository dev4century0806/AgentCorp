export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
const BLOCKED_USERNAMES = new Set([
  'admin', 'administrator', 'agentcorp', 'help', 'moderator',
  'official', 'owner', 'pam', 'root', 'security', 'staff', 'support', 'system',
  'webmaster',
  'asshole', 'bitch', 'cunt', 'dick', 'fuck', 'fucker', 'hitler', 'nazi', 'shit',
]);

export type UsernameValidation = { valid: true } | { valid: false; message: string };

export function normalizeUsername(username: string): string {
  return username.trim();
}

export function validateUsername(username: string): UsernameValidation {
  const value = normalizeUsername(username);
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    return { valid: false, message: 'Use 3–20 characters.' };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { valid: false, message: 'Use only letters, numbers, and underscores.' };
  }
  if (BLOCKED_USERNAMES.has(value.toLowerCase().replaceAll('_', ''))) {
    return { valid: false, message: 'That username is reserved. Try another.' };
  }
  return { valid: true };
}

export function usernameSaveError(message: string): string {
  if (/profiles_username_lower_key|duplicate key|unique constraint/i.test(message)) {
    return 'That username was just taken. Try another.';
  }
  if (/profiles_username_format|check constraint/i.test(message)) {
    return 'Use 3–20 letters, numbers, or underscores, and choose a non-reserved name.';
  }
  return message;
}

interface UsernameAvailabilityOptions {
  current: string;
  allowUnchanged: boolean;
  check(username: string): Promise<boolean>;
}

export interface UsernameAvailabilityBinding {
  refresh(): void;
  setCurrent(username: string): void;
}

/** Keeps one username field's validation, availability message, and submit state in sync. */
export function bindUsernameAvailability(
  input: HTMLInputElement,
  status: HTMLElement,
  submit: HTMLButtonElement,
  options: UsernameAvailabilityOptions,
): UsernameAvailabilityBinding {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  let current = options.current;

  const show = (message: string, kind: 'm' | 'why' | 'available'): void => {
    status.className = `msg-line username-status ${kind}`;
    status.textContent = message;
  };

  const refresh = (): void => {
    if (timer) clearTimeout(timer);
    const version = ++request;
    const username = normalizeUsername(input.value);
    const validation = validateUsername(username);
    if (!validation.valid) {
      submit.disabled = true;
      show(validation.message, 'why');
      return;
    }
    if (username.toLowerCase() === current.toLowerCase()) {
      submit.disabled = !options.allowUnchanged;
      show(options.allowUnchanged ? 'This suggestion is ready to use.' : 'This is your current username.', 'm');
      return;
    }

    submit.disabled = true;
    show('Checking availability…', 'm');
    timer = setTimeout(() => {
      void options.check(username).then((available) => {
        if (version !== request) return;
        submit.disabled = !available;
        show(available ? 'Username is available.' : 'That username is already taken.', available ? 'available' : 'why');
      }).catch(() => {
        if (version !== request) return;
        submit.disabled = true;
        show('Could not check availability. Try again.', 'why');
      });
    }, 300);
  };

  input.addEventListener('input', refresh);
  refresh();
  return {
    refresh,
    setCurrent(username: string): void {
      current = username;
    },
  };
}
