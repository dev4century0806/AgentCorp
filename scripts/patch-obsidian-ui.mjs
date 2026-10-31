import fs from 'node:fs';

const file = 'D:/Project/AgentCorp/web/ui/dist/assets/index-BtYC2mdW.js';
let content = fs.readFileSync(file, 'utf8');

const helper = `function o_obsidianSection(){
  const pill = p('span', 'pill pill-ok', 'Ready');
  const card = mn('Obsidian Semantic Memory', 'Local vector memory with sqlite-vec and all-MiniLM-L6-v2. Notes & ADRs are vectorized for agents.', [pill]);
  card.id = 'obsidianCard';
  const statusLine = p('div', 'setting-status-line');
  statusLine.style.cssText = 'margin:8px 0;font-size:12px;color:var(--text-muted,#888);';
  statusLine.textContent = 'Checking status...';
  const inputRow = p('div', 'setting-input-row');
  inputRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:10px;';
  const pathInput = p('input', 'ask-path');
  pathInput.type = 'text';
  pathInput.placeholder = 'D:\\\\Path\\\\To\\\\Your\\\\Obsidian\\\\Vault';
  pathInput.style.cssText = 'flex:1;padding:6px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#fff;';
  const syncBtn = p('button', 'btn small primary', 'Sync Vault');
  syncBtn.type = 'button';
  syncBtn.style.cssText = 'padding:6px 14px;cursor:pointer;';
  inputRow.append(pathInput, syncBtn);
  card.append(inputRow, statusLine);

  const refresh = async () => {
    try {
      const res = await fetch('/api/obsidian/status', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const st = await res.json();
      if (st.vaultPath && !pathInput.value) pathInput.value = st.vaultPath;
      statusLine.textContent = 'Indexed notes: ' + (st.count ?? 0) + ' chunks | Vault: ' + (st.vaultPath || 'Not configured');
      pill.textContent = st.enabled ? 'Active' : 'Standby';
      pill.className = st.enabled ? 'pill pill-ok' : 'pill pill-off';
    } catch (err) {
      statusLine.textContent = 'Status error: ' + err.message;
    }
  };

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    statusLine.textContent = 'Vectorizing Markdown files into SQLite...';
    try {
      const res = await fetch('/api/obsidian/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ vaultPath: pathInput.value.trim() || undefined })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      statusLine.textContent = 'Sync completed! Indexed ' + (data.newChunksIndexed ?? 0) + ' new chunks (' + (data.totalNotesInIndex ?? data.filesScanned) + ' total).';
      pill.textContent = 'Active';
      pill.className = 'pill pill-ok';
    } catch (err) {
      statusLine.textContent = 'Sync failed: ' + err.message;
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Vault';
    }
  });

  void refresh();
  return card;
};
`;

if (!content.includes('o_obsidianSection')) {
  content = content.replace('function Rz(t,e,n,i,s){', helper + 'function Rz(t,e,n,i,s){');
  content = content.replace('o.appendChild(l.node),o.appendChild(o7(t,n))', 'o.appendChild(l.node),o.appendChild(o_obsidianSection()),o.appendChild(o7(t,n))');
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully patched index-BtYC2mdW.js with Obsidian section!');
} else {
  console.log('Already contains o_obsidianSection.');
}
