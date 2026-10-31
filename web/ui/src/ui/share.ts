/**
 * Share dialog for agents and skills.
 *
 * Opens when the user clicks Share on a persona or skill, asks for a
 * recipient username, validates it exists and isn't blocked, strips
 * secrets, and sends the share.
 */

import type { Persona, SharePackageData } from '@shared';
import { SECRET_PATTERNS } from '@shared';
import { $, clear, el, escapeHtml, iconSvg, iconText, TEXT_ICONS } from './dom.js';
import { lookupUserByUsername, sharePackage, signedInUsername } from './auth.js';

/** Strip secrets from text and return what was removed. */
function stripSecrets(text: string): { text: string; stripped: string[] } {
  const stripped = new Set<string>();
  let result = text;

  for (const { pattern, kind } of SECRET_PATTERNS) {
    // Create a fresh regex to avoid issues with global state
    const regex = new RegExp(pattern, 'gi');
    if (regex.test(text)) {
      stripped.add(kind);
      // Reset and replace
      const replaceRegex = new RegExp(pattern, 'gi');
      result = result.replace(replaceRegex, '[REDACTED]');
    }
  }

  return { text: result, stripped: [...stripped] };
}

/** What's being shared. */
export type ShareTarget =
  | { type: 'agent'; persona: Persona }
  | { type: 'skill'; skill: { id: string; name: string; description: string; instructions: string; files: string[] } };

/** Opens the share dialog. Returns true if shared successfully. */
export async function openShareDialog(target: ShareTarget): Promise<boolean> {
  const dialog = $<HTMLDialogElement>('shareDialog');
  const form = $<HTMLFormElement>('shareForm');
  const recipientInput = $<HTMLInputElement>('shareRecipient');
  const status = $<HTMLElement>('shareStatus');
  const preview = $<HTMLElement>('sharePreview');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const title = $<HTMLElement>('shareTitle');
  const secretsWarning = $<HTMLElement>('shareSecretsWarning');

  // Set title
  const name = target.type === 'agent' ? target.persona.name : target.skill.name;
  title.textContent = `Share ${target.type === 'agent' ? 'agent' : 'skill'}: ${name}`;

  // Check for secrets and show preview
  const content = target.type === 'agent'
    ? target.persona.instructions
    : target.skill.instructions;
  const { text: strippedContent, stripped } = stripSecrets(content);

  // Show what's being shared
  clear(preview);
  const previewTitle = el('b', null, name);
  preview.appendChild(previewTitle);

  if (target.type === 'agent') {
    const p = target.persona;
    const meta = el('div', 'm');
    meta.textContent = [
      p.permission !== 'standard' ? `Permission: ${p.permission}` : null,
      p.model ? `Model: ${p.model}` : null,
    ].filter(Boolean).join(' · ') || 'Default settings';
    preview.appendChild(meta);
  } else {
    if (target.skill.description) {
      preview.appendChild(el('p', 'm', target.skill.description));
    }
    if (target.skill.files.length > 0) {
      const files = el('div', 'share-files-notice');
      files.innerHTML = iconSvg(TEXT_ICONS.warning, 'text-icon') + '<b>Contains code:</b> ' + escapeHtml(target.skill.files.join(', '));
      preview.appendChild(files);
    }
  }

  // Show secrets warning if any were stripped
  if (stripped.length > 0) {
    secretsWarning.innerHTML = `${iconSvg(TEXT_ICONS.lock, 'text-icon')}<b>Secrets will be removed:</b> ${escapeHtml(stripped.join(', '))}`;
    secretsWarning.hidden = false;
  } else {
    secretsWarning.hidden = true;
  }

  // Reset form
  recipientInput.value = '';
  status.textContent = '';
  status.className = 'msg-line';
  button.disabled = false;
  button.textContent = 'Share';

  // Validate recipient on blur
  let validatedUser: { userId: string; username: string } | null = null;
  recipientInput.addEventListener('blur', async () => {
    const username = recipientInput.value.trim();
    if (!username) return;

    // Can't share with yourself
    if (username.toLowerCase() === signedInUsername().toLowerCase()) {
      status.className = 'msg-line why';
      status.textContent = "That's you! Enter someone else's username.";
      validatedUser = null;
      return;
    }

    try {
      validatedUser = await lookupUserByUsername(username);
      if (!validatedUser) {
        status.className = 'msg-line why';
        status.textContent = `No user found with username "${username}"`;
      } else {
        status.className = 'msg-line';
        status.textContent = `Will share with ${validatedUser.username}`;
      }
    } catch (err) {
      status.className = 'msg-line why';
      status.textContent = (err as Error).message;
      validatedUser = null;
    }
  });

  return new Promise((resolve) => {
    const close = (success: boolean) => {
      dialog.close();
      resolve(success);
    };

    $('shareCancel').onclick = () => close(false);
    dialog.addEventListener('close', () => resolve(false), { once: true });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const username = recipientInput.value.trim();
      if (!username) {
        status.className = 'msg-line why';
        status.textContent = 'Enter a username';
        return;
      }

      button.disabled = true;
      button.textContent = 'Sharing…';
      status.className = 'msg-line';
      status.textContent = '';

      try {
        // Look up user if not already validated
        if (!validatedUser || validatedUser.username.toLowerCase() !== username.toLowerCase()) {
          validatedUser = await lookupUserByUsername(username);
          if (!validatedUser) {
            throw new Error(`No user found with username "${username}"`);
          }
        }

        // Prepare package data
        const packageData: SharePackageData = target.type === 'agent'
          ? {
              name: target.persona.name,
              persona: {
                ...target.persona,
                instructions: strippedContent,
              },
            }
          : {
              name: target.skill.name,
              skill: {
                id: target.skill.id,
                name: target.skill.name,
                description: target.skill.description,
                instructions: strippedContent,
                files: target.skill.files,
              },
            };

        await sharePackage(
          validatedUser.username,
          target.type === 'agent' ? 'agent' : 'skill',
          packageData,
          stripped
        );

        status.className = 'msg-line';
        iconText(status, TEXT_ICONS.check, `Shared with ${validatedUser.username}`);
        button.textContent = 'Done';

        // Close after a short delay
        setTimeout(() => close(true), 1500);
      } catch (err) {
        status.className = 'msg-line why';
        status.textContent = (err as Error).message;
        button.disabled = false;
        button.textContent = 'Share';
      }
    };

    dialog.showModal();
    recipientInput.focus();
  });
}
